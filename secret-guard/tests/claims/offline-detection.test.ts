import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Claim « sans LLM · sans réseau · avant l’envoi » (docs/secret-guard/CLAIMS.md):
// the modules on the detection path — the core scanner, the loading of an
// xSOM rules pack and the hook decision — import no network, process or LLM
// module and call no network API. This walks their real import graph.

const WORKSPACE_PACKAGES: Record<string, string> = {
  "@xsom/secret-guard-core": "packages/core/src/index.ts",
  "@xsom/developer-guard-runner": "packages/runner/src/index.ts",
  "@xsom/developer-guard-policy": "packages/policy/src/index.ts",
  "@xsom/developer-guard-adapters": "packages/adapters/src/index.ts",
};

const IMPORT = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*"([^"]+)"/gu;
const SIDE_EFFECT_IMPORT = /(?:^|\n)\s*import\s*"([^"]+)"/gu;
const NETWORK_API =
  /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|\bimport\s*\(|\brequire\s*\(/u;
const LLM_PACKAGE =
  /openai|anthropic|mistral|litellm|ollama|cohere|langchain/iu;

interface Walk {
  readonly files: Set<string>;
  readonly specifiers: Map<string, string[]>;
}

function walk(entry: string, follow: (specifier: string) => boolean): Walk {
  const files = new Set<string>();
  const specifiers = new Map<string, string[]>();
  const pending = [resolve(entry)];
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    const source = readFileSync(file, "utf8");
    const found = [
      ...source.matchAll(IMPORT),
      ...source.matchAll(SIDE_EFFECT_IMPORT),
    ].map((match) => match[1]!);
    specifiers.set(file, found);
    for (const specifier of found) {
      if (specifier.startsWith("."))
        pending.push(join(dirname(file), specifier.replace(/\.js$/u, ".ts")));
      else if (WORKSPACE_PACKAGES[specifier] && follow(specifier))
        pending.push(resolve(WORKSPACE_PACKAGES[specifier]));
    }
  }
  return { files, specifiers };
}

function external(graph: Walk): string[] {
  return [
    ...new Set(
      [...graph.specifiers.values()]
        .flat()
        .filter(
          (specifier) =>
            !specifier.startsWith(".") && !WORKSPACE_PACKAGES[specifier],
        ),
    ),
  ].sort();
}

describe("offline, LLM-free detection path", () => {
  it("keeps the core scanner free of any runtime module", () => {
    const graph = walk("packages/core/src/index.ts", () => false);
    expect(graph.files.size).toBeGreaterThan(10);
    expect(external(graph)).toEqual([]);
    for (const file of graph.files)
      expect(readFileSync(file, "utf8"), file).not.toMatch(NETWORK_API);
    const manifest = JSON.parse(
      readFileSync("packages/core/package.json", "utf8"),
    ) as { dependencies?: object };
    expect(manifest.dependencies).toBeUndefined();
  });

  it("loads a rules pack with crypto and local files only", () => {
    const graph = walk(
      "packages/runner/src/rules-pack.ts",
      (specifier) => specifier === "@xsom/secret-guard-core",
    );
    expect(external(graph)).toEqual([
      "node:crypto",
      "node:fs/promises",
      "node:path",
    ]);
    for (const file of graph.files)
      expect(readFileSync(file, "utf8"), file).not.toMatch(NETWORK_API);
  });

  it("decides a hook event without network, process or LLM module", () => {
    const graph = walk(
      "packages/cli/src/hook.ts",
      (specifier) => specifier === "@xsom/secret-guard-core",
    );
    const modules = external(graph);
    expect(modules).toEqual(["node:fs", "node:path", "node:process"]);
    for (const module of modules) expect(module).not.toMatch(LLM_PACKAGE);
    for (const file of graph.files)
      expect(readFileSync(file, "utf8"), file).not.toMatch(NETWORK_API);
  });

  it("detects an import the gate forbids", () => {
    // The walker itself is exercised on a module that does use the network.
    const graph = walk(
      "packages/vscode/src/team/gateway-client.ts",
      () => false,
    );
    expect(
      [...graph.files].some((file) =>
        NETWORK_API.test(readFileSync(file, "utf8")),
      ),
    ).toBe(true);
  });
});
