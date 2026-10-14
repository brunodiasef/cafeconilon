# Conilon Vivo — instruções para o Claude

App web para pequenos produtores de café conilon do ES (ver README.md). Hoje roda no **modo manual**:
o produtor envia a foto pelo WhatsApp ao Bruno, o Bruno passa a foto aqui, o Claude analisa e gera
um laudo `laudos/laudo-CODIGO.json`, o Bruno devolve o arquivo e o produtor importa no app.

## Quando o Bruno mandar uma foto para análise

1. **Leia o código** carimbado na faixa verde embaixo da foto (`CÓDIGO: XXXXXX`, 6 caracteres, sem O/0/I/1).
   A faixa também traz parte da planta, talhão e data. Um pedido pode ter **até 4 fotos** com o mesmo código
   (`FOTO 1 DE 3`...): analise todas juntas e faça **um laudo só** para o código. Se faltar alguma foto
   do pedido, avise o Bruno. Se o Bruno colar a mensagem do WhatsApp,
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

6. **Atualize o cadastro** (`produtores/cadastro.json`, fora do git): veja abaixo.

## Cadastro dos produtores e acompanhamento dos casos

Cada pedido é um **caso** (o código) ligado a um **produtor**. O caso passa pelas etapas
foto → laudo → achou na lavoura → tratou → resolvido. O Bruno quer ver isso por agricultor.

- **Ao receber um pedido**: a mensagem traz `Produtor: Nome — Comunidade, Município` e `Telefone:`
  (a faixa da foto também traz o nome). Se o produtor não existe em `produtores`, cadastre
  (`id` = nome em minúsculas com hífen, ex.: `jose-silva`; `desde` = data de hoje, `AAAA-MM-DD`).
  Crie o caso com `codigo`, `produtor`, `data_foto`, `parte`, `talhao` e `obs_produtor` (observação da mensagem).
  Pedido sem nome do produtor (app antigo): pergunte ao Bruno de quem é. Até lá, use `"produtor": "sem_cadastro"`.
- **Depois do laudo**: `node cadastro.js sincronizar` (copia diagnóstico, certeza e data do laudo para o caso).
- **Quando o Bruno colar um "Conilon Vivo — retorno"**: atualize o caso pelo código.
  `Achou na lavoura`: Sim, achei → `reconheceu: "sim"`; Não achei → `"nao"`; Ainda não olhei → `"nao_olhou"`.
  `Tratamento`: títulos em `tratamentos` (o "Outro: ..." também entra na lista, como escrito); "Ainda não fiz" → `nao_tratou: true`.
  `Resultado`: Resolveu → `resolveu: "sim"`; Melhorou um pouco → `"em_parte"`; Não resolveu → `"nao"`; Ainda não sei → `"esperando"`.
  Preencha `data_retorno` e `obs_retorno`, e acrescente em `eventos` uma linha curta (`{ "data", "o_que" }`).
  Se não resolveu ou o produtor não achou o problema, diga ao Bruno e recomende o Incaper.
- **Sempre no fim**: `node cadastro.js validar` e `node cadastro.js painel`, e mande `produtores/painel.html` ao Bruno.
  O painel tem dados pessoais: mande como arquivo, **nunca publique** como página ou no git.

Guarde as fotos recebidas em `fotos-recebidas/` (fora do git) com o nome `CODIGO.jpg` (ou `CODIGO-1.jpg`, `CODIGO-2.jpg`... quando o pedido tiver várias fotos).
