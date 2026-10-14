# Conilon Vivo (nome provisório)

App web para o pequeno produtor de café conilon do Espírito Santo:
**tira a foto → o app identifica a praga ou doença → mostra o tratamento do mais barato ao mais caro.**

## Modo manual (atual, sem chave da API)

1. O produtor tira a foto e toca **Enviar para análise**. A foto sai pelo WhatsApp com um **código** carimbado (ex.: `K7M2PX`).
2. O Bruno passa a foto ao Claude Code nesta pasta. O Claude gera `laudos/laudo-K7M2PX.json` (roteiro em `CLAUDE.md`) e confere com `node validar-laudo.js`.
3. O Bruno manda o arquivo de volta. O produtor toca **Importar análise** e o resultado fica salvo no histórico, na foto certa.

Quando houver chave da API (`.env`), o app passa sozinho para o **modo automático** (análise na hora).

## Como funciona

- **Celular (pasta `public/`)**: app web que se instala na tela inicial. Funciona sem sinal: a foto fica guardada e é analisada quando a internet volta. O histórico fica no próprio celular.
- **Servidor (`server.js`)**: recebe a foto e pergunta ao Claude (IA da Anthropic) qual é o problema. A chave da API fica só no servidor.
- **Base de pragas (`public/dados/pragas.json`)**: sintomas e tratamentos escritos e revisáveis. **A IA só identifica o problema; os tratamentos vêm desta base**, não são inventados pela IA.

Pragas e doenças cobertas: broca, bicho-mineiro, cochonilha-da-roseta, cochonilha-verde, ácaro-vermelho, ferrugem, cercosporiose, seca-de-ponteiros, falta de nutrientes e nematoides.

## Rodar no computador

```bash
npm install
npm start
```

Abra http://localhost:3000. Sem chave, o app roda em **modo demonstração** (resultado de exemplo fixo).

## Ativar a IA de verdade

1. Crie uma chave em https://console.anthropic.com (precisa cadastrar cartão; cada análise custa poucos centavos).
2. Copie `.env.example` para `.env` e preencha `ANTHROPIC_API_KEY`.
3. Para a fase de testes, defina também `CODIGO_ACESSO` (ex.: `cafe2026`) e passe o código só para os produtores do teste. Isso evita que estranhos usem e gerem custo.
4. Reinicie com `npm start`.

## Colocar no ar para os produtores

O celular só instala o app e acessa a câmera em endereço **https**. Qualquer serviço que rode Node.js serve (Render, Railway, Fly.io etc.):
comando de início `npm start`, e as variáveis do `.env` cadastradas no painel do serviço.

## Antes de ampliar o teste

- [ ] **Revisão da base por engenheiro agrônomo**, de preferência junto com o Incaper. O conteúdo foi escrito como ponto de partida.
- [ ] Testar com **fotos reais** de lavoura (com e sem praga) e anotar acertos e erros.
- [ ] Definir o nome e a marca definitivos (logo atual é provisória: `public/icone.svg`).
