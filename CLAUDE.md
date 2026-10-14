# Conilon Vivo — instruções para o Claude

App web para pequenos produtores de café conilon do ES (ver README.md). Cada produtor entra com
telefone e senha; o Bruno é o responsável (admin) e vê tudo. Os dados ficam no Firebase (Firestore).
O produtor manda as fotos pelo app, o Claude analisa, grava o laudo no banco e o produtor vê na hora.

## Quando o Bruno pedir "analise os pedidos novos"

1. `node nuvem.js pendentes`: lista os pedidos sem laudo (produtor, parte, talhão, observação) e baixa
   as fotos em `fotos-recebidas/CODIGO.jpg` (ou `CODIGO-1.jpg`, `CODIGO-2.jpg`...). Olhe todas as fotos do pedido.
2. Faça o laudo de cada pedido como descrito abaixo (passos 2 a 4).
3. `node nuvem.js laudo laudos/laudo-CODIGO.json`: grava no app. O produtor vê na hora, não precisa mandar arquivo.
4. Diga ao Bruno, por pedido: produtor, diagnóstico e certeza. Se a certeza for baixa ou houver risco
   de prejuízo, recomende o Incaper (gratuito).

`node nuvem.js casos` mostra todos os casos e o que cada produtor contou ("achou", "resolveu").
`node nuvem.js testar` confere se a chave funciona (primeira coisa a rodar numa sessão nova).
Produtor esqueceu a senha: `node nuvem.js senha TELEFONE` e passe a senha nova ao Bruno.
O acesso ao banco vem da variável `FIREBASE_SERVICE_ACCOUNT`. Sem ela, diga ao Bruno; não tente outro caminho.

Se o Bruno mandar a foto direto aqui (fora do app), o caminho de antes continua valendo: faça o laudo e
entregue o arquivo; ele importa no pedido pela área dele no app.

## Como fazer o laudo

1. **Código do pedido**: vem do `node nuvem.js pendentes`. Um pedido pode ter **até 4 fotos**:
   analise todas juntas e faça **um laudo só** para o código. Fotos antigas, mandadas pelo WhatsApp,
   têm o código carimbado na faixa verde (`CÓDIGO: XXXXXX`). Sem código: pergunte ao Bruno, não invente.
2. **Analise a foto** comparando com o catálogo em `public/dados/pragas.json`. Escolha `diagnostico_id`
   entre os ids do catálogo, `saudavel` ou `nao_identificado`.
   - Seja honesto: prefira confiança `baixa` ou `nao_identificado` a chutar. Um erro faz o produtor gastar à toa.
   - Atenção a confusões comuns: deficiência nutricional × doença; cercosporiose × ferrugem;
     bicho-mineiro × queimadura de sol; cochonilha-da-roseta × fungos brancos;
     `broca` (fruto) × `broca_ramos` (ramo verde oco, com furinho).
   - Foto ruim (borrada, escura, longe): `foto_boa: false` e explique em `problema_da_foto` como refazer.
   - Um id novo no catálogo só aparece certo no celular depois que o app atualizado for publicado (push na `main`).
     Antes disso, use `nao_identificado` e explique em `o_que_vi`.
   - **Não escreva produto nem dose.** Os tratamentos o app tira de `pragas.json`.
3. **Escreva o laudo** em `laudos/laudo-CODIGO.json`, em português simples (fala de produtor rural):

```json
{
  "tipo": "conilon-vivo-laudo",
  "versao": 1,
  "codigo": "K7M2PX",
  "data_analise": "2026-10-14T15:00:00-03:00",
  "parte": "Folha",
  "talhao": "Talhão da baixada",
  "data_foto": "2026-10-14T09:30:00-03:00",
  "resultado": {
    "foto_boa": true,
    "problema_da_foto": "",
    "e_cafe": true,
    "diagnostico_id": "ferrugem",
    "confianca": "media",
    "o_que_vi": "2 a 3 frases simples sobre o que se vê na foto.",
    "gravidade": "moderada",
    "alternativas": ["cercosporiose"],
    "perguntas": ["Até 3 perguntas simples para o produtor conferir na lavoura"],
    "dica": "Dica curta específica desta foto, ou vazio",
    "mensagem": "Recado opcional do Bruno para o produtor"
  }
}
```

   Valores aceitos: `confianca` = alta | media | baixa; `gravidade` = leve | moderada | grave | nao_se_aplica.
   `parte`, `talhao`, `data_foto` e `mensagem` são opcionais.
4. **Valide**: `node validar-laudo.js laudos/laudo-CODIGO.json`. Só grave ou entregue se der `OK`.

As fotos e os dados dos produtores são pessoais: ficam fora do git (`fotos-recebidas/`, `laudos/*.json`)
e nunca são publicados.

## Desenvolvimento

- `npm run build` gera `public/vendor/firebase.js` (rode depois de mudar `src/firebase.js` ou a versão do Firebase).
- `npm run simulador` sobe o Firebase local; com ele rodando, `npm run teste:regras` testa as regras de acesso
  (`firestore.rules`) e o app abre em `http://localhost:PORTA/?simulador`. `node nuvem.js ... --simulador` usa o simulador.
- Mudou `firestore.rules`? Rode o teste e lembre o Bruno de publicar as regras (README).
