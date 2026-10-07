import { expect, test } from "@playwright/test";

/**
 * Trois adresses publiques, un seul déploiement (`lib/sites.ts`). L'en-tête `Host`
 * simule chaque adresse ; les redirections sont lues sans être suivies.
 */
const cases: [host: string, path: string, status: number, location?: string][] = [
  ["fleet.xsom.fr", "/", 200],
  ["fleet.xsom.fr", "/fleet", 308, "https://fleet.xsom.fr/"],
  ["fleet.xsom.fr", "/login?next=%2Fhome", 308, "https://ai.xsom.fr/login?next=%2Fhome"],
  ["fleet.xsom.fr", "/mentions-legales", 200],
  ["guard.xsom.fr", "/", 200],
  ["guard.xsom.fr", "/secret-guard", 308, "https://guard.xsom.fr/"],
  ["guard.xsom.fr", "/produits", 308, "https://ai.xsom.fr/produits"],
  ["guard.xsom.fr", "/login", 200],
  ["ai.xsom.fr", "/", 200],
  ["ai.xsom.fr", "/secret-guard?ref=nav", 308, "https://guard.xsom.fr/?ref=nav"],
  ["ai.xsom.fr", "/fleet", 308, "https://fleet.xsom.fr/"],
  ["ai.xsom.fr", "/menaces", 200],
];

for (const [host, path, status, location] of cases) {
  test(`${host}${path} → ${status}`, async ({ request }) => {
    const response = await request.get(path, { headers: { host }, maxRedirects: 0 });
    expect(response.status()).toBe(status);
    if (location) expect(response.headers().location).toBe(location);
  });
}

test("fleet.xsom.fr shows the Fleet page at its root", async ({ request }) => {
  const response = await request.get("/", { headers: { host: "fleet.xsom.fr" } });
  expect(await response.text()).toContain("à l’échelle de toute l’entreprise");
});

test("guard.xsom.fr shows Secret Guard at its root", async ({ request }) => {
  const response = await request.get("/", { headers: { host: "guard.xsom.fr" } });
  expect(await response.text()).toContain("Sans exposer vos secrets.");
});

test("the Fleet page fits a phone screen", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/fleet");
  await expect(page.locator("h1")).toContainText("à l’échelle de toute l’entreprise");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
