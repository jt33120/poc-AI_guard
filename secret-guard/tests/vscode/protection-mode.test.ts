import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  verifyFileReadCanary,
  verifyHookCanary,
} from "../../packages/vscode/src/hook-manager.js";
import { protectionMode } from "../../packages/vscode/src/protection-mode.js";

let fixtureDirectory: string;
let hookPath: string;
beforeAll(async () => {
  fixtureDirectory = await mkdtemp(join(tmpdir(), "secret-guard-modes-"));
  hookPath = join(fixtureDirectory, "hook.cjs");
  await build({
    entryPoints: [resolve("packages/vscode/src/hook-entry.ts")],
    outfile: hookPath,
    bundle: true,
    platform: "node",
    format: "cjs",
  });
});
afterAll(async () => {
  if (fixtureDirectory)
    await rm(fixtureDirectory, { recursive: true, force: true });
});

describe("protection modes in the actual hook process", () => {
  it.each(["block", "redact", "observe", "allow"] as const)(
    `user-prompt-submit: clean and sensitive canaries follow %s`,
    async (mode) => {
      await expect(
        verifyHookCanary(process.execPath, hookPath, mode),
      ).resolves.toBe(true);
    },
  );
  it.each(["block", "redact", "observe", "allow"] as const)(
    `pre-tool-use Read: clean and sensitive files follow %s`,
    async (mode) => {
      await expect(
        verifyFileReadCanary(process.execPath, hookPath, mode),
      ).resolves.toBe(true);
    },
  );
  it("defaults absent and invalid settings to block", () => {
    expect(protectionMode(undefined)).toBe("block");
    expect(protectionMode("typo")).toBe("block");
    expect(protectionMode("observe")).toBe("observe");
  });
});
