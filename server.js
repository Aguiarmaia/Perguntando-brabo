const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { generateAIQuestions } = require('./questions/ai-questions');
const { getRandomQuestions } = require('./questions/questions');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function suggestQuestions(playerCount) {
  // ~3 rounds per player pair, minimum 5
  return Math.max(5, playerCount * 3);
}

function createRoom(hostId, maxPlayers, questionCount, hostPlays) {
  let code;
  do { code = generateCode(); } while (rooms[code]);

  rooms[code] = {
    code,
    host: hostId,
    hostPlays,
    maxPlayers,
    questionCount,
    players: {},       // id -> { id, name, score, inGame, onBench, isHost }
    spectators: {},    // id -> { id, name } — host if not playing
    state: 'waiting',  // waiting | generating | countdown | question | reveal | paused | finished
    questions: [],
    currentQuestion: 0,
    currentPair: [],   // [id, id] currently at the table
    bench: [],         // queue of ids waiting
    answers: {},       // id -> answerIndex
    skipVotes: {},
    questionTimer: null,
    revealTimer: null,
    _questionStart: null,
    _questionDuration: 60000,
    pausedRemaining: null,
  };
  return rooms[code];
}

// Pick next pair from bench
function getNextPair(room) {
  const bench = room.bench;
  if (bench.length === 0) return [];
  if (bench.length === 1) return [bench[0]];
  return [bench[0], bench[1]];
}

function broadcastState(room) {
  const code = room.code;
  const q = room.questions[room.currentQuestion];

  const base = {
    state: room.state,
    players: room.players,
    spectators: room.spectators,
    currentPair: room.currentPair,
    bench: room.bench,
    currentQuestion: room.currentQuestion,
    totalQuestions: room.questions.length,
    question: q ? { question: q.question, options: q.options } : null,
    answers: room.answers,
    host: room.host,
    hostPlays: room.hostPlays,
  };

  // Send to each player/spectator with their role context
  const allSockets = [...Object.keys(room.players), ...Object.keys(room.spectators)];
  allSockets.forEach(sid => {
    const s = io.sockets.sockets.get(sid);
    if (s) s.emit('room_state', { ...base, myId: sid });
  });
}

function startQuestion(room) {
  const code = room.code;
  room.state = 'question';
  room.answers = {};
  room.skipVotes = {};
  room._questionStart = Date.now();
  room._questionDuration = 60000;

  broadcastState(room);

  room.questionTimer = setTimeout(() => revealAnswer(room), 60000);
}

function revealAnswer(room) {
  const code = room.code;
  if (room.questionTimer) clearTimeout(room.questionTimer);
  room.state = 'reveal';

  const q = room.questions[room.currentQuestion];
  const results = {};
  let anyCorrect = false;

  room.currentPair.forEach(pid => {
    const answer = room.answers[pid];
    const didNotAnswer = answer === undefined;
    const correct = !didNotAnswer && answer === q.correct;
    if (correct) {
      room.players[pid].score = (room.players[pid].score || 0) + 1;
      anyCorrect = true;
    }
    results[pid] = { answer: didNotAnswer ? null : answer, correct, didNotAnswer };
  });

  // Determine who goes to bench (who erred)
  const losers = room.currentPair.filter(pid => !results[pid]?.correct);
  const winners = room.currentPair.filter(pid => results[pid]?.correct);

  // Move losers to bench (end of queue), remove from currentPair
  losers.forEach(pid => {
    if (room.players[pid]) room.players[pid].onBench = true;
    room.bench.push(pid);
  });

  // Winners stay at table (still in currentPair after leader advances)
  // but we store the result so leader can decide when to advance
  room._lastResults = results;
  room._lastLosers = losers;
  room._lastWinners = winners;
  room._lastCorrectIndex = q.correct;
  room._lastExplanation = q.explanation || '';

  const allWrong = losers.length === room.currentPair.length;

  io.to(code).emit('reveal_answer', {
    correctIndex: q.correct,
    explanation: q.explanation || '',
    results,
    scores: Object.fromEntries(Object.entries(room.players).map(([id, p]) => [id, p.score || 0])),
    players: room.players,
    allWrong,
    waitingForLeader: true,
  });
}

function advanceAfterReveal(room) {
  const code = room.code;
  if (room.revealTimer) clearTimeout(room.revealTimer);

  const losers = room._lastLosers || [];
  const winners = room._lastWinners || [];

  // Build new pair: winners stay + pull from bench to fill 2 spots
  let newPair = [...winners];
  while (newPair.length < 2 && room.bench.length > 0) {
    const next = room.bench.shift();
    if (room.players[next]) room.players[next].onBench = false;
    newPair.push(next);
  }

  // If only 1 player left total, end game
  const totalPlayers = Object.keys(room.players).length;
  if (totalPlayers < 2) {
    endGame(room);
    return;
  }

  room.currentPair = newPair;
  room.currentQuestion++;

  if (room.currentQuestion >= room.questions.length) {
    endGame(room);
  } else {
    startQuestion(room);
  }
}

function endGame(room) {
  const code = room.code;
  room.state = 'finished';

  const sorted = Object.values(room.players)
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  io.to(code).emit('game_over', {
    ranking: sorted,
    players: room.players,
  });
}

io.on('connection', (socket) => {
  console.log(`[+] ${socket.id}`);

  // Host creates room
  socket.on('create_room', ({ name, maxPlayers, questionCount, hostPlays }) => {
    const room = createRoom(socket.id, maxPlayers, questionCount, hostPlays);
    socket.join(room.code);

    if (hostPlays) {
      room.players[socket.id] = { id: socket.id, name, score: 0, isHost: true, ready: false, onBench: false, inGame: false };
    } else {
      room.spectators[socket.id] = { id: socket.id, name, isHost: true };
    }

    socket.emit('room_created', {
      code: room.code,
      isHost: true,
      hostPlays,
      suggestedQuestions: suggestQuestions(maxPlayers),
      questionCount,
      maxPlayers,
    });
    console.log(`[ROOM] ${room.code} by ${name} (${maxPlayers}p, ${questionCount}q, hostPlays=${hostPlays})`);
  });

  // Player joins
  socket.on('join_room', ({ code, name }) => {
    const room = rooms[code.toUpperCase()];
    if (!room) return socket.emit('error', { message: 'Sala não encontrada!' });
    if (room.state !== 'waiting') return socket.emit('error', { message: 'Torneio já em andamento!' });
    const playerCount = Object.keys(room.players).length + Object.keys(room.spectators).length;
    if (playerCount >= room.maxPlayers + (room.hostPlays ? 0 : 1)) return socket.emit('error', { message: 'Sala cheia!' });

    room.players[socket.id] = { id: socket.id, name, score: 0, isHost: false, ready: false, onBench: false, inGame: false };
    socket.join(code.toUpperCase());

    socket.emit('room_joined', { code: code.toUpperCase(), isHost: false });
    io.to(code.toUpperCase()).emit('lobby_update', {
      players: room.players,
      spectators: room.spectators,
      maxPlayers: room.maxPlayers,
      questionCount: room.questionCount,
    });
    console.log(`[JOIN] ${name} -> ${code}`);
  });

  // Player ready
  socket.on('player_ready', ({ code }) => {
    const room = rooms[code];
    if (!room || !room.players[socket.id]) return;
    room.players[socket.id].ready = true;
    io.to(code).emit('lobby_update', {
      players: room.players,
      spectators: room.spectators,
      maxPlayers: room.maxPlayers,
      questionCount: room.questionCount,
    });
  });

  // HOST: start tournament
  socket.on('start_tournament', ({ code }) => {
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;
    if (Object.keys(room.players).length < 2) return socket.emit('error', { message: 'Precisa de pelo menos 2 jogadores!' });

    room.state = 'generating';
    io.to(code).emit('generating_questions');

    // First 2 players at table, rest on bench
    const playerIds = Object.keys(room.players);
    // Shuffle for fairness
    playerIds.sort(() => Math.random() - 0.5);
    room.currentPair = [playerIds[0], playerIds[1]];
    room.bench = playerIds.slice(2);
    room.bench.forEach(id => { if (room.players[id]) room.players[id].onBench = true; });

    generateAIQuestions(room.questionCount)
      .then(questions => {
        room.questions = questions;
        io.to(code).emit('game_countdown', { seconds: 3 });
        room.state = 'countdown';
        setTimeout(() => startQuestion(room), 3000);
      })
      .catch(err => {
        console.error('[AI] fallback:', err.message);
        room.questions = getRandomQuestions(room.questionCount);
        io.to(code).emit('generating_fallback');
        io.to(code).emit('game_countdown', { seconds: 3 });
        room.state = 'countdown';
        setTimeout(() => startQuestion(room), 3000);
      });
  });

  // HOST: update question count before start
  socket.on('update_question_count', ({ code, count }) => {
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;
    room.questionCount = Math.max(1, Math.min(50, count));
    io.to(code).emit('lobby_update', {
      players: room.players,
      spectators: room.spectators,
      maxPlayers: room.maxPlayers,
      questionCount: room.questionCount,
    });
  });

  // Player submits answer (only current pair)
  socket.on('submit_answer', ({ code, answer }) => {
    const room = rooms[code];
    if (!room || room.state !== 'question') return;
    if (!room.currentPair.includes(socket.id)) return;
    if (room.answers[socket.id] !== undefined) return;

    room.answers[socket.id] = answer;
    socket.emit('answer_received', { answer });
    socket.to(code).emit('opponent_answered', { playerId: socket.id });

    // If both of current pair answered, reveal
    if (room.currentPair.every(pid => room.answers[pid] !== undefined)) {
      clearTimeout(room.questionTimer);
      revealAnswer(room);
    }
  });

  // HOST: pause
  socket.on('host_pause', ({ code }) => {
    const room = rooms[code];
    if (!room || room.host !== socket.id || room.state !== 'question') return;
    const elapsed = Date.now() - room._questionStart;
    room.pausedRemaining = Math.max(0, room._questionDuration - elapsed);
    clearTimeout(room.questionTimer);
    room.state = 'paused';
    io.to(code).emit('game_paused', { remaining: Math.round(room.pausedRemaining / 1000) });
  });

  // HOST: resume
  socket.on('host_resume', ({ code }) => {
    const room = rooms[code];
    if (!room || room.host !== socket.id || room.state !== 'paused') return;
    room.state = 'question';
    room._questionStart = Date.now();
    room._questionDuration = room.pausedRemaining;
    room.questionTimer = setTimeout(() => revealAnswer(room), room.pausedRemaining);
    io.to(code).emit('game_resumed', { remaining: Math.round(room.pausedRemaining / 1000) });
  });

  // HOST: advance after reveal
  socket.on('host_advance', ({ code }) => {
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;
    if (room.state !== 'reveal') return;
    advanceAfterReveal(room);
  });

  // HOST: kick player
  socket.on('kick_player', ({ code, playerId }) => {
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;
    if (room.players[playerId]) {
      const kicked = io.sockets.sockets.get(playerId);
      if (kicked) kicked.emit('kicked');
      // Remove from all structures
      delete room.players[playerId];
      room.bench = room.bench.filter(id => id !== playerId);
      room.currentPair = room.currentPair.filter(id => id !== playerId);
      io.to(code).emit('lobby_update', { players: room.players, spectators: room.spectators, maxPlayers: room.maxPlayers, questionCount: room.questionCount });
    }
  });

  // Players vote skip (both of current pair must agree)
  socket.on('vote_skip', ({ code }) => {
    const room = rooms[code];
    if (!room || room.state !== 'question') return;
    if (!room.currentPair.includes(socket.id)) return;
    room.skipVotes[socket.id] = true;
    const needed = room.currentPair.length;
    const votes = Object.keys(room.skipVotes).length;
    io.to(code).emit('skip_vote_update', { votes, needed });
    if (votes >= needed) {
      clearTimeout(room.questionTimer);
      revealAnswer(room);
    }
  });

  socket.on('disconnect', () => {
    console.log(`[-] ${socket.id}`);
    for (const code in rooms) {
      const room = rooms[code];
      const wasPlayer = !!room.players[socket.id];
      const wasSpectator = !!room.spectators[socket.id];
      if (!wasPlayer && !wasSpectator) continue;

      delete room.players[socket.id];
      delete room.spectators[socket.id];
      room.bench = room.bench.filter(id => id !== socket.id);
      room.currentPair = room.currentPair.filter(id => id !== socket.id);

      if (Object.keys(room.players).length === 0 && Object.keys(room.spectators).length === 0) {
        if (room.questionTimer) clearTimeout(room.questionTimer);
        if (room.revealTimer) clearTimeout(room.revealTimer);
        delete rooms[code];
      } else {
        io.to(code).emit('player_disconnected', {
          players: room.players,
          spectators: room.spectators,
          currentPair: room.currentPair,
          bench: room.bench,
        });
      }
      break;
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎮 Perguntando Brabo na porta ${PORT}`));
