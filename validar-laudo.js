// Confere se os laudos estão no formato que o app aceita.
// Uso: node validar-laudo.js laudos/laudo-ABC123.json [outros...]
import fs from "node:fs";
import { base, Laudo } from "./diagnostico.js";

const arquivos = process.argv.slice(2);
if (!arquivos.length) {
  console.error("Uso: node validar-laudo.js laudos/laudo-CODIGO.json");
  process.exit(1);
}
let falhou = false;
for (const arquivo of arquivos) {
  try {
    const laudo = Laudo.parse(JSON.parse(fs.readFileSync(arquivo, "utf8")));
    const nome = base.problemas.find((p) => p.id === laudo.resultado.diagnostico_id)?.nome || laudo.resultado.diagnostico_id;
    if (!arquivo.includes(laudo.codigo)) throw new Error(`o nome do arquivo não tem o código ${laudo.codigo}`);
    console.log(`OK  ${arquivo}: ${laudo.codigo} → ${nome} (certeza ${laudo.resultado.confianca})`);
  } catch (erro) {
    falhou = true;
    console.error(`ERRO ${arquivo}: ${erro.message}`);
  }
}
process.exit(falhou ? 1 : 0);
