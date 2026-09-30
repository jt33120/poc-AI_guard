import { describe, expect, it } from "vitest";
import {
  dashboardHtml,
  DASHBOARD_COMMANDS,
} from "../../packages/vscode/src/dashboard.js";
import type { HookHealth } from "../../packages/vscode/src/hook-manager.js";
import {
  TEAM_DASHBOARD_COMMANDS,
  teamDashboard,
} from "../../packages/vscode/src/team/dashboard.js";

const healthy: HookHealth = {
  state: "active",
  reason: "local_canaries_verified",
  hosts: [{ id: "claude", label: "Claude Code", configured: true }],
};

describe("Équipe sections of the protection centre", () => {
  it("shows the relay action according to live state", () => {
    const offline = dashboardHtml(healthy, "block", "nonce", {
      team: teamDashboard(),
    });
    expect(offline).toContain("Pièces jointes · Non analysées");
    expect(offline).toContain('href="command:secretGuard.connectGateway"');
    expect(offline).not.toContain(
      'href="command:secretGuard.disconnectGateway"',
    );

    const online = dashboardHtml(healthy, "block", "nonce", {
      team: teamDashboard({
        state: "online",
        status: "Claude raccordé",
        audit: "Audit : 0 en attente",
      }),
    });
    expect(online).toContain("Pièces jointes · Analysées");
    expect(online).toContain("Audit : 0 en attente");
    expect(online).toContain('href="command:secretGuard.disconnectGateway"');
    expect(online).not.toContain('href="command:secretGuard.connectGateway"');
  });

  it("escapes relay status and audit", () => {
    const html = dashboardHtml(healthy, "block", "nonce", {
      team: teamDashboard({
        state: "retrying",
        status: '<img src=x onerror="alert(1)">',
        audit: "<script>alert(1)</script>",
      }),
    });
    expect(html).toContain("&lt;img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script");
    expect(html).toContain('href="command:secretGuard.disconnectGateway"');
  });

  it("only links to commands the panel allows", () => {
    const html = dashboardHtml(healthy, "block", "nonce", {
      team: teamDashboard(undefined, {
        state: "none",
        tone: "info",
        line: "x",
        title: "Règles intégrées",
        detail: "Aucun réglage",
        offerRequest: true,
      }),
    });
    const allowed = [...DASHBOARD_COMMANDS, ...TEAM_DASHBOARD_COMMANDS];
    const actions = [...html.matchAll(/href="command:([^"]+)"/gu)].map(
      (match) => match[1],
    );
    expect(actions).toContain("secretGuard.requestRulesPack");
    for (const action of actions) expect(allowed).toContain(action);
  });
});
