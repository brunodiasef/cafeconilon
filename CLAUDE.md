# Conilon Vivo — instruções para o Claude

App web para pequenos produtores de café conilon do ES (ver README.md). Hoje roda no **modo manual**:
o produtor envia a foto pelo WhatsApp ao Bruno, o Bruno passa a foto aqui, o Claude analisa e gera
um laudo `laudos/laudo-CODIGO.json`, o Bruno devolve o arquivo e o produtor importa no app.

## Quando o Bruno mandar uma foto para análise

1. **Leia o código** carimbado na faixa verde embaixo da foto (`CÓDIGO: XXXXXX`, 6 caracteres, sem O/0/I/1).
   A faixa também traz parte da planta, talhão e data. Se o Bruno colar a mensagem do WhatsApp,
   ela tem o código e a observação do produtor. Sem código legível: pergunte ao Bruno, não invente.
2. **Analise a foto** comparando com o catálogo em `public/dados/pragas.json`. Escolha `diagnostico_id`
   entre os ids do catálogo, `saudavel` ou `nao_identificado`.
   - Seja honesto: prefira confiança `baixa` ou `nao_identificado` a chutar. Um erro faz o produtor gastar à toa.
   - Atenção a confusões comuns: deficiência nutricional × doença; cercosporiose × ferrugem;
     bicho-mineiro × queimadura de sol; cochonilha-da-roseta × fungos brancos;
     `broca` (fruto) × `broca_ramos` (ramo verde oco, com furinho).
   - Foto ruim (borrada, escura, longe): `foto_boa: false` e explique em `problema_da_foto` como refazer.
   - Um id novo no catálogo só funciona no celular depois que o app atualizado for publicado (push na `main`).
     Antes disso, o app do produtor recusa o laudo: use `nao_identificado` e explique em `o_que_vi`.
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
   `parte`, `talhao`, `data_foto` e `mensagem` são opcionais (servem se a foto não estiver no celular que importar).
4. **Valide**: `node validar-laudo.js laudos/laudo-CODIGO.json`. Só entregue se der `OK`.
5. Diga ao Bruno, em poucas linhas: o diagnóstico, a certeza, e o caminho do arquivo para ele mandar ao produtor.
   Se a certeza for baixa ou houver risco de prejuízo, recomende a visita de um técnico (Incaper, gratuito).

Guarde as fotos recebidas em `fotos-recebidas/` (fora do git) com o nome `CODIGO.jpg`, se o Bruno enviar o arquivo.
