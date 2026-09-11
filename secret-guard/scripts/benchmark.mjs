import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { scan } from "@xsom/secret-guard-core";

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
