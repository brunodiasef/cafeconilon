# Conilon Vivo (nome provisório)

App web para o pequeno produtor de café conilon do Espírito Santo:
**tira a foto → o app identifica a praga ou doença → mostra o tratamento do mais barato ao mais caro.**

## Como funciona

- **Produtor**: entra no app com o **telefone e uma senha de 6 números** (o Bruno cadastra e passa a senha). Tira a foto e toca **Enviar para análise**. O laudo aparece no **Histórico**, com os tratamentos do mais barato ao mais caro. Depois conta no app se achou o problema, o que fez e se resolveu. Vê só os casos dele.
- **Bruno (responsável)**: entra com e-mail. Vê o **Painel** (pedidos esperando laudo, casos que precisam de atenção, problemas mais vistos), cadastra **Produtores** e acompanha cada caso: foto → laudo → achou → tratou → resolvido.
- **Laudo**: o Bruno pede ao Claude Code "analise os pedidos novos". O Claude baixa as fotos (`node nuvem.js pendentes`), faz o laudo e grava no app (`node nuvem.js laudo ...`). O produtor vê na hora. Roteiro em `CLAUDE.md`.
- **Sem sinal**: o pedido fica guardado no celular e sobe sozinho quando a internet volta.
- **Dados**: ficam no **Firebase** (Google), plano gratuito, que não adormece. Fotos e dados só são vistos pelo produtor dono e pelo Bruno; quem garante isso são as regras de `firestore.rules`, testadas em `testes/regras.test.mjs`.
- **Base de pragas** (`public/dados/pragas.json`): sintomas e tratamentos escritos e revisáveis. **O laudo só identifica o problema; os tratamentos vêm desta base.**

Pragas e doenças cobertas: broca, broca-dos-ramos, bicho-mineiro, cochonilha-da-roseta, cochonilha-verde, ácaro-vermelho, ferrugem, cercosporiose, seca-de-ponteiros, falta de nutrientes e nematoides.

## Configurar o Firebase (uma vez)

1. Em https://console.firebase.google.com, crie um projeto (ex.: `conilon-vivo`). Pode desligar o Google Analytics. Fica no plano gratuito (Spark): não precisa de cartão.
2. **Authentication** → Começar → **E-mail/senha** → Ativar.
3. **Firestore Database** → Criar banco → local `southamerica-east1` (São Paulo) → modo de produção.
4. **Regras**: em Firestore → Regras, apague o que estiver lá, cole o conteúdo de `firestore.rules` e publique.
5. **Sua conta**: Authentication → Usuários → Adicionar usuário (seu e-mail e uma senha forte).
6. **Configuração do app**: Configurações do projeto → Seus apps → Web (`</>`) → registre o app e copie os valores de `firebaseConfig` para `public/firebase-config.js`.
7. **Acesso do Claude**: Configurações do projeto → Contas de serviço → Gerar nova chave privada. Guarde o arquivo: ele dá acesso total ao banco. Coloque o conteúdo dele na variável de ambiente `FIREBASE_SERVICE_ACCOUNT` do ambiente do Claude Code (não cole no chat).
8. Com a variável no lugar: `node nuvem.js admin SEU-EMAIL` torna sua conta responsável pelo app. (Sem o Claude: crie no Firestore a coleção `admins` com um documento cujo ID é o UID da sua conta.)
9. **Authentication → Configurações → Domínios autorizados**: confira que `brunodiasef.github.io` está na lista.

O app é publicado no GitHub Pages a cada push na `main` (`.github/workflows/pages.yml`).

## Rodar no computador (desenvolvimento)

```bash
npm install
npm run simulador          # Firebase local (precisa de Java)
npm run teste:regras       # em outro terminal: testa quem pode ver e mexer em quê
python3 -m http.server 3124 -d public   # e abra http://localhost:3124/?simulador
```

`npm run build` refaz `public/vendor/firebase.js` (o Firebase vai junto com o app, para funcionar sem sinal).

## Próximo passo: análise automática pela IA

Hoje quem faz o laudo é o Claude Code, quando o Bruno pede. Para a análise sair sozinha, um servidor com a chave da API da Anthropic precisa ler os pedidos novos e gravar o laudo (como o `nuvem.js laudo` faz). O `server.js` já tem a chamada à IA (`/api/diagnosticar`); falta ligá-lo ao Firebase.

## Antes de ampliar o teste

- [ ] **Revisão da base por engenheiro agrônomo**, de preferência junto com o Incaper. O conteúdo foi escrito como ponto de partida.
- [ ] Testar com **fotos reais** de lavoura (com e sem praga) e anotar acertos e erros.
- [ ] Definir o nome e a marca definitivos (logo atual é provisória: `public/icone.svg`).
