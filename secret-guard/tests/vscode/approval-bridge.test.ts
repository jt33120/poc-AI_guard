import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveApproval } from "../../packages/runner/src/index.js";
import {
  approvalSocketLocation,
  fitsUnixSocket,
  startApprovalBridge,
  unixSocketPathLimit,
  type ApprovalBridge,
} from "../../packages/vscode/src/approval-bridge.js";

const posixOnly = process.platform === "win32" ? it.skip : it;

// A VS Code global storage folder on macOS is already close to the 104-byte
// sun_path limit; this one is well beyond it.
async function longStorage(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "developer-guard-approval-"));
  const storage = join(
    base,
    "Library",
    "Application Support",
    "Code",
    "User",
    "globalStorage",
    "xsom.xsom-secret-guard-vscode",
  );
  await mkdir(storage, { recursive: true });
  return storage;
}

function stubGateway(
  seen: { url: string; token: string | null; body: unknown }[],
): void {
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
}

const PUBLISH_REQUEST = {
  assistant: "claude",
  event: "command",
  actionClass: "publish",
  tool: "Bash",
  capabilityVerified: true,
} as const;

const APPROVAL_DECISION = {
  effect: "require_approval",
  reason: "publish",
  policyId: "team",
  policyVersion: 2,
  matchedRuleIds: ["approve-publish"],
} as const;

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
    stubGateway(seen);
    bridge = await startApprovalBridge(
      storage,
      "http://localhost:8080",
      "gateway-secret",
    );
    const result = await resolveApproval(
      storage,
      JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash" }),
      PUBLISH_REQUEST,
      APPROVAL_DECISION,
    );
    expect(result).toBe("approved");
    expect(seen).toHaveLength(2);
    expect(seen.every((call) => call.token === "gateway-secret")).toBe(true);
    expect(JSON.stringify(seen)).not.toContain("PreToolUse");
  });

  posixOnly(
    "serves approvals from a storage path longer than sun_path",
    async () => {
      const storage = await longStorage();
      expect(
        fitsUnixSocket(join(storage, "developer-guard-approval.sock")),
      ).toBe(false);
      const seen: { url: string; token: string | null; body: unknown }[] = [];
      stubGateway(seen);
      bridge = await startApprovalBridge(
        storage,
        "http://localhost:8080",
        "gateway-secret",
      );
      const config = JSON.parse(
        await readFile(join(storage, "developer-guard-approval.json"), "utf8"),
      ) as { socket: string };
      expect(fitsUnixSocket(config.socket)).toBe(true);
      const directory = join(config.socket, "..");
      expect((await stat(directory)).mode & 0o777).toBe(0o700);
      const result = await resolveApproval(
        storage,
        JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash" }),
        PUBLISH_REQUEST,
        APPROVAL_DECISION,
      );
      expect(result).toBe("approved");
      await bridge.close();
      bridge = undefined;
      // The temporary directory goes with the bridge.
      await expect(stat(directory)).rejects.toThrow();
    },
  );
});

describe("approval socket location", () => {
  it("knows the sun_path limit of each platform", () => {
    expect(unixSocketPathLimit("darwin")).toBe(103);
    expect(unixSocketPathLimit("freebsd")).toBe(103);
    expect(unixSocketPathLimit("linux")).toBe(107);
    expect(fitsUnixSocket(`/${"a".repeat(102)}`, "darwin")).toBe(true);
    expect(fitsUnixSocket(`/${"a".repeat(103)}`, "darwin")).toBe(false);
    // Bytes, not characters: accents count twice.
    expect(fitsUnixSocket(`/${"é".repeat(52)}`, "darwin")).toBe(false);
  });

  posixOnly("keeps a short storage path in a private ipc folder", async () => {
    const storage = await mkdtemp(join("/tmp", "xsg-short-"));
    const location = await approvalSocketLocation(storage, [], "darwin");
    expect(location).toEqual({
      socket: join(storage, "ipc", "approval.sock"),
      directory: join(storage, "ipc"),
      temporary: false,
    });
    expect((await stat(location.directory)).mode & 0o777).toBe(0o700);
  });

  posixOnly("falls back to the first short temporary base", async () => {
    const storage = await longStorage();
    const tooLong = join("/tmp", "b".repeat(120));
    const location = await approvalSocketLocation(
      storage,
      [tooLong, "/tmp"],
      "darwin",
    );
    expect(location.temporary).toBe(true);
    expect(location.socket.startsWith("/tmp/xsg-")).toBe(true);
    expect(fitsUnixSocket(location.socket, "darwin")).toBe(true);
    expect((await stat(location.directory)).mode & 0o777).toBe(0o700);
    await rm(location.directory, { recursive: true, force: true });
  });

  posixOnly(
    "refuses a planted symlink without touching its target",
    async () => {
      const storage = await mkdtemp(join("/tmp", "xsg-link-"));
      const target = await mkdtemp(join("/tmp", "xsg-target-"));
      await chmod(target, 0o755);
      await symlink(target, join(storage, "ipc"));
      await expect(
        approvalSocketLocation(storage, [], "darwin"),
      ).rejects.toThrow("approval_socket_directory_not_private");
      expect((await stat(target)).mode & 0o777).toBe(0o755);
      await rm(storage, { recursive: true, force: true });
      await rm(target, { recursive: true, force: true });
    },
  );

  posixOnly("fails closed when no location fits", async () => {
    const storage = await longStorage();
    await expect(
      approvalSocketLocation(
        storage,
        [join("/tmp", "c".repeat(120))],
        "darwin",
      ),
    ).rejects.toThrow("approval_socket_path_too_long");
  });
});
