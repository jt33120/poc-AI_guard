import { spawnSync } from "node:child_process";
import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import {
  acceptRulesPack,
  authorityKeyId,
  canonicalRulesPack,
  parseAuthorityKeys,
} from "@xsom/developer-guard-runner";
import { compileRulesPack, scan } from "@xsom/secret-guard-core";

import { largestRulesPack } from "./largest-rules-pack.mjs";

const check = process.argv.includes("--check");

const cases = [
  {
    name: "16 KiB prompt",
    bytes: 16 * 1024,
    iterations: 250,
    p95: 15,
    p99: 30,
  },
  {
    name: "256 KiB prompt",
    bytes: 256 * 1024,
    iterations: 100,
    p95: 75,
    p99: 125,
  },
  {
    name: "1 MiB prompt",
    bytes: 1024 * 1024,
    iterations: 30,
    p95: 250,
    p99: 400,
  },
];

function percentile(values, percent) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((percent / 100) * sorted.length) - 1,
  );
  return sorted[index];
}

let failed = false;
for (const benchmark of cases) {
  const line = "Explain the authorization flow without changing any files.\n";
  const content = line
    .repeat(Math.ceil(benchmark.bytes / Buffer.byteLength(line)))
    .slice(0, benchmark.bytes);
  for (let index = 0; index < 20; index += 1)
    scan({ content, sourceKind: "prompt" });

  const samples = [];
  for (let index = 0; index < benchmark.iterations; index += 1) {
    const started = performance.now();
    const result = scan({ content, sourceKind: "prompt" });
    samples.push(performance.now() - started);
    if (!result.complete || result.decision !== "ALLOW") {
      throw new Error(`benchmark corpus produced ${result.decision}`);
    }
  }

  const p50 = percentile(samples, 50);
  const p95 = percentile(samples, 95);
  const p99 = percentile(samples, 99);
  process.stdout.write(
    `${benchmark.name}: p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms p99=${p99.toFixed(2)}ms\n`,
  );
  if (check && (p95 > benchmark.p95 || p99 > benchmark.p99)) failed = true;
}

// xSOM custom tuning: the largest pack the contract allows (200 detectors,
// 20 000 digests, 4 salts, maxWords 4), then a valid but pathological pattern.
function timed(iterations, action) {
  const samples = [];
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    action();
    samples.push(performance.now() - started);
  }
  return samples;
}

function report(name, samples, p95Limit) {
  const p50 = percentile(samples, 50);
  const p95 = percentile(samples, 95);
  process.stdout.write(
    `${name}: p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms (gate p95 ≤ ${String(p95Limit)}ms)\n`,
  );
  if (check && p95 > p95Limit) failed = true;
}

const largest = largestRulesPack();
const compiled = compileRulesPack(largest);
if (!compiled.ok) throw new Error(`largest pack refused: ${compiled.error}`);
process.stdout.write(
  `Largest rules pack: ${String(largest.detectors.length)} detectors, ${String(largest.detectors.reduce((total, detector) => total + (detector.match.digests?.length ?? 0), 0))} digests, ${String(Buffer.byteLength(JSON.stringify(largest)))} bytes\n`,
);
report(
  "Largest pack full validation (self-tests)",
  timed(5, () => compileRulesPack(largest)),
  3_000,
);

// What each hook invocation does: signature, schema, tenant, version, compile.
// The key pair is ephemeral, in memory, for this measurement only.
const ephemeral = generateKeyPairSync("ed25519").privateKey;
const publicKey = Buffer.from(
  createPublicKey(ephemeral).export({ format: "jwk" }).x,
  "base64url",
).toString("base64");
const envelope = {
  payload: largest,
  keyId: authorityKeyId(publicKey),
  signature: sign(
    null,
    Buffer.from(canonicalRulesPack(largest), "utf8"),
    ephemeral,
  ).toString("base64"),
};
const serialized = JSON.stringify(envelope);
const first = acceptRulesPack(JSON.parse(serialized), {
  keys: parseAuthorityKeys(publicKey),
  enrolledTenant: largest.tenantId,
  highest: {},
  now: new Date("2026-10-01T00:00:00Z"),
});
if (!first.ok) throw new Error(`largest envelope refused: ${first.reason}`);
report(
  "Largest pack hook load (verify + compile)",
  timed(10, () => {
    const result = acceptRulesPack(JSON.parse(serialized), {
      keys: parseAuthorityKeys(publicKey),
      enrolledTenant: largest.tenantId,
      highest: {},
      now: new Date("2026-10-01T00:00:00Z"),
      selfTestedDigest: first.digest,
    });
    if (!result.ok) throw new Error("hook load refused the pack");
  }),
  500,
);

const promptLine =
  "Explain the authorization flow without changing any files.\n";
for (const [name, bytes, iterations, limit] of [
  ["16 KiB prompt + largest pack", 16 * 1024, 50, 100],
  ["256 KiB prompt + largest pack", 256 * 1024, 10, 1_500],
  ["1 MiB prompt + largest pack", 1024 * 1024, 5, 5_000],
]) {
  const content = promptLine
    .repeat(Math.ceil(bytes / promptLine.length))
    .slice(0, bytes);
  scan({ content, rules: compiled.pack });
  report(
    name,
    timed(iterations, () => {
      const result = scan({ content, rules: compiled.pack });
      if (!result.complete || result.decision !== "ALLOW")
        throw new Error(`${name} produced ${result.decision}`);
    }),
    limit,
  );
}

const pathological = compileRulesPack({
  ...largest,
  detectors: [
    {
      id: "slow",
      label: "Motif lent",
      category: "project",
      action: "warn",
      match: { type: "pattern", pattern: `aaa${"[a-z]{0,8}".repeat(20)}z` },
    },
  ],
  tests: { positives: [{ detector: "slow", text: "aaabcz" }], negatives: [] },
});
if (!pathological.ok) throw new Error("pathological pack refused");
// One letter repeated: the built-in scanner passes it (no Base64 shape, no
// entropy), so the time measured is the custom rules' own budget.
const adversarial = "a".repeat(1_048_000);
report(
  "1 MiB adversarial input, pathological valid pattern (BLOCK incomplete)",
  timed(3, () => {
    const result = scan({ content: adversarial, rules: pathological.pack });
    if (
      result.complete ||
      result.findings[0]?.ruleId !== "custom_rules_incomplete"
    )
      throw new Error("the work budget did not stop the pathological pattern");
  }),
  5_000,
);

const cli = fileURLToPath(
  new URL("../packages/cli/dist/index.js", import.meta.url),
);
const cliLine = "Review this local function.\n";
const cliInput = cliLine
  .repeat(Math.ceil((16 * 1024) / Buffer.byteLength(cliLine)))
  .slice(0, 16 * 1024);
const cliSamples = [];
for (let index = 0; index < 20; index += 1) {
  const started = performance.now();
  const execution = spawnSync(process.execPath, [cli, "scan", "--json"], {
    encoding: "utf8",
    input: cliInput,
    maxBuffer: 256 * 1024,
    timeout: 2_000,
  });
  cliSamples.push(performance.now() - started);
  if (execution.status !== 0) {
    throw new Error("CLI cold-start benchmark did not return ALLOW");
  }
}
const cliP95 = percentile(cliSamples, 95);
process.stdout.write(`16 KiB CLI cold start: p95=${cliP95.toFixed(2)}ms\n`);
if (check && cliP95 > 350) failed = true;

if (failed) {
  process.stderr.write("Secret Guard performance gate failed.\n");
  process.exitCode = 1;
}
