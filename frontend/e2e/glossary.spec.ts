import { expect, test } from "@playwright/test";

test("the glossary combines local search and use filters, resets both and translates", async ({ page }) => {
  let apiRequests = 0;
  await page.route("**/api/**", async (route) => {
    apiRequests += 1;
    await route.fulfill({ status: 503, json: { detail: "Public definitions are local content" } });
  });
  await page.goto("/");
  await page.getByRole("navigation", { name: "Navigation principale" })
    .getByRole("link", { name: "Les menaces cyber IA", exact: true }).click();
  await expect(page).toHaveURL(/\/menaces$/);
  await expect(page.getByRole("heading", { name: "Glossaire des menaces IA", exact: true })).toBeVisible();

  const cards = page.locator(".guard-glossary__card");
  const search = page.getByRole("searchbox", { name: "Rechercher une menace", exact: true });
  const filters = page.getByRole("group", { name: "Filtrer par usage IA", exact: true });
  await expect(cards).toHaveCount(8);
  await expect(filters.getByRole("button", { name: "Tous les usages", exact: true })).toHaveAttribute("aria-pressed", "true");
  for (const card of await cards.all()) {
    await expect(card.getByRole("heading", { name: "Exemple illustratif", exact: true })).toBeVisible();
    await expect(card.locator(".guard-glossary__source")).toHaveAttribute("href", /^https:\/\/genai\.owasp\.org\//);
  }
  await expect(cards.getByText(/\bM-\d{2}\b/)).toHaveCount(0);

  // Chaque fiche explique son mécanisme par une figure, et chaque figure porte son
  // nom accessible. Les marqueurs de flèche sont posés UNE fois pour le document :
  // un jeu par fiche produirait huit `id` identiques et un rendu qui dépend de
  // l'ordre de lecture.
  await expect(page.locator(".guard-glossary__card .diag")).toHaveCount(8);
  await expect(page.locator("marker#fx")).toHaveCount(1);
  await expect(page.locator("marker#ax")).toHaveCount(1);
  for (const card of await cards.all()) {
    await expect(card.locator(".diag > title")).toHaveCount(1);
  }

  // La recherche ignore accents et casse, et les mots portent sur une même fiche.
  await search.fill("CODE GENERE");
  await expect(cards).toHaveCount(1);
  await expect(cards.first().getByRole("heading", { level: 2 })).toHaveText("Code généré vulnérable");
  await filters.getByRole("button", { name: "Collaborateurs", exact: true }).click();
  await expect(cards).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Aucune définition trouvée", exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("0");

  await page.locator(".guard-glossary__empty").getByRole("button", { name: "Réinitialiser les filtres", exact: true }).click();
  await expect(search).toHaveValue("");
  await expect(filters.getByRole("button", { name: "Tous les usages", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(cards).toHaveCount(8);
  await filters.getByRole("button", { name: "Collaborateurs", exact: true }).click();
  expect(await cards.count()).toBeLessThan(8);
  expect(await cards.count()).toBeGreaterThan(0);
  for (const card of await cards.all()) await expect(card.locator(".guard-glossary__tags")).toContainText("Collaborateurs");
  await expect(page.locator("#code-vulnerable")).toHaveCount(0);

  await page.getByRole("button", { name: "Réinitialiser les filtres", exact: true }).click();
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(page.getByRole("heading", { name: "AI threat glossary", exact: true })).toBeVisible();
  await page.getByRole("group", { name: "Filter by AI use", exact: true })
    .getByRole("button", { name: "Models & data", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search for a threat", exact: true }).fill("poisoning");
  await expect(cards).toHaveCount(1);
  await expect(cards.first().getByRole("heading", { level: 2 })).toHaveText("Data or model poisoning");
  await expect(page.locator(".guard-glossary__scope a")).toHaveAttribute("href", "/evidence");
  expect(apiRequests).toBe(0);
});

for (const width of [390, 768, 1440]) {
  test(`the glossary stays contained and usable in both languages at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/menaces");
    await expect(page.locator(".guard-glossary__card")).toHaveCount(8);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("group", { name: "Filtrer par usage IA", exact: true })
      .getByRole("button", { name: "Modèles & données", exact: true }).click();
    await expect(page.locator("#empoisonnement")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "EN", exact: true }).click();
    await expect(page.getByRole("heading", { name: "AI threat glossary", exact: true })).toBeVisible();
    await expect(page.getByRole("searchbox", { name: "Search for a threat", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 390) {
      const cards = page.locator(".guard-glossary__card");
      const first = await cards.nth(0).boundingBox();
      const second = await cards.nth(1).boundingBox();
      expect(second!.y).toBeGreaterThan(first!.y);
    }
  });
}
