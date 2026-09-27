import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  evaluatePosture,
  mcpToolAllowed,
  mcpToolFingerprint,
  readControlledResource,
} from "../../packages/runner/src/index.js";

let temporary = "";
afterEach(async () => {
  if (temporary) await rm(temporary, { recursive: true, force: true });
  temporary = "";
});

describe("runner controls", () => {
  it("reads a bounded regular file and rejects symlinks and binary data", async () => {
    temporary = await mkdtemp(join(tmpdir(), "developer-guard-resource-"));
    const text = join(temporary, "safe.txt");
    const binary = join(temporary, "binary.dat");
    const link = join(temporary, "link.txt");
    await writeFile(text, "safe");
    await writeFile(binary, Buffer.from([1, 0, 2]));
    await symlink(text, link);
    await expect(
      readControlledResource(text, [temporary]),
    ).resolves.toMatchObject({
      allowed: true,
      content: Buffer.from("safe"),
    });
    await expect(
      readControlledResource(binary, [temporary]),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "binary_content",
    });
    await expect(
      readControlledResource(link, [temporary]),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "symbolic_link",
    });
  });

  it("pins MCP tool identity to server, name and schema", () => {
    const tool = { server: "git", tool: "push", schema: { type: "object" } };
    const approved = [mcpToolFingerprint(tool)];
    expect(mcpToolAllowed(tool, approved)).toBe(true);
    expect(
      mcpToolAllowed({ ...tool, schema: { type: "string" } }, approved),
    ).toBe(false);
    expect(mcpToolAllowed({ ...tool, server: "other" }, approved)).toBe(false);
  });

  it("never reports stale, missing, or saturated evidence as healthy", () => {
    const now = new Date("2026-09-22T12:00:00Z");
    expect(
      evaluatePosture({
        policyPresent: true,
        policyExpiresAt: "2026-09-23T12:00:00Z",
        hookInstalled: true,
        lastHookInvocationAt: "2026-09-22T11:59:00Z",
        queuePending: 0,
        queueDropped: 0,
        now,
      }),
    ).toEqual({ state: "healthy", reasons: [] });
    expect(
      evaluatePosture({
        policyPresent: true,
        policyExpiresAt: "2026-09-22T11:00:00Z",
        hookInstalled: false,
        queuePending: 1000,
        queueDropped: 3,
        now,
      }),
    ).toMatchObject({ state: "failed" });
  });
});
