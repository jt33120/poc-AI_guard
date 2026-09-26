import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveApproval } from "../../packages/runner/src/index.js";
import {
  startApprovalBridge,
  type ApprovalBridge,
} from "../../packages/vscode/src/approval-bridge.js";

let bridge: ApprovalBridge | undefined;
afterEach(async () => {
  vi.unstubAllGlobals();
  await bridge?.close();
  bridge = undefined;
});

describe("local approval bridge", () => {
  it("keeps the gateway token in the extension and consumes an exact approval", async () => {
    const storage = await mkdtemp(join(tmpdir(), "developer-guard-approval-"));
    const seen: { url: string; token: string | null; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        seen.push({
          url,
          token: new Headers(init?.headers).get("X-Gateway-Token"),
          body: JSON.parse(String(init?.body)),
        });
        return Promise.resolve(
          new Response(
            JSON.stringify(
              url.endsWith("/consume")
                ? { approval_id: "approval-1", status: "consumed" }
                : { approval_id: "approval-1", status: "approved" },
            ),
            { status: url.endsWith("/consume") ? 200 : 201 },
          ),
        );
      }),
    );
    bridge = await startApprovalBridge(
      storage,
      "http://localhost:8080",
      "gateway-secret",
    );
    const result = await resolveApproval(
      storage,
      JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash" }),
      {
        assistant: "claude",
        event: "command",
        actionClass: "publish",
        tool: "Bash",
        capabilityVerified: true,
      },
      {
        effect: "require_approval",
        reason: "publish",
        policyId: "team",
        policyVersion: 2,
        matchedRuleIds: ["approve-publish"],
      },
    );
    expect(result).toBe("approved");
    expect(seen).toHaveLength(2);
    expect(seen.every((call) => call.token === "gateway-secret")).toBe(true);
    expect(JSON.stringify(seen)).not.toContain("PreToolUse");
  });
});
