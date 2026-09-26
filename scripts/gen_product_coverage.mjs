#!/usr/bin/env node
/** Generate the Developer Guard coverage ledger from typed source data.
 *
 * The TypeScript AST is used only to obtain the canonical glossary identifiers;
 * coverage assertions live in `coverage/developer-guard-controls.json`. This keeps
 * the 77 threat anchors in one place and makes a missing or duplicated override a
 * build failure instead of a silent marketing claim.
 */
import { createRequire } from "node:module";
import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const glossaryPath = join(root, "frontend", "lib", "threat-glossary.ts");
const controlsPath = join(root, "coverage", "developer-guard-controls.json");
const outputPath = join(root, "frontend", "lib", "generated", "product-coverage.json");
const frontendRequire = createRequire(join(root, "frontend", "package.json"));
const ts = frontendRequire("typescript");

function fail(message) { throw new Error(`product coverage: ${message}`); }
function literalText(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}
function unwrap(node) {
  while (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) node = node.expression;
  return node;
}
function property(object, name) {
  return object.properties.find((item) => ts.isPropertyAssignment(item) && item.name.getText() === name);
}
function glossaryIds(sourceText) {
  const source = ts.createSourceFile(glossaryPath, sourceText, ts.ScriptTarget.Latest, true);
  let declaration;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "THREAT_GLOSSARY") declaration = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!declaration?.initializer) fail("THREAT_GLOSSARY declaration is missing");
  const array = unwrap(declaration.initializer);
  if (!ts.isArrayLiteralExpression(array)) fail("THREAT_GLOSSARY is no longer an array literal");
  const ids = array.elements.map((entry) => {
    if (!ts.isObjectLiteralExpression(entry)) fail("every glossary entry must be an object literal");
    const id = property(entry, "id")?.initializer;
    const value = id && literalText(id);
    if (!value) fail("every glossary entry must have a literal id");
    return value;
  });
  if (new Set(ids).size !== ids.length) fail("glossary ids are duplicated");
  if (ids.length !== 77) fail(`expected 77 glossary entries, found ${ids.length}`);
  return ids;
}
function assertString(value, name) {
  if (typeof value !== "string" || value.trim() === "") fail(`${name} must be a non-empty string`);
}
async function validateEntry(entry, label, knownIds) {
  for (const field of ["product", "module", "status", "mode", "environment", "limit"]) assertString(entry[field], `${label}.${field}`);
  if (!Array.isArray(entry.hosts) || !Array.isArray(entry.preconditions) || !Array.isArray(entry.scenarios) || !Array.isArray(entry.sources)) fail(`${label} must carry arrays for hosts, preconditions, scenarios and sources`);
  if (!new Set(["B", "D", "O", "A", "X"]).has(entry.mode)) fail(`${label}.mode is invalid`);
  for (const host of entry.hosts) {
    if (!host || typeof host !== "object") fail(`${label}.hosts contains an invalid host`);
    assertString(host.assistant, `${label}.host.assistant`);
    assertString(host.environment, `${label}.host.environment`);
    if (!Array.isArray(host.events) || !host.events.every((event) => typeof event === "string")) fail(`${label}.host.events is invalid`);
  }
  for (const source of [...entry.scenarios, ...entry.sources]) {
    assertString(source, `${label}.source`);
    try { await stat(join(root, source)); } catch { fail(`${label} references missing proof ${source}`); }
  }
  if (entry.ids !== undefined) {
    if (!Array.isArray(entry.ids) || entry.ids.length === 0) fail(`${label}.ids is invalid`);
    for (const id of entry.ids) if (!knownIds.has(id)) fail(`${label} references unknown threat ${id}`);
  }
}

const [sourceText, controlsText] = await Promise.all([readFile(glossaryPath, "utf8"), readFile(controlsPath, "utf8")]);
const ids = glossaryIds(sourceText);
let controls;
try { controls = JSON.parse(controlsText); } catch { fail("controls source is invalid JSON"); }
if (!controls || controls.schemaVersion !== 1 || !controls.defaults || !Array.isArray(controls.overrides)) fail("controls source has an invalid schema version or shape");
const knownIds = new Set(ids);
await validateEntry(controls.defaults, "defaults", knownIds);
const overrides = new Map();
for (const override of controls.overrides) {
  const merged = { ...controls.defaults, ...override };
  await validateEntry(merged, "override", knownIds);
  for (const id of merged.ids) {
    if (overrides.has(id)) fail(`threat ${id} is overridden twice`);
    const { ids: ignored, ...entry } = merged;
    overrides.set(id, entry);
  }
}
const threats = ids.map((id) => ({ id, ...(overrides.get(id) ?? controls.defaults) }));
const rendered = `${JSON.stringify({ schemaVersion: 1, product: "Secret Guard", threats }, null, 2)}\n`;
if (process.argv.includes("--check")) {
  let current;
  try { current = await readFile(outputPath, "utf8"); } catch { fail(`generated file is absent: ${outputPath}`); }
  if (current !== rendered) fail(`generated file is stale: ${outputPath}; run node scripts/gen_product_coverage.mjs`);
  process.stdout.write(`Product coverage is current (${threats.length} entries)\n`);
} else {
  await writeFile(outputPath, rendered, "utf8");
  process.stdout.write(`Generated ${threats.length} Developer Guard coverage entries in ${outputPath}\n`);
}
