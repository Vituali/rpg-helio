/**
 * tools/docgen.mjs — Gerador Automático de Inventário e Mapa de Código para Agentes e Desenvolvedores.
 *
 * Varre os pacotes do monorepo (client, server, shared), extrai imports, exports e descrições JSDoc
 * no topo dos arquivos e atualiza a documentação técnica consolidada em docs/CODE_MAP.md.
 *
 * Execução: node tools/docgen.mjs
 */

import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const TARGET_DIRS = [
  { name: "Shared", dir: path.join(ROOT, "shared", "src") },
  { name: "Server", dir: path.join(ROOT, "server", "src") },
  { name: "Client", dir: path.join(ROOT, "client", "src") },
];

async function getFiles(dir) {
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      files.push(...(await getFiles(full)));
    } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      files.push(full);
    }
  }
  return files;
}

function parseTopComment(content) {
  const match = content.match(/^\/\*\*([\s\S]*?)\*\//);
  if (!match) return "";
  return match[1]
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, "").trim())
    .filter(Boolean)
    .join(" ");
}

function extractExports(content) {
  const exports = [];
  const lines = content.split("\n");
  for (const line of lines) {
    const fnMatch = line.match(/^export (?:default )?(?:async )?function ([a-zA-Z0-9_]+)/);
    if (fnMatch) exports.push(`fn ${fnMatch[1]}()`);
    const constMatch = line.match(/^export const ([a-zA-Z0-9_]+)/);
    if (constMatch) exports.push(`const ${constMatch[1]}`);
    const typeMatch = line.match(/^export (?:type|interface) ([a-zA-Z0-9_]+)/);
    if (typeMatch) exports.push(`type ${typeMatch[1]}`);
  }
  return exports;
}

async function main() {
  console.log("[docgen] Escaneando módulos do HELIO...");
  let md = `# CODE_MAP.MD — MAPA AUTOMATIZADO DO CÓDIGO (HELIO)\n\n`;
  md += `> Gerado automaticamente por \`tools/docgen.mjs\` em: **${new Date().toISOString()}**.\n`;
  md += `> Não edite manualmente. Para atualizar este arquivo, execute: \`node tools/docgen.mjs\`.\n\n`;

  for (const group of TARGET_DIRS) {
    md += `## Pacote: ${group.name} (\`${path.relative(ROOT, group.dir).replace(/\\/g, "/")}\`)\n\n`;
    const files = await getFiles(group.dir);

    for (const file of files) {
      const relPath = path.relative(ROOT, file).replace(/\\/g, "/");
      const content = await readFile(file, "utf8");
      const comment = parseTopComment(content);
      const exps = extractExports(content);

      md += `### \`${relPath}\`\n`;
      if (comment) {
        md += `> ${comment}\n\n`;
      } else {
        md += `> Sem descrição de cabeçalho.\n\n`;
      }

      if (exps.length > 0) {
        md += `**Exports principais:**\n`;
        md += exps.slice(0, 10).map((e) => `- \`${e}\``).join("\n");
        if (exps.length > 10) {
          md += `\n- *...e mais ${exps.length - 10} declarações.*`;
        }
        md += `\n\n`;
      }
      md += `---\n\n`;
    }
  }

  const outPath = path.join(ROOT, "docs", "CODE_MAP.md");
  await writeFile(outPath, md, "utf8");
  console.log(`[docgen] Mapa de código gerado com sucesso em: docs/CODE_MAP.md`);
}

main().catch((err) => {
  console.error("[docgen] Erro:", err);
  process.exit(1);
});
