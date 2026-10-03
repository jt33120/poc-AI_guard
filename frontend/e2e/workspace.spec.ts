import { expect, test, type Page } from "@playwright/test";
import { mockWorkspace, WORKSPACE } from "./workspace-fixture";

async function prepare(page: Page) {
  await page.context().addCookies([{ name: "xsom_e2e", value: "1", url: "http://127.0.0.1:3100" }]);
  await page.route("**/api/control/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = path.endsWith("/workspace") ? WORKSPACE : path.endsWith("/agents") ? { customer: "xSOM", agents: [] } : path.endsWith("/events") ? { events: [], next_before: null } : [];
    return route.fulfill({ json: body });
  });
}

test("organization and identity persist across distinct product workspaces", async ({ page }) => {
  await prepare(page);
  await page.goto("/home");
  await expect(page.getByRole("heading", { name: "Votre espace xSOM" })).toBeVisible();
  await expect(page.locator(".workspace-organization")).toContainText("xSOM");
  await page.getByLabel("Mon compte", { exact: true }).click();
  await expect(page.locator(".workspace-account-panel")).toContainText("admin@example.test");
  await page.keyboard.press("Escape");
  await expect(page.locator(".workspace-account")).not.toHaveAttribute("open");
  await page.getByRole("link", { name: "Ouvrir Dev Guard", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Dev Guard", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Agent Guard", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Postes de l’équipe", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Postes de l’équipe", level: 1 })).toBeVisible();
  await page.locator(".workspace-product-switch").filter({ hasText: "Agent Guard" }).click();
  await expect(page).toHaveURL(/\/ai-guard$/);
  await expect(page.getByRole("navigation", { name: "Agent Guard", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Dev Guard", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Mes abonnements", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Mes abonnements", level: 1 })).toBeVisible();
  await expect(page.locator("#secret_guard")).toContainText("Dogfooding");
  await expect(page.locator("#ai_guard")).toContainText("Dogfooding");
  await expect(page.getByText("Abonnement actif", { exact: true })).toHaveCount(0);
});

test("unsubscribed product remains discoverable and direct URLs do not load its data", async ({ page }) => {
  await prepare(page);
  await mockWorkspace(page, { ...WORKSPACE, subscriptions: WORKSPACE.subscriptions.map((s) => s.product === "secret_guard" ? { ...s, status: "not_subscribed", edition: null } : s) });
  const dataRequests: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/api/control/v1/extensions")) dataRequests.push(r.url()); });
  await page.goto("/extensions/activity");
  await expect(page.getByRole("heading", { name: "Non souscrit", level: 1 })).toBeVisible();
  expect(dataRequests).toHaveLength(0);
  await expect(page.locator(".workspace-product-switch").filter({ hasText: "Dev Guard" })).toContainText("Non souscrit");
  await page.getByRole("link", { name: "Voir mes abonnements" }).click();
  await expect(page).toHaveURL(/\/subscriptions#secret_guard$/);
  await expect(page.locator("#secret_guard")).toContainText("Non souscrit");
  await expect(page.locator("#ai_guard").getByRole("link", { name: "Ouvrir Agent Guard" })).toBeVisible();
});

test("unavailable rights stay unknown and can be retried", async ({ page }) => {
  await prepare(page);
  let failing = true;
  await page.route("**/api/control/v1/workspace", (route) => route.fulfill(failing ? { status: 503, json: {} } : { json: WORKSPACE }));
  await page.goto("/extensions");
  await expect(page.getByRole("heading", { name: "Les accès sont indisponibles" })).toBeVisible();
  failing = false;
  await page.getByRole("button", { name: "Réessayer", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Votre équipe, ses protections" })).toBeVisible();
});

test("each approval page requests its own product queue", async ({ page }) => {
  await prepare(page);
  const sources: string[] = [];
  await page.route("**/api/control/v1/approvals?*", (route) => {
    sources.push(new URL(route.request().url()).searchParams.get("product") ?? "missing");
    return route.fulfill({ json: [] });
  });
  await page.goto("/extensions/approvals");
  await expect(page.getByRole("heading", { name: "Approbations de l’équipe" })).toBeVisible();
  await expect.poll(() => sources.length).toBeGreaterThan(0);
  expect(sources.every((s) => s === "secret_guard")).toBe(true);
  sources.length = 0;
  await page.goto("/approvals");
  await expect(page.getByRole("heading", { name: "Approbations des agents" })).toBeVisible();
  await expect.poll(() => sources.length).toBeGreaterThan(0);
  expect(sources.every((s) => s === "ai_guard")).toBe(true);
});

for (const width of [390, 768, 1440]) {
  test(`workspace layouts and keyboard navigation at ${width}px`, async ({ page }, testInfo) => {
    await prepare(page);
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    for (const [path, title] of [["/home", "Votre espace xSOM"], ["/subscriptions", "Mes abonnements"], ["/extensions", "Votre équipe, ses protections"]]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
      await expect(page.locator(".workspace-organization")).toContainText("xSOM");
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${path.slice(1)}-${width}.png`), fullPage: true });
    }
    if (width < 1024) {
      await page.getByRole("button", { name: "Ouvrir le menu" }).click();
      await expect(page.getByRole("navigation", { name: "Dev Guard", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "Ouvrir le menu" })).toBeFocused();
      await expect(page.getByRole("navigation", { name: "Dev Guard", exact: true })).not.toBeVisible();
    }
    expect(errors).toEqual([]);
  });
}
