import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { buildSync } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The open source build of Secret Guard Local starts from local-extension.ts
// and local-hook.ts. Neither may reach the Équipe edition, neither a file of
// src/team/ nor a Developer Guard package: the Local edition must build, run
// and stay open source without it. team-port.ts is the only seam.

const SOURCE = resolve("packages/vscode/src");
const TEAM = join(SOURCE, "team") + sep;
const IMPORT = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*"([^"]+)"/gu;
const EQUIPE_MARKERS = [
  "vscode/src/team/",
  "packages/runner/",
  "packages/adapters/",
  "packages/policy/",
];
// Assembled at run time so the dogfood scan of this file stays clean.
const GITHUB_TOKEN = ["ghp", "aB3d".repeat(9)].join("_");

function localGraph(entry: string): { files: string[]; packages: string[] } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const pending = [join(SOURCE, entry)];
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    for (const [, specifier] of readFileSync(file, "utf8").matchAll(IMPORT)) {
      if (specifier!.startsWith("."))
        pending.push(join(dirname(file), specifier!.replace(/\.js$/u, ".ts")));
      else packages.add(specifier!);
    }
  }
  return { files: [...files], packages: [...packages].sort() };
}

function bundle(entry: string): string {
  return buildSync({
    entryPoints: [join(SOURCE, entry)],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    external: ["vscode"],
    alias: {
      "@xsom/secret-guard-cli/hook": resolve("packages/cli/src/hook.ts"),
      "@xsom/secret-guard-core": resolve("packages/core/src/index.ts"),
    },
  }).outputFiles[0]!.text;
}

describe("the open source Local edition", () => {
  it.each(["local-extension.ts", "local-hook.ts"])(
    "%s reaches no Équipe code",
    (entry) => {
      const graph = localGraph(entry);
      expect(graph.files.length).toBeGreaterThan(3);
      expect(graph.files.filter((file) => file.startsWith(TEAM))).toEqual([]);
      expect(
        graph.packages.filter((name) => name.startsWith("@xsom/developer-")),
      ).toEqual([]);
    },
  );

  it("plugs the Équipe edition into the same Local code in the official build", () => {
    const extension = localGraph("extension.ts").files;
    expect(extension).toContain(join(SOURCE, "protection.ts"));
    expect(extension).toContain(join(TEAM, "index.ts"));
    const hook = localGraph("hook-entry.ts").files;
    expect(hook).toContain(join(SOURCE, "hook-check.ts"));
    expect(hook).toContain(join(TEAM, "hook.ts"));
  });

  it("bundles without any Équipe module", () => {
    for (const entry of ["local-extension.ts", "local-hook.ts"]) {
      const text = bundle(entry);
      for (const marker of EQUIPE_MARKERS)
        expect(text, `${entry} → ${marker}`).not.toContain(marker);
    }
  });
});

describe("the open source hook protects on its own", () => {
  let storage: string;
  beforeAll(async () => {
    storage = await mkdtemp(join(tmpdir(), "local-hook-"));
    await writeFile(join(storage, "hook.cjs"), bundle("local-hook.ts"));
  });
  afterAll(async () => {
    await rm(storage, { recursive: true, force: true });
  });

  function submit(prompt: string) {
    return spawnSync(
      process.execPath,
      [join(storage, "hook.cjs"), "--host=claude", "--mode=block"],
      {
        encoding: "utf8",
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt }),
        timeout: 20_000,
      },
    );
  }

  it("blocks a secret without showing it", () => {
    const result = submit(`deploy ${GITHUB_TOKEN}`);
    expect(result.status).toBe(2);
    expect(result.stdout + result.stderr).not.toContain(GITHUB_TOKEN);
  });

  it("lets a clean prompt through", () => {
    const result = submit("explique ce test unitaire");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ continue: true });
  });

  it("refuses an invalid envelope", () => {
    const result = spawnSync(
      process.execPath,
      [join(storage, "hook.cjs"), "--host=claude"],
      {
        encoding: "utf8",
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        input: "{not json",
        timeout: 20_000,
      },
    );
    expect(result.status).toBe(2);
  });
});
