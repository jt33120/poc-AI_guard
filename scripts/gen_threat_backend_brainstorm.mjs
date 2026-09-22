import { readFile, writeFile } from "node:fs/promises";

const source = await readFile(new URL("../frontend/lib/threat-glossary.ts", import.meta.url), "utf8");
const output = new URL("../docs/menaces-backend-brainstorm.md", import.meta.url);
const entries = [...source.matchAll(/  \{\n    id: "([^"]+)",([\s\S]*?)\n  \},/g)];

function value(block, key) {
  const match = block.match(new RegExp(`${key}:\\s*"((?:\\\\.|[^\\"])*)"`));
  return match ? JSON.parse(`"${match[1]}"`) : "";
}

function tools(block) {
  const match = block.match(/tools:\s*\[([\s\S]*?)\],/);
  if (!match) return [];
  return [...match[1].matchAll(/"((?:\\.|[^\"])*)"|fr:\s*"((?:\\.|[^\"])*)"/g)]
    .map((tool) => tool[2] ?? tool[1])
    .filter((tool, index, list) => tool && list.indexOf(tool) === index);
}

const sections = entries.map(([, id, block]) => {
  const fr = block.match(/fr:\s*\{([\s\S]*?)\n      \},\n      en:/)?.[1] ?? "";
  return {
    id,
    category: value(block, "category"),
    title: value(fr, "title"),
    mitigation: value(fr, "mitigation"),
    tools: tools(block),
  };
});

const document = [
  "# Menaces IA - matière de brainstorming backend",
  "",
  "> Document interne généré depuis `frontend/lib/threat-glossary.ts`. Il recense les parades de référence et les outils libres retirés de la table publique. Ce sont des pistes de conception, pas des capacités déjà livrées par AI Guard.",
  "",
  "## Comment l'utiliser",
  "",
  "Pour chaque menace, confronter la parade proposée au périmètre produit : contrôle déterministe, journal d'audit, validation humaine, isolation de tenant, ou intégration d'un outil tiers. Ne pas présenter un outil listé ici comme intégré sans preuve d'implémentation.",
  "",
  ...sections.flatMap((entry) => [
    `## ${entry.title} \`${entry.id}\``,
    "",
    `- Catégorie : ${entry.category}`,
    `- Parade de référence : ${entry.mitigation || "À qualifier"}`,
    `- Outils libres à évaluer : ${entry.tools.join(", ") || "À qualifier"}`,
    "",
  ]),
].join("\n");

await writeFile(output, document);
console.log(`Generated ${sections.length} threat entries in ${output.pathname}`);
