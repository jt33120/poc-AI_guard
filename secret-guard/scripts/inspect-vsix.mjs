import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const workspace = dirname(dirname(fileURLToPath(import.meta.url)));
const vsix = join(
  workspace,
  "packages",
  "vscode",
  "dist",
  "xsom-secret-guard-vscode.vsix",
);
const expectedFiles = [
  "[Content_Types].xml",
  "extension.vsixmanifest",
  "extension/LICENSE.txt",
  "extension/dist/extension.cjs",
  "extension/dist/hook.cjs",
  "extension/icon.png",
  "extension/package.json",
  "extension/readme.md",
].sort();
const localEquivalents = new Map([
  ["extension/LICENSE.txt", "packages/vscode/LICENSE.txt"],
  ["extension/dist/extension.cjs", "packages/vscode/dist/extension.cjs"],
  ["extension/dist/hook.cjs", "packages/vscode/dist/hook.cjs"],
  ["extension/icon.png", "packages/vscode/icon.png"],
  ["extension/package.json", "packages/vscode/package.json"],
  ["extension/readme.md", "packages/vscode/README.md"],
]);
const sensitivePatterns = [
  ["GitHub fine-grained token", /\bgithub_pat_[A-Za-z0-9_]{60,}\b/u],
  ["GitHub legacy token", /\bgh[pousr]_[A-Za-z0-9]{36,}\b/u],
  ["GitLab token", /\bglpat-[A-Za-z0-9_-]{20,}\b/u],
  ["AWS access key", /\bAKIA(?!IOSFODNN7EXAMPLE\b)[A-Z0-9]{16}\b/u],
  [
    "private key block",
    /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----[\s\S]{64,}-----END (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/u,
  ],
  [
    "credential assignment",
    /(?:AWS_SECRET_ACCESS_KEY|GITHUB_TOKEN|NPM_TOKEN|OPENAI_API_KEY|VSCE_PAT)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{16,}/u,
  ],
  [
    "absolute build path",
    /(?:\/Users\/[^/\s]+\/|\/home\/runner\/work\/|[A-Za-z]:\\Users\\)/u,
  ],
];

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function archivePattern(path) {
  return path
    .replaceAll("[", "[[]")
    .replaceAll("?", "[?]")
    .replaceAll("*", "[*]");
}

function tarArchivePattern(path) {
  return path
    .replaceAll("\\", "\\\\")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]")
    .replaceAll("?", "\\?")
    .replaceAll("*", "\\*");
}

function runArchiveTool(executable, arguments_) {
  const result = spawnSync(executable, arguments_, {
    encoding: null,
    maxBuffer: 4_000_000,
    timeout: 5_000,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    const diagnostic = result.stderr?.toString("utf8").trim() ?? "";
    throw new Error(
      `cannot inspect VSIX with ${executable}: ${diagnostic || `exit ${String(result.status)}`}`,
    );
  }
  return result.stdout;
}

function unzip(arguments_) {
  const unzipArguments =
    arguments_[0] === "-p" && arguments_[2] !== undefined
      ? [arguments_[0], arguments_[1], archivePattern(arguments_[2])]
      : arguments_;
  const result = spawnSync("unzip", unzipArguments, {
    encoding: null,
    maxBuffer: 4_000_000,
    timeout: 5_000,
  });
  if (result.error?.code !== "ENOENT") {
    if (result.error !== undefined) throw result.error;
    if (result.status !== 0) {
      const diagnostic = result.stderr?.toString("utf8").trim() ?? "";
      throw new Error(`cannot inspect VSIX with unzip: ${diagnostic}`);
    }
    return result.stdout;
  }
  if (process.platform !== "win32") throw result.error;

  const tarArguments =
    arguments_[0] === "-Z1"
      ? ["-tf", arguments_[1]]
      : ["-xOf", arguments_[1], tarArchivePattern(arguments_[2])];
  return runArchiveTool("tar.exe", tarArguments);
}

const archive = await stat(vsix);
if (archive.size <= 0 || archive.size > 2_000_000) {
  throw new Error(`VSIX has an invalid size: ${archive.size} bytes`);
}

const files = unzip(["-Z1", vsix])
  .toString("utf8")
  .split(/\r?\n/u)
  .filter(Boolean);
if (new Set(files).size !== files.length) {
  throw new Error("VSIX contains duplicate archive entries");
}
const actualFiles = [...files].sort();
const missing = expectedFiles.filter((path) => !actualFiles.includes(path));
const unexpected = actualFiles.filter((path) => !expectedFiles.includes(path));
if (missing.length > 0 || unexpected.length > 0) {
  throw new Error(
    `VSIX content is not allowlisted (missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"})`,
  );
}

const archivedContents = new Map(
  expectedFiles.map((path) => [path, unzip(["-p", vsix, path])]),
);
for (const [archivePath, relativeLocalPath] of localEquivalents) {
  const archived = archivedContents.get(archivePath);
  if (archived === undefined) {
    throw new Error(`VSIX is missing checksummed file ${archivePath}`);
  }
  const local = await readFile(join(workspace, relativeLocalPath));
  if (sha256(archived) !== sha256(local)) {
    throw new Error(`VSIX checksum mismatch for ${archivePath}`);
  }
}

for (const [path, content] of archivedContents) {
  const text = content.toString("utf8");
  for (const [label, pattern] of sensitivePatterns) {
    if (pattern.test(text)) {
      throw new Error(`VSIX contains ${label} material in ${path}`);
    }
  }
}

const packagedManifest = JSON.parse(
  archivedContents.get("extension/package.json").toString("utf8"),
);
if (
  packagedManifest.main !== "./dist/extension.cjs" ||
  packagedManifest.preview !== true ||
  packagedManifest.license !== "SEE LICENSE IN LICENSE.txt" ||
  packagedManifest.icon !== "icon.png" ||
  packagedManifest.publisher !== "xsom" ||
  packagedManifest.private !== undefined
) {
  throw new Error("VSIX package manifest violates the release contract");
}

const archiveDigest = sha256(await readFile(vsix));
process.stdout.write(
  `VSIX inspection: OK (${archive.size} bytes, ${files.length} exact files, sha256=${archiveDigest})\n`,
);
