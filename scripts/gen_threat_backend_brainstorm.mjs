#!/usr/bin/env node
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const sourceUrl = new URL(
  "../frontend/lib/threat-glossary.ts",
  import.meta.url,
);
const outputUrl = new URL(
  "../docs/menaces-backend-brainstorm.md",
  import.meta.url,
);
const requireFromFrontend = createRequire(
  new URL("../frontend/package.json", import.meta.url),
);
const ts = requireFromFrontend("typescript");

function fail(message) {
  throw new Error(`threat brainstorm: ${message}`);
}

function unwrap(node) {
  while (
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isParenthesizedExpression(node)
  )
    node = node.expression;
  return node;
}

function property(object, name) {
  return object.properties.find(
    (item) =>
      ts.isPropertyAssignment(item) &&
      (ts.isIdentifier(item.name) || ts.isStringLiteral(item.name)) &&
      item.name.text === name,
  )?.initializer;
}

function objectProperty(object, name) {
  const value = property(object, name);
  if (!value || !ts.isObjectLiteralExpression(unwrap(value)))
    fail(`${name} must be an object literal`);
  return unwrap(value);
}

function stringProperty(object, name) {
  const value = property(object, name);
  if (!value || !ts.isStringLiteralLike(unwrap(value)))
    fail(`${name} must be a string literal`);
  return unwrap(value).text;
}

function frenchTools(object, source, localized) {
  const value = property(object, "tools");
  if (!value || !ts.isArrayLiteralExpression(unwrap(value)))
    fail("tools must be an array");
  const labels = unwrap(value).elements.map((entry) => {
    const item = unwrap(entry);
    if (ts.isStringLiteralLike(item)) return item.text;
    if (ts.isObjectLiteralExpression(item)) return stringProperty(item, "fr");
    if (ts.isIdentifier(item) && localized.has(item.text))
      return localized.get(item.text);
    fail(
      `tool entries must be strings or localized object literals: ${item.getText(source)}`,
    );
  });
  return [...new Set(labels)];
}

function glossaryEntries(sourceText) {
  const source = ts.createSourceFile(
    fileURLToPath(sourceUrl),
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );
  let declaration;
  const localized = new Map();
  const visit = (node) => {
    if (ts.isVariableDeclaration(node)) {
      if (node.name.getText(source) === "THREAT_GLOSSARY") declaration = node;
      const initial = node.initializer && unwrap(node.initializer);
      if (
        ts.isIdentifier(node.name) &&
        initial &&
        ts.isObjectLiteralExpression(initial)
      ) {
        const french = property(initial, "fr");
        if (french && ts.isStringLiteralLike(unwrap(french)))
          localized.set(node.name.text, unwrap(french).text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!declaration?.initializer) fail("THREAT_GLOSSARY is missing");
  const array = unwrap(declaration.initializer);
  if (!ts.isArrayLiteralExpression(array))
    fail("THREAT_GLOSSARY must be an array literal");
  return array.elements.map((element) => {
    if (!ts.isObjectLiteralExpression(element))
      fail("glossary entries must be object literals");
    const french = objectProperty(objectProperty(element, "copy"), "fr");
    return {
      id: stringProperty(element, "id"),
      category: stringProperty(element, "category"),
      title: stringProperty(french, "title"),
      mitigation: stringProperty(french, "mitigation"),
      tools: frenchTools(element, source, localized),
    };
  });
}

const entries = glossaryEntries(await readFile(sourceUrl, "utf8"));
if (entries.length !== 77) fail(`expected 77 entries, found ${entries.length}`);
if (new Set(entries.map((entry) => entry.id)).size !== entries.length)
  fail("duplicate threat identifiers");
if (
  entries.some(
    (entry) => !entry.title || !entry.mitigation || entry.tools.length === 0,
  )
)
  fail("required threat fields are empty");

const rendered = `${[
  "# Menaces IA - matière de brainstorming backend",
  "",
  "> Document interne généré depuis `frontend/lib/threat-glossary.ts`. Il recense les parades de référence et les outils libres retirés de la table publique. Ce sont des pistes de conception, pas des capacités déjà livrées par AI Guard.",
  "",
  "## Comment l'utiliser",
  "",
  "Pour chaque menace, confronter la parade proposée au périmètre produit : contrôle déterministe, journal d'audit, validation humaine, isolation de tenant, ou intégration d'un outil tiers. Ne pas présenter un outil listé ici comme intégré sans preuve d'implémentation.",
  "",
  ...entries.flatMap((entry) => [
    `## ${entry.title} \`${entry.id}\``,
    "",
    `- Catégorie : ${entry.category}`,
    `- Parade de référence : ${entry.mitigation}`,
    `- Outils libres à évaluer : ${entry.tools.join(", ")}`,
    "",
  ]),
].join("\n")}`;

if (process.argv.includes("--check")) {
  const current = await readFile(outputUrl, "utf8");
  if (current !== rendered) fail("generated document is stale");
  process.stdout.write(
    `Threat brainstorm is current (${entries.length} entries)\n`,
  );
} else {
  await writeFile(outputUrl, rendered, "utf8");
  process.stdout.write(
    `Generated ${entries.length} validated threat entries in ${fileURLToPath(outputUrl)}\n`,
  );
}
