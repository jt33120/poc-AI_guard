import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2)
  args.set(process.argv[index], process.argv[index + 1]);
const commitSha = args.get("--commit");
if (!commitSha || !/^[a-f0-9]{40}$/u.test(commitSha))
  throw new Error("--commit must be a full lowercase Git SHA");

const workspace = dirname(dirname(fileURLToPath(import.meta.url)));
const distribution = join(workspace, "packages", "vscode", "dist");
const paths = {
  vsix: join(distribution, "xsom-secret-guard-vscode.vsix"),
  sbom: join(distribution, "xsom-secret-guard-vscode.sbom.cdx.json"),
  lock: join(workspace, "package-lock.json"),
  manifest: join(workspace, "packages", "vscode", "package.json"),
};
const digest = async (path) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
const manifest = JSON.parse(await readFile(paths.manifest, "utf8"));
const provenance = {
  schemaVersion: 1,
  subject: "xsom.xsom-secret-guard-vscode",
  version: manifest.version,
  commitSha,
  builder:
    "github.com/jt33120/poc-AI_guard/.github/workflows/secret-guard-release.yml",
  artifacts: {
    "xsom-secret-guard-vscode.vsix": await digest(paths.vsix),
    "xsom-secret-guard-vscode.sbom.cdx.json": await digest(paths.sbom),
    "package-lock.json": await digest(paths.lock),
  },
};
await writeFile(
  join(distribution, "release-provenance.json"),
  `${JSON.stringify(provenance, null, 2)}\n`,
  { mode: 0o644 },
);
await writeFile(
  join(distribution, "SHA256SUMS"),
  `${Object.entries(provenance.artifacts)
    .map(([name, sha]) => `${sha}  ${name}`)
    .join("\n")}\n`,
  { mode: 0o644 },
);
