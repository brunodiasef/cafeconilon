// Servidor do Conilon Vivo: entrega o app (pasta public/) e analisa fotos com o Claude.
// A chave da API fica só aqui no servidor, nunca vai para o celular.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { base, Diagnostico } from "./diagnostico.js";

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const PUBLICO = path.join(RAIZ, "public");
const PORTA = Number(process.env.PORT || 3000);
const MODELO = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const CODIGO_ACESSO = process.env.CODIGO_ACESSO || "";
const LIMITE_POR_HORA = Number(process.env.LIMITE_POR_HORA || 30);
// Sem chave da API, o app funciona no modo manual: o produtor envia a foto e importa o laudo.
const MODO_MANUAL = !process.env.ANTHROPIC_API_KEY;


const catalogo = base.problemas
  .map((p) => `- id "${p.id}": ${p.nome} (${p.nome_cientifico}). Onde: ${p.onde}. Sintomas: ${p.sintomas.join("; ")}.`)
  .join("\n");

const SISTEMA = `Você ajuda pequenos produtores de café conilon (Coffea canephora) do Espírito Santo a identificar problemas na lavoura por foto.

Classifique a foto em UM dos ids do catálogo abaixo, ou:
- "saudavel" se a planta parecer sadia;
- "nao_identificado" se não for possível saber, se não for café, ou se o problema não estiver no catálogo.

Catálogo:
${catalogo}

Regras:
- Seja honesto sobre a incerteza. Prefira confiança "baixa" ou "nao_identificado" a chutar. Um erro pode fazer o produtor gastar dinheiro à toa.
- Considere sintomas parecidos: deficiência nutricional x doença; cercosporiose x ferrugem; bicho-mineiro x queimadura de sol; cochonilha-da-roseta x fungos brancos.
- Escreva em português simples, como quem conversa com um produtor rural. Nada de termos técnicos sem explicar.
- Não recomende produtos nem doses: o app mostra os tratamentos a partir de uma base revisada.`;

const cliente = MODO_MANUAL ? null : new Anthropic();

async function diagnosticar({ imagens, parte, observacao }) {
  const texto = [
    `Parte da planta fotografada: ${parte || "não informada"}.`,
    imagens.length > 1 ? `São ${imagens.length} fotos do mesmo problema, de ângulos diferentes. Considere todas juntas.` : "",
    observacao ? `O produtor escreveu: "${observacao.slice(0, 500)}"` : "",
  ].filter(Boolean).join("\n");

  const resposta = await cliente.beta.messages.parse({
    model: MODELO,
    max_tokens: 16000,
    output_config: { effort: "medium", format: betaZodOutputFormat(Diagnostico) },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SISTEMA,
    messages: [{
      role: "user",
      content: [
        ...imagens.map((data) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } })),
        { type: "text", text: texto },
      ],
    }],
  });

  if (resposta.stop_reason === "refusal" || !resposta.parsed_output) {
    throw new ErroUsuario("Não consegui analisar esta foto. Tente outra foto.");
  }
  return resposta.parsed_output;
}

class ErroUsuario extends Error {}

// Limite simples por IP para a fase de testes (evita gasto descontrolado).
const usos = new Map();
function dentroDoLimite(ip) {
  const agora = Date.now();
  const lista = (usos.get(ip) || []).filter((t) => agora - t < 3600_000);
  if (lista.length >= LIMITE_POR_HORA) return false;
  lista.push(agora);
  usos.set(ip, lista);
  return true;
}

async function lerCorpo(req, maxBytes) {
  const partes = [];
  let total = 0;
  for await (const parte of req) {
    total += parte.length;
    if (total > maxBytes) throw new ErroUsuario("Foto grande demais.");
    partes.push(parte);
  }
  return JSON.parse(Buffer.concat(partes).toString("utf8"));
}

function json(res, status, dados) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(dados));
}

const TIPOS = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png",
};

async function servirArquivo(req, res) {
  const url = new URL(req.url, "http://x");
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  const arquivo = path.normalize(path.join(PUBLICO, rel));
  if (!arquivo.startsWith(PUBLICO)) return json(res, 403, { erro: "Proibido" });
  try {
    const dados = await fs.readFile(arquivo);
    res.writeHead(200, { "Content-Type": TIPOS[path.extname(arquivo)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(dados);
  } catch {
    json(res, 404, { erro: "Não encontrado" });
  }
}

const servidor = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/api/status") {
      return json(res, 200, { modo: MODO_MANUAL ? "manual" : "automatico", precisa_codigo: Boolean(CODIGO_ACESSO) });
    }
    if (req.method === "POST" && req.url === "/api/diagnosticar") {
      if (MODO_MANUAL) return json(res, 503, { erro: "Análise automática desligada. Use Enviar para análise." });
      const corpo = await lerCorpo(req, 24 * 1024 * 1024);
      if (CODIGO_ACESSO && corpo.codigo !== CODIGO_ACESSO) {
        return json(res, 401, { erro: "Código de acesso inválido." });
      }
      const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress;
      if (!dentroDoLimite(ip)) return json(res, 429, { erro: "Muitas análises em pouco tempo. Tente de novo mais tarde." });
      const imagens = Array.isArray(corpo.imagens) ? corpo.imagens.filter((i) => typeof i === "string" && i.length > 100).slice(0, 4) : [];
      if (!imagens.length) throw new ErroUsuario("Foto não recebida.");
      corpo.imagens = imagens;
      return json(res, 200, await diagnosticar(corpo));
    }
    if (req.method === "GET") return servirArquivo(req, res);
    json(res, 405, { erro: "Método não permitido" });
  } catch (erro) {
    if (erro instanceof ErroUsuario || erro instanceof SyntaxError) return json(res, 400, { erro: erro.message });
    if (erro instanceof Anthropic.RateLimitError) return json(res, 503, { erro: "Serviço ocupado. Tente em alguns minutos." });
    console.error(erro);
    json(res, 500, { erro: "Erro no servidor. Tente de novo." });
  }
});

servidor.listen(PORTA, () => {
  console.log(`Conilon Vivo rodando em http://localhost:${PORTA}`);
  if (MODO_MANUAL) console.log("Sem ANTHROPIC_API_KEY: modo manual (enviar foto pelo WhatsApp e importar laudo).");
});
