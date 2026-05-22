const questions = [
  {
    question: "Qual é a capital do Brasil?",
    options: ["São Paulo", "Rio de Janeiro", "Brasília", "Salvador"],
    correct: 2
  },
  {
    question: "Quantos planetas existem no Sistema Solar?",
    options: ["7", "8", "9", "10"],
    correct: 1
  },
  {
    question: "Quem pintou a Mona Lisa?",
    options: ["Michelangelo", "Rafael", "Leonardo da Vinci", "Donatello"],
    correct: 2
  },
  {
    question: "Em que ano o homem pisou na Lua pela primeira vez?",
    options: ["1965", "1967", "1969", "1971"],
    correct: 2
  },
  {
    question: "Qual é o maior oceano do mundo?",
    options: ["Atlântico", "Índico", "Ártico", "Pacífico"],
    correct: 3
  },
  {
    question: "Qual elemento químico tem símbolo 'O'?",
    options: ["Ouro", "Oxigênio", "Ósmio", "Opério"],
    correct: 1
  },
  {
    question: "Qual país tem a maior população do mundo?",
    options: ["Índia", "China", "EUA", "Brasil"],
    correct: 0
  },
  {
    question: "Quantos lados tem um hexágono?",
    options: ["5", "6", "7", "8"],
    correct: 1
  },
  {
    question: "Qual é o rio mais longo do mundo?",
    options: ["Amazonas", "Nilo", "Yangtzé", "Mississippi"],
    correct: 1
  },
  {
    question: "Quem escreveu 'Dom Casmurro'?",
    options: ["José de Alencar", "Machado de Assis", "Clarice Lispector", "Guimarães Rosa"],
    correct: 1
  },
  {
    question: "Qual é a fórmula química da água?",
    options: ["H2O2", "HO2", "H2O", "H3O"],
    correct: 2
  },
  {
    question: "Qual animal é o mais rápido do mundo?",
    options: ["Leão", "Guepardo", "Falcão-peregrino", "Avestruz"],
    correct: 2
  },
  {
    question: "Em que continente fica o Egito?",
    options: ["Ásia", "Europa", "África", "Oriente Médio"],
    correct: 2
  },
  {
    question: "Qual é o metal mais precioso do mundo?",
    options: ["Ouro", "Platina", "Ródio", "Paládio"],
    correct: 2
  },
  {
    question: "Quantos ossos tem o corpo humano adulto?",
    options: ["186", "206", "226", "246"],
    correct: 1
  },
  {
    question: "Quem foi o primeiro presidente do Brasil?",
    options: ["Dom Pedro II", "Getúlio Vargas", "Deodoro da Fonseca", "Floriano Peixoto"],
    correct: 2
  },
  {
    question: "Qual é a maior floresta tropical do mundo?",
    options: ["Congo", "Amazônia", "Daintree", "Tongass"],
    correct: 1
  },
  {
    question: "Em que ano foi proclamada a República do Brasil?",
    options: ["1822", "1888", "1889", "1891"],
    correct: 2
  },
  {
    question: "Qual planeta é conhecido como 'Planeta Vermelho'?",
    options: ["Vênus", "Júpiter", "Marte", "Saturno"],
    correct: 2
  },
  {
    question: "Quantos jogadores tem um time de futebol em campo?",
    options: ["10", "11", "12", "9"],
    correct: 1
  }
];

function getRandomQuestions(count = 10) {
  const shuffled = [...questions].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

module.exports = { questions, getRandomQuestions };
