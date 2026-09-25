import { describe, expect, it } from "vitest";
import {
  dashboardHtml,
  DASHBOARD_COMMANDS,
} from "../../packages/vscode/src/dashboard.js";
import type { HookHealth } from "../../packages/vscode/src/hook-manager.js";

const healthy: HookHealth = {
  state: "active",
  reason: "local_canaries_verified",
  hosts: [
    { id: "claude", label: "Claude Code", configured: true },
    { id: "codex", label: "Codex", configured: true },
  ],
};

describe("protection dashboard boundaries", () => {
  it("shows actual observe behavior and a mode selector", () => {
    const html = dashboardHtml(healthy, "observe", "nonce");
    expect(html).toContain("Changer de mode");
    expect(html).toContain("secretGuard.chooseMode");
    expect(html).toContain("même avec des secrets");
  });
  it("explains where redaction is automatic and where it is manual", () => {
    const html = dashboardHtml(healthy, "redact", "nonce");
    expect(html).toContain("Automatique dans @secretguard");
    expect(html).toContain("envoi arrêté");
  });
  it("exposes failed mode application instead of claiming success", () => {
    const html = dashboardHtml(healthy, "observe", "nonce", true);
    expect(html).toContain("Mode à appliquer");
    expect(html).toContain("Configurer la protection");
  });
  it("escapes host labels and only links to allowlisted actions", () => {
    const html = dashboardHtml(
      {
        ...healthy,
        hosts: [
          {
            id: "claude",
            configured: true,
            label: '<img src=x onerror="alert(1)">',
          },
        ],
      },
      "block",
      "test-nonce",
    );
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toContain("default-src 'none'");
    const actions = [...html.matchAll(/href="command:([^"]+)"/gu)].map(
      (match) => match[1],
    );
    for (const action of actions) expect(DASHBOARD_COMMANDS).toContain(action);
    expect(html).not.toMatch(/(?:src|href)="https?:/u);
  });

  it("does not paint configured hosts as ready when the scanner failed", () => {
    const html = dashboardHtml(
      { ...healthy, state: "degraded", reason: "canary_failed" },
      "block",
      "nonce",
    );
    expect(html).toContain("Protection à vérifier");
    expect(html).toContain("Le test local de protection n’a pas abouti");
    expect(html).not.toContain('class="badge ready"');
    expect(html).toContain("Configurer la protection");
  });

  it("makes the time-limited Avertir policy and pending Codex approval visible", () => {
    const html = dashboardHtml(healthy, "observe", "nonce");
    expect(html).toContain("pendant 1 heure");
    expect(html).toContain("repasse automatiquement en Expurger");
    expect(html).not.toContain("Mode permissif");
    expect(html).toContain("Approbation du hook requise dans Codex");
    expect(html).toContain("Validez le blocage dans chaque assistant");
  });

  it("shows the monitored scope and relay action according to live state", () => {
    const offline = dashboardHtml(healthy, "block", "nonce");
    expect(offline).toContain("Périmètre surveillé");
    expect(offline).toContain("Prompts · Surveillé");
    expect(offline).toContain("Pièces jointes · Non analysées");
    expect(offline).toContain('href="command:secretGuard.connectGateway"');
    expect(offline).not.toContain(
      'href="command:secretGuard.disconnectGateway"',
    );

    const online = dashboardHtml(healthy, "block", "nonce", false, {
      state: "online",
      status: "Claude raccordé",
      audit: "Audit : 0 en attente",
    });
    expect(online).toContain("Pièces jointes · Analysées");
    expect(online).toContain("Audit : 0 en attente");
    expect(online).toContain('href="command:secretGuard.disconnectGateway"');
    expect(online).not.toContain('href="command:secretGuard.connectGateway"');

    const off = dashboardHtml(
      { ...healthy, state: "off", reason: "not_configured" },
      "block",
      "nonce",
    );
    expect(off).toContain("Prompts · Non surveillé");
    expect(off).not.toContain("Prompts · Surveillé");
  });

  it("escapes relay status and audit in the protection center", () => {
    const html = dashboardHtml(healthy, "block", "nonce", false, {
      state: "retrying",
      status: '<img src=x onerror="alert(1)">',
      audit: "<script>alert(1)</script>",
    });
    expect(html).toContain("&lt;img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script");
    expect(html).toContain('href="command:secretGuard.disconnectGateway"');
  });
});
