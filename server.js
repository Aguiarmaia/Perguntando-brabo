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

function createRoom(hostId) {
  let code;
  do { code = generateCode(); } while (rooms[code]);
  rooms[code] = {
    code, players: {}, host: hostId,
    state: 'waiting',
    questions: [], currentQuestion: 0,
    answers: {}, scores: {},
    questionTimer: null, revealTimer: null,
    pauseVotes: {},      // socketId -> true
    skipVotes: {},       // socketId -> true
    paused: false,
    pauseStart: null,
    pausedRemaining: null,
  };
  return rooms[code];
}

function startQuestion(room) {
  const code = room.code;
  room.state = 'question';
  room.answers = {};
  room.pauseVotes = {};
  room.skipVotes = {};
  room.paused = false;
  room.pauseStart = null;
  room.pausedRemaining = null;

  const q = room.questions[room.currentQuestion];
  io.to(code).emit('question_start', {
    index: room.currentQuestion,
    total: room.questions.length,
    question: q.question,
    options: q.options,
    timeLimit: 60
  });

  room.questionTimer = setTimeout(() => revealAnswer(room), 60000);
  room._questionStart = Date.now();
  room._questionDuration = 60000;
}

function revealAnswer(room) {
  const code = room.code;
  if (room.questionTimer) clearTimeout(room.questionTimer);
  room.state = 'reveal';

  const q = room.questions[room.currentQuestion];
  const playerIds = Object.keys(room.players);
  const results = {};

  playerIds.forEach(pid => {
    const answer = room.answers[pid];
    const didNotAnswer = answer === undefined;
    const correct = !didNotAnswer && answer === q.correct;
    results[pid] = { answer: didNotAnswer ? null : answer, correct, didNotAnswer };
    if (correct) room.scores[pid] = (room.scores[pid] || 0) + 1;
  });

  const allCorrect = playerIds.every(pid => results[pid]?.correct);
  const allWrong = playerIds.every(pid => !results[pid]?.correct);
  const roundResult = allCorrect ? 'all_correct' : allWrong ? 'all_wrong' : 'mixed';

  io.to(code).emit('reveal_answer', {
    correctIndex: q.correct,
    explanation: q.explanation || '',
    results, scores: room.scores, roundResult, players: room.players
  });

  room.revealTimer = setTimeout(() => {
    room.currentQuestion++;
    if (room.currentQuestion >= room.questions.length) endGame(room);
    else startQuestion(room);
  }, 30000);
}

function endGame(room) {
  const code = room.code;
  room.state = 'finishing'; // intermediate state for 10s countdown
  const playerIds = Object.keys(room.players);
  let winner = null, maxScore = -1;
  playerIds.forEach(pid => {
    const s = room.scores[pid] || 0;
    if (s > maxScore) { maxScore = s; winner = pid; }
  });
  const tied = playerIds.every(pid => (room.scores[pid] || 0) === maxScore);

  io.to(code).emit('game_ending', {
    scores: room.scores, players: room.players,
    winner: tied ? null : winner,
    countdown: 10
  });

  setTimeout(() => {
    room.state = 'finished';
    io.to(code).emit('game_over', {
      scores: room.scores, players: room.players,
      winner: tied ? null : winner
    });
  }, 10000);
}

io.on('connection', (socket) => {
  console.log(`[CONNECT] ${socket.id}`);

  socket.on('create_room', ({ name }) => {
    const room = createRoom(socket.id);
    room.players[socket.id] = { name, id: socket.id };
    room.scores[socket.id] = 0;
    socket.join(room.code);
    socket.emit('room_created', { code: room.code, players: room.players });
  });

  socket.on('join_room', ({ code, name }) => {
    const room = rooms[code.toUpperCase()];
    if (!room) return socket.emit('error', { message: 'Sala não encontrada!' });
    if (room.state !== 'waiting') return socket.emit('error', { message: 'Partida já em andamento!' });
    if (Object.keys(room.players).length >= 2) return socket.emit('error', { message: 'Sala cheia!' });
    room.players[socket.id] = { name, id: socket.id };
    room.scores[socket.id] = 0;
    socket.join(code.toUpperCase());
    io.to(code.toUpperCase()).emit('player_joined', { players: room.players });
    socket.emit('room_joined', { code: code.toUpperCase(), players: room.players });
  });

  socket.on('player_ready', ({ code }) => {
    const room = rooms[code];
    if (!room) return;
    room.players[socket.id].ready = true;
    io.to(code).emit('player_ready_update', { players: room.players });

    const allReady = Object.values(room.players).every(p => p.ready);
    const playerCount = Object.keys(room.players).length;

    if (allReady && playerCount === 2 && room.state === 'waiting') {
      room.state = 'generating';
      io.to(code).emit('generating_questions');

      generateAIQuestions(10)
        .then(questions => {
          room.questions = questions;
          room.state = 'countdown';
          io.to(code).emit('game_countdown', { seconds: 3 });
          setTimeout(() => startQuestion(room), 3000);
        })
        .catch(err => {
          console.error('[AI] Fallback:', err.message);
          room.questions = getRandomQuestions(10);
          room.state = 'countdown';
          io.to(code).emit('generating_fallback');
          io.to(code).emit('game_countdown', { seconds: 3 });
          setTimeout(() => startQuestion(room), 3000);
        });
    }
  });

  socket.on('submit_answer', ({ code, answer }) => {
    const room = rooms[code];
    if (!room || room.state !== 'question') return;
    if (room.answers[socket.id] !== undefined) return;
    room.answers[socket.id] = answer;
    socket.emit('answer_received', { answer });
    socket.to(code).emit('opponent_answered');
    const playerCount = Object.keys(room.players).length;
    if (Object.keys(room.answers).length === playerCount) {
      clearTimeout(room.questionTimer);
      revealAnswer(room);
    }
  });

  // PAUSE
  socket.on('vote_pause', ({ code }) => {
    const room = rooms[code];
    if (!room || room.state !== 'question') return;

    room.pauseVotes[socket.id] = true;
    const playerIds = Object.keys(room.players);
    const voteCount = Object.keys(room.pauseVotes).length;

    io.to(code).emit('pause_vote_update', {
      votes: voteCount,
      needed: playerIds.length,
      voters: Object.keys(room.pauseVotes).map(id => room.players[id]?.name)
    });

    if (voteCount >= playerIds.length) {
      // Pause!
      room.paused = true;
      room.pauseVotes = {};
      const elapsed = Date.now() - room._questionStart;
      room.pausedRemaining = Math.max(0, room._questionDuration - elapsed);
      clearTimeout(room.questionTimer);
      io.to(code).emit('game_paused', { remaining: Math.round(room.pausedRemaining / 1000) });
    }
  });

  socket.on('vote_resume', ({ code }) => {
    const room = rooms[code];
    if (!room || !room.paused) return;

    room.pauseVotes[socket.id] = true;
    const playerIds = Object.keys(room.players);
    const voteCount = Object.keys(room.pauseVotes).length;

    io.to(code).emit('resume_vote_update', {
      votes: voteCount,
      needed: playerIds.length,
      voters: Object.keys(room.pauseVotes).map(id => room.players[id]?.name)
    });

    if (voteCount >= playerIds.length) {
      room.paused = false;
      room.pauseVotes = {};
      room._questionStart = Date.now();
      room._questionDuration = room.pausedRemaining;
      io.to(code).emit('game_resumed', { remaining: Math.round(room.pausedRemaining / 1000) });
      room.questionTimer = setTimeout(() => revealAnswer(room), room.pausedRemaining);
    }
  });

  // SKIP
  socket.on('vote_skip', ({ code }) => {
    const room = rooms[code];
    if (!room || room.state !== 'question') return;

    room.skipVotes[socket.id] = true;
    const playerIds = Object.keys(room.players);
    const voteCount = Object.keys(room.skipVotes).length;

    io.to(code).emit('skip_vote_update', {
      votes: voteCount,
      needed: playerIds.length,
      voters: Object.keys(room.skipVotes).map(id => room.players[id]?.name)
    });

    if (voteCount >= playerIds.length) {
      room.skipVotes = {};
      clearTimeout(room.questionTimer);
      revealAnswer(room);
    }
  });

  socket.on('disconnect', () => {
    for (const code in rooms) {
      const room = rooms[code];
      if (room.players[socket.id]) {
        delete room.players[socket.id];
        if (room.questionTimer) clearTimeout(room.questionTimer);
        if (room.revealTimer) clearTimeout(room.revealTimer);
        io.to(code).emit('player_left', { players: room.players });
        if (Object.keys(room.players).length === 0) {
          delete rooms[code];
        }
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎮 Perguntando Brabo rodando na porta ${PORT}`));
