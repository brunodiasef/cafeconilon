// Testa as regras do Firestore no simulador (npm run teste:regras).
import { test } from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, doc, setDoc, getDoc, getDocs, updateDoc, writeBatch, collection, query, where } from "firebase/firestore";
import { initializeApp as adminApp } from "firebase-admin/app";
import { getFirestore as adminDb } from "firebase-admin/firestore";

const PROJETO = "demo-conilon";
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
const servidor = adminDb(adminApp({ projectId: PROJETO }));
const sufixo = Date.now().toString(36);

async function entrar(nome) {
  const app = initializeApp({ apiKey: "demo", projectId: PROJETO }, nome + sufixo);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  const { user } = await createUserWithEmailAndPassword(auth, `${nome}${sufixo}@produtor.conilonvivo.app`, "123456");
  return { app, db, uid: user.uid };
}
const nega = (p) => assert.rejects(p, /permission|PERMISSION_DENIED/i);
const codigo = (n) => ("ABCDEFGHJKMNPQRSTUVWXYZ"[n] + sufixo.toUpperCase().replace(/[^A-HJKMNP-Z2-9]/g, "Z")).padEnd(6, "Z").slice(0, 6);

function pedido(db, cod, uid, extra = {}) {
  const lote = writeBatch(db);
  lote.set(doc(db, "casos", cod), { codigo: cod, produtor_uid: uid, status: "aguardando", laudo: null, n_fotos: 1, acompanhamento: null, ...extra });
  lote.set(doc(db, "casos", cod, "fotos", "1"), { ordem: 1, dados: "data:image/jpeg;base64,AAAA" });
  return lote.commit();
}

const jose = await entrar("jose");
const maria = await entrar("maria");
const bruno = await entrar("bruno");
const estranho = await entrar("estranho"); // tem login mas não foi cadastrado pelo Bruno
await servidor.doc(`admins/${bruno.uid}`).set({ email: "bruno" });
await servidor.doc(`usuarios/${jose.uid}`).set({ nome: "José" });
await servidor.doc(`usuarios/${maria.uid}`).set({ nome: "Maria" });
const C1 = codigo(1), C2 = codigo(2), C3 = codigo(3);

test("produtor cria pedido com foto", () => pedido(jose.db, C1, jose.uid));
test("produtor não cria pedido em nome de outro", () => nega(pedido(jose.db, C2, maria.uid)));
test("produtor não cria pedido já com laudo", () => nega(pedido(jose.db, C2, jose.uid, { status: "pronto", laudo: { diagnostico_id: "ferrugem" } })));
test("quem não foi cadastrado não cria pedido", () => nega(pedido(estranho.db, C3, estranho.uid)));
test("outro produtor não lê o caso nem a foto", async () => {
  await nega(getDoc(doc(maria.db, "casos", C1)));
  await nega(getDoc(doc(maria.db, "casos", C1, "fotos", "1")));
});
test("outro produtor não lista todos os casos", () => nega(getDocs(collection(maria.db, "casos"))));
test("produtor lista os próprios casos", async () => {
  const lista = await getDocs(query(collection(jose.db, "casos"), where("produtor_uid", "==", jose.uid)));
  assert.equal(lista.size, 1);
});
test("produtor não escreve o laudo", () => nega(updateDoc(doc(jose.db, "casos", C1), { laudo: { diagnostico_id: "ferrugem" }, status: "pronto" })));
test("produtor atualiza o acompanhamento", () => updateDoc(doc(jose.db, "casos", C1), { acompanhamento: { resolveu: "sim" }, atualizado_em: "agora" }));
test("produtor não lê dados de outro produtor", () => nega(getDoc(doc(jose.db, "usuarios", maria.uid))));
test("produtor não se faz admin", () => nega(setDoc(doc(jose.db, "admins", jose.uid), { x: 1 })));
test("produtor só aceita o termo nos próprios dados", async () => {
  await updateDoc(doc(jose.db, "usuarios", jose.uid), { aceitou_termos_em: "agora" });
  await nega(updateDoc(doc(jose.db, "usuarios", jose.uid), { nome: "Outro" }));
});
test("admin lê tudo e escreve o laudo", async () => {
  assert.ok((await getDocs(collection(bruno.db, "casos"))).size >= 1);
  await getDoc(doc(bruno.db, "casos", C1, "fotos", "1"));
  await updateDoc(doc(bruno.db, "casos", C1), { laudo: { diagnostico_id: "ferrugem" }, status: "pronto" });
  await setDoc(doc(bruno.db, "usuarios", "novo" + sufixo), { nome: "Novo" });
});
test.after(() => Promise.all([jose, maria, bruno, estranho].map((u) => deleteApp(u.app))));
