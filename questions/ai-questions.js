const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const TEMAS = [
  'história do mundo', 'ciências', 'geografia', 'cultura pop',
  'esportes', 'literatura', 'tecnologia', 'gastronomia',
  'arte e música', 'natureza e animais', 'curiosidades gerais'
];

async function generateAIQuestions(count = 10) {
  const tema1 = TEMAS[Math.floor(Math.random() * TEMAS.length)];
  const tema2 = TEMAS[Math.floor(Math.random() * TEMAS.length)];

  const prompt = `Crie exatamente ${count} perguntas de quiz de conhecimento geral em português brasileiro.
Misture os temas: ${tema1} e ${tema2}, mas inclua variedade.
Dificuldade: média (nem muito fácil nem muito difícil).

Responda APENAS com JSON válido, sem texto extra, neste formato exato:
[
  {
    "question": "Texto da pergunta?",
    "options": ["Opção A", "Opção B", "Opção C", "Opção D"],
    "correct": 0,
    "explanation": "Breve explicação da resposta correta (1 frase)"
  }
]

Regras:
- "correct" é o índice (0-3) da opção correta em "options"
- As opções erradas devem ser plausíveis mas claramente incorretas
- Nunca repita perguntas similares
- Misture bem os índices corretos (não coloque sempre 0 ou sempre a mesma posição)`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].text.trim();
  const clean = text.replace(/```json|```/g, '').trim();
  const questions = JSON.parse(clean);

  // Validate structure
  return questions.map(q => ({
    question: q.question,
    options: q.options,
    correct: q.correct,
    explanation: q.explanation || ''
  }));
}

module.exports = { generateAIQuestions };
