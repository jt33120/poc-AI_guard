import { describe, expect, it } from "vitest";
import type { HookHealth } from "../../packages/vscode/src/hook-manager.js";
import {
  statusTooltipMarkdown,
  STATUS_TOOLTIP_COMMANDS,
  type StatusTooltipInput,
} from "../../packages/vscode/src/status-tooltip.js";

const healthy: HookHealth = {
  state: "active",
  reason: "local_canaries_verified",
  hosts: [
    { id: "claude", label: "Claude Code", configured: true },
    { id: "codex", label: "Codex", configured: true },
  ],
};

// Mirrors the VS Code markdown sanitizer: anything outside these rules is
// silently stripped from the hover, which would break the layout or a control.
const VSCODE_SPAN_STYLE =
  /^(color:(#[0-9a-fA-F]+|var\(--vscode(-[a-zA-Z0-9]+)+\));)?(background-color:(#[0-9a-fA-F]+|var\(--vscode(-[a-zA-Z0-9]+)+\));)?(border-radius:[0-9]+px;)?$/u;
const USED_TAGS = new Set([
  "a",
  "b",
  "br",
  "div",
  "hr",
  "i",
  "small",
  "span",
  "table",
  "td",
  "tr",
]);

function render(overrides: Partial<StatusTooltipInput> = {}): string {
  return statusTooltipMarkdown({
    health: healthy,
    warnMode: "block",
    ...overrides,
  });
}

function linkedCommands(markdown: string): string[] {
  return [...markdown.matchAll(/href="command:([^"?]+)/gu)].map(
    (match) => match[1]!,
  );
}

function modeLinks(markdown: string): string[] {
  return [
    ...markdown.matchAll(/href="command:secretGuard\.setMode\?([^"]+)"/gu),
  ].map((match) => (JSON.parse(decodeURIComponent(match[1]!)) as string[])[0]!);
}

describe("status bar tooltip controls", () => {
  it("highlights the active level and links the other levels", () => {
    const markdown = render({ warnMode: "observe" });
    expect(markdown).toContain("<b>Avertir et laisser passer</b>");
    expect(markdown).toContain("Élevée");
    expect(modeLinks(markdown)).toEqual(["redact", "block"]);
  });

  it("offers every level when only the legacy permissive setting exists", () => {
    const markdown = render({ warnMode: "allow" });
    expect(markdown).toContain("Ancien réglage permissif");
    expect(modeLinks(markdown)).toEqual(["observe", "redact", "block"]);
  });

  it("exposes scans, Codex approval, settings and dashboard", () => {
    const commands = linkedCommands(render());
    for (const command of [
      "secretGuard.scanClipboard",
      "secretGuard.scanDocument",
      "secretGuard.connectGateway",
      "secretGuard.finishCodexSetup",
      "secretGuard.showDashboard",
      "workbench.action.openSettings",
    ])
      expect(commands).toContain(command);
    expect(commands).not.toContain("secretGuard.disconnectGateway");
  });

  it("offers disconnection once the gateway is linked or retrying", () => {
    for (const state of ["online", "retrying"] as const) {
      const markdown = render({
        gateway: { state, status: "Claude raccordé", audit: "Audit : 0" },
      });
      expect(linkedCommands(markdown)).toContain(
        "secretGuard.disconnectGateway",
      );
      expect(linkedCommands(markdown)).not.toContain(
        "secretGuard.connectGateway",
      );
    }
  });

  it("surfaces incomplete protection and failed mode application", () => {
    const degraded = render({
      health: { ...healthy, state: "degraded", reason: "canary_failed" },
    });
    expect(degraded).toContain("Protection à vérifier");
    expect(degraded).toContain("Le test local de protection n’a pas abouti");
    expect(degraded).toContain("À vérifier");
    expect(linkedCommands(degraded)).toContain("secretGuard.enableHook");

    const failed = render({ modeApplicationFailed: true });
    expect(failed).toContain("Mode à appliquer");
    expect(failed).not.toContain("Prêt à veiller");
    expect(linkedCommands(failed)).toContain("secretGuard.enableHook");
    expect(linkedCommands(render())).not.toContain("secretGuard.enableHook");
  });

  it("summarizes the last manual scan from metadata only", () => {
    expect(
      render({
        lastScan: {
          source: "document",
          decision: "BLOCK",
          findings: 2,
          complete: true,
          time: "15:43",
        },
      }),
    ).toContain("Document ouvert · 2 secret(s) détecté(s)");
    expect(
      render({
        lastScan: {
          source: "clipboard",
          decision: "ALLOW",
          findings: 0,
          complete: false,
          time: "15:44",
        },
      }),
    ).toContain("Presse-papiers · analyse incomplète");
  });

  it("escapes dynamic text and only links allowlisted commands", () => {
    const injected =
      '<a href="command:secretGuard.disableHook">x</a><img src=x onerror="alert(1)"> $(bug)';
    const markdown = render({
      health: {
        ...healthy,
        hosts: [{ id: "claude", configured: true, label: injected }],
      },
      gateway: { state: "online", status: injected, audit: injected },
    });
    expect(markdown).not.toContain("<img");
    expect(markdown).not.toContain("$(bug)");
    expect(linkedCommands(markdown)).not.toContain("secretGuard.disableHook");
    for (const command of linkedCommands(markdown))
      expect(STATUS_TOOLTIP_COMMANDS).toContain(command);
  });

  it("only emits markup the VS Code hover sanitizer keeps", () => {
    const markdown = render({
      warnMode: "observe",
      health: { ...healthy, state: "partial", reason: "config_invalid" },
      gateway: { state: "retrying", status: "Connexion indisponible" },
      lastScan: {
        source: "selection",
        decision: "WARN",
        findings: 1,
        complete: true,
        time: "09:05",
      },
    });
    for (const [, tag] of markdown.matchAll(/<\/?([a-z]+)/gu))
      expect(USED_TAGS).toContain(tag);
    for (const [, style] of markdown.matchAll(/style="([^"]*)"/gu))
      expect(style).toMatch(VSCODE_SPAN_STYLE);
    for (const [element] of markdown.matchAll(/<[a-z]+ [^>]*style=/gu))
      expect(element.startsWith("<span ")).toBe(true);
    for (const [, attributes] of markdown.matchAll(/<[a-z]+ ([^>]*)>/gu))
      expect(attributes).not.toContain("$(");
  });
});
