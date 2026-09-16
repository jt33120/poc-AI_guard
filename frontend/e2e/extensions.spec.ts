import { expect, test } from "@playwright/test";

test("workstations distinguish client claims and gateway evidence", async ({
  page,
  context,
}) => {
  await context.addCookies([
    { name: "xsom_e2e", value: "1", url: "http://127.0.0.1:3100" },
  ]);
  await page.route("**/api/control/v1/clients", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/control/v1/agents", (route) =>
    route.fulfill({ json: { customer: null, agents: [] } }),
  );
  await page.route("**/api/control/v1/extensions/devices", (route) =>
    route.fulfill({
      json: [
        {
          id: "device-1",
          name: "PC-TEST",
          platform: "win32",
          extension_version: "0.3.0",
          mode: "redact",
          registered_at: "2026-09-16T10:00:00Z",
          last_seen_at: "2026-09-16T10:00:00Z",
          revoked_at: null,
          gateway_events: 2,
        },
      ],
    }),
  );
  await page.route("**/api/control/v1/extensions/events?*", (route) =>
    route.fulfill({
      json: {
        events: [
          {
            id: 2,
            device_id: "device-1",
            source: "gateway",
            received_at: "2026-09-16T10:00:00Z",
            payload: {
              assistant: "claude",
              kind: "gateway_request",
              outcome: "redacted",
              findings: 1,
              rules: ["password_assignment"],
            },
          },
          {
            id: 1,
            device_id: "device-1",
            source: "extension",
            received_at: "2026-09-16T10:00:00Z",
            payload: {
              assistant: "manual",
              kind: "local_test",
              outcome: "passed",
              findings: 0,
            },
          },
        ],
        next_before: null,
      },
    }),
  );
  await page.route("**/api/control/v1/extensions/verify", (route) =>
    route.fulfill({ json: { valid: true } }),
  );
  await page.goto("/extensions");
  await expect(
    page.getByRole("heading", { name: "Les postes. Les faits. Les preuves." }),
  ).toBeVisible();
  await expect(
    page.getByText("Observé par la passerelle", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Déclaré par l’extension", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Nettoyé → XXX", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Vérifier le chaînage" }).click();
  await expect(page.getByRole("status")).toContainText("pas une attestation");
  await page.getByLabel("Poste", { exact: true }).selectOption("device-1");
  await expect(
    page.getByText("Observé par la passerelle", { exact: true }),
  ).toBeVisible();
});

test("extension inventory requires a console session", async ({ page }) => {
  await page.goto("/extensions");
  await expect(page).toHaveURL(/\/login/);
});
