import { WORKSPACE } from "./workspace-fixture";
import { type BrowserContext, type Page, expect, test } from "@playwright/test";

// The supervision room on the overview: a deterministic day of decisions, served
// by a mocked control API, rendered for real by the console.

const HOUR = 3_600_000;
const END = Date.UTC(2026, 8, 28, 16, 0, 0);

function bucketsFor(index: number) {
  const wave = Math.round(40 + 30 * Math.sin((index / 24) * Math.PI * 2 - 1));
  return {
    auto_allowed: wave + 12,
    allowed_with_notice: Math.round(wave / 6),
    held_for_human: index % 5 === 0 ? 3 : 1,
    human_approved: index % 3 === 0 ? 2 : 1,
    refused: index === 17 ? 14 : index % 4,
    guard_recorded: index % 7 === 0 ? 2 : 0,
    observed_not_enforced: index > 18 ? 3 : 0,
    not_inspected: 0,
    unclassified: 0,
  };
}

function supervisionFixture(window = "24h", empty = false) {
  const series = Array.from({ length: 24 }, (_, index) => ({
    at: new Date(END - (24 - index) * HOUR).toISOString(),
    buckets: empty
      ? {
          auto_allowed: 0,
          allowed_with_notice: 0,
          held_for_human: 0,
          human_approved: 0,
          refused: 0,
          guard_recorded: 0,
          observed_not_enforced: 0,
          not_inspected: 0,
          unclassified: 0,
        }
      : bucketsFor(index),
  }));
  const buckets = Object.fromEntries(
    Object.keys(series[0].buckets).map((name) => [
      name,
      series.reduce(
        (sum, point) =>
          sum + point.buckets[name as keyof (typeof series)[0]["buckets"]],
        0,
      ),
    ]),
  );
  const total = Object.values(buckets).reduce((sum, value) => sum + value, 0);
  return {
    window,
    step_seconds: 3600,
    start: series[0].at,
    end: new Date(END).toISOString(),
    generated_at: new Date(END - 18 * 60_000).toISOString(),
    total,
    buckets,
    series,
    latency: {
      samples: empty ? 0 : 1180,
      p50: empty ? null : 3.4,
      p95: empty ? null : 11.8,
      p99: empty ? null : 23.5,
      series: series.map((point, index) => ({
        at: point.at,
        samples: empty ? 0 : 40 + index,
        p50: empty ? null : Number((3 + Math.sin(index / 3) * 0.6).toFixed(2)),
        p95: empty
          ? null
          : Number((10 + Math.cos(index / 4) * 2.5 + (index === 17 ? 9 : 0)).toFixed(2)),
      })),
    },
    classes: empty
      ? []
      : [
          { action_class: "read", total: 1210, buckets: { ...series[0].buckets, auto_allowed: 1180, allowed_with_notice: 30, held_for_human: 0, human_approved: 0, refused: 0, guard_recorded: 0, observed_not_enforced: 0 } },
          { action_class: "write", total: 180, buckets: { ...series[0].buckets, auto_allowed: 120, allowed_with_notice: 40, held_for_human: 4, human_approved: 6, refused: 10, guard_recorded: 0, observed_not_enforced: 0 } },
          { action_class: "external_send", total: 95, buckets: { ...series[0].buckets, auto_allowed: 0, allowed_with_notice: 52, held_for_human: 12, human_approved: 18, refused: 13, guard_recorded: 0, observed_not_enforced: 0 } },
          { action_class: "irreversible", total: 41, buckets: { ...series[0].buckets, auto_allowed: 0, allowed_with_notice: 0, held_for_human: 8, human_approved: 9, refused: 24, guard_recorded: 0, observed_not_enforced: 0 } },
        ],
    tools: empty
      ? []
      : [
          { tool: "db.drop_table", total: 26, held: 7, refused: 19 },
          { tool: "mail.send_external", total: 64, held: 21, refused: 6 },
          { tool: "crm.delete_contact", total: 15, held: 9, refused: 4 },
          { tool: "fs.write", total: 120, held: 0, refused: 7 },
        ],
    agents: empty
      ? []
      : [
          { id: "4f1c9a3e-0000-4000-8000-000000000001", name: "support-bot", total: 842, held: 31, refused: 18, last_active: new Date(END - 20 * 60_000).toISOString() },
          { id: "4f1c9a3e-0000-4000-8000-000000000002", name: "finance-agent", total: 511, held: 22, refused: 29, last_active: new Date(END - 2 * HOUR).toISOString() },
        ],
    approvals: {
      created: empty ? 0 : 58,
      approved: empty ? 0 : 33,
      denied: empty ? 0 : 17,
      expired: empty ? 0 : 3,
      pending: empty ? 0 : 5,
      median_decision_s: empty ? null : 164,
      p90_decision_s: empty ? null : 610,
      rubber_stamps: empty ? 0 : 2,
      expiry_rate: empty ? null : 0.0566,
      histogram: [
        { low_s: 0, high_s: 5, count: empty ? 0 : 2 },
        { low_s: 5, high_s: 30, count: empty ? 0 : 9 },
        { low_s: 30, high_s: 120, count: empty ? 0 : 14 },
        { low_s: 120, high_s: 600, count: empty ? 0 : 19 },
        { low_s: 600, high_s: 3600, count: empty ? 0 : 5 },
        { low_s: 3600, high_s: null, count: empty ? 0 : 1 },
      ],
      pending_now: empty ? 0 : 2,
      oldest_pending_s: empty ? null : 412,
      targets: { median_decision_s: 300, expiry_rate: 0.1, rubber_stamp_s: 5 },
    },
    probes: {
      database_ms: 7.4,
      chain_ok: true,
      chain_entries: empty ? 0 : 14_302,
      chain_broken_id: null,
      last_checkpoint_at: empty ? null : new Date(END - 5 * HOUR).toISOString(),
      last_checkpoint_entries: empty ? null : 14_010,
      last_event_at: empty ? null : new Date(END - 4 * 60_000).toISOString(),
    },
  };
}

async function authed(context: BrowserContext) {
  await context.addCookies([
    { name: "xsom_e2e", value: "1", url: "http://127.0.0.1:3100" },
  ]);
}

async function serve(page: Page, empty = false) {
  const windows: string[] = [];
  await page.route("**/api/control/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/v1/workspace")) return route.fulfill({ json: WORKSPACE });
    if (url.pathname.endsWith("/v1/supervision")) {
      const window = url.searchParams.get("window") ?? "24h";
      windows.push(window);
      await route.fulfill({ json: supervisionFixture(window, empty) });
      return;
    }
    if (url.pathname.endsWith("/v1/agents")) {
      await route.fulfill({ json: { customer: null, agents: [] } });
      return;
    }
    await route.fulfill({ json: [] });
  });
  return windows;
}

test("the overview shows the supervision room, measured", async ({ page, context }) => {
  await authed(context);
  const windows = await serve(page);
  await page.goto("/ai-guard");

  const room = page.locator(".sup-root");
  await expect(room.locator(".sup-hero-figure")).toHaveText(/\d/);
  await expect(room.getByText("Chaîne d’audit")).toBeVisible();
  await expect(room.getByText("Intacte")).toBeVisible();
  await expect(room.getByText("Objectif tenu · < 5 min")).toBeVisible();
  await expect(room.getByText("Où la garde intervient")).toBeVisible();
  await expect(room.getByText("db.drop_table")).toBeVisible();

  const timeline = room.locator(".sup-chart").first();
  const box = await timeline.boundingBox();
  if (!box) throw new Error("timeline not rendered");
  await timeline.hover({ position: { x: box.width * 0.75, y: box.height / 2 } });
  await expect(room.locator(".sup-tooltip")).toContainText("événements");

  await room.getByRole("button", { name: "Voir le tableau" }).click();
  await expect(room.locator(".sup-table-wrap tbody tr")).toHaveCount(24);

  await room.getByRole("button", { name: "7 jours" }).click();
  await expect.poll(() => windows.at(-1)).toBe("7d");
});

test("keyboard reaches every point of the timeline", async ({ page, context }) => {
  await authed(context);
  await serve(page);
  await page.goto("/ai-guard");
  const timeline = page.locator(".sup-root .sup-chart").first();
  await timeline.focus();
  await expect(page.locator(".sup-tooltip")).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".sup-tooltip")).toContainText("–");
  await page.keyboard.press("Escape");
  await expect(page.locator(".sup-tooltip")).toHaveCount(0);
});

test("an empty tenant is invited to connect an agent", async ({ page, context }) => {
  await authed(context);
  await serve(page, true);
  await page.goto("/ai-guard");
  await expect(
    page.getByText("La salle attend son premier appel d’outil."),
  ).toBeVisible();
  await expect(page.locator(".sup-root .sup-hero-figure")).toHaveText("0");
});
