import { type BrowserContext, expect, test } from "@playwright/test";

const APPROVAL = {
  id: "11111111-1111-1111-1111-111111111111",
  request_id: "req-1",
  tool_name: "crm.delete_contact",
  action_class: "irreversible",
  status: "pending",
  required_count: 1,
  approved_by: [] as string[],
  dry_run: { summary: "Execute crm.delete_contact [irreversible] with contact_id='c1'" },
};

async function authed(context: BrowserContext) {
  await context.addCookies([
    { name: "xsom_e2e", value: "1", url: "http://127.0.0.1:3100" },
  ]);
}

test("landing page renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "xSOM AI Guard" })).toBeVisible();
});

test("approving a held action from the UI clears it from the queue", async ({ page, context }) => {
  await authed(context);
  let decided = false;

  await page.route("**/api/control/**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (url.includes("/v1/approvals/") && url.includes("/decision") && method === "POST") {
      decided = true;
      await route.fulfill({ json: { ...APPROVAL, status: "approved" } });
      return;
    }
    if (url.includes("/v1/approvals")) {
      await route.fulfill({ json: decided ? [] : [APPROVAL] });
      return;
    }
    await route.fulfill({ json: [] });
  });

  await page.goto("/approvals");
  await expect(page.getByText("Execute crm.delete_contact")).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("No pending approvals.")).toBeVisible();
});

test("audit explorer lists entries and offers exports", async ({ page, context }) => {
  await authed(context);
  await page.route("**/api/control/v1/audit**", async (route) => {
    await route.fulfill({
      json: [
        {
          id: 1,
          ts: "2026-06-15T12:00:00+00:00",
          tool_name: "crm.read",
          action_class: "read",
          decision: "allow",
          args_hash: "abc123def456",
        },
      ],
    });
  });

  await page.goto("/audit");
  await expect(page.getByText("crm.read")).toBeVisible();
  await expect(page.getByRole("link", { name: /Export AI Act/ })).toBeVisible();
});

test("editing the policy saves a new version", async ({ page, context }) => {
  await authed(context);
  await page.route("**/api/control/**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (url.includes("/v1/policy") && method === "PUT") {
      await route.fulfill({ json: { yaml: "tools: []\n", version: 2 } });
      return;
    }
    if (url.includes("/v1/policy")) {
      await route.fulfill({ json: { yaml: "tools: []\n", version: 1 } });
      return;
    }
    await route.fulfill({ json: [] });
  });

  await page.goto("/admin");
  await expect(page.getByText("version 1")).toBeVisible();
  await page.getByRole("button", { name: "Save policy" }).click();
  await expect(page.getByText("Policy saved (version 2).")).toBeVisible();
});
