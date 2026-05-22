# QuizBattle 🎮

Jogo de quiz multiplayer em tempo real com perguntas geradas por IA a cada partida!

## Como jogar
1. Jogador 1 cria uma sala e compartilha o código de 6 letras
2. Jogador 2 entra com o código
3. Os dois clicam em "Estou Pronto!"
4. A IA gera 10 perguntas exclusivas para a partida
5. Responda em até 60 segundos
6. A resposta é revelada com explicação da IA
7. Verde = acertou, Vermelho = errou, Amarelo = os dois erraram

## Deploy no Render

1. Crie um repositório no GitHub e envie este código
2. Acesse [render.com](https://render.com) → **New Web Service**
3. Conecte ao repositório GitHub
4. Configurações automáticas pelo `render.yaml`, mas adicione manualmente:
   - **ANTHROPIC_API_KEY** → sua chave em [console.anthropic.com](https://console.anthropic.com)
5. Clique em **Deploy**!

## Rodar localmente

```bash
npm install
ANTHROPIC_API_KEY=sua_chave_aqui node server.js
# Acesse http://localhost:3000
```
