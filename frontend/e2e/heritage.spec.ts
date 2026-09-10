import { expect, test } from "@playwright/test";
import { GUARD_COPY } from "../components/guard-copy";

function copyLeaves(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") return Object.values(value).flatMap(copyLeaves);
  return [];
}

test("the entire nested orientation copy stays illustrative, without invented coverage counts", () => {
  const coverage = /menace|ligne|facette|couvert|couvre|matrice|bloqu|threat|row|facet|cover|block/i;
  const number = /\d+|\b(?:dix-sept|dix-huit|dix-neuf|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|vingt|seventeen|eighteen|nineteen|two|three|four|five|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|twenty)\b/i;
  for (const language of ["fr", "en"] as const) {
    const phrases = copyLeaves(GUARD_COPY[language]);
    expect(phrases.length).toBeGreaterThan(50);
    for (const phrase of phrases) {
      expect(phrase.trim(), `${language}: an empty visible label`).not.toBe("");
      // Per-row proof belongs on /evidence, not in an illustrative route selector.
      expect(phrase, `${language}: an unbound evidence claim`).not.toMatch(/\bM-\d{2}\b|100\s*%/i);
      if (coverage.test(phrase)) expect(phrase, `${language}: hardcoded coverage count`).not.toMatch(number);
    }
  }
  expect(coverage.test("Huit menaces bloquées")).toBe(true);
  expect(number.test("Huit menaces bloquées")).toBe(true);
  expect(number.test("Une liste de menaces")).toBe(false);
});

test("the POC explains people, developers and confidential data without connecting a service", async ({ page }) => {
  let apiRequests = 0;
  await page.route("**/api/**", async (route) => {
    apiRequests += 1;
    await route.fulfill({ status: 503, json: { detail: "No service call belongs to this illustration" } });
  });
  await page.goto("/");
  await expect(page.getByText("Prototype en expérimentation", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Scénario illustratif · aucune action réelle", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /P1a/ })).toHaveCount(0);
  const examples = page.getByRole("group", { name: "Choisir un exemple", exact: true });
  await examples.getByRole("button", { name: "Du code", exact: true }).click();
  await expect(page.locator(".guard-scene")).toHaveAttribute("data-scenario", "code");
  await expect(page.getByText("Connexion à configurer", { exact: true })).toBeVisible();
  await examples.getByRole("button", { name: "Un document", exact: true }).click();
  await expect(page.getByText("Données à qualifier", { exact: true })).toBeVisible();

  const audiences = page.getByRole("group", { name: "Comment utilisez-vous l’IA ?", exact: true });
  await expect(audiences.getByRole("button", { name: "Collaborateurs", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("ChatGPT ou Claude dans un navigateur ne passent pas, par défaut, par AI Guard.", { exact: false })).toBeVisible();
  await audiences.getByRole("button", { name: "Développeurs", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Construire avec l’IA. Encadrer ce qu’elle peut faire.", exact: true })).toBeVisible();
  await expect(page.locator(".guard-route__destination").getByText("OpenAI · Claude", { exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "Dans votre infrastructure", exact: true }).check();
  await expect(page.locator(".guard-route__diagram")).toHaveAttribute("data-destination", "internal");
  await expect(page.getByText("Modèle open-weight", { exact: true })).toBeVisible();
  await audiences.getByRole("button", { name: "Données confidentielles", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Un document confidentiel mérite un chemin explicite.", exact: true })).toBeVisible();
  await expect(page.getByText("Un modèle hébergé en interne est une option d’architecture, pas une certification.", { exact: false })).toBeVisible();
  await expect(page.getByText("Ce choix ne connecte aucun service.", { exact: false })).toBeVisible();
  expect(apiRequests).toBe(0);

  await page.getByRole("link", { name: "Périmètre & preuves", exact: true }).first().click();
  await expect(page).toHaveURL(/\/evidence$/);
  await expect(page.locator("#menaces .paysage .menace")).toHaveCount(23);
});

for (const width of [390, 768, 1440]) {
  test(`the use-case landing stays contained in French and English at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "Données confidentielles", exact: true }).click();
    await page.getByRole("radio", { name: "Dans votre infrastructure", exact: true }).check();
    await expect(page.getByText("Modèle open-weight", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "EN", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Confidential documents need an explicit path.", exact: true })).toBeVisible();
    await expect(page.getByText("Open-weight model", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
