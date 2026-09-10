import { type BrowserContext, expect, type Page, test } from "@playwright/test";

const APPROVAL = {
  id: "22222222-2222-2222-2222-222222222222",
  request_id: "signal-demo-request",
  tool_name: "demo.delete_record",
  action_class: "irreversible",
  status: "pending",
  required_count: 1,
  approved_by: [] as string[],
  dry_run: { summary: "Demo fixture: delete one isolated test record." },
  expires_at: "2099-01-01T00:00:00Z",
};

const TOOLS = [
  { name: "demo.read_record", canonical: "demo.read_record", action_class: "read", decision: "auto" },
  { name: "demo.delete_record", canonical: "demo.delete_record", action_class: "irreversible", decision: "human_in_the_loop" },
];
const AUDIT = {
  id: 913,
  ts: "2026-09-10T12:00:00Z",
  tool_name: "demo.delete_record",
  action_class: "irreversible",
  decision: "hitl_pending",
  args_hash: "7e951933c58b559ab449145d439419d16c11ffbec06d690b0e8a2141890f110a",
  policy_rule_id: "demo-human-deletion-rule",
  request_id: "demo-request-913",
  latency_ms: null,
  enforcement_mode: "enforce",
};

async function authenticate(context: BrowserContext) {
  await context.addCookies([{ name: "xsom_e2e", value: "1", url: "http://127.0.0.1:3100" }]);
}

async function emptyControlResponses(page: Page) {
  await page.route("**/api/control/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/control/v1/policy") {
      await route.fulfill({ json: { yaml: "tools: []\n", version: 1 } });
      return;
    }
    await route.fulfill({ json: [] });
  });
}

test("an expired approval cannot be accepted from the console", async ({ page, context }) => {
  await authenticate(context);
  let writes = 0;
  await page.route("**/api/control/**", async (route) => {
    if (route.request().method() !== "GET") writes += 1;
    await route.fulfill({ json: route.request().url().includes("/v1/approvals")
      ? [{ ...APPROVAL, expires_at: "2000-01-01T00:00:00Z" }] : [] });
  });

  await page.goto("/approvals");
  await expect(page.getByText(APPROVAL.dry_run.summary)).toBeVisible();
  await expect(page.getByRole("button", { name: "Approuver", exact: true })).toBeDisabled();
  expect(writes).toBe(0);
});

test("an open approval becomes unavailable at its deadline without a reload", async ({ page, context }) => {
  await authenticate(context);
  await page.route("**/api/control/**", async (route) => {
    await route.fulfill({ json: route.request().url().includes("/v1/approvals")
      ? [{ ...APPROVAL, expires_at: new Date(Date.now() + 3_000).toISOString() }] : [] });
  });
  await page.goto("/approvals");
  const accept = page.getByRole("button", { name: "Approuver", exact: true });
  await expect(accept).toBeEnabled();
  await expect(accept).toBeDisabled({ timeout: 6_000 });
});

test("an approval stays held until the server confirms the decision", async ({ page, context }) => {
  await authenticate(context);
  let confirmed = false;
  let requested = false;
  let confirm: () => void = () => undefined;
  const confirmation = new Promise<void>((resolve) => { confirm = resolve; });
  await page.route("**/api/control/**", async (route) => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toEqual({ decision: "approve" });
      requested = true;
      await confirmation;
      confirmed = true;
      await route.fulfill({ json: { ...APPROVAL, status: "approved" } });
      return;
    }
    await route.fulfill({ json: !confirmed && route.request().url().includes("/v1/approvals") ? [APPROVAL] : [] });
  });

  await page.goto("/approvals");
  await page.getByRole("button", { name: "Approuver", exact: true }).click();
  await expect.poll(() => requested).toBe(true);
  await expect(page.getByText(APPROVAL.dry_run.summary)).toBeVisible();
  await expect(page.getByText("Aucune validation en attente.")).toHaveCount(0);
  confirm();
  await expect(page.getByText("Aucune validation en attente.")).toBeVisible();
});

test("a rejected approval write leaves the pending action visible", async ({ page, context }) => {
  await authenticate(context);
  await page.route("**/api/control/**", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 503, json: { detail: "Approval service unavailable" } });
      return;
    }
    await route.fulfill({ json: route.request().url().includes("/v1/approvals") ? [APPROVAL] : [] });
  });

  await page.goto("/approvals");
  await page.getByRole("button", { name: "Approuver", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(page.getByText(APPROVAL.dry_run.summary)).toBeVisible();
  await expect(page.getByText("Aucune validation en attente.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Approuver", exact: true })).toBeEnabled();
});

test("an unavailable queue is not presented as an empty queue", async ({ page, context }) => {
  await authenticate(context);
  await page.route("**/api/control/**", async (route) => {
    await route.fulfill({ status: 503, json: { detail: "Approval service unavailable" } });
  });
  await page.goto("/approvals");
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(page.getByText("Aucune validation en attente.")).toHaveCount(0);
});

test("a rejected policy keeps its version and never announces a save", async ({ page, context }) => {
  await authenticate(context);
  await emptyControlResponses(page);
  await page.route("**/api/control/v1/policy", async (route) => {
    await route.fulfill(route.request().method() === "PUT"
      ? { status: 422, json: { detail: "Invalid policy YAML" } }
      : { json: { yaml: "tools: []\n", version: 7 } });
  });
  await page.goto("/policy");
  await expect(page.getByText("version 7", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Policy YAML", exact: true }).fill("invalid: [");
  await page.getByRole("button", { name: "Enregistrer la politique", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(page.getByText("version 7", { exact: true })).toBeVisible();
  await expect(page.getByText(/Politique enregistrée/)).toHaveCount(0);
});

test("a pending policy save freezes the draft until the server acknowledges it", async ({ page, context }) => {
  await authenticate(context);
  await emptyControlResponses(page);
  let requested = false;
  let confirm: () => void = () => undefined;
  const confirmation = new Promise<void>((resolve) => { confirm = resolve; });
  const submitted = "tools: []\n# reviewed draft\n";
  await page.route("**/api/control/v1/policy", async (route) => {
    if (route.request().method() === "PUT") {
      expect(route.request().postDataJSON()).toEqual({ yaml: submitted });
      requested = true;
      await confirmation;
      await route.fulfill({ json: { yaml: submitted, version: 8 } });
      return;
    }
    await route.fulfill({ json: { yaml: "tools: []\n", version: 7 } });
  });
  await page.goto("/policy");
  const editor = page.getByRole("textbox", { name: "Policy YAML", exact: true });
  await expect(editor).toBeEditable();
  await editor.fill(submitted);
  await page.getByRole("button", { name: "Enregistrer la politique", exact: true }).click();
  await expect.poll(() => requested).toBe(true);
  await expect(editor).not.toBeEditable();
  await expect(page.getByText("version 7", { exact: true })).toBeVisible();
  await expect(page.getByText(/Politique enregistrée/)).toHaveCount(0);
  confirm();
  await expect(page.getByText("version 8", { exact: true })).toBeVisible();
  await expect(editor).toBeEditable();
  await expect(editor).toHaveValue(submitted);
});

test("the inspector selects actual evidence without executing an action", async ({ page, context }) => {
  await authenticate(context);
  let writes = 0;
  await page.route("**/api/control/**", async (route) => {
    if (route.request().method() !== "GET") writes += 1;
    const pathname = new URL(route.request().url()).pathname;
    await route.fulfill({ json: pathname.endsWith("/tools") ? TOOLS : pathname.endsWith("/audit") ? [AUDIT] : [] });
  });

  await page.goto("/inspector");
  await page.getByRole("button", { name: /demo.delete_record/ }).click();
  await expect(page.getByText(AUDIT.policy_rule_id, { exact: true })).toBeVisible();
  await expect(page.getByText(AUDIT.args_hash, { exact: true })).toBeVisible();
  await expect(page.getByText(AUDIT.request_id, { exact: true })).toBeVisible();
  await expect(page.getByText("Latence non renseignée", { exact: true })).toBeVisible();
  const flow = page.locator('signal-flow[mode="live"]');
  await expect(flow.getByText("non autorisé", { exact: true })).toBeVisible();
  await expect(flow.getByRole("button")).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Filtrer les outils" }).fill("read_record");
  await expect(page.getByRole("button", { name: /demo.delete_record/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /demo.read_record/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Pas encore de trace.", { exact: true })).toBeVisible();
  expect(writes).toBe(0);
});

test("risk reports observed trust and drift without inventing a numerical risk score", async ({ page, context }) => {
  await authenticate(context);
  await emptyControlResponses(page);
  await page.route("**/api/control/v1/trust", async (route) => {
    await route.fulfill({ json: [{ tool: "demo.read_record", seen_before: true, clean_streak: 13, trusted: true }] });
  });
  await page.route("**/api/control/v1/tools/integrity", async (route) => {
    await route.fulfill({ json: [{ server: "demo", tool_name: "demo.read_record", approved: false, status: "drift", first_seen: null, last_seen: null }] });
  });
  await page.goto("/risk");
  await expect(page.getByText("13 consécutives", { exact: true })).toBeVisible();
  await expect(page.locator(".console-metric").filter({ hasText: "Dérives déclarées" }).locator("strong")).toHaveText("1");
  await expect(page.getByText("Le score par appel n’est pas exposé par cette API.", { exact: false })).toBeVisible();
  await expect(page.locator('signal-risk[mode="live"] meter')).toHaveCount(0);
});

test("unavailable risk feeds remain unknown rather than showing reassuring zeroes", async ({ page, context }) => {
  await authenticate(context);
  await page.route("**/api/control/**", async (route) => {
    await route.fulfill({ status: 503, json: { detail: "Telemetry unavailable" } });
  });
  await page.goto("/risk");
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(page.locator(".console-metric strong")).toHaveText(["—", "—", "—", "—"]);
  await expect(page.getByText("Confiance indisponible.", { exact: true })).toBeVisible();
  await expect(page.getByText("Aucune empreinte.", { exact: true })).toHaveCount(0);
});

test("the executive view never counts uninspected or unknown events as authorizations", async ({ page, context }) => {
  await authenticate(context);
  const decisions = [
    "allow", "deny", "hitl_pending", "streamed_uninspected", "relayed_unparsed",
    "future_verdict", null, "monitor_deny", "tool_drift",
  ];
  await page.route("**/api/control/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const json = pathname.endsWith("/audit")
      ? decisions.map((decision, index) => ({ ...AUDIT, id: index + 1, decision }))
      : pathname.endsWith("/usage") ? { total_cost_usd: 0 }
      : pathname.endsWith("/agents") ? { customer: null, agents: [] }
      : pathname.endsWith("/tools") ? TOOLS : [];
    await route.fulfill({ json });
  });
  await page.goto("/executive");
  for (const label of ["Autorisations", "Décisions HITL", "Refus"]) {
    await expect(page.getByText(label, { exact: true }).locator("..")).toHaveText(new RegExp(`${label}\\s*1$`));
  }
  await expect(page.getByText("Autres événements", { exact: true }).locator("..")).toHaveText(/Autres événements\s*6$/);
  await expect(page.getByText("Exclus de la répartition des décisions, jamais assimilés à une autorisation.", { exact: false })).toBeVisible();
});

test("the redesigned console keeps English after reloading", async ({ page, context }) => {
  await authenticate(context);
  await emptyControlResponses(page);
  await page.goto("/risk");
  await expect(page.getByRole("heading", { name: "La confiance se gagne.", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Trust is earned.", exact: true })).toBeVisible();
  await expect(page.locator("signal-risk").getByText("Risk × trust", { exact: true })).toBeVisible();
  await expect(page.locator("signal-preferences").getByRole("button", { name: "Light theme", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: "Trust is earned.", exact: true })).toBeVisible();
  await expect(page.locator("signal-risk").getByText("Risk × trust", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "FR", exact: true }).click();
  await expect(page.locator("signal-risk").getByText("Risque × confiance", { exact: true })).toBeVisible();
  await expect(page.locator("signal-preferences").getByRole("button", { name: "Thème clair", exact: true })).toBeVisible();
});

test("the interactive overview labels its demonstration and never writes to the service", async ({ page, context }) => {
  await authenticate(context);
  let writes = 0;
  await page.route("**/api/control/**", async (route) => {
    if (route.request().method() !== "GET") writes += 1;
    await route.fulfill({ json: [] });
  });
  await page.goto("/home");
  const demo = page.locator('signal-flow[mode="demo"]');
  await expect(demo.getByText("Démonstration · données illustratives", { exact: true })).toBeVisible();
  await demo.getByRole("button", { name: "Guarded", exact: true }).click();
  await expect(demo.getByRole("button", { name: "Unguarded", exact: true })).toBeVisible();
  await demo.getByRole("button", { name: "Unguarded", exact: true }).click();
  await demo.getByRole("button", { name: "DENY", exact: true }).click();
  await expect(demo.getByText("non exécuté", { exact: true })).toBeVisible();
  expect(writes).toBe(0);
});

test("theme and reduced motion persist, and operating-system motion always wins", async ({ page, context }) => {
  await authenticate(context);
  await emptyControlResponses(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/settings");
  const preferences = page.locator("signal-preferences").first();
  const html = page.locator("html");

  await expect(html).toHaveAttribute("data-theme", "light");
  await preferences.getByRole("button", { name: "Thème clair", exact: true }).click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await preferences.getByRole("button", { name: "Réduire les animations", exact: true }).click();
  await expect(html).toHaveAttribute("data-motion", "off");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(html).toHaveAttribute("data-motion", "off");

  await preferences.getByRole("button", { name: "Réduire les animations", exact: true }).click();
  await expect(html).toHaveAttribute("data-reduced-motion", "false");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(html).toHaveAttribute("data-motion", "off");
  await page.reload();
  await expect(html).toHaveAttribute("data-motion", "off");
});

for (const width of [390, 768, 1440]) {
  test(`operator pages retain a contained canvas at ${width}px`, async ({ page, context }) => {
    await authenticate(context);
    await emptyControlResponses(page);
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/api/control/v1/tools", async (route) => route.fulfill({ json: TOOLS }));
    await page.route("**/api/control/v1/audit**", async (route) => route.fulfill({ json: [AUDIT] }));
    for (const route of ["/inspector", "/approvals", "/audit", "/policy", "/risk", "/settings", "/onboarding", "/admin"]) {
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const excess = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(excess, `${route} overflows the ${width}px viewport by ${excess}px`).toBeLessThanOrEqual(1);
      if (route === "/onboarding") {
        await page.getByRole("button", { name: "Suivant", exact: true }).click();
        const selected = page.getByRole("button", { name: "Utiliser un modèle", exact: true });
        await expect(selected).toHaveAttribute("aria-pressed", "true");
        for (const theme of ["light", "dark"]) {
          if (theme === "dark") {
            const themeButton = page.locator('signal-preferences [data-action="theme"]').first();
            const menu = page.getByRole("button", { name: "Menu", exact: true });
            const openMenu = !(await themeButton.isVisible());
            if (openMenu) await menu.click();
            await themeButton.click();
            if (openMenu) await menu.click();
          }
          await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
          // Measure the selected state, not interpolated colors during the theme transition.
          await selected.evaluate(async element => {
            await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => undefined)));
          });
          const contrast = await selected.evaluate(element => {
            const style = getComputedStyle(element);
            const luminance = (color: string) => {
              const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(value => {
                const channel = Number(value) / 255;
                return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
              });
              return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
            };
            const foreground = luminance(style.color);
            const background = luminance(style.backgroundColor);
            return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
          });
          expect(contrast, `onboarding step 2 ${theme} selected mode contrast`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
}
