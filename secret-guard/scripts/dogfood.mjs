import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

import { scan } from "@xsom/secret-guard-core";

const root = process.cwd();
const candidates = [join(root, "README.md"), join(root, "package-lock.json")];

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
  if (!result.complete || result.decision === "BLOCK") {
    failures.push({
      path: relative(root, path),
      complete: result.complete,
      ruleLines: result.findings.map(
        (finding) => `${finding.ruleId}:${finding.span.start.line}`,
      ),
    });
  } else if (result.decision === "WARN") warnings += 1;
}

process.stdout.write(
  `Dogfood files: ${candidates.length}; WARN files: ${warnings}; BLOCK files: ${failures.length}\n`,
);
if (failures.length > 0) {
  process.stderr.write(`Dogfood failures: ${JSON.stringify(failures)}\n`);
  process.exitCode = 1;
}
