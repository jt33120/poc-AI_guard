import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "vscode";
import { randomUUID } from "node:crypto";
import { GatewayIntegration } from "../../packages/vscode/src/gateway-integration.js";

const native = vi.hoisted(() => ({
  getConfiguration: vi.fn(),
  getExtension: vi.fn(),
  startRelay: vi.fn(),
  closeApproval: vi.fn(),
  showErrorMessage: vi.fn(),
}));
vi.mock("vscode", () => ({
  workspace: { getConfiguration: native.getConfiguration },
  extensions: { getExtension: native.getExtension },
  env: {},
  window: { showErrorMessage: native.showErrorMessage },
  ConfigurationTarget: { Global: 1 },
}));
vi.mock("../../packages/vscode/src/gateway-bridge.js", () => ({
  startGatewayBridge: native.startRelay,
}));
vi.mock("../../packages/vscode/src/approval-bridge.js", () => ({
  startApprovalBridge: () => Promise.resolve({ close: native.closeApproval }),
}));
vi.mock("../../packages/vscode/src/enrollment.js", () => ({
  syncManagedPolicy: () => Promise.resolve("none"),
  readManagedPolicySummary: () => Promise.resolve(undefined),
  verifiedPolicyTenant: () => Promise.resolve(undefined),
}));
vi.mock("../../packages/vscode/src/hook-activity.js", () => ({
  readLastHookAt: () => undefined,
}));
let integration: GatewayIntegration | undefined;
afterEach(() => {
  integration?.dispose();
  integration = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("workstation tracking without Claude", () => {
  it("keeps the credential until disconnection is confirmed, then clears it", async () => {
    const remove = vi.fn(() => Promise.resolve());
    const context = {
      secrets: {
        get: () =>
          Promise.resolve(
            JSON.stringify({
              endpoint: "https://api.example.test",
              token: "synthetic-credential",
              installation: randomUUID(),
              relay: false,
            }),
          ),
        delete: remove,
      },
      globalState: { get: () => undefined, update: () => Promise.resolve() },
      globalStorageUri: { fsPath: `/tmp/secret-guard-test-${randomUUID()}` },
    } as unknown as ExtensionContext;
    native.getConfiguration.mockReturnValue({ get: () => [] });
    const request = vi.fn(() =>
      Promise.resolve(new Response("unavailable", { status: 503 })),
    );
    vi.stubGlobal("fetch", request);
    integration = new GatewayIntegration(context, () =>
      Promise.resolve({ state: "off", reason: "not_configured", hosts: [] }),
    );
    await integration.disconnect();
    expect(remove).not.toHaveBeenCalled();
    expect(native.showErrorMessage).toHaveBeenCalledOnce();
    request.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ disconnected: true }))),
    );
    await integration.disconnect();
    expect(request.mock.calls[1]?.[0]).toBe(
      "https://api.example.test/v1/extension/disconnect",
    );
    expect(remove).toHaveBeenCalledWith("xsom.gateway.connection");
    expect(integration.state).toBe("offline");
  });

  it("restores, emits presence, retries offline events and preserves local protection mode", async () => {
    vi.useFakeTimers();
    const installation = randomUUID();
    const persisted = new Map<string, unknown>();
    const mutation = vi.fn();
    native.getConfiguration.mockImplementation((section: string) => {
      if (section !== "secretGuard")
        throw new Error("Claude settings must not be accessed");
      return { get: () => "block", update: mutation };
    });
    native.getExtension.mockImplementation(() => {
      throw new Error("Claude must not be required");
    });
    let offline = false;
    const received: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init: RequestInit) =>
        Promise.resolve().then(() => {
          if (offline) throw new Error("offline");
          const body = JSON.parse(init.body as string);
          if (url.endsWith("/register"))
            return new Response(
              JSON.stringify({
                device_id: installation,
                redaction: "required",
                protocol: "anthropic-messages-v1",
              }),
            );
          received.push(...body.events);
          return new Response(
            JSON.stringify({
              accepted: body.events.map(
                (e: { event_id: string }) => e.event_id,
              ),
            }),
          );
        }),
      ),
    );
    const context = {
      secrets: {
        get: () =>
          Promise.resolve(
            JSON.stringify({
              endpoint: "https://api.example.test",
              token: "synthetic-credential",
              installation,
              relay: false,
              organization: "xSOM test",
            }),
          ),
      },
      globalState: {
        get: (key: string) => persisted.get(key),
        update: (key: string, value: unknown) => {
          persisted.set(key, value);
          return Promise.resolve();
        },
      },
      globalStorageUri: { fsPath: "/tmp/organization-integration-test" },
      extension: { packageJSON: { version: "0.6.2" } },
    } as unknown as ExtensionContext;
    integration = new GatewayIntegration(context, () =>
      Promise.resolve({ state: "off", reason: "not_configured", hosts: [] }),
    );
    await integration.restore();
    await vi.advanceTimersByTimeAsync(1);
    expect(integration.status).toContain("xSOM test");
    expect(native.startRelay).not.toHaveBeenCalled();
    expect(native.getExtension).not.toHaveBeenCalled();
    expect(mutation).not.toHaveBeenCalled();
    offline = true;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(integration.state).toBe("retrying");
    offline = false;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(integration.state).toBe("online");
    expect(
      received.some(
        (e) =>
          e.kind === "heartbeat" &&
          e.assistant === "secretguard" &&
          e.mode === "block",
      ),
    ).toBe(true);
    expect(received.some((e) => e.kind === "gateway_configured")).toBe(false);
    expect(JSON.stringify(received)).not.toContain("synthetic-credential");
    expect(JSON.stringify(received)).not.toContain("prompt");
  });
});
