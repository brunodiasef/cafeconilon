// Formato do resultado de uma análise. Usado pelo servidor (modo automático, com a IA)
// e pelo validador de laudos (modo manual, laudos feitos no Claude Code).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
export const base = JSON.parse(fs.readFileSync(path.join(RAIZ, "public", "dados", "pragas.json"), "utf8"));
export const IDS = [...base.problemas.map((p) => p.id), "saudavel", "nao_identificado"];

export const Diagnostico = z.object({
  foto_boa: z.boolean().describe("false se a foto estiver escura, borrada, longe demais ou não mostrar o problema"),
  problema_da_foto: z.string().describe("Se foto_boa=false, diga em uma frase simples como tirar uma foto melhor. Senão, string vazia."),
  e_cafe: z.boolean().describe("true se a planta da foto for café"),
  diagnostico_id: z.enum(IDS),
  confianca: z.enum(["alta", "media", "baixa"]),
  o_que_vi: z.string().describe("2 a 3 frases simples dizendo o que você enxergou na foto que levou ao diagnóstico"),
  gravidade: z.enum(["leve", "moderada", "grave", "nao_se_aplica"]),
  alternativas: z.array(z.enum(IDS)).describe("Outros problemas possíveis, do mais para o menos provável. Pode ser vazio."),
  perguntas: z.array(z.string()).describe("Até 3 perguntas simples que o produtor pode checar na lavoura para confirmar"),
  dica: z.string().describe("Uma dica curta e prática específica para esta foto, ou string vazia"),
});

// Arquivo que vai de volta para o produtor no modo manual (laudo-CODIGO.json).
export const Laudo = z.object({
  tipo: z.literal("conilon-vivo-laudo"),
  versao: z.literal(1),
  codigo: z.string().regex(/^[A-Z0-9]{6}$/),
  data_analise: z.string(),
  parte: z.string().optional(),
  talhao: z.string().optional(),
  data_foto: z.string().optional(),
  resultado: Diagnostico.extend({
    mensagem: z.string().optional().describe("Recado do técnico para o produtor (opcional)"),
  }),
});
