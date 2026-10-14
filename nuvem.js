// Ferramenta do Claude/Bruno para o banco do app (Firebase), com acesso de administrador.
//
// Uso:
//   node nuvem.js testar                 confere se a chave de acesso funciona
//   node nuvem.js pendentes              lista os pedidos sem laudo e baixa as fotos em fotos-recebidas/
//   node nuvem.js laudo laudos/laudo-X.json   grava o laudo no pedido: o produtor vê na hora
//   node nuvem.js casos                  lista todos os casos e em que pé estão
//   node nuvem.js admin email@exemplo    torna essa conta (já criada no Firebase) responsável pelo app
//   node nuvem.js senha 27999990000 [123456]  troca a senha de um produtor (sem a senha nova, sorteia)
// Acrescente --simulador para usar o simulador local (npm run simulador).
//
// Acesso: variável FIREBASE_SERVICE_ACCOUNT com o conteúdo da chave JSON da conta de serviço
// (console do Firebase → Configurações do projeto → Contas de serviço → Gerar nova chave privada).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { base, Laudo } from "./diagnostico.js";

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const DOMINIO_PRODUTOR = "produtor.conilonvivo.app"; // igual ao do app (public/app.js)
const args = process.argv.slice(2).filter((a) => a !== "--simulador");

function conectar() {
  if (process.argv.includes("--simulador")) {
    process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
    process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
    return initializeApp({ projectId: "demo-conilon" });
  }
  const conta = lerChave(process.env.FIREBASE_SERVICE_ACCOUNT);
  return initializeApp({ credential: cert(conta), projectId: conta.project_id });
}

// Lê a chave da variável de ambiente, tolerando o que costuma acontecer ao copiar pelo celular
// (aspas sobrando, quebras de linha dentro da chave privada). Nunca mostra a chave nas mensagens.
function lerChave(texto) {
  if (!texto?.trim()) throw new Error("falta a variável FIREBASE_SERVICE_ACCOUNT com a chave da conta de serviço do Firebase");
  let t = texto.trim().replace(/^['"‘’“”]+|['"‘’“”]+$/g, "").trim();
  let conta;
  try {
    conta = JSON.parse(t);
  } catch {
    // Quebras de linha de verdade dentro de "private_key" deixam o JSON inválido: volta para \n.
    t = t.replace(/("private_key"\s*:\s*")([\s\S]*?)(")/, (_, a, chave, b) => a + chave.replace(/\r?\n/g, "\\n") + b);
    try { conta = JSON.parse(t); } catch {
      throw new Error(`a chave em FIREBASE_SERVICE_ACCOUNT está incompleta ou com pedaço faltando (${t.length} caracteres; começa com "${t[0] || ""}" e termina com "${t.at(-1) || ""}"; o certo é começar com { e terminar com })`);
    }
  }
  const faltando = ["type", "project_id", "private_key", "client_email"].filter((c) => !conta[c]);
  if (faltando.length) throw new Error(`a chave em FIREBASE_SERVICE_ACCOUNT não tem: ${faltando.join(", ")}`);
  if (!/BEGIN PRIVATE KEY[\s\S]+END PRIVATE KEY/.test(conta.private_key)) throw new Error("a chave privada está cortada (falta o BEGIN ou o END PRIVATE KEY)");
  return conta;
}
let app, db; // conectados em main(), para que um erro na chave vire uma mensagem clara

const nome = (id) => base.problemas.find((p) => p.id === id)?.nome || { saudavel: "Planta sadia", nao_identificado: "Não identificado" }[id] || id;
const lugar = (p) => [p?.comunidade, p?.municipio].filter(Boolean).join(", ");
const telefone = (t) => {
  let d = String(t || "").replace(/\D/g, "");
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) throw new Error("telefone inválido (use DDD + número)");
  return d;
};

async function pendentes() {
  const lista = await db.collection("casos").where("status", "==", "aguardando").get();
  if (lista.empty) return console.log("Nenhum pedido esperando laudo.");
  const pasta = path.join(RAIZ, "fotos-recebidas");
  fs.mkdirSync(pasta, { recursive: true });
  for (const doc of lista.docs.sort((a, b) => (a.data().data_foto || "").localeCompare(b.data().data_foto || ""))) {
    const c = doc.data();
    const fotos = (await doc.ref.collection("fotos").get()).docs.map((f) => f.data()).sort((a, b) => a.ordem - b.ordem);
    const arquivos = fotos.map((f, i) => {
      const nomeArquivo = fotos.length > 1 ? `${doc.id}-${i + 1}.jpg` : `${doc.id}.jpg`;
      fs.writeFileSync(path.join(pasta, nomeArquivo), Buffer.from(f.dados.split(",")[1], "base64"));
      return `fotos-recebidas/${nomeArquivo}`;
    });
    console.log([
      `\n${doc.id}  ${c.data_foto}`,
      `  Produtor: ${c.produtor?.nome || "?"}${lugar(c.produtor) ? ` — ${lugar(c.produtor)}` : ""}`,
      `  Parte: ${c.parte || "?"}${c.talhao ? ` · Talhão: ${c.talhao}` : ""}`,
      c.obs && `  Observação: ${c.obs}`,
      `  Fotos: ${arquivos.join(", ") || "(nenhuma chegou ainda)"}`,
    ].filter(Boolean).join("\n"));
  }
}

async function gravarLaudo(arquivo) {
  if (!arquivo) throw new Error("diga o arquivo: node nuvem.js laudo laudos/laudo-CODIGO.json");
  const laudo = Laudo.parse(JSON.parse(fs.readFileSync(arquivo, "utf8")));
  const ref = db.collection("casos").doc(laudo.codigo);
  const caso = await ref.get();
  if (!caso.exists) throw new Error(`o pedido ${laudo.codigo} não existe no app`);
  const trocou = caso.data().status === "pronto";
  await ref.update({ laudo: { ...laudo.resultado, data_analise: laudo.data_analise }, status: "pronto", atualizado_em: new Date().toISOString() });
  console.log(`OK  ${laudo.codigo} → ${nome(laudo.resultado.diagnostico_id)} (certeza ${laudo.resultado.confianca})${trocou ? " · laudo trocado" : ""}. ${caso.data().produtor?.nome || "O produtor"} já vê no app.`);
}

async function listarCasos() {
  const lista = await db.collection("casos").get();
  for (const doc of lista.docs.sort((a, b) => (b.data().data_foto || "").localeCompare(a.data().data_foto || ""))) {
    const c = doc.data();
    const a = c.acompanhamento || {};
    const situacao = c.status !== "pronto" ? "aguardando laudo" : [nome(c.laudo.diagnostico_id), a.reconheceu && `achou: ${a.reconheceu}`, a.resolveu && `resolveu: ${a.resolveu}`].filter(Boolean).join(" · ");
    console.log(`${doc.id}  ${(c.data_foto || "").slice(0, 10)}  ${(c.produtor?.nome || "?").padEnd(22)} ${situacao}`);
  }
  if (lista.empty) console.log("Nenhum caso ainda.");
}

async function tornarAdmin(email) {
  if (!email) throw new Error("diga o e-mail: node nuvem.js admin email@exemplo.com");
  const u = await getAuth(app).getUserByEmail(email);
  await db.collection("admins").doc(u.uid).set({ email, desde: new Date().toISOString() });
  console.log(`OK  ${email} agora é responsável pelo app.`);
}

async function trocarSenha(tel, nova) {
  const d = telefone(tel);
  const senha = nova || String(Math.floor(Math.random() * 1e6)).padStart(6, "0");
  if (!/^\d{6}$/.test(senha)) throw new Error("a senha precisa ter 6 números");
  const u = await getAuth(app).getUserByEmail(`${d}@${DOMINIO_PRODUTOR}`);
  await getAuth(app).updateUser(u.uid, { password: senha });
  console.log(`OK  senha nova de ${d}: ${senha}`);
}

// Confere se a chave funciona, sem mostrar nada dela.
async function testar() {
  await db.listCollections();
  console.log(`OK  chave funcionando. Projeto: ${app.options.projectId}`);
}

const [comando, ...resto] = args;
const comandos = { testar, pendentes, laudo: gravarLaudo, casos: listarCasos, admin: tornarAdmin, senha: trocarSenha };
try {
  app = conectar();
  db = getFirestore(app);
  if (!comandos[comando]) throw new Error("uso: node nuvem.js testar | pendentes | laudo <arquivo> | casos | admin <email> | senha <telefone> [nova]");
  await comandos[comando](...resto);
  process.exit(0);
} catch (erro) {
  console.error("ERRO " + (erro.issues ? erro.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : erro.message));
  process.exit(1);
}
