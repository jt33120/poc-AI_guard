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

// Plafond d'Avertir : l'administrateur le choisit en composant la politique, le
// voit dans le résumé ; la plateforme valide et signe (tests Python), ici simulée.
async function policyConsole(
  page: Page,
  list: () => unknown[] | Promise<unknown[]>,
  onPut?: (body: Record<string, unknown>) => void,
): Promise<void> {
  await authenticated(page);
  await page.route("**/api/control/v1/extensions/devices", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/control/v1/extensions/events?*", (route) =>
    route.fulfill({ json: { events: [], next_before: null } }),
  );
  await page.route("**/api/control/v1/developer-policies", async (route) => {
    try {
      await route.fulfill({ json: await list() });
    } catch {
      await route.fulfill({ status: 500, json: {} });
    }
  });
  await page.route(
    "**/api/control/v1/developer-policies/team-default",
    async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      onPut?.(body);
      await route.fulfill({
        json: { policy: body, keyId: "k", publicKey: "p", signature: "s" },
      });
    },
  );
}

const PUBLISHED = [
  {
    policy_id: "equipe",
    version: 2,
    expires_at: "2099-09-23T10:00:00Z",
    revoked_at: null,
    key_id: "key-1",
    observe_max_minutes: 0,
    min_runner_version: "0.7.1",
  },
  {
    policy_id: "libre",
    version: 1,
    expires_at: "2099-09-23T10:00:00Z",
    revoked_at: null,
    key_id: "key-1",
    observe_max_minutes: null,
    min_runner_version: null,
  },
];

test("an admin caps Avertir while composing a policy and sees it in the summary", async ({
  page,
}) => {
  let published: Record<string, unknown> | undefined;
  await policyConsole(
    page,
    () =>
      published === undefined
        ? PUBLISHED
        : [
            ...PUBLISHED,
            {
              policy_id: "team-default",
              version: 1,
              expires_at: "2099-09-23T10:00:00Z",
              revoked_at: null,
              key_id: "key-1",
              observe_max_minutes: 60,
              min_runner_version: "0.7.1",
            },
          ],
    (body) => {
      published = body;
    },
  );
  await page.goto("/extensions");
  const panel = page.getByRole("region", { name: "Politiques Secret Guard" });
  const summary = panel.getByRole("region", { name: "Politiques publiées" });
  await expect(
    summary.getByRole("listitem").filter({ hasText: "equipe · v2" }),
  ).toContainText("Avertir : interdit");
  await expect(
    summary.getByRole("listitem").filter({ hasText: "equipe · v2" }),
  ).toContainText("extension 0.7.1 ou plus récente");
  await expect(
    summary.getByRole("listitem").filter({ hasText: "libre · v1" }),
  ).toContainText("Avertir : autorisé (8 h max)");

  const cap = panel.getByRole("group", { name: "Avertir sur les postes" });
  const json = panel.getByRole("textbox", { name: "Politique JSON" });
  await expect(
    cap.getByRole("radio", { name: "Autorisé (8 h max)" }),
  ).toBeChecked();
  await expect(json).not.toHaveValue(/workstation/);

  // Keyboard: arrows move within the group and rewrite the JSON.
  await cap.getByRole("radio", { name: "Autorisé (8 h max)" }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(cap.getByRole("radio", { name: "4 h max" })).toBeChecked();
  await expect(cap.getByRole("radio", { name: "4 h max" })).toBeFocused();
  await expect(json).toHaveValue(/"observeMaxMinutes": 240/);

  await cap.getByText("Interdit").click();
  await expect(json).toHaveValue(/"observeMaxMinutes": 0/);
  await cap.getByRole("radio", { name: "Autorisé (8 h max)" }).check();
  await expect(json).not.toHaveValue(/workstation/);
  await cap.getByRole("radio", { name: "1 h max" }).check();
  await expect(json).toHaveValue(/"observeMaxMinutes": 60/);

  await panel.getByRole("button", { name: "Publier la politique" }).click();
  await expect(panel.getByText("Politique signée et publiée.")).toBeVisible();
  expect(published?.workstation).toEqual({ observeMaxMinutes: 60 });
  expect(published?.policyId).toBe("team-default");
  await expect(
    summary.getByRole("listitem").filter({ hasText: "team-default · v1" }),
  ).toContainText("Avertir : 1 h max");

  // A cap the platform would refuse is named, not silently kept.
  await json.fill(
    JSON.stringify({ policyId: "x", workstation: { observeMaxMinutes: 30 } }),
  );
  await expect(cap.getByRole("radio", { checked: true })).toHaveCount(0);
  await expect(panel.getByRole("alert")).toContainText(
    "que la plateforme refusera",
  );
  // Unreadable JSON: the choice waits for a valid policy.
  await json.fill("{");
  for (const radio of await cap.getByRole("radio").all())
    await expect(radio).toBeDisabled();
  await expect(cap).toContainText("Corrigez le JSON");
});

test("the policy summary shows loading, failure, retry and empty states", async ({
  page,
}) => {
  let calls = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await policyConsole(page, async () => {
    calls += 1;
    if (calls === 1) {
      await gate;
      throw new Error("down");
    }
    return [];
  });
  await page.goto("/extensions");
  const summary = page
    .getByRole("region", { name: "Politiques Secret Guard" })
    .getByRole("region", { name: "Politiques publiées" });
  await expect(
    summary.getByRole("status", { name: "Chargement…" }),
  ).toBeVisible();
  release();
  await expect(summary.getByRole("alert")).toContainText(
    "Le service n’a pas répondu",
  );
  await summary.getByRole("button", { name: "Réessayer" }).click();
  await expect(
    summary.getByRole("heading", { name: "Aucune politique publiée" }),
  ).toBeVisible();
});

test("the Avertir cap reads in English", async ({ page }) => {
  await page
    .context()
    .addCookies([
      { name: "xsom_lang", value: "en", url: "http://127.0.0.1:3100" },
    ]);
  await policyConsole(page, () => PUBLISHED);
  await page.goto("/extensions");
  const panel = page.getByRole("region", { name: "Secret Guard policies" });
  await expect(
    panel.getByRole("group", { name: "Warn mode (Avertir) on workstations" }),
  ).toBeVisible();
  await expect(panel.getByRole("radio", { name: "Forbidden" })).toBeVisible();
  await expect(panel.getByText("Avertir: forbidden")).toBeVisible();
  await expect(panel.getByText("Avertir: allowed (8 h max)")).toBeVisible();
});
