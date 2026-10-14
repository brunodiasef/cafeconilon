// Conilon Vivo — app do produtor e área do Bruno.
// Login pelo Firebase: o produtor entra com telefone e senha de 6 números; o Bruno (admin) com e-mail.
// Os pedidos (fotos) e os laudos ficam no Firestore. O app guarda uma cópia no celular,
// então funciona sem sinal: o pedido feito sem internet sobe sozinho quando o sinal volta.
import * as fb from "./vendor/firebase.js";
import config from "./firebase-config.js";

const tela = document.getElementById("tela");
const PARTES = ["Folha", "Fruto", "Ramo", "Raiz", "Planta inteira"];
const CONFIANCA = { alta: "Certeza alta", media: "Certeza média", baixa: "Certeza baixa" };
const GRAVIDADE = { leve: "Ataque leve", moderada: "Ataque moderado", grave: "Ataque forte" };
// Acompanhamento de cada caso: o produtor conta se achou o problema, o que fez e se resolveu.
const RECONHECEU = { sim: "Sim, achei", nao: "Não achei", nao_olhou: "Ainda não olhei" };
const RESOLVEU = { sim: "Resolveu", em_parte: "Melhorou um pouco", nao: "Não resolveu", esperando: "Ainda não sei" };
const MAX_FOTOS = 4;
const DIAS_SEM_RETORNO = 7;
const DOMINIO_PRODUTOR = "produtor.conilonvivo.app"; // o telefone vira um "e-mail" interno para o login

// ---------- Firebase ----------
// ?simulador no endereço (só no computador) usa o simulador local do Firebase, para testes.
const SIMULADOR = ["localhost", "127.0.0.1"].includes(location.hostname) && new URLSearchParams(location.search).has("simulador");
const CONFIG = SIMULADOR ? { apiKey: "demo", projectId: "demo-conilon", authDomain: "localhost" } : config;
const CONFIGURADO = Boolean(CONFIG.apiKey && CONFIG.projectId);
let app, auth, db;
if (CONFIGURADO) {
  app = fb.initializeApp(CONFIG);
  auth = fb.getAuth(app);
  db = fb.initializeFirestore(app, { localCache: fb.persistentLocalCache({ tabManager: fb.persistentMultipleTabManager() }) });
  if (SIMULADOR) {
    fb.connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    fb.connectFirestoreEmulator(db, "127.0.0.1", 8080);
  }
}

// ---------- estado ----------
let base = null;
let usuario = null;   // login atual (Firebase Auth)
let perfil = null;    // usuarios/{uid}
let ehAdmin = false;
const casos = new Map();      // código → caso
const produtores = new Map(); // uid → produtor (só para o admin)
const fotosCache = new Map(); // código → [fotos em tamanho grande]
let pararEscuta = [];
let rascunho = null;  // fotos escolhidas, ainda não enviadas
let adicionando = false;
let rotaAtual = "inicio";
let idAtual = null;

// ---------- utilidades ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const problema = (id) => base.problemas.find((p) => p.id === id);
const nomeDiagnostico = (id) => problema(id)?.nome || { saudavel: "Planta sadia", nao_identificado: "Não identificado" }[id] || "—";
const dataBR = (iso) => iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const diaBR = (iso) => iso ? new Date(iso).toLocaleDateString("pt-BR") : "—";
const diasDesde = (iso) => iso ? Math.floor((Date.now() - new Date(iso)) / 86400000) : null;
const agora = () => new Date().toISOString();
const lerLocal = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const gravarLocal = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const lugar = (p) => [p?.comunidade, p?.municipio].filter(Boolean).join(", ");
const IDS_VALIDOS = () => [...base.problemas.map((p) => p.id), "saudavel", "nao_identificado"];
const ordenarCasos = (lista) => [...lista].sort((a, b) => (b.data_foto || "").localeCompare(a.data_foto || ""));

// Telefone: só números, com DDD (10 ou 11 dígitos). "+55 (27) 99999-0000" → "27999990000".
function limparTelefone(texto) {
  let d = String(texto || "").replace(/\D/g, "");
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  return d.length === 10 || d.length === 11 ? d : null;
}
const telefoneBonito = (d) => d ? `(${d.slice(0, 2)}) ${d.slice(2, -4)}-${d.slice(-4)}` : "";
const emailDoTelefone = (d) => `${d}@${DOMINIO_PRODUTOR}`;
const novaSenha = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
// Código curto do pedido, sem letras/números que se confundem (O/0, I/1, L).
function novoCodigo() {
  const letras = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), (n) => letras[n % letras.length]).join("");
}

// ---------- foto ----------
function carregarImagem(arquivo) {
  return new Promise((ok, falha) => {
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(img.src); ok(img); };
    img.onerror = () => falha(new Error("Não foi possível abrir a foto."));
    img.src = URL.createObjectURL(arquivo);
  });
}
// Reduz a foto para economizar dados móveis. Cada foto precisa caber num documento do banco (< 1 MB).
function redimensionar(img, max, qualidade) {
  const escala = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * escala);
  c.height = Math.round(img.height * escala);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  let q = qualidade, dados = c.toDataURL("image/jpeg", q);
  while (dados.length > 900000 && q > 0.4) dados = c.toDataURL("image/jpeg", (q -= 0.1));
  return dados;
}

async function fotoEscolhida(evento) {
  const arquivos = [...(evento.target.files || [])];
  evento.target.value = "";
  if (!arquivos.length) return;
  try {
    if (!adicionando || !rascunho) {
      rascunho = { fotos: [], parte: "", talhao: lerLocal("ultimo-talhao") || "", obs: "" };
    } else {
      guardarCamposDoRascunho();
    }
    for (const arquivo of arquivos.slice(0, MAX_FOTOS - rascunho.fotos.length)) {
      const img = await carregarImagem(arquivo);
      rascunho.fotos.push(redimensionar(img, 1280, 0.82));
      if (rascunho.fotos.length === 1) rascunho.miniatura = redimensionar(img, 200, 0.7);
    }
    ir("confirmar");
  } catch (e) {
    mostrarErro(e.message);
  } finally {
    adicionando = false;
  }
}
function guardarCamposDoRascunho() {
  const talhao = document.getElementById("talhao");
  if (!rascunho || !talhao) return;
  rascunho.talhao = talhao.value.trim();
  rascunho.obs = document.getElementById("obs").value.trim();
}
document.getElementById("camera").addEventListener("change", fotoEscolhida);
document.getElementById("galeria").addEventListener("change", fotoEscolhida);

// ---------- banco ----------
// Grava o pedido e as fotos juntos. Sem sinal, fica na fila do próprio Firebase e sobe depois.
function criarPedido() {
  const codigo = novoCodigo();
  const lote = fb.writeBatch(db);
  lote.set(fb.doc(db, "casos", codigo), {
    codigo,
    produtor_uid: usuario.uid,
    produtor: { nome: perfil.nome, comunidade: perfil.comunidade || "", municipio: perfil.municipio || "", telefone: perfil.telefone || "" },
    parte: rascunho.parte,
    talhao: rascunho.talhao,
    obs: rascunho.obs,
    n_fotos: rascunho.fotos.length,
    miniatura: rascunho.miniatura,
    data_foto: agora(),
    criado_em: fb.serverTimestamp(),
    status: "aguardando",
    laudo: null,
    acompanhamento: null,
  });
  rascunho.fotos.forEach((dados, i) => lote.set(fb.doc(db, "casos", codigo, "fotos", String(i + 1)), { ordem: i + 1, dados }));
  fotosCache.set(codigo, [...rascunho.fotos]);
  lote.commit().catch((e) => mostrarErro("O pedido não foi aceito: " + e.message));
  return codigo;
}

async function fotosDoCaso(codigo) {
  if (fotosCache.has(codigo)) return fotosCache.get(codigo);
  const lista = await fb.getDocs(fb.collection(db, "casos", codigo, "fotos"));
  const fotos = lista.docs.map((d) => d.data()).sort((a, b) => a.ordem - b.ordem).map((f) => f.dados);
  if (fotos.length) fotosCache.set(codigo, fotos);
  return fotos;
}

function salvarAcompanhamento(codigo, mudar) {
  const caso = casos.get(codigo);
  const a = { ...(caso.acompanhamento || {}) };
  mudar(a);
  a.atualizado_em = agora();
  caso.acompanhamento = a; // mostra na hora; o Firebase sobe quando der
  return fb.updateDoc(fb.doc(db, "casos", codigo), { acompanhamento: a, atualizado_em: a.atualizado_em })
    .catch((e) => mostrarErro("Não consegui salvar: " + e.message));
}

// Escuta o banco: o que muda lá aparece na hora na tela (laudo novo, retorno do produtor...).
function escutar() {
  pararEscuta.forEach((parar) => parar());
  casos.clear();
  produtores.clear();
  const consulta = ehAdmin ? fb.collection(db, "casos") : fb.query(fb.collection(db, "casos"), fb.where("produtor_uid", "==", usuario.uid));
  pararEscuta = [
    fb.onSnapshot(consulta, { includeMetadataChanges: true }, (lista) => {
      casos.clear();
      lista.forEach((d) => casos.set(d.id, { ...d.data(), id: d.id, subindo: d.metadata.hasPendingWrites }));
      redesenhar();
    }, (e) => console.warn("casos", e)),
  ];
  if (ehAdmin) {
    pararEscuta.push(fb.onSnapshot(fb.collection(db, "usuarios"), (lista) => {
      produtores.clear();
      lista.forEach((d) => produtores.set(d.id, { ...d.data(), uid: d.id }));
      redesenhar();
    }, (e) => console.warn("usuarios", e)));
  }
}
// Redesenha listas quando o banco muda, sem atrapalhar quem está digitando.
function redesenhar() {
  const digitando = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);
  if (digitando || ["confirmar", "novo-produtor", "entrar", "termos"].includes(rotaAtual)) return;
  const y = window.scrollY;
  ir(rotaAtual, idAtual, { manterRolagem: y });
}

// ---------- situação do caso ----------
function faseDoCaso(c) {
  if (c.status !== "pronto") return c.subindo ? { classe: "falta", texto: "📶 Esperando sinal para enviar" } : { classe: "falta", texto: "⏳ Aguardando análise" };
  if (!c.laudo?.foto_boa) return { classe: "ruim", texto: "📷 Refazer a foto" };
  if (!problema(c.laudo.diagnostico_id)) return null;
  const a = c.acompanhamento || {};
  if (a.resolveu === "sim") return { classe: "ok", texto: "✅ Resolvido" };
  if (a.resolveu === "nao") return { classe: "ruim", texto: "⚠️ Não resolveu" };
  if (a.resolveu === "em_parte") return { classe: "meio", texto: "🌱 Melhorando" };
  if (a.tratamentos?.length || a.outro) return { classe: "meio", texto: "🔧 Em tratamento" };
  if (a.reconheceu === "nao") return { classe: "ruim", texto: "❓ Não achou na lavoura" };
  return { classe: "falta", texto: "✍️ Conte como foi" };
}
function etapas(c) {
  const a = c.acompanhamento || {};
  const tratou = a.tratamentos?.length > 0 || !!a.outro;
  return [
    { nome: "Foto", feito: !c.subindo },
    { nome: "Laudo", feito: c.status === "pronto" },
    { nome: "Achou", feito: a.reconheceu === "sim", ruim: a.reconheceu === "nao" },
    { nome: "Tratou", feito: tratou, ruim: a.nao_tratou && !tratou },
    { nome: "Resolvido", feito: a.resolveu === "sim", meio: a.resolveu === "em_parte", ruim: a.resolveu === "nao" },
  ];
}
// O que o Bruno precisa olhar.
function alertas(c) {
  const a = c.acompanhamento || {};
  const lista = [];
  if (c.status !== "pronto") lista.push(`Esperando laudo há ${diasDesde(c.data_foto)} dia(s).`);
  if (a.resolveu === "nao") lista.push("Não resolveu: falar com o produtor e indicar o Incaper.");
  if (a.reconheceu === "nao") lista.push("Produtor não achou o problema na lavoura: o laudo pode estar errado.");
  if (c.status === "pronto" && problema(c.laudo?.diagnostico_id) && !c.acompanhamento && diasDesde(c.laudo.data_analise) >= DIAS_SEM_RETORNO) {
    lista.push(`Sem retorno do produtor há ${diasDesde(c.laudo.data_analise)} dias.`);
  }
  if (c.laudo?.confianca === "baixa" && a.resolveu !== "sim") lista.push("Laudo com certeza baixa.");
  return lista;
}

// ---------- telas ----------
const telas = {
  semConfig() {
    return `<h1>App ainda não configurado</h1>
      <p>Falta ligar o app ao projeto no Firebase (arquivo <code>firebase-config.js</code>).</p>`;
  },

  entrar() {
    return `<h1>Entrar</h1>
      <p class="suave">Use o telefone e a senha de 6 números que você recebeu.</p>
      <label for="login">Telefone com DDD</label>
      <input id="login" type="text" inputmode="tel" autocomplete="username" placeholder="Ex.: 27 99999-0000">
      <label for="senha">Senha</label>
      <input id="senha" type="password" inputmode="numeric" autocomplete="current-password" maxlength="40" placeholder="6 números">
      <button class="botao" data-acao="entrar">Entrar</button>
      <p class="suave">Esqueceu a senha ou ainda não tem acesso? Fale com o Bruno.</p>`;
  },

  termos() {
    return `<h1>Bem-vindo, ${esc(perfil.nome.split(" ")[0])}!</h1>
      <div class="cartao">
        <p>O Conilon Vivo guarda <b>seu nome, telefone, comunidade e as fotos da sua lavoura</b> para fazer a análise e acompanhar o seu caso.</p>
        <p>Quem vê esses dados: <b>você</b> e o <b>Bruno</b>, responsável pelo app. Eles não são vendidos nem passados para ninguém.</p>
        <p>Se quiser apagar seus dados, é só pedir ao Bruno.</p>
      </div>
      <button class="botao" data-acao="aceitar-termos">Concordo, quero usar</button>
      <button class="botao secundario" data-acao="sair">Não quero</button>`;
  },

  semCadastro() {
    return `<h1>Acesso não liberado</h1>
      <p>Seu login existe, mas o cadastro ainda não foi feito. Fale com o Bruno.</p>
      <button class="botao secundario" data-acao="sair">Sair</button>`;
  },

  // ----- produtor -----
  inicio() {
    if (ehAdmin) return telas.painel();
    const lista = [...casos.values()];
    const subindo = lista.filter((c) => c.subindo).length;
    const aguardando = lista.filter((c) => c.status !== "pronto" && !c.subindo).length;
    const contar = lista.filter((c) => faseDoCaso(c)?.classe === "falta" && c.status === "pronto").length;
    return `
      <h1>Viu algo errado no café?</h1>
      <p class="suave">Tire uma foto bem de perto do problema. O Bruno analisa e o laudo aparece aqui no app.</p>
      <button class="botao grande" data-acao="camera"><span aria-hidden="true">📷</span>Tirar foto</button>
      <button class="botao secundario" data-acao="galeria">Escolher foto da galeria</button>
      ${subindo ? `<div class="aviso">📶 ${subindo} pedido(s) guardado(s) no celular. Vão sozinhos quando tiver sinal.</div>` : ""}
      ${aguardando ? `<div class="aviso">⏳ ${aguardando} pedido(s) aguardando análise. O laudo aparece no <b>Histórico</b>.</div>` : ""}
      ${contar ? `<button class="atalho-acomp" data-ir="historico">✍️ ${contar} caso(s) esperando você contar como foi na lavoura</button>` : ""}
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
    const cabe = rascunho.fotos.length < MAX_FOTOS;
    return `
      <div class="fotos-pedido">
        ${rascunho.fotos.map((f, i) => `<div class="miniatura">
          <img src="${f}" alt="Foto ${i + 1}">
          ${rascunho.fotos.length > 1 ? `<button data-acao="remover-foto" data-indice="${i}" aria-label="Remover foto ${i + 1}">✕</button>` : ""}
        </div>`).join("")}
      </div>
      ${cabe ? `<div class="adicionar">
          <button class="botao secundario" data-acao="adicionar-camera">📷 + Outra foto</button>
          <button class="botao secundario" data-acao="adicionar-galeria">🖼️ + Da galeria</button>
        </div>
        <p class="suave">Mais fotos do mesmo problema ajudam: folha por cima e por baixo, o fruto, o pé inteiro. Até ${MAX_FOTOS} fotos.</p>`
        : `<p class="suave">Limite de ${MAX_FOTOS} fotos neste pedido.</p>`}
      <label>Qual parte da planta? (toque em uma)</label>
      <div class="opcoes" role="group">
        ${PARTES.map((p) => `<button data-parte="${p}" aria-pressed="${p === rascunho.parte}">${p}</button>`).join("")}
      </div>
      <label for="talhao">Talhão ou lavoura (opcional)</label>
      <input id="talhao" type="text" value="${esc(rascunho.talhao)}" placeholder="Ex.: Talhão da baixada" maxlength="60">
      <label for="obs">Quer contar mais alguma coisa? (opcional)</label>
      <textarea id="obs" placeholder="Ex.: começou há 2 semanas, está em vários pés..." maxlength="500">${esc(rascunho.obs)}</textarea>
      <button class="botao" data-acao="enviar">📤 Enviar para análise</button>
      <p class="suave">Sem sinal? Pode enviar assim mesmo: o pedido fica guardado e vai sozinho quando a internet voltar.</p>
      <button class="botao secundario" data-acao="camera">Começar de novo</button>`;
  },

  async resultado(id) {
    const c = casos.get(id);
    if (!c) return ehAdmin ? telas.painel() : telas.historico();
    const fotos = await fotosDoCaso(id).catch(() => []);
    const [primeira, ...outras] = fotos.length ? fotos : [c.miniatura];
    let html = `<img class="foto" src="${primeira}" alt="Foto do pedido">
      ${outras.length ? `<div class="fotos-pedido">${outras.map((f, i) => `<a class="miniatura" href="${f}" target="_blank"><img src="${f}" alt="Foto ${i + 2}"></a>`).join("")}</div>` : ""}
      <p class="suave">${esc(c.parte)}${c.talhao ? " · " + esc(c.talhao) : ""} · ${dataBR(c.data_foto)} · código ${esc(c.id)}</p>`;

    if (ehAdmin) {
      const p = produtores.get(c.produtor_uid) || c.produtor || {};
      html += `<div class="cartao"><h3>${esc(p.nome || "Produtor")}</h3>
        <p class="suave">${esc(lugar(p))}${p.telefone ? ` · ${esc(telefoneBonito(p.telefone))}` : ""}</p>
        ${c.obs ? `<p><b>Ele disse:</b> “${esc(c.obs)}”</p>` : ""}
        <ol class="etapas">${etapas(c).map((e) => `<li class="${e.feito ? "feito" : e.ruim ? "ruim" : e.meio ? "meio" : ""}">${e.nome}</li>`).join("")}</ol>
        ${alertas(c).length ? `<ul class="alertas">${alertas(c).map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` : ""}
        <button class="botao secundario" data-ir="produtor" data-id="${esc(c.produtor_uid)}">Ver todos os casos dele</button>
      </div>`;
    }

    if (c.status !== "pronto") {
      html += `<div class="cartao diagnostico duvida">
          <p class="suave" style="margin:0">${c.subindo ? "Guardado no celular" : "Enviado"}</p>
          <h1>${c.subindo ? "Esperando sinal" : "Aguardando análise"}</h1>
          <p>${c.subindo ? "O pedido vai sozinho quando o celular tiver internet. Não precisa fazer nada." : "O Bruno já recebeu as fotos. O laudo aparece aqui quando ficar pronto."}</p>
        </div>`;
      if (ehAdmin) html += botaoImportarLaudo(c);
      return html;
    }
    const comAcompanhamento = c.laudo.foto_boa && problema(c.laudo.diagnostico_id);
    if (ehAdmin) {
      return html + (comAcompanhamento ? resumoAcompanhamento(c) : "") + renderDiagnostico(c.laudo) + botaoImportarLaudo(c);
    }
    return html
      + (comAcompanhamento ? `<button class="atalho-acomp" data-acao="ir-acompanhamento">✍️ Já cuidou da lavoura? Conte como foi ↓</button>` : "")
      + renderDiagnostico(c.laudo)
      + (comAcompanhamento ? renderAcompanhamento(c) : "");
  },

  historico() {
    const lista = ordenarCasos([...casos.values()]);
    if (!lista.length) return `<h1>Histórico</h1><p class="suave">Nenhum pedido ainda. As fotos que você mandar e os laudos ficam guardados aqui.</p>`;
    return `<h1>Histórico</h1>` + lista.map(linhaDoCaso).join("");
  },

  // ----- Bruno (admin) -----
  painel() {
    const lista = ordenarCasos([...casos.values()]);
    const aguardando = lista.filter((c) => c.status !== "pronto");
    const atencao = lista.filter((c) => c.status === "pronto" && alertas(c).length);
    const numeros = [
      ["Produtores", [...produtores.values()].length],
      ["Casos", lista.length],
      ["Esperando laudo", aguardando.length],
      ["Resolvidos", lista.filter((c) => c.acompanhamento?.resolveu === "sim").length],
      ["Não resolvidos", lista.filter((c) => c.acompanhamento?.resolveu === "nao").length],
    ];
    const porProblema = Object.entries(lista.filter((c) => c.laudo).reduce((m, c) => (m[c.laudo.diagnostico_id] = (m[c.laudo.diagnostico_id] || 0) + 1, m), {}))
      .sort((a, b) => b[1] - a[1]);
    return `<h1>Painel</h1>
      <div class="resumo">${numeros.map(([n, v]) => `<div><b>${v}</b><span class="suave">${n}</span></div>`).join("")}</div>
      <h2>Esperando laudo (${aguardando.length})</h2>
      ${aguardando.length ? aguardando.map(linhaDoCaso).join("") : `<p class="suave">Nenhum pedido novo.</p>`}
      ${aguardando.length ? `<p class="suave">Para analisar, peça ao Claude: <b>“analise os pedidos novos”</b>. Ou abra o pedido e importe o arquivo do laudo.</p>` : ""}
      <h2>Precisa de atenção (${atencao.length})</h2>
      ${atencao.length ? atencao.map((c) => linhaDoCaso(c) + `<ul class="alertas">${alertas(c).map((a) => `<li>${esc(a)}</li>`).join("")}</ul>`).join("") : `<p class="suave">Nada pendente.</p>`}
      ${porProblema.length ? `<h2>Problemas mais vistos</h2>
        <div class="cartao">${porProblema.map(([id, n]) => `<div class="linha-numero"><span>${esc(nomeDiagnostico(id))}</span><b>${n}</b></div>`).join("")}</div>` : ""}`;
  },

  produtores() {
    const lista = [...produtores.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    return `<h1>Produtores</h1>
      <button class="botao" data-ir="novo-produtor">➕ Cadastrar produtor</button>
      ${lista.length ? lista.map((p) => {
        const dele = [...casos.values()].filter((c) => c.produtor_uid === p.uid);
        const pendentes = dele.filter((c) => alertas(c).length).length;
        return `<button class="link-lista" data-ir="produtor" data-id="${esc(p.uid)}">
          <div><b>${esc(p.nome)}</b><div class="meta">${esc(lugar(p))}<br>${dele.length} caso(s)${pendentes ? ` · <span class="fase ruim">${pendentes} para olhar</span>` : ""}</div></div>
          <span class="seta" aria-hidden="true">›</span></button>`;
      }).join("") : `<p class="suave">Nenhum produtor cadastrado ainda.</p>`}`;
  },

  produtor(uid) {
    const p = produtores.get(uid);
    if (!p) return telas.produtores();
    const dele = ordenarCasos([...casos.values()].filter((c) => c.produtor_uid === uid));
    return `<h1>${esc(p.nome)}</h1>
      <p class="suave">${esc(lugar(p))} · desde ${diaBR(p.criado_em)}</p>
      <div class="cartao">
        <p><b>Telefone:</b> ${esc(telefoneBonito(p.telefone))}</p>
        <p><b>Termo de uso:</b> ${p.aceitou_termos_em ? `aceito em ${diaBR(p.aceitou_termos_em)}` : "ainda não entrou no app"}</p>
        <a class="botao secundario" href="https://wa.me/55${esc(p.telefone)}" target="_blank" rel="noopener">💬 Abrir conversa no WhatsApp</a>
      </div>
      <h2>Casos (${dele.length})</h2>
      ${dele.length ? dele.map((c) => linhaDoCaso(c) + `<ol class="etapas">${etapas(c).map((e) => `<li class="${e.feito ? "feito" : e.ruim ? "ruim" : e.meio ? "meio" : ""}">${e.nome}</li>`).join("")}</ol>`).join("") : `<p class="suave">Nenhum pedido ainda.</p>`}`;
  },

  "novo-produtor"() {
    return `<h1>Cadastrar produtor</h1>
      <label for="np-nome">Nome</label>
      <input id="np-nome" type="text" maxlength="60" placeholder="Ex.: José da Silva">
      <label for="np-telefone">Telefone com DDD (é o login dele)</label>
      <input id="np-telefone" type="text" inputmode="tel" maxlength="20" placeholder="Ex.: 27 99999-0000">
      <label for="np-comunidade">Comunidade ou córrego (opcional)</label>
      <input id="np-comunidade" type="text" maxlength="60" placeholder="Ex.: Córrego Bley">
      <label for="np-municipio">Município</label>
      <input id="np-municipio" type="text" maxlength="40" placeholder="Ex.: Jaguaré">
      <label for="np-senha">Senha (6 números)</label>
      <input id="np-senha" type="text" inputmode="numeric" maxlength="6" value="${novaSenha()}">
      <button class="botao" data-acao="salvar-produtor">Cadastrar</button>`;
  },

  // ----- todos -----
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
        <p><b>1.</b> Você tira a foto do problema na lavoura e toca em <b>Enviar para análise</b>.</p>
        <p><b>2.</b> O Bruno analisa. O laudo aparece no <b>Histórico</b>, com os tratamentos <b>do mais barato para o mais caro</b>.</p>
        <p><b>3.</b> Depois de cuidar da lavoura, conte no app se resolveu. Assim o Bruno acompanha o seu caso.</p>
      </div>
      <h2>Importante</h2>
      <div class="cartao">
        <p>O Conilon Vivo dá uma <b>orientação inicial</b>. Ele pode errar e não substitui um técnico.</p>
        <p>Agrotóxico só pode ser comprado e usado com <b>receituário agronômico</b>. Use sempre EPI, respeite a carência e devolva as embalagens vazias.</p>
        <p><b>Assistência técnica gratuita:</b> procure o escritório local do <b>Incaper</b> no seu município.</p>
        <a class="botao secundario" href="https://incaper.es.gov.br" target="_blank" rel="noopener">Site do Incaper</a>
      </div>
      <h2>Sua conta</h2>
      <div class="cartao">
        <p>${ehAdmin ? `<b>Responsável pelo app</b><br>${esc(usuario?.email)}` : `<b>${esc(perfil?.nome)}</b><br>${esc(lugar(perfil))}<br>${esc(telefoneBonito(perfil?.telefone))}`}</p>
        ${ehAdmin ? "" : `<p class="suave">Algum dado errado? Fale com o Bruno.</p>`}
        <button class="botao secundario" data-acao="sair">Sair</button>
      </div>
      <p class="rodape-aviso">Versão de testes · base de pragas ${esc(base.versao)}${SIMULADOR ? " · SIMULADOR" : ""}</p>`;
  },
};

function linhaDoCaso(c) {
  const fase = faseDoCaso(c);
  const titulo = c.status === "pronto" ? (c.laudo.foto_boa ? nomeDiagnostico(c.laudo.diagnostico_id) : "Foto precisa ser refeita") : `Pedido ${c.id}`;
  const quem = ehAdmin ? `${esc(c.produtor?.nome || "")} · ` : "";
  return `<button class="link-lista" data-ir="resultado" data-id="${esc(c.id)}">
    <img src="${c.miniatura || "icone-192.png"}" alt="">
    <div><b>${esc(titulo)}</b><div class="meta">${quem}${esc(c.parte)}${c.talhao ? " · " + esc(c.talhao) : ""}<br>${dataBR(c.data_foto)}</div>
      ${fase ? `<span class="fase ${fase.classe}">${fase.texto}</span>` : ""}</div>
    <span class="seta" aria-hidden="true">›</span></button>`;
}

function botaoImportarLaudo(c) {
  return `<div class="cartao">
      <h3>${c.status === "pronto" ? "Trocar o laudo" : "Laudo"}</h3>
      <p class="suave">Peça ao Claude para analisar o pedido ${esc(c.id)}: ele grava o laudo direto aqui. Se ele te mandar o arquivo <b>laudo-${esc(c.id)}.json</b>, importe abaixo.</p>
      <button class="botao secundario" data-acao="importar" data-id="${esc(c.id)}">📥 Importar arquivo do laudo</button>
    </div>`;
}

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
      ${d.mensagem ? `<div class="cartao"><h3>💬 Recado do Bruno</h3><p>${esc(d.mensagem)}</p></div>` : ""}
      ${ehAdmin ? "" : `<button class="botao" data-acao="camera">Tirar outra foto</button>`}`;
  }
  const recado = d.mensagem ? `<div class="cartao"><h3>💬 Recado do Bruno</h3><p>${esc(d.mensagem)}</p></div>` : "";
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
      ${ehAdmin ? "" : `<button class="botao" data-acao="camera">Tirar outra foto</button>`}`;
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

function renderAcompanhamento(c) {
  const a = c.acompanhamento || {};
  const p = problema(c.laudo.diagnostico_id);
  const botoes = (campo, opcoes) => `<div class="opcoes" role="group">${Object.entries(opcoes).map(([valor, rotulo]) =>
    `<button data-acomp="${campo}" data-valor="${valor}" data-id="${esc(c.id)}" aria-pressed="${a[campo] === valor}">${rotulo}</button>`).join("")}</div>`;
  const tratamentos = [...p.tratamentos].sort((x, y) => x.nivel - y.nivel);
  return `<h2 id="acompanhamento">Como foi na lavoura?</h2>
    <div class="cartao acompanhamento">
      <h3>1. Você achou esse problema na lavoura?</h3>
      ${botoes("reconheceu", RECONHECEU)}
      <h3>2. O que você já fez?</h3>
      <div class="opcoes coluna" role="group">
        ${tratamentos.map((t) => `<button data-acomp="tratamentos" data-valor="${esc(t.titulo)}" data-id="${esc(c.id)}" aria-pressed="${!!a.tratamentos?.includes(t.titulo)}">${esc(t.titulo)}</button>`).join("")}
        <button data-acomp="nao_tratou" data-valor="1" data-id="${esc(c.id)}" aria-pressed="${!!a.nao_tratou}">Ainda não fiz nada</button>
      </div>
      <label for="acomp-outro">Fez outra coisa? Qual? (opcional)</label>
      <input id="acomp-outro" data-texto="outro" data-id="${esc(c.id)}" type="text" value="${esc(a.outro)}" maxlength="120" placeholder="Ex.: passei calda bordalesa">
      <h3>3. Resolveu?</h3>
      ${botoes("resolveu", RESOLVEU)}
      <label for="acomp-obs">Quer contar mais alguma coisa? (opcional)</label>
      <textarea id="acomp-obs" data-texto="obs" data-id="${esc(c.id)}" maxlength="500" placeholder="Ex.: melhorou no talhão de cima, no de baixo continua">${esc(a.obs)}</textarea>
      <p class="suave">${a.atualizado_em ? `✓ Salvo. O Bruno vê na hora. (${dataBR(a.atualizado_em)})` : "O que você marcar fica salvo e o Bruno vê na hora."}
        Se piorar ou não resolver, procure o <b>Incaper</b> (gratuito).</p>
    </div>`;
}

// Para o Bruno: o que o produtor contou, em poucas linhas.
function resumoAcompanhamento(c) {
  const a = c.acompanhamento;
  if (!a) return `<div class="aviso">O produtor ainda não contou como foi na lavoura.</div>`;
  const feitos = [...(a.tratamentos || []), a.outro && `Outro: ${a.outro}`].filter(Boolean);
  return `<div class="cartao"><h3>O que o produtor contou</h3>
    <p><b>Achou na lavoura:</b> ${esc(RECONHECEU[a.reconheceu] || "não respondeu")}<br>
    <b>Fez:</b> ${esc(a.nao_tratou ? "ainda não fez nada" : (feitos.join("; ") || "não respondeu"))}<br>
    <b>Resultado:</b> ${esc(RESOLVEU[a.resolveu] || "não respondeu")}</p>
    ${a.obs ? `<p>“${esc(a.obs)}”</p>` : ""}
    <p class="suave">Atualizado em ${dataBR(a.atualizado_em)}</p></div>`;
}

function avisoFinal() {
  return `<p class="rodape-aviso">Orientação inicial, não substitui o técnico. Produto químico só com receituário agronômico, EPI e respeito à carência. Assistência gratuita: escritório local do Incaper.</p>`;
}

function mostrarErro(msg, classe = "erro") {
  tela.insertAdjacentHTML("afterbegin", `<div class="aviso ${classe}">${esc(msg)}</div>`);
  window.scrollTo(0, 0);
}
const mostrarAviso = (msg) => mostrarErro(msg, "");

const ABAS_PRODUTOR = [["inicio", "📷", "Foto"], ["historico", "📋", "Histórico"], ["guia", "📖", "Pragas"], ["sobre", "ℹ️", "Ajuda"]];
const ABAS_ADMIN = [["inicio", "📊", "Painel"], ["produtores", "👥", "Produtores"], ["guia", "📖", "Pragas"], ["sobre", "ℹ️", "Conta"]];
// Rotas que só existem para um dos dois tipos de usuário.
const SO_ADMIN = ["painel", "produtores", "produtor", "novo-produtor"];
const SO_PRODUTOR = ["confirmar", "historico"];

async function ir(rota, id, { manterRolagem } = {}) {
  if (!CONFIGURADO) rota = "semConfig";
  else if (!usuario) rota = "entrar";
  else if (!ehAdmin && !perfil) rota = "semCadastro";
  else if (!ehAdmin && !perfil.aceitou_termos_em && rota !== "sobre") rota = "termos";
  else if ((ehAdmin && SO_PRODUTOR.includes(rota)) || (!ehAdmin && SO_ADMIN.includes(rota))) rota = "inicio";
  rotaAtual = rota;
  idAtual = id;
  document.body.classList.toggle("admin", ehAdmin);
  const abas = document.querySelector(".abas");
  abas.hidden = !usuario || (!ehAdmin && !perfil?.aceitou_termos_em);
  abas.innerHTML = (ehAdmin ? ABAS_ADMIN : ABAS_PRODUTOR).map(([r, icone, nome]) =>
    `<button data-ir="${r}"><span aria-hidden="true">${icone}</span>${nome}</button>`).join("");
  abas.querySelectorAll("button").forEach((b) => {
    const aba = b.dataset.ir;
    const ativa = aba === rota || (rota === "praga" && aba === "guia")
      || (rota === "resultado" && aba === (ehAdmin ? "inicio" : "historico"))
      || (["produtor", "novo-produtor"].includes(rota) && aba === "produtores");
    b.classList.toggle("ativo", ativa);
  });
  tela.innerHTML = await telas[rota](id);
  window.scrollTo(0, manterRolagem ?? 0);
  const destino = rota === "inicio" ? "#" : `#${rota}${id ? "/" + id : ""}`;
  if (manterRolagem === undefined && location.hash !== destino && !(rota === "inicio" && !location.hash)) history.pushState(null, "", destino);
}

// ---------- login ----------
async function aoMudarLogin(u) {
  pararEscuta.forEach((parar) => parar());
  pararEscuta = [];
  usuario = u;
  perfil = null;
  ehAdmin = false;
  casos.clear();
  fotosCache.clear();
  if (u) {
    // Guarda quem é quem no celular: sem sinal, o app abre com o que já sabia.
    const chave = "perfil-" + u.uid;
    try {
      ehAdmin = (await fb.getDoc(fb.doc(db, "admins", u.uid))).exists();
      if (!ehAdmin) perfil = (await fb.getDoc(fb.doc(db, "usuarios", u.uid))).data() || null;
      gravarLocal(chave, JSON.stringify({ ehAdmin, perfil }));
    } catch (e) {
      console.warn("perfil", e);
      try { ({ ehAdmin, perfil } = JSON.parse(lerLocal(chave)) || {}); } catch {}
      ehAdmin = !!ehAdmin;
      perfil ??= null;
    }
    if (ehAdmin || perfil) escutar();
  }
  const [rota, id] = rotaDoEndereco();
  await ir(rota, id);
}

function mensagemDoLogin(e) {
  if (["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found", "auth/invalid-email"].includes(e.code)) return "Telefone ou senha errados.";
  if (e.code === "auth/too-many-requests") return "Muitas tentativas. Espere alguns minutos e tente de novo.";
  if (e.code === "auth/network-request-failed") return "Sem internet. Para entrar pela primeira vez, precisa de sinal.";
  return "Não consegui entrar: " + e.message;
}

// O Bruno cadastra o produtor sem sair da conta dele: usa uma segunda conexão só para criar o login.
async function cadastrarProdutor() {
  const campo = (id) => document.getElementById(id).value.trim();
  const telefone = limparTelefone(campo("np-telefone"));
  const dados = { nome: campo("np-nome"), telefone, comunidade: campo("np-comunidade"), municipio: campo("np-municipio") };
  const senha = campo("np-senha");
  if (!dados.nome || !dados.municipio) return mostrarErro("Preencha pelo menos o nome e o município.");
  if (!telefone) return mostrarErro("Telefone inválido. Use o DDD e o número, ex.: 27 99999-0000.");
  if (!/^\d{6}$/.test(senha)) return mostrarErro("A senha precisa ter 6 números.");
  const segundo = fb.initializeApp(CONFIG, "cadastro-" + Date.now());
  try {
    const authCadastro = fb.initializeAuth(segundo, { persistence: fb.inMemoryPersistence });
    if (SIMULADOR) fb.connectAuthEmulator(authCadastro, "http://127.0.0.1:9099", { disableWarnings: true });
    const { user } = await fb.createUserWithEmailAndPassword(authCadastro, emailDoTelefone(telefone), senha);
    await fb.setDoc(fb.doc(db, "usuarios", user.uid), { ...dados, criado_em: agora(), criado_por: usuario.uid });
    const recado = `Olá, ${dados.nome.split(" ")[0]}! Seu acesso ao Conilon Vivo:\n\n${location.origin}${location.pathname}\nTelefone: ${telefoneBonito(telefone)}\nSenha: ${senha}\n\nNo celular, abra o link e use "Adicionar à tela inicial" para instalar o app.`;
    tela.innerHTML = `<h1>Produtor cadastrado</h1>
      <div class="cartao"><p><b>${esc(dados.nome)}</b><br>${esc(lugar(dados))}</p>
        <p>Login: <b>${esc(telefoneBonito(telefone))}</b><br>Senha: <b class="senha">${esc(senha)}</b></p></div>
      <p class="suave">Mande o acesso para ele. A senha não aparece de novo depois que você sair desta tela.</p>
      <a class="botao" href="https://wa.me/55${telefone}?text=${encodeURIComponent(recado)}" target="_blank" rel="noopener">💬 Mandar acesso pelo WhatsApp</a>
      <button class="botao secundario" data-ir="produtor" data-id="${esc(user.uid)}">Ver produtor</button>`;
    rotaAtual = "novo-produtor";
  } catch (e) {
    mostrarErro(e.code === "auth/email-already-in-use" ? "Esse telefone já tem cadastro." : "Não consegui cadastrar: " + e.message);
  } finally {
    fb.deleteApp(segundo).catch(() => {});
  }
}

// O Bruno importa um arquivo laudo-CODIGO.json num pedido.
let importarPara = null;
async function importarLaudo(evento) {
  const arquivo = evento.target.files?.[0];
  evento.target.value = "";
  if (!arquivo || !importarPara) return;
  try {
    const laudo = JSON.parse(await arquivo.text());
    const d = laudo.resultado;
    if (laudo.tipo !== "conilon-vivo-laudo" || !d || !IDS_VALIDOS().includes(d.diagnostico_id)) throw new Error("não é um laudo do Conilon Vivo");
    if (laudo.codigo !== importarPara) throw new Error(`o arquivo é do pedido ${laudo.codigo}, não do ${importarPara}`);
    await fb.updateDoc(fb.doc(db, "casos", importarPara), { laudo: { ...d, data_analise: laudo.data_analise || agora() }, status: "pronto", atualizado_em: agora() });
    mostrarAviso("Laudo enviado. O produtor já vê no app.");
  } catch (e) {
    mostrarErro("Não consegui importar: " + (e instanceof SyntaxError ? "não é um laudo do Conilon Vivo" : e.message));
  }
}
document.getElementById("laudo").addEventListener("change", importarLaudo);

// ---------- ações ----------
document.addEventListener("click", async (e) => {
  const alvo = e.target.closest("[data-ir], [data-acao], [data-parte], [data-acomp]");
  if (!alvo) return;

  if (alvo.dataset.ir) return ir(alvo.dataset.ir, alvo.dataset.id);

  if (alvo.dataset.parte) {
    rascunho.parte = alvo.dataset.parte;
    document.querySelectorAll("[data-parte]").forEach((b) => b.setAttribute("aria-pressed", b === alvo));
    return;
  }

  if (alvo.dataset.acomp) {
    const { acomp: campo, valor, id } = alvo.dataset;
    salvarAcompanhamento(id, (a) => {
      if (campo === "tratamentos") {
        const lista = new Set(a.tratamentos || []);
        lista.has(valor) ? lista.delete(valor) : lista.add(valor);
        a.tratamentos = [...lista];
        if (lista.size) a.nao_tratou = false;
      } else if (campo === "nao_tratou") {
        a.nao_tratou = !a.nao_tratou;
        if (a.nao_tratou) a.tratamentos = [];
      } else {
        a[campo] = a[campo] === valor ? null : valor;
      }
    });
    return ir("resultado", id, { manterRolagem: window.scrollY });
  }

  switch (alvo.dataset.acao) {
    case "entrar": {
      const login = document.getElementById("login").value.trim();
      const senha = document.getElementById("senha").value;
      const telefone = limparTelefone(login);
      const email = login.includes("@") ? login : telefone && emailDoTelefone(telefone);
      if (!email || !senha) return mostrarErro("Digite o telefone com DDD e a senha.");
      alvo.disabled = true;
      try {
        await fb.signInWithEmailAndPassword(auth, email, senha);
      } catch (erro) {
        alvo.disabled = false;
        mostrarErro(mensagemDoLogin(erro));
      }
      return;
    }

    case "sair":
      if (!confirm("Sair da sua conta neste celular?")) return;
      rascunho = null;
      return fb.signOut(auth);

    case "aceitar-termos":
      perfil.aceitou_termos_em = agora();
      fb.updateDoc(fb.doc(db, "usuarios", usuario.uid), { aceitou_termos_em: perfil.aceitou_termos_em }).catch((erro) => mostrarErro(erro.message));
      return ir("inicio");

    case "camera": return document.getElementById("camera").click();
    case "galeria": return document.getElementById("galeria").click();

    case "adicionar-camera":
    case "adicionar-galeria":
      adicionando = true;
      return document.getElementById(alvo.dataset.acao === "adicionar-camera" ? "camera" : "galeria").click();

    case "remover-foto":
      guardarCamposDoRascunho();
      rascunho.fotos.splice(Number(alvo.dataset.indice), 1);
      if (Number(alvo.dataset.indice) === 0) {
        rascunho.miniatura = redimensionar(await carregarImagem(await (await fetch(rascunho.fotos[0])).blob()), 200, 0.7);
      }
      return ir("confirmar");

    case "enviar": {
      if (!rascunho.parte) return mostrarErro("Escolha qual parte da planta aparece na foto.");
      guardarCamposDoRascunho();
      gravarLocal("ultimo-talhao", rascunho.talhao);
      const codigo = criarPedido();
      rascunho = null;
      return ir("resultado", codigo);
    }

    case "ir-acompanhamento":
      return document.getElementById("acompanhamento")?.scrollIntoView({ behavior: "smooth" });

    case "salvar-produtor":
      alvo.disabled = true;
      await cadastrarProdutor();
      alvo.disabled = false;
      return;

    case "importar":
      importarPara = alvo.dataset.id;
      return document.getElementById("laudo").click();
  }
});

// Textos do acompanhamento: salvam quando o produtor sai do campo.
document.addEventListener("change", (e) => {
  const campo = e.target.dataset?.texto;
  if (!campo) return;
  salvarAcompanhamento(e.target.dataset.id, (a) => { a[campo] = e.target.value.trim(); });
});

function rotaDoEndereco() {
  const [rota, id] = location.hash.slice(1).split("/");
  return telas[rota] && !["confirmar", "entrar", "termos", "semConfig", "semCadastro"].includes(rota) ? [rota, id] : ["inicio"];
}
window.addEventListener("popstate", () => {
  const [rota, id] = rotaDoEndereco();
  ir(rota, id);
});

function atualizarSinal() {
  document.getElementById("sinal").hidden = navigator.onLine;
}
window.addEventListener("online", atualizarSinal);
window.addEventListener("offline", atualizarSinal);

// ---------- início ----------
async function iniciar() {
  base = await (await fetch("dados/pragas.json")).json();
  atualizarSinal();
  if ("serviceWorker" in navigator && !SIMULADOR) navigator.serviceWorker.register("sw.js").catch(() => {});
  if (!CONFIGURADO) return ir("semConfig");
  fb.onAuthStateChanged(auth, aoMudarLogin);
}
iniciar();
