// Conilon Vivo — app do produtor.
// Fotos ficam guardadas no próprio celular (IndexedDB).
// Modo automático: o servidor analisa com a IA (precisa de chave). Sem sinal, a análise espera na fila.
// Modo manual: o produtor envia a foto (com código carimbado) pelo WhatsApp, recebe de volta
// um arquivo laudo-CODIGO.json e o importa no app.

const tela = document.getElementById("tela");
const PARTES = ["Folha", "Fruto", "Ramo", "Raiz", "Planta inteira"];
const CONFIANCA = { alta: "Certeza alta", media: "Certeza média", baixa: "Certeza baixa" };
const GRAVIDADE = { leve: "Ataque leve", moderada: "Ataque moderado", grave: "Ataque forte" };

let base = null;
let status = { modo: "manual", precisa_codigo: false };
let rascunho = null; // foto escolhida, ainda não enviada

// ---------- utilidades ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const problema = (id) => base.problemas.find((p) => p.id === id);
const dataBR = (iso) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const lerLocal = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const gravarLocal = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

// ---------- banco local (IndexedDB) ----------
const bancoPromessa = new Promise((ok, falha) => {
  const pedido = indexedDB.open("conilon-vivo", 1);
  pedido.onupgradeneeded = () => pedido.result.createObjectStore("registros", { keyPath: "id" });
  pedido.onsuccess = () => ok(pedido.result);
  pedido.onerror = () => falha(pedido.error);
});
async function banco(modo, acao) {
  const db = await bancoPromessa;
  return new Promise((ok, falha) => {
    const loja = db.transaction("registros", modo).objectStore("registros");
    const pedido = acao(loja);
    pedido.onsuccess = () => ok(pedido.result);
    pedido.onerror = () => falha(pedido.error);
  });
}
const salvar = (r) => banco("readwrite", (l) => l.put(r));
const buscar = (id) => banco("readonly", (l) => l.get(id));
const todos = async () => (await banco("readonly", (l) => l.getAll())).sort((a, b) => b.data.localeCompare(a.data));
const apagar = (id) => banco("readwrite", (l) => l.delete(id));

// ---------- foto ----------
// Reduz a foto para economizar dados móveis (máx. 1280 px) e cria uma miniatura para o histórico.
function carregarImagem(arquivo) {
  return new Promise((ok, falha) => {
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(img.src); ok(img); };
    img.onerror = () => falha(new Error("Não foi possível abrir a foto."));
    img.src = URL.createObjectURL(arquivo);
  });
}
function redimensionar(img, max, qualidade) {
  const escala = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * escala);
  c.height = Math.round(img.height * escala);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", qualidade);
}

async function fotoEscolhida(evento) {
  const arquivo = evento.target.files?.[0];
  evento.target.value = "";
  if (!arquivo) return;
  try {
    const img = await carregarImagem(arquivo);
    rascunho = { foto: redimensionar(img, 1280, 0.82), miniatura: redimensionar(img, 200, 0.7), parte: "", talhao: lerLocal("ultimo-talhao") || "", obs: "" };
    ir("confirmar");
  } catch (e) {
    mostrarErro(e.message);
  }
}
document.getElementById("camera").addEventListener("change", fotoEscolhida);
document.getElementById("galeria").addEventListener("change", fotoEscolhida);

// ---------- modo manual: enviar foto e importar laudo ----------
// Código curto, sem letras/números que se confundem (O/0, I/1).
function novoCodigo() {
  const letras = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), (n) => letras[n % letras.length]).join("");
}

// Escreve o código e os dados na própria foto: assim o código chega mesmo se o WhatsApp renomear a imagem.
async function carimbar(registro) {
  const img = await carregarImagem(await (await fetch(registro.foto)).blob());
  const tamanho = Math.max(18, Math.round(img.width / 28));
  const faixa = tamanho * 4.2;
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height + faixa;
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  g.fillStyle = "#1f5e2e";
  g.fillRect(0, img.height, c.width, faixa);
  g.fillStyle = "#fff";
  g.font = `bold ${Math.round(tamanho * 1.4)}px sans-serif`;
  g.fillText(`CÓDIGO: ${registro.id}`, tamanho, img.height + tamanho * 1.7);
  g.font = `${tamanho}px sans-serif`;
  const linha = [registro.parte, registro.talhao, dataBR(registro.data)].filter(Boolean).join(" · ");
  g.fillText(linha, tamanho, img.height + tamanho * 3.2, c.width - tamanho * 2);
  return new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.85));
}

async function enviarParaAnalise(registro) {
  const arquivo = new File([await carimbar(registro)], `conilon-${registro.id}.jpg`, { type: "image/jpeg" });
  const texto = [
    "Conilon Vivo — pedido de análise",
    `Código: ${registro.id}`,
    `Parte: ${registro.parte}`,
    registro.talhao && `Talhão: ${registro.talhao}`,
    registro.obs && `Observação: ${registro.obs}`,
  ].filter(Boolean).join("\n");
  if (navigator.canShare?.({ files: [arquivo] })) {
    try {
      await navigator.share({ files: [arquivo], text: texto, title: "Pedido de análise" });
    } catch (e) {
      if (e.name !== "AbortError") throw e;
    }
    return;
  }
  // Computador ou navegador sem compartilhamento: baixa a foto para enviar manualmente.
  const link = Object.assign(document.createElement("a"), { href: URL.createObjectURL(arquivo), download: arquivo.name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
}

const IDS_VALIDOS = () => [...base.problemas.map((p) => p.id), "saudavel", "nao_identificado"];

async function importarLaudos(evento) {
  const arquivos = [...(evento.target.files || [])];
  evento.target.value = "";
  const importados = [];
  const erros = [];
  for (const arquivo of arquivos) {
    try {
      const laudo = JSON.parse(await arquivo.text());
      const d = laudo.resultado;
      if (laudo.tipo !== "conilon-vivo-laudo" || !/^[A-Z0-9]{6}$/.test(laudo.codigo) || !d || !IDS_VALIDOS().includes(d.diagnostico_id)) {
        throw new Error("não é um laudo do Conilon Vivo");
      }
      const registro = (await buscar(laudo.codigo)) || {
        // Laudo de uma foto que não está neste celular: cria o registro sem a foto.
        id: laudo.codigo, data: laudo.data_foto || new Date().toISOString(),
        foto: "icone-512.png", miniatura: "icone-192.png",
        parte: laudo.parte || "—", talhao: laudo.talhao || "", obs: "",
      };
      registro.resultado = d;
      registro.status = "pronto";
      registro.data_analise = laudo.data_analise || new Date().toISOString();
      await salvar(registro);
      importados.push(registro.id);
    } catch (e) {
      erros.push(`${arquivo.name} (${e instanceof SyntaxError ? "não é um laudo do Conilon Vivo" : e.message})`);
    }
  }
  if (importados.length === 1 && !erros.length) return ir("resultado", importados[0]);
  await ir("historico");
  if (erros.length) mostrarErro("Não consegui abrir: " + erros.join("; "));
}
document.getElementById("laudo").addEventListener("change", importarLaudos);

// ---------- modo automático: envio e fila ----------
async function enviar(registro) {
  const resposta = await fetch("/api/diagnosticar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imagem: registro.foto.split(",")[1], parte: registro.parte, observacao: registro.obs, codigo: lerLocal("codigo") || "" }),
  });
  const dados = await resposta.json().catch(() => ({}));
  if (resposta.status === 401) gravarLocal("codigo", "");
  if (!resposta.ok) throw Object.assign(new Error(dados.erro || "Erro ao analisar."), { definitivo: resposta.status < 500 && resposta.status !== 429 });
  return dados;
}

async function analisar(registro) {
  try {
    registro.resultado = await enviar(registro);
    registro.status = "pronto";
    delete registro.erro;
  } catch (e) {
    // Sem rede: continua na fila. Erro do servidor: guarda a mensagem.
    registro.status = e instanceof TypeError ? "pendente" : (e.definitivo ? "erro" : "pendente");
    registro.erro = e instanceof TypeError ? "" : e.message;
  }
  await salvar(registro);
  return registro;
}

let processandoFila = false;
async function processarFila() {
  if (processandoFila || !navigator.onLine) return;
  processandoFila = true;
  try {
    const pendentes = (await todos()).filter((r) => r.status === "pendente");
    for (const r of pendentes) await analisar(r);
    if (pendentes.length && (rotaAtual === "historico" || rotaAtual === "inicio")) ir(rotaAtual);
  } finally {
    processandoFila = false;
  }
}

function atualizarSinal() {
  document.getElementById("sinal").hidden = navigator.onLine;
  if (navigator.onLine) processarFila();
}
window.addEventListener("online", atualizarSinal);
window.addEventListener("offline", atualizarSinal);

// ---------- telas ----------
let rotaAtual = "inicio";
const telas = {
  async inicio() {
    const lista = await todos();
    const pendentes = lista.filter((r) => r.status === "pendente").length;
    const aguardando = lista.filter((r) => r.status === "aguardando").length;
    return `
      <h1>Viu algo errado no café?</h1>
      <p class="suave">Tire uma foto bem de perto do problema. O app diz o que pode ser e o jeito mais barato de resolver.</p>
      <button class="botao grande" data-acao="camera"><span aria-hidden="true">📷</span>Tirar foto</button>
      <button class="botao secundario" data-acao="galeria">Escolher foto da galeria</button>
      ${pendentes ? `<div class="aviso">📶 ${pendentes} foto(s) esperando sinal de internet para serem analisadas.</div>` : ""}
      ${aguardando ? `<div class="aviso">⏳ ${aguardando} foto(s) aguardando análise. Quando receber o arquivo da análise, toque em <b>Importar análise</b>.</div>` : ""}
      ${status.modo === "manual" ? `<button class="botao secundario" data-acao="importar">📥 Importar análise recebida</button>` : ""}
      <h2>Dicas para uma boa foto</h2>
      <ul class="lista">
        <li>Chegue <b>perto</b>: o problema deve ocupar a foto.</li>
        <li>Foto <b>na sombra</b> ou com o sol atrás de você. Evite contraluz.</li>
        <li>Folha: fotografe <b>por cima e por baixo</b> (a ferrugem fica embaixo).</li>
        <li>Fruto: mostre a <b>ponta (coroa)</b> do fruto.</li>
        <li>Ramo secando: mostre o <b>furinho</b> e, se puder, o ramo aberto ao meio.</li>
        <li>Espere a câmera focar antes de apertar.</li>
      </ul>`;
  },

  confirmar() {
    if (!rascunho) return telas.inicio();
    return `
      <img class="foto" src="${rascunho.foto}" alt="Foto escolhida">
      <label>Qual parte da planta? (toque em uma)</label>
      <div class="opcoes" role="group">
        ${PARTES.map((p) => `<button data-parte="${p}" aria-pressed="${p === rascunho.parte}">${p}</button>`).join("")}
      </div>
      <label for="talhao">Talhão ou lavoura (opcional)</label>
      <input id="talhao" type="text" value="${esc(rascunho.talhao)}" placeholder="Ex.: Talhão da baixada" maxlength="60">
      <label for="obs">Quer contar mais alguma coisa? (opcional)</label>
      <textarea id="obs" placeholder="Ex.: começou há 2 semanas, está em vários pés..." maxlength="500">${esc(rascunho.obs)}</textarea>
      ${status.modo === "manual"
        ? `<button class="botao" data-acao="enviar">📤 Enviar para análise</button>
           <p class="suave">A foto vai com um código. Envie pelo WhatsApp e aguarde o arquivo da análise.</p>`
        : `<button class="botao" data-acao="analisar">Analisar foto</button>`}
      <button class="botao secundario" data-acao="camera">Tirar outra foto</button>`;
  },

  async resultado(id) {
    const r = await buscar(id);
    if (!r) return telas.historico();
    const cab = `<img class="foto" src="${r.foto}" alt="Foto analisada">
      <p class="suave">${esc(r.parte)}${r.talhao ? " · " + esc(r.talhao) : ""} · ${dataBR(r.data)}</p>`;

    if (r.status === "pendente") {
      return cab + `<div class="aviso">📶 Esta foto está guardada e será analisada quando o celular tiver internet.${r.erro ? `<br>${esc(r.erro)}` : ""}</div>
        <button class="botao" data-acao="tentar" data-id="${r.id}">Tentar agora</button>
        <button class="botao secundario" data-acao="apagar" data-id="${r.id}">Apagar</button>`;
    }
    if (r.status === "aguardando") {
      return cab + `<div class="cartao diagnostico duvida">
          <p class="suave" style="margin:0">Aguardando análise</p>
          <h1>Código ${esc(r.id)}</h1>
          <p>Envie a foto pelo WhatsApp (se ainda não enviou). Quando receber o arquivo <b>laudo-${esc(r.id)}.json</b>, toque em <b>Importar análise</b>.</p>
        </div>
        <button class="botao" data-acao="importar">📥 Importar análise</button>
        <button class="botao secundario" data-acao="reenviar" data-id="${r.id}">📤 Enviar a foto de novo</button>
        <button class="botao secundario" data-acao="apagar" data-id="${r.id}">Apagar</button>`;
    }
    if (r.status === "erro") {
      return cab + `<div class="aviso erro">${esc(r.erro)}</div>
        <button class="botao" data-acao="tentar" data-id="${r.id}">Tentar de novo</button>
        <button class="botao secundario" data-acao="apagar" data-id="${r.id}">Apagar</button>`;
    }
    return cab + renderDiagnostico(r.resultado) + `
      <button class="botao secundario" data-acao="apagar" data-id="${r.id}">Apagar do histórico</button>`;
  },

  async historico() {
    const lista = await todos();
    if (!lista.length) return `<h1>Histórico</h1><p class="suave">Nenhuma foto ainda. As análises que você fizer ficam guardadas aqui, no seu celular.</p>`;
    return `<h1>Histórico</h1>` + lista.map((r) => {
      let titulo = "Esperando internet";
      if (r.status === "aguardando") titulo = `Aguardando análise · ${r.id}`;
      if (r.status === "erro") titulo = "Não analisada";
      if (r.status === "pronto") {
        const d = r.resultado;
        titulo = !d.foto_boa ? "Foto precisa ser refeita" : (problema(d.diagnostico_id)?.nome || (d.diagnostico_id === "saudavel" ? "Planta sadia" : "Não identificado"));
      }
      return `<button class="link-lista" data-ir="resultado" data-id="${r.id}">
        <img src="${r.miniatura}" alt="">
        <div><b>${esc(titulo)}</b><div class="meta">${esc(r.parte)}${r.talhao ? " · " + esc(r.talhao) : ""}<br>${dataBR(r.data)}</div></div>
        <span class="seta" aria-hidden="true">›</span></button>`;
    }).join("");
  },

  guia() {
    return `<h1>Pragas e doenças do conilon</h1>
      <p class="suave">Funciona sem internet. Toque para ver os sinais e o que fazer.</p>` +
      base.problemas.map((p) => `<button class="link-lista" data-ir="praga" data-id="${p.id}">
        <div><b>${esc(p.nome)}</b><div class="meta">${esc(p.tipo)} · ${esc(p.onde)}</div></div>
        <span class="seta" aria-hidden="true">›</span></button>`).join("");
  },

  praga(id) {
    const p = problema(id);
    if (!p) return telas.guia();
    return `<h1>${esc(p.nome)}</h1>
      <p class="suave"><i>${esc(p.nome_cientifico)}</i> · ${esc(p.tipo)}</p>
      ${renderFicha(p)}
      ${avisoFinal()}`;
  },

  sobre() {
    return `<h1>Como funciona</h1>
      <div class="cartao">
        <p><b>1.</b> Você tira a foto do problema na lavoura.</p>
        ${status.modo === "manual"
          ? `<p><b>2.</b> Toque em <b>Enviar para análise</b> e mande a foto pelo WhatsApp. Ela vai com um código.</p>
             <p><b>3.</b> Você recebe de volta um arquivo <b>laudo-CÓDIGO.json</b>. Toque em <b>Importar análise</b> e escolha esse arquivo.</p>
             <p><b>4.</b> O app mostra o problema e os tratamentos <b>do mais barato para o mais caro</b>. Fica tudo guardado no Histórico.</p>`
          : `<p><b>2.</b> Uma inteligência artificial compara a foto com as pragas e doenças mais comuns do conilon no Espírito Santo.</p>
             <p><b>3.</b> O app mostra os tratamentos <b>do mais barato para o mais caro</b>. Comece sempre pelo primeiro.</p>
             <p>Sem internet? A foto fica guardada e é analisada quando o sinal voltar.</p>`}
      </div>
      <h2>Importante</h2>
      <div class="cartao">
        <p>O Conilon Vivo dá uma <b>orientação inicial</b>. Ele pode errar e não substitui um técnico.</p>
        <p>Agrotóxico só pode ser comprado e usado com <b>receituário agronômico</b>. Use sempre EPI, respeite a carência e devolva as embalagens vazias.</p>
        <p><b>Assistência técnica gratuita:</b> procure o escritório local do <b>Incaper</b> no seu município.</p>
        <a class="botao secundario" href="https://incaper.es.gov.br" target="_blank" rel="noopener">Site do Incaper</a>
      </div>
      <p class="rodape-aviso">Versão de testes · base de pragas ${esc(base.versao)}</p>
      ${status.precisa_codigo ? `<button class="botao secundario" data-acao="trocar-codigo">Trocar código de acesso</button>` : ""}`;
  },

  codigo() {
    return `<h1>Bem-vindo ao Conilon Vivo</h1>
      <p>Este app está em fase de testes. Digite o código que você recebeu:</p>
      <input id="codigo" type="text" autocomplete="off" autocapitalize="off" placeholder="Código de acesso">
      <button class="botao" data-acao="salvar-codigo">Entrar</button>`;
  },
};

// No resultado da foto, o "o que fazer" vem primeiro; no guia, os sinais vêm primeiro.
function renderFicha(p, tratamentoPrimeiro = false) {
  const sinais = `
    <div class="cartao"><h3>Sinais na planta</h3><ul class="lista">${p.sintomas.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></div>
    <div class="cartao"><h3>Como avaliar</h3><p>${esc(p.como_avaliar)}</p><h3>Por que acontece</h3><p>${esc(p.por_que_acontece)}</p></div>`;
  return tratamentoPrimeiro
    ? renderTratamentos(p) + `<h2>Confira os sinais</h2>` + sinais
    : sinais + renderTratamentos(p);
}

function renderTratamentos(p) {
  const tratamentos = [...p.tratamentos].sort((a, b) => a.nivel - b.nivel);
  return `
    <h2>O que fazer — do mais barato ao mais caro</h2>
    ${tratamentos.map((t, i) => `
      <div class="cartao tratamento">
        <div class="num">${i + 1}</div>
        <div>
          <span class="custo n${t.nivel}">${esc(base.niveis_custo[t.nivel])} · ${esc(t.tipo)}</span>
          <h3>${esc(t.titulo)}</h3>
          <p>${esc(t.como_fazer)}</p>
          <p class="suave"><b>Quando:</b> ${esc(t.quando)}</p>
          ${t.precisa_receita ? `<div class="receita">⚠️ Precisa de receituário agronômico. O Incaper pode orientar de graça.</div>` : ""}
        </div>
      </div>`).join("")}`;
}

function renderDiagnostico(d) {
  if (!d.foto_boa) {
    return `<div class="aviso"><b>Não deu para ver bem.</b><br>${esc(d.problema_da_foto || "Tire outra foto mais de perto e com boa luz.")}</div>
      ${d.mensagem ? `<div class="cartao"><h3>💬 Recado do técnico</h3><p>${esc(d.mensagem)}</p></div>` : ""}
      <button class="botao" data-acao="camera">Tirar outra foto</button>`;
  }
  const recado = d.mensagem ? `<div class="cartao"><h3>💬 Recado do técnico</h3><p>${esc(d.mensagem)}</p></div>` : "";
  const perguntas = d.perguntas?.length ? `<div class="cartao"><h3>Confira na lavoura</h3>
      <ul class="lista perguntas">${d.perguntas.map((q) => `<li><label><input type="checkbox"> ${esc(q)}</label></li>`).join("")}</ul></div>` : "";
  const alternativas = d.alternativas?.filter(problema).length ? `<div class="cartao"><h3>Também pode ser</h3>
      ${d.alternativas.filter(problema).map((id) => `<button class="link-lista" data-ir="praga" data-id="${id}"><b>${esc(problema(id).nome)}</b><span class="seta">›</span></button>`).join("")}</div>` : "";
  const dica = d.dica ? `<div class="cartao"><h3>Dica</h3><p>${esc(d.dica)}</p></div>` : "";

  if (d.diagnostico_id === "saudavel") {
    return `<div class="cartao diagnostico ok"><h1>A planta parece sadia</h1>
      <p>${esc(d.o_que_vi)}</p></div>${recado}${dica}${perguntas}${alternativas}
      <p class="suave">Se você continua vendo algo estranho, tire outra foto mais de perto do ponto que preocupa.</p>`;
  }
  const p = problema(d.diagnostico_id);
  if (!p) {
    return `<div class="cartao diagnostico duvida"><h1>Não consegui identificar</h1>
      <p>${esc(d.o_que_vi)}</p>${d.e_cafe === false ? `<p><b>A foto não parece ser de café.</b></p>` : ""}</div>
      ${recado}${dica}${perguntas}${alternativas}
      <div class="aviso">Tente outra foto mais de perto. Se o problema continuar, procure o escritório do <b>Incaper</b> do seu município (atendimento gratuito).</div>
      <button class="botao" data-acao="camera">Tirar outra foto</button>`;
  }
  const duvida = d.confianca === "baixa";
  return `
    <div class="cartao diagnostico ${duvida ? "duvida" : ""}">
      <p class="suave" style="margin:0">${duvida ? "Pode ser" : "Provavelmente é"}</p>
      <h1>${esc(p.nome)}</h1>
      <div class="selos">
        <span class="selo ${d.confianca}">${CONFIANCA[d.confianca]}</span>
        ${GRAVIDADE[d.gravidade] ? `<span class="selo ${d.gravidade}">${GRAVIDADE[d.gravidade]}</span>` : ""}
        <span class="selo">${esc(p.tipo)}</span>
      </div>
      <p>${esc(d.o_que_vi)}</p>
    </div>
    ${duvida ? `<div class="aviso">A certeza é baixa. Antes de gastar com qualquer produto, confira as perguntas abaixo ou tire outra foto.</div>` : ""}
    ${recado}${perguntas}${dica}
    ${renderFicha(p, true)}
    ${alternativas}
    ${avisoFinal()}`;
}

function avisoFinal() {
  return `<p class="rodape-aviso">Orientação inicial, não substitui o técnico. Produto químico só com receituário agronômico, EPI e respeito à carência. Assistência gratuita: escritório local do Incaper.</p>`;
}

function mostrarErro(msg) {
  tela.insertAdjacentHTML("afterbegin", `<div class="aviso erro">${esc(msg)}</div>`);
  window.scrollTo(0, 0);
}

async function ir(rota, id) {
  if (status.precisa_codigo && !lerLocal("codigo") && rota !== "sobre") rota = "codigo";
  rotaAtual = rota;
  document.querySelectorAll(".abas button").forEach((b) => b.classList.toggle("ativo", b.dataset.ir === rota || (rota === "praga" && b.dataset.ir === "guia") || (rota === "resultado" && b.dataset.ir === "historico")));
  tela.innerHTML = await telas[rota](id);
  window.scrollTo(0, 0);
  const destino = rota === "inicio" ? "#" : `#${rota}${id ? "/" + id : ""}`;
  if (location.hash !== destino && !(rota === "inicio" && !location.hash)) history.pushState(null, "", destino);
}

// ---------- ações ----------
document.addEventListener("click", async (e) => {
  const alvo = e.target.closest("[data-ir], [data-acao], [data-parte]");
  if (!alvo) return;

  if (alvo.dataset.ir) return ir(alvo.dataset.ir, alvo.dataset.id);

  if (alvo.dataset.parte) {
    rascunho.parte = alvo.dataset.parte;
    document.querySelectorAll("[data-parte]").forEach((b) => b.setAttribute("aria-pressed", b === alvo));
    return;
  }

  switch (alvo.dataset.acao) {
    case "camera": return document.getElementById("camera").click();
    case "galeria": return document.getElementById("galeria").click();

    case "analisar": {
      if (!rascunho.parte) return mostrarErro("Escolha qual parte da planta aparece na foto.");
      rascunho.talhao = document.getElementById("talhao").value.trim();
      rascunho.obs = document.getElementById("obs").value.trim();
      gravarLocal("ultimo-talhao", rascunho.talhao);
      const registro = { id: crypto.randomUUID(), data: new Date().toISOString(), status: "pendente", ...rascunho };
      rascunho = null;
      await salvar(registro);
      if (!navigator.onLine) return ir("resultado", registro.id);
      tela.innerHTML = `<div class="carregando"><div class="girando"></div><h2>Analisando a foto…</h2><p class="suave">Isso pode levar até um minuto.</p></div>`;
      await analisar(registro);
      return ir("resultado", registro.id);
    }

    case "enviar": {
      if (!rascunho.parte) return mostrarErro("Escolha qual parte da planta aparece na foto.");
      rascunho.talhao = document.getElementById("talhao").value.trim();
      rascunho.obs = document.getElementById("obs").value.trim();
      gravarLocal("ultimo-talhao", rascunho.talhao);
      const registro = { id: novoCodigo(), data: new Date().toISOString(), status: "aguardando", ...rascunho };
      rascunho = null;
      await salvar(registro);
      await ir("resultado", registro.id);
      try { await enviarParaAnalise(registro); } catch (erro) { mostrarErro("Não consegui abrir o envio: " + erro.message); }
      return;
    }

    case "reenviar":
      try { await enviarParaAnalise(await buscar(alvo.dataset.id)); } catch (erro) { mostrarErro("Não consegui abrir o envio: " + erro.message); }
      return;

    case "importar": return document.getElementById("laudo").click();

    case "tentar": {
      const r = await buscar(alvo.dataset.id);
      tela.innerHTML = `<div class="carregando"><div class="girando"></div><h2>Analisando a foto…</h2></div>`;
      r.status = "pendente";
      await analisar(r);
      return ir("resultado", r.id);
    }

    case "apagar":
      if (!confirm("Apagar esta foto do histórico?")) return;
      await apagar(alvo.dataset.id);
      return ir("historico");

    case "salvar-codigo": {
      const valor = document.getElementById("codigo").value.trim();
      if (!valor) return;
      gravarLocal("codigo", valor);
      return ir("inicio");
    }

    case "trocar-codigo":
      gravarLocal("codigo", "");
      return ir("codigo");
  }
});

function rotaDoEndereco() {
  const [rota, id] = location.hash.slice(1).split("/");
  return telas[rota] && !["confirmar", "codigo"].includes(rota) ? [rota, id] : ["inicio"];
}
window.addEventListener("popstate", () => {
  const [rota, id] = rotaDoEndereco();
  rotaAtual = rota;
  ir(rota, id);
});

// ---------- início ----------
async function iniciar() {
  base = await (await fetch("dados/pragas.json")).json();
  // Sem servidor (site estático ou sem sinal), o app funciona no modo manual.
  try { status = await (await fetch("/api/status")).json(); } catch {}
  const [rota, id] = rotaDoEndereco();
  await ir(rota, id);
  atualizarSinal();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}
iniciar();
