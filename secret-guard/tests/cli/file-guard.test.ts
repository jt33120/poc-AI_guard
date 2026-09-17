import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  MAX_MENTIONED_FILES,
  mentionedPaths,
  readLocalFile,
  type FileReader,
} from "../../packages/cli/src/file-guard.js";
import { runHook } from "../../packages/cli/src/hook.js";

const fakeToken = `ghp_${"aB3d".repeat(9)}`;
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function workspace(files: Record<string, string | Uint8Array>): string {
  const directory = mkdtempSync(join(tmpdir(), "secret-guard-files-"));
  directories.push(directory);
  for (const [name, content] of Object.entries(files))
    writeFileSync(join(directory, name), content);
  return directory;
}

function readEvent(filePath: string, cwd?: string): string {
  return JSON.stringify({
    hook_event_name: "PreToolUse",
    tool_name: "Read",
    tool_input: { file_path: filePath },
    ...(cwd === undefined ? {} : { cwd }),
  });
}

describe("local file reading", () => {
  it("returns text, absent or unreadable without throwing", () => {
    const directory = workspace({
      "notes.md": "# Notes",
      "image.png": Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0, 1),
    });
    expect(readLocalFile(join(directory, "notes.md"))).toEqual({
      status: "text",
      content: "# Notes",
    });
    expect(readLocalFile(join(directory, "missing.md"))).toEqual({
      status: "absent",
    });
    expect(readLocalFile(directory)).toEqual({ status: "absent" });
    expect(readLocalFile(join(directory, "image.png"))).toEqual({
      status: "unreadable",
    });
  });

  it("resolves @-mentions but ignores e-mail addresses", () => {
    const cwd = resolve("/work");
    expect(
      mentionedPaths(
        'voir @docs/a.md, @"b c.md" et @src/x.ts#L10-20 — jt@corp.fr',
        cwd,
      ),
    ).toEqual([
      resolve(cwd, "docs/a.md"),
      resolve(cwd, "b c.md"),
      resolve(cwd, "src/x.ts"),
    ]);
  });
});

describe("hook file guard", () => {
  it("lets a clean file through and blocks a secret without echoing it", () => {
    const directory = workspace({
      "clean.md": "Explain this.",
      ".env": `TOKEN=${fakeToken}`,
    });
    expect(runHook(readEvent(join(directory, "clean.md")))).toEqual({
      continue: true,
    });
    const blocked = runHook(readEvent(".env", directory));
    expect(blocked.continue).toBe(false);
    expect(blocked.stopReason).toContain("« .env »");
    expect(blocked.stopReason).toContain("ne lisez pas ce fichier");
    expect(JSON.stringify(blocked)).not.toContain(fakeToken);
  });

  it("fails closed on files it cannot fully scan, except in observe mode", () => {
    const unreadable: FileReader = () => ({ status: "unreadable" });
    const event = readEvent("/any/image.png");
    expect(runHook(event, "block", unreadable).continue).toBe(false);
    expect(runHook(event, "redact", unreadable).stopReason).toContain(
      "relais xSOM",
    );
    expect(runHook(event, "observe", unreadable)).toMatchObject({
      continue: true,
      systemMessage: expect.stringContaining("en entier") as string,
    });
    const failing: FileReader = () => {
      throw new Error("io");
    };
    expect(runHook(event, "block", failing).continue).toBe(false);
  });

  it("lets the host report a missing file itself", () => {
    const absent: FileReader = () => ({ status: "absent" });
    expect(runHook(readEvent("/nope.md"), "block", absent)).toEqual({
      continue: true,
    });
  });

  it("only accepts Read tool events with a path", () => {
    expect(
      runHook(
        JSON.stringify({
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_input: { command: "ls" },
        }),
      ).continue,
    ).toBe(false);
    expect(
      runHook(
        JSON.stringify({
          hook_event_name: "PreToolUse",
          tool_name: "Read",
          tool_input: {},
        }),
      ).continue,
    ).toBe(false);
  });

  it("checks files @-mentioned in a prompt", () => {
    const directory = workspace({ "keys.md": `key ${fakeToken}` });
    const prompt = (text: string): string =>
      JSON.stringify({
        hook_event_name: "UserPromptSubmit",
        prompt: text,
        cwd: directory,
      });
    expect(runHook(prompt("résume @keys.md")).continue).toBe(false);
    expect(runHook(prompt("résume @absent.md"))).toEqual({ continue: true });
    const observed = runHook(prompt("résume @keys.md"), "observe");
    expect(observed.continue).toBe(true);
    expect(observed.systemMessage).toContain("« keys.md »");
  });

  it("refuses to vouch for more mentions than it checks", () => {
    const absent: FileReader = () => ({ status: "absent" });
    const many = Array.from(
      { length: MAX_MENTIONED_FILES + 1 },
      (_, index) => `@f${String(index)}.md`,
    ).join(" ");
    const raw = JSON.stringify({ prompt: many, cwd: "/work" });
    expect(runHook(raw, "block", absent).continue).toBe(false);
    expect(runHook(raw, "observe", absent).continue).toBe(true);
  });
});
