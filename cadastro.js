// Cadastro dos produtores e acompanhamento de cada caso (lado do Bruno).
// Os dados ficam em produtores/cadastro.json, fora do git: são dados pessoais dos produtores.
//
// Uso:
//   node cadastro.js validar       confere o cadastro
//   node cadastro.js sincronizar   puxa os laudos de laudos/ para os casos
//   node cadastro.js painel        gera produtores/painel.html (abre no navegador)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { base, IDS, Laudo } from "./diagnostico.js";

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const PASTA = path.join(RAIZ, "produtores");
const ARQUIVO = path.join(PASTA, "cadastro.json");
const SEM_CADASTRO = "sem_cadastro";

const Produtor = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, "use só letras minúsculas, números e hífen (ex.: joao-silva)"),
  nome: z.string().min(1),
  comunidade: z.string().optional(),
  municipio: z.string().optional(),
  telefone: z.string().optional(),
  desde: z.string(),
  obs: z.string().optional(),
});

const Caso = z.object({
  codigo: z.string().regex(/^[A-Z0-9]{6}$/),
  produtor: z.string(),
  data_foto: z.string().optional(),
  parte: z.string().optional(),
  talhao: z.string().optional(),
  obs_produtor: z.string().optional(),
  // Preenchidos pelo laudo (node cadastro.js sincronizar)
  diagnostico_id: z.enum(IDS).optional(),
  confianca: z.enum(["alta", "media", "baixa"]).optional(),
  gravidade: z.enum(["leve", "moderada", "grave", "nao_se_aplica"]).optional(),
  data_laudo: z.string().optional(),
  // Preenchidos pelo retorno do produtor (mensagem "Conilon Vivo — retorno")
  reconheceu: z.enum(["sim", "nao", "nao_olhou"]).nullable().default(null),
  tratamentos: z.array(z.string()).default([]),
  nao_tratou: z.boolean().default(false),
  resolveu: z.enum(["sim", "em_parte", "nao", "esperando"]).nullable().default(null),
  data_retorno: z.string().optional(),
  obs_retorno: z.string().optional(),
  notas: z.string().optional().describe("Anotações do Bruno"),
  eventos: z.array(z.object({ data: z.string(), o_que: z.string() })).default([]),
});

const Cadastro = z.object({
  tipo: z.literal("conilon-vivo-cadastro"),
  versao: z.literal(1),
  produtores: z.array(Produtor),
  casos: z.array(Caso),
}).superRefine((c, ctx) => {
  const ids = new Set(c.produtores.map((p) => p.id));
  if (ids.size !== c.produtores.length) ctx.addIssue({ code: "custom", message: "há produtores com o mesmo id" });
  const codigos = new Set();
  for (const caso of c.casos) {
    if (codigos.has(caso.codigo)) ctx.addIssue({ code: "custom", message: `caso ${caso.codigo} repetido` });
    codigos.add(caso.codigo);
    if (caso.produtor !== SEM_CADASTRO && !ids.has(caso.produtor)) {
      ctx.addIssue({ code: "custom", message: `caso ${caso.codigo}: produtor "${caso.produtor}" não está cadastrado` });
    }
  }
});

function ler() {
  if (!fs.existsSync(ARQUIVO)) return { tipo: "conilon-vivo-cadastro", versao: 1, produtores: [], casos: [] };
  return Cadastro.parse(JSON.parse(fs.readFileSync(ARQUIVO, "utf8")));
}
function gravar(cadastro) {
  fs.mkdirSync(PASTA, { recursive: true });
  fs.writeFileSync(ARQUIVO, JSON.stringify(Cadastro.parse(cadastro), null, 2) + "\n");
}

function sincronizar() {
  const cadastro = ler();
  const pasta = path.join(RAIZ, "laudos");
  let novos = 0, atualizados = 0;
  for (const nome of fs.readdirSync(pasta).filter((n) => /^laudo-[A-Z0-9]{6}\.json$/.test(n)).sort()) {
    const laudo = Laudo.parse(JSON.parse(fs.readFileSync(path.join(pasta, nome), "utf8")));
    let caso = cadastro.casos.find((c) => c.codigo === laudo.codigo);
    if (!caso) {
      caso = Caso.parse({ codigo: laudo.codigo, produtor: SEM_CADASTRO });
      cadastro.casos.push(caso);
      novos++;
    }
    const r = laudo.resultado;
    if (caso.diagnostico_id === r.diagnostico_id && caso.data_laudo === laudo.data_analise) continue;
    const trocou = caso.diagnostico_id && caso.diagnostico_id !== r.diagnostico_id;
    Object.assign(caso, { diagnostico_id: r.diagnostico_id, confianca: r.confianca, gravidade: r.gravidade, data_laudo: laudo.data_analise });
    caso.data_foto ??= laudo.data_foto;
    caso.parte ??= laudo.parte;
    caso.talhao ??= laudo.talhao;
    caso.eventos.push({ data: laudo.data_analise, o_que: `${trocou ? "Laudo refeito" : "Laudo"}: ${nomeProblema(r.diagnostico_id)} (${CONFIANCA[r.confianca]})` });
    atualizados++;
  }
  gravar(cadastro);
  const sem = cadastro.casos.filter((c) => c.produtor === SEM_CADASTRO).map((c) => c.codigo);
  console.log(`OK  ${novos} caso(s) novo(s), ${atualizados} atualizado(s) com o laudo.`);
  if (sem.length) console.log(`Atenção: sem produtor ligado: ${sem.join(", ")}`);
}

// ---------- painel ----------
const nomeProblema = (id) => base.problemas.find((p) => p.id === id)?.nome
  || { saudavel: "Planta sadia", nao_identificado: "Não identificado" }[id] || "—";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const dataBR = (iso) => {
  if (!iso) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso.split("-").reverse().join("/"); // data sem hora: não converte fuso
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
};
const CONFIANCA = { alta: "certeza alta", media: "certeza média", baixa: "certeza baixa" };
const GRAVIDADE = { leve: "ataque leve", moderada: "ataque moderado", grave: "ataque forte" };
const diasDesde = (iso) => iso ? Math.floor((Date.now() - new Date(iso)) / 86400000) : null;
const RECONHECEU = { sim: "Achou na lavoura", nao: "Não achou na lavoura", nao_olhou: "Ainda não olhou" };
const RESOLVEU = { sim: "Resolveu", em_parte: "Melhorou um pouco", nao: "Não resolveu", esperando: "Ainda não sabe" };
const DIAS_SEM_RETORNO = 7;

// As etapas do caso: foto → laudo → achou na lavoura → tratou → resolvido.
function etapas(c) {
  const tratou = c.tratamentos.length > 0;
  return [
    { nome: "Foto", feito: true },
    { nome: "Laudo", feito: !!c.diagnostico_id },
    { nome: "Achou", feito: c.reconheceu === "sim", ruim: c.reconheceu === "nao" },
    { nome: "Tratou", feito: tratou, ruim: c.nao_tratou && !tratou },
    { nome: "Resolvido", feito: c.resolveu === "sim", meio: c.resolveu === "em_parte", ruim: c.resolveu === "nao" },
  ];
}

function alertas(c) {
  const lista = [];
  if (c.produtor === SEM_CADASTRO) lista.push("Caso sem produtor ligado no cadastro.");
  if (c.resolveu === "nao") lista.push("Não resolveu: falar com o produtor e indicar o Incaper.");
  if (c.reconheceu === "nao") lista.push("Produtor não achou o problema na lavoura: o laudo pode estar errado.");
  if (c.diagnostico_id && !c.data_retorno && diasDesde(c.data_laudo) >= DIAS_SEM_RETORNO) {
    lista.push(`Sem retorno há ${diasDesde(c.data_laudo)} dias.`);
  }
  if (c.confianca === "baixa" && c.resolveu !== "sim") lista.push("Laudo com certeza baixa.");
  if (!c.diagnostico_id) lista.push("Falta fazer o laudo.");
  return lista;
}

function linhaCaso(c, produtores) {
  const p = produtores.find((x) => x.id === c.produtor);
  const feitos = [...c.tratamentos, c.nao_tratou && !c.tratamentos.length ? "Ainda não fez nada" : null].filter(Boolean);
  const avisos = alertas(c);
  return `<article class="caso">
    <header>
      <div><b>${esc(nomeProblema(c.diagnostico_id))}</b>
        <span class="suave">${esc([c.parte, c.talhao].filter(Boolean).join(" · "))}</span></div>
      <code>${esc(c.codigo)}</code>
    </header>
    <ol class="etapas">${etapas(c).map((e) => `<li class="${e.feito ? "feito" : e.ruim ? "ruim" : e.meio ? "meio" : ""}">${e.nome}</li>`).join("")}</ol>
    <dl>
      ${p ? "" : `<dt>Produtor</dt><dd>sem cadastro</dd>`}
      <dt>Foto</dt><dd>${dataBR(c.data_foto)}${c.obs_produtor ? ` — “${esc(c.obs_produtor)}”` : ""}</dd>
      ${c.diagnostico_id ? `<dt>Laudo</dt><dd>${[dataBR(c.data_laudo), CONFIANCA[c.confianca], GRAVIDADE[c.gravidade]].filter(Boolean).join(" · ")}</dd>` : ""}
      ${c.data_retorno ? `<dt>Retorno</dt><dd>${dataBR(c.data_retorno)} · ${esc(RECONHECEU[c.reconheceu] || "—")} · ${esc(RESOLVEU[c.resolveu] || "—")}</dd>` : ""}
      ${feitos.length ? `<dt>Fez</dt><dd>${feitos.map(esc).join("; ")}</dd>` : ""}
      ${c.obs_retorno ? `<dt>Disse</dt><dd>“${esc(c.obs_retorno)}”</dd>` : ""}
      ${c.notas ? `<dt>Notas</dt><dd>${esc(c.notas)}</dd>` : ""}
    </dl>
    ${avisos.length ? `<ul class="alertas">${avisos.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` : ""}
  </article>`;
}

function painel() {
  const { produtores, casos } = ler();
  const ordenar = (a, b) => (b.data_foto || b.data_laudo || "").localeCompare(a.data_foto || a.data_laudo || "");
  const atencao = casos.filter((c) => alertas(c).length).sort(ordenar);
  const conta = (f) => casos.filter(f).length;
  const resumo = [
    ["Produtores", produtores.length],
    ["Casos", casos.length],
    ["Esperando retorno", conta((c) => c.diagnostico_id && !c.data_retorno)],
    ["Resolvidos", conta((c) => c.resolveu === "sim")],
    ["Não resolvidos", conta((c) => c.resolveu === "nao")],
  ];
  const porProblema = Object.entries(casos.reduce((m, c) => (m[c.diagnostico_id || "—"] = (m[c.diagnostico_id || "—"] || 0) + 1, m), {}))
    .sort((a, b) => b[1] - a[1]);
  const grupos = [...produtores.map((p) => ({ p, casos: casos.filter((c) => c.produtor === p.id).sort(ordenar) })),
    { p: null, casos: casos.filter((c) => c.produtor === SEM_CADASTRO).sort(ordenar) }].filter((g) => g.p || g.casos.length);
  const zap = (tel) => tel ? `https://wa.me/55${tel.replace(/\D/g, "").replace(/^55/, "")}` : "";

  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Painel dos produtores</title>
<style>
:root { --fundo:#f7f3ea; --papel:#fff; --texto:#22201c; --suave:#5d5a52; --borda:#d9d2c3; --verde:#1f5e2e; --verde-claro:#e3efdc;
  --amarelo:#8a5a00; --amarelo-claro:#fbefd2; --cereja:#a3271f; --cereja-claro:#f8e2df; }
@media (prefers-color-scheme: dark) { :root { --fundo:#171a16; --papel:#22261f; --texto:#ece8de; --suave:#aaa496; --borda:#3a3f35;
  --verde:#8fcf9a; --verde-claro:#23402a; --amarelo:#e8c06a; --amarelo-claro:#3d3218; --cereja:#f19a90; --cereja-claro:#47221e; } }
* { box-sizing:border-box; }
body { margin:0; background:var(--fundo); color:var(--texto); font:16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width:860px; margin:0 auto; padding:20px 16px 48px; }
h1 { font-size:26px; margin:0 0 4px; } h2 { font-size:20px; margin:32px 0 10px; } h3 { margin:0; font-size:18px; }
.suave { color:var(--suave); font-size:14px; }
.resumo { display:grid; grid-template-columns:repeat(auto-fit, minmax(130px, 1fr)); gap:10px; margin-top:16px; }
.resumo div { background:var(--papel); border:1px solid var(--borda); border-radius:12px; padding:12px; }
.resumo b { display:block; font-size:28px; line-height:1.1; font-variant-numeric:tabular-nums; }
.produtor { background:var(--papel); border:1px solid var(--borda); border-radius:14px; padding:16px; margin-bottom:14px; }
.produtor > header { display:flex; flex-wrap:wrap; gap:8px 16px; align-items:baseline; justify-content:space-between; margin-bottom:10px; }
.produtor a { color:var(--verde); font-weight:700; }
.caso { border-top:1px solid var(--borda); padding:12px 0 4px; }
.caso > header { display:flex; justify-content:space-between; gap:12px; align-items:baseline; }
.caso > header .suave { margin-left:6px; }
code { font:600 14px ui-monospace, monospace; color:var(--suave); }
.etapas { display:flex; flex-wrap:wrap; gap:4px; list-style:none; padding:0; margin:8px 0; }
.etapas li { font-size:13px; font-weight:600; padding:2px 10px; border-radius:99px; border:1px solid var(--borda); color:var(--suave); }
.etapas li.feito { background:var(--verde-claro); border-color:transparent; color:var(--verde); }
.etapas li.meio { background:var(--amarelo-claro); border-color:transparent; color:var(--amarelo); }
.etapas li.ruim { background:var(--cereja-claro); border-color:transparent; color:var(--cereja); }
dl { display:grid; grid-template-columns:max-content 1fr; gap:2px 12px; margin:6px 0; font-size:15px; }
dt { color:var(--suave); } dd { margin:0; }
.alertas { margin:6px 0 8px; padding:8px 12px 8px 28px; background:var(--amarelo-claro); color:var(--amarelo); border-radius:10px; font-size:15px; }
table { border-collapse:collapse; width:100%; background:var(--papel); border:1px solid var(--borda); border-radius:12px; overflow:hidden; }
td { padding:8px 12px; border-top:1px solid var(--borda); } tr:first-child td { border-top:0; }
td:last-child { text-align:right; font-variant-numeric:tabular-nums; font-weight:700; }
.vazio { background:var(--papel); border:1px dashed var(--borda); border-radius:12px; padding:16px; color:var(--suave); }
</style></head>
<body><main>
  <h1>Painel dos produtores</h1>
  <p class="suave">Conilon Vivo · atualizado em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · dados só deste computador</p>
  <section class="resumo">${resumo.map(([n, v]) => `<div><b>${v}</b><span class="suave">${n}</span></div>`).join("")}</section>

  <h2>Precisa de atenção (${atencao.length})</h2>
  ${atencao.length ? atencao.map((c) => {
    const p = produtores.find((x) => x.id === c.produtor);
    return `<div class="produtor"><header><h3>${esc(p?.nome || "Sem cadastro")}</h3><span class="suave">${esc(p?.municipio || "")}</span></header>${linhaCaso(c, produtores)}</div>`;
  }).join("") : `<p class="vazio">Nada pendente.</p>`}

  <h2>Por produtor</h2>
  ${grupos.length ? grupos.map(({ p, casos: lista }) => `<section class="produtor">
    <header>
      <div><h3>${esc(p?.nome || "Casos sem produtor ligado")}</h3>
        ${p ? `<span class="suave">${esc([p.comunidade, p.municipio].filter(Boolean).join(", "))} · desde ${dataBR(p.desde)}</span>` : ""}</div>
      ${p?.telefone ? `<a href="${zap(p.telefone)}">WhatsApp ${esc(p.telefone)}</a>` : ""}
    </header>
    ${p?.obs ? `<p class="suave">${esc(p.obs)}</p>` : ""}
    ${lista.length ? lista.map((c) => linhaCaso(c, produtores)).join("") : `<p class="suave">Nenhum caso ainda.</p>`}
  </section>`).join("") : `<p class="vazio">Nenhum produtor cadastrado ainda.</p>`}

  <h2>Problemas mais vistos</h2>
  ${porProblema.length ? `<table>${porProblema.map(([id, n]) => `<tr><td>${esc(nomeProblema(id))}</td><td>${n}</td></tr>`).join("")}</table>` : `<p class="vazio">Nenhum caso ainda.</p>`}
</main></body></html>`;
  fs.mkdirSync(PASTA, { recursive: true });
  fs.writeFileSync(path.join(PASTA, "painel.html"), html);
  console.log(`OK  painel gerado: produtores/painel.html (${produtores.length} produtor(es), ${casos.length} caso(s), ${atencao.length} para atenção)`);
}

const comando = process.argv[2];
try {
  if (comando === "validar") { const c = ler(); console.log(`OK  ${c.produtores.length} produtor(es), ${c.casos.length} caso(s).`); }
  else if (comando === "sincronizar") sincronizar();
  else if (comando === "painel") painel();
  else { console.error("Uso: node cadastro.js validar | sincronizar | painel"); process.exit(1); }
} catch (erro) {
  console.error("ERRO " + (erro instanceof z.ZodError ? erro.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : erro.message));
  process.exit(1);
}
