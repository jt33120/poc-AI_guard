import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

import { scan } from "@xsom/secret-guard-core";

const root = process.cwd();
const candidates = [join(root, "README.md"), join(root, "package-lock.json")];

// This file maps SecretType identifiers to their French UI labels. Those exact
// declarations necessarily contain both the classifier term and its display
// wording, so contextual rules see them as self-references. Keep the exception
// tied to the file, rule and declaration prefix: any value elsewhere, or any
// new rule, still fails dogfood.
const presentationLabels = new Map([
  ["contextual_private_key", ["private_key:"]],
  ["contextual_access_token", ["provider_token:", "access_token:"]],
  ["contextual_password", ["password:"]],
  ["contextual_api_key", ["api_key:"]],
  ["contextual_generic_secret", ["generic_secret:"]],
]);

function isKnownSelfReference(path, content, finding) {
  const file = relative(root, path).replaceAll("\\", "/");
  const line = (
    content.split(/\r?\n/u)[finding.span.start.line - 1] ?? ""
  ).trim();
  if (
    file === "packages/vscode/README.md" &&
    finding.ruleId === "contextual_password" &&
    line === "Analyse cette configuration : PASSWORD=XXX"
  )
    return true;
  if (file !== "packages/vscode/src/presentation.ts") return false;
  return (presentationLabels.get(finding.ruleId) ?? []).some((prefix) =>
    line.startsWith(prefix),
  );
}

async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (
        !["dist", "node_modules", "coverage", ".vscode-test"].includes(
          entry.name,
        )
      )
        await collect(path);
      continue;
    }
    if (
      extname(entry.name) === ".ts" ||
      (extname(entry.name) === ".md" &&
        !path.includes(`${join(root, "tests")}/`))
    )
      candidates.push(path);
  }
}

await collect(join(root, "packages"));
await collect(join(root, "..", "docs", "secret-guard"));

const failures = [];
let warnings = 0;
for (const path of [...new Set(candidates)].sort()) {
  const content = await readFile(path, "utf8");
  const result = scan({
    content,
    sourceKind: "document",
    languageId: extname(path).slice(1),
  });
  const actionable = result.findings.filter(
    (finding) => !isKnownSelfReference(path, content, finding),
  );
  const blocking = actionable.some(
    (finding) => finding.level === "HIGH" || finding.level === "CRITICAL",
  );
  if (!result.complete || blocking) {
    failures.push({
      path: relative(root, path),
      complete: result.complete,
      ruleLines: actionable.map(
        (finding) => `${finding.ruleId}:${finding.span.start.line}`,
      ),
    });
  } else if (actionable.some((finding) => finding.level === "MEDIUM"))
    warnings += 1;
}

process.stdout.write(
  `Dogfood files: ${candidates.length}; WARN files: ${warnings}; BLOCK files: ${failures.length}\n`,
);
if (failures.length > 0) {
  process.stderr.write(`Dogfood failures: ${JSON.stringify(failures)}\n`);
  process.exitCode = 1;
}
