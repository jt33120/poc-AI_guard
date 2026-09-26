import { expect, test, type Page } from "@playwright/test";

async function authenticated(page: Page): Promise<void> {
  await page
    .context()
    .addCookies([
      { name: "xsom_e2e", value: "1", url: "http://127.0.0.1:3100" },
    ]);
  await page.route("**/api/control/v1/clients", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/control/v1/agents", (route) =>
    route.fulfill({ json: { customer: null, agents: [] } }),
  );
}

test("admin flow exposes policy assignment, one-shot approvals and escaped evidence", async ({
  page,
}) => {
  await authenticated(page);
  await page.route("**/api/control/v1/extensions/devices", (route) =>
    route.fulfill({
      json: [
        {
          id: "device-1",
          name: '<img src=x onerror="window.__xss=1">',
          platform: "linux",
          extension_version: "0.6.0",
          mode: "block",
          registered_at: "2026-09-22T10:00:00Z",
          last_seen_at: "2026-09-22T10:01:00Z",
          revoked_at: null,
          gateway_events: 1,
          assigned_policy_id: "team-default",
          assigned_policy_version: 2,
          assigned_policy_expires_at: "2099-09-23T10:00:00Z",
          minimum_runner_version: "0.6.0",
          posture_received_at: new Date().toISOString(),
          posture: {
            outcome: "unverified",
            posture_reasons: ["hook_modified"],
            policy_id: "team-default",
            policy_version: 1,
            runner_version: "0.6.0",
            queue_pending: 0,
            dropped: 0,
          },
        },
      ],
    }),
  );
  await page.route("**/api/control/v1/extensions/events?*", (route) =>
    route.fulfill({
      json: {
        events: [
          {
            id: 1,
            device_id: "device-1",
            event_id: "event-1",
            source: "gateway",
            received_at: "2026-09-22T10:01:00Z",
            payload: {
              assistant: "claude",
              kind: "posture",
              outcome: "configured",
              findings: 0,
            },
            prev_hash: "a",
            entry_hash: "b",
          },
        ],
        next_before: null,
      },
    }),
  );
  await page.route("**/api/control/v1/developer-policies", (route) =>
    route.fulfill({
      json: [
        {
          policy_id: "team-default",
          version: 1,
          expires_at: "2026-09-23T10:00:00Z",
          revoked_at: null,
          key_id: "key-1",
        },
      ],
    }),
  );
  await page.goto("/extensions");

  await expect(
    page.getByRole("heading", { name: "Politiques Secret Guard" }),
  ).toBeVisible();
  await expect(
    page.getByText("approbations à usage unique et durée courte"),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Ouvrir la file d’approbation" }),
  ).toHaveAttribute("href", "/approvals");
  await expect(
    page
      .getByLabel("Couverture des postes")
      .getByText('<img src=x onerror="window.__xss=1">', { exact: true }),
  ).toBeVisible();
  await expect(page.locator("img[src='x']")).toHaveCount(0);
  await expect(page.getByText(/hook modifié/)).toBeVisible();
  await expect(page.getByText(/version de politique en dérive/)).toBeVisible();
  expect(
    await page.evaluate(() => (window as Window & { __xss?: number }).__xss),
  ).toBeUndefined();

  await page.getByLabel("Politique à attribuer").selectOption("team-default");
  await page.getByLabel("Poste à attribuer").selectOption("device-1");
  await expect(page.getByRole("button", { name: "Attribuer" })).toBeEnabled();
});

test("policy publication reports insufficient rights without claiming success", async ({
  page,
}) => {
  await authenticated(page);
  await page.route("**/api/control/v1/extensions/devices", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/control/v1/extensions/events?*", (route) =>
    route.fulfill({ json: { events: [], next_before: null } }),
  );
  await page.route("**/api/control/v1/developer-policies", async (route) => {
    if (route.request().method() === "PUT")
      await route.fulfill({ status: 403, json: {} });
    else await route.fulfill({ json: [] });
  });
  await page.route(
    "**/api/control/v1/developer-policies/team-default",
    (route) => route.fulfill({ status: 403, json: {} }),
  );
  await page.goto("/extensions");
  await page.getByRole("button", { name: "Publier la politique" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Request failed (403)" }),
  ).toBeVisible();
  await expect(page.getByText("Politique signée et publiée.")).toHaveCount(0);
});
