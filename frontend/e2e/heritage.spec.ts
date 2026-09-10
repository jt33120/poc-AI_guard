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

test("the landing answers three questions in order, without connecting a service", async ({ page }) => {
  let apiRequests = 0;
  await page.route("**/api/**", async (route) => {
    apiRequests += 1;
    await route.fulfill({ status: 503, json: { detail: "No service call belongs to this illustration" } });
  });
  await page.goto("/");

  // 1. L'accueil. La scène reste illustrative, et le dit.
  await expect(page.getByText("Prototype en expérimentation", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Scénario illustratif · aucune action réelle", { exact: true })).toBeVisible();
  const examples = page.getByRole("group", { name: "Choisir un exemple", exact: true });
  await examples.getByRole("button", { name: "Du code", exact: true }).click();
  await expect(page.locator(".guard-scene")).toHaveAttribute("data-scenario", "code");
  await expect(page.getByText("Connexion à configurer", { exact: true })).toBeVisible();

  // 2. Le problème, groupé. Le défaut montre le haut du classement, pas le premier
  // maillon : un lecteur qui ne clique jamais doit voir ce qui coûte le plus.
  const groupes = page.getByRole("group", { name: "Choisir un maillon", exact: true });
  await expect(groupes.getByRole("button", { name: /Les plus coûteuses/ })).toHaveAttribute("aria-pressed", "true");
  const menaces = page.locator(".guard-threat");
  await expect(menaces).toHaveCount(5);
  await expect(menaces.first()).toContainText("Injection de prompts indirecte");
  await expect(menaces.first().locator(".diag")).toHaveCount(1);

  // Un maillon cliqué ne montre que ses menaces. C'est ce qui empêche la section de
  // dérouler les vingt-trois d'affilée.
  await groupes.getByRole("button", { name: /Le modèle/ }).click();
  await expect(page.locator(".guard-threat").first()).not.toContainText("Injection de prompts indirecte");
  await expect(page.locator(".guard-threat").count()).resolves.toBeLessThan(23);

  // La section ne revendique rien : aucun identifiant de relevé, aucun mode publié.
  await expect(page.locator("#menaces-accueil").getByText(/\bM-\d{2}\b/)).toHaveCount(0);

  // 3. L'aiguillage. Deux chemins, deux destinations différentes.
  const chemins = page.locator(".guard-path");
  await expect(chemins).toHaveCount(2);
  await expect(chemins.filter({ hasText: "Organisation" }).getByRole("link")).toHaveAttribute("href", /^mailto:/);
  await expect(chemins.filter({ hasText: "Développeur" }).getByRole("link")).toHaveAttribute("href", "/saas");

  expect(apiRequests).toBe(0);

  await page.getByRole("link", { name: "Périmètre & preuves", exact: true }).first().click();
  await expect(page).toHaveURL(/\/evidence$/);
  await expect(page.locator("#menaces .paysage .menace")).toHaveCount(23);
});

test("the self-serve page says what is included and how to start", async ({ page }) => {
  await page.goto("/");
  await page.locator(".guard-path").filter({ hasText: "Développeur" }).getByRole("link").click();
  await expect(page).toHaveURL(/\/saas$/);

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Encadrez vos agents");
  // Ce qui est inclus, et le guide : les deux blocs que la page doit porter.
  await expect(page.locator(".guard-included__list li")).toHaveCount(6);
  await expect(page.locator(".guard-start__steps li")).toHaveCount(4);
  await expect(page.locator(".guard-start__steps li").first()).toContainText("Créer le compte");

  // Le périmètre est dit sur la page qui vend, pas seulement sur celle qui prouve.
  await expect(page.getByText("n’est pas contrôlé", { exact: false })).toBeVisible();

  // La sortie mène à la création de compte, pas à un formulaire de contact : c'est
  // toute la différence entre ce chemin et celui du conseil.
  await expect(page.getByRole("link", { name: /Créer un compte/ }).first()).toHaveAttribute("href", "/signup");
});

for (const width of [390, 768, 1440]) {
  test(`the landing stays contained in French and English at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.getByRole("group", { name: "Choisir un maillon", exact: true })
      .getByRole("button", { name: /Ses actions/ })
      .click();
    await expect(page.locator(".guard-threat").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "EN", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Tell us about you.", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await page.goto("/saas");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
