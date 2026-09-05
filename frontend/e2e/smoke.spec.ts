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

// --- Public profile diagnostic (QO-7) ------------------------------------------
//
// No `authed()`: the whole point is that a prospect with no account reaches it.
// A test that signed in first would pass on a screen locked behind a login.

const DIAGNOSTIC = {
  profiles: ["P1a", "P2", "P3"],
  lines: 16,
  applicable: 14,
  ours: 11,
  blocked: 8,
  statement:
    "Sur les 16 lignes de la matrice de menaces, 14 vous concernent réellement compte tenu de votre usage. Sur ces 14, nous en bloquons 8 nativement, chez vous, aujourd'hui.",
  privacy:
    "Votre adresse sert à vous recontacter au sujet de ce diagnostic. Base légale : intérêt légitime (prospection B2B).",
};

test("a prospect with no account gets a diagnostic after giving an e-mail", async ({ page }) => {
  let sent: { profiles?: string[]; email?: string } = {};
  await page.route("**/api/triage", async (route) => {
    sent = JSON.parse(route.request().postData() ?? "{}");
    await route.fulfill({ json: DIAGNOSTIC });
  });

  await page.goto("/triage");

  // The purpose is readable BEFORE anything is handed over — a purpose met only
  // after the fact was not disclosed.
  await expect(page.getByText(/ni revendue ni transmise|neither sold nor passed/)).toBeVisible();

  // Nothing ticked: the submit is refused, so an empty diagnostic can never be
  // presented as an answer.
  await expect(page.getByRole("button", { name: /diagnostic|Voir mon/i })).toBeDisabled();

  await page.getByRole("checkbox").first().check();
  await page.getByLabel(/E-mail|Professional/).fill("prospect@exemple-client.test");
  await page.getByRole("button", { name: /diagnostic|Voir mon/i }).click();

  await expect(page.getByTestId("triage-statement")).toContainText("nous en bloquons 8");
  expect(sent.email).toBe("prospect@exemple-client.test");
  expect(sent.profiles).toEqual(["P1a"]);
});
