import { expect, test } from "@playwright/test";

import releve from "../lib/generated/threat-rows.json";
import { THREAT_GLOSSARY } from "../lib/threat-glossary";

const TOTAL = THREAT_GLOSSARY.length;

test("no glossary line claims more AI Guard coverage than the generated coverage record", () => {
  // La colonne AI Guard est une revendication sur un contrôle de sécurité. Elle ne
  // peut pas être plus forte que la carte générée depuis les scénarios qui passent :
  // « Couvert » exige une facette publiée Bloqué, « Partiel » une facette qui ne soit
  // pas hors périmètre. Revendiquer moins que la carte reste permis.
  const lignes = new Map(releve.lignes.map((ligne) => [ligne.id, ligne.facettes.map((facette) => facette.mode)]));
  const ids = new Set<string>();
  const referenced = THREAT_GLOSSARY.filter((entry) => entry.releve);
  expect(referenced.length).toBeGreaterThan(15);
  for (const entry of THREAT_GLOSSARY) {
    expect(ids.has(entry.id), `duplicate id ${entry.id}`).toBe(false);
    ids.add(entry.id);
    if (!entry.releve) continue;
    const modes = lignes.get(entry.releve);
    expect(modes, `${entry.id} cites an unknown record line ${entry.releve}`).toBeDefined();
    if (entry.coverage === "yes") expect(modes, `${entry.id} claims Covered without a Blocked facet`).toContain("B");
    if (entry.coverage === "partial") {
      expect(modes!.some((mode) => mode !== "X"), `${entry.id} claims Partial on an out-of-scope line`).toBe(true);
    }
  }
});

test("the glossary table combines search, facets and sorting, expands rows and translates", async ({ page }) => {
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

  const table = page.getByRole("table");
  const rows = page.locator(".guard-glossary__row");
  const status = page.getByRole("status");
  const search = page.getByRole("searchbox", { name: "Rechercher une menace", exact: true });
  const uses = page.getByRole("group", { name: "Filtrer par usage IA", exact: true });
  const coverage = page.getByRole("group", { name: "Filtrer par couverture AI Guard", exact: true });

  await expect(rows).toHaveCount(TOTAL);
  await expect(status).toHaveText(`${TOTAL} menaces affichées sur ${TOTAL}`);
  await expect(table.getByRole("columnheader", { name: "AI Guard", exact: true })).toBeVisible();
  await expect(page.locator(".guard-glossary__group")).toHaveCount(13);
  await expect(uses.getByRole("button", { name: "Tous les usages", exact: true })).toHaveAttribute("aria-pressed", "true");
  for (const row of await rows.all()) await expect(row.locator(".guard-glossary__offer")).toHaveText(/^(SaaS|Conseil)/);
  // Les codes du relevé ne s'affichent qu'au détail, comme lien vers la preuve.
  await expect(rows.getByText(/\bM-\d{2}\b/)).toHaveCount(0);

  // La recherche ignore accents et casse, et les mots portent sur une même ligne.
  await search.fill("CODE GENERE VULNERABLE");
  await expect(rows).toHaveCount(1);
  await expect(rows.first().getByRole("rowheader")).toContainText("Code généré vulnérable");
  await uses.getByRole("button", { name: "Collaborateurs", exact: true }).click();
  await expect(rows).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Aucune menace trouvée", exact: true })).toBeVisible();
  await expect(status).toContainText("0");
  await page.locator(".guard-glossary__empty").getByRole("button", { name: "Réinitialiser les filtres", exact: true }).click();
  await expect(search).toHaveValue("");
  await expect(uses.getByRole("button", { name: "Tous les usages", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(rows).toHaveCount(TOTAL);

  // Les facettes se composent, et chaque compte est celui des données.
  const covered = THREAT_GLOSSARY.filter((entry) => entry.coverage === "yes");
  await expect(coverage.getByRole("button", { name: "Couvert", exact: true })).toContainText(String(covered.length));
  await coverage.getByRole("button", { name: "Couvert", exact: true }).click();
  await expect(rows).toHaveCount(covered.length);
  for (const row of await rows.all()) await expect(row.locator(".guard-glossary__offer")).toHaveText(/SaaS/);
  await page.getByRole("combobox", { name: "Catégorie", exact: true }).selectOption("agents");
  await expect(rows).toHaveCount(covered.filter((entry) => entry.category === "agents").length);
  await page.getByRole("button", { name: "Réinitialiser les filtres", exact: true }).click();
  await page.getByRole("combobox", { name: "Surface d’attaque", exact: true }).selectOption("people");
  await expect(rows).toHaveCount(THREAT_GLOSSARY.filter((entry) => entry.surface === "people").length);
  await page.getByRole("button", { name: "Réinitialiser les filtres", exact: true }).click();

  // Hors du tri par catégorie, les groupes disparaissent et chaque ligne dit la sienne.
  await page.getByRole("combobox", { name: "Trier par", exact: true }).selectOption("risk");
  await expect(page.locator(".guard-glossary__group")).toHaveCount(0);
  await expect(rows.first().locator(".guard-glossary__kicker")).toBeVisible();
  await page.getByRole("combobox", { name: "Trier par", exact: true }).selectOption("category");

  // Le détail s'ouvre sur place : définition, couverture, preuve, figure nommée.
  const rag = page.getByRole("button", { name: "Accès indu aux documents du RAG", exact: true });
  await expect(page.locator("#acces-rag-details")).toBeHidden();
  await rag.click();
  await expect(rag).toHaveAttribute("aria-expanded", "true");
  const details = page.locator("#acces-rag-details");
  await expect(details).toBeVisible();
  await expect(details.getByRole("heading", { name: "Exemple illustratif", exact: true })).toBeVisible();
  await expect(details.getByRole("heading", { name: /Ce que fait AI Guard · Non couvert/ })).toBeVisible();
  await expect(details.locator(".guard-glossary__source")).toHaveAttribute("href", /^https:\/\/genai\.owasp\.org\//);
  await expect(details.locator(".diag > title")).toHaveCount(1);
  await rag.click();
  await expect(details).toBeHidden();
  const indirect = page.getByRole("button", { name: "Injection de prompt indirecte", exact: true });
  await indirect.click();
  await expect(page.locator("#injection-de-prompt-details").getByRole("link", { name: /Relevé de couverture · M-02/ }))
    .toHaveAttribute("href", "/evidence#menaces");
  // Les marqueurs de flèche sont posés UNE fois pour le document, quel que soit le
  // nombre de figures ouvertes.
  await page.getByRole("button", { name: "Autonomie excessive", exact: true }).click();
  await expect(page.locator(".guard-glossary__details .diag")).toHaveCount(2);
  await expect(page.locator("marker#fx")).toHaveCount(1);
  await expect(page.locator("marker#ax")).toHaveCount(1);

  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(page.getByRole("heading", { name: "AI threat glossary", exact: true })).toBeVisible();
  await page.getByRole("group", { name: "Filter by AI use", exact: true })
    .getByRole("button", { name: "Data & weights", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search for a threat", exact: true }).fill("poisoning");
  const headers = rows.getByRole("rowheader");
  await expect(headers.filter({ hasText: "Training-data poisoning" })).toHaveCount(1);
  await expect(headers.filter({ hasText: "RAG poisoning" })).toHaveCount(1);
  // Même mot, mais un usage que le filtre écarte : les deux critères se composent.
  await expect(headers.filter({ hasText: "Tool poisoning and rug pull" })).toHaveCount(0);
  await expect(page.locator(".guard-glossary__scope a")).toHaveAttribute("href", "/evidence");
  expect(apiRequests).toBe(0);
});

test("a deep link opens the row it targets", async ({ page }) => {
  await page.goto("/menaces#code-vulnerable");
  await expect(page.getByRole("button", { name: "Code généré vulnérable", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#code-vulnerable-details")).toBeVisible();
  await expect(page.locator("#code-vulnerable-details .diag > title")).toHaveCount(1);
});

for (const width of [390, 768, 1440]) {
  test(`the glossary stays contained and usable in both languages at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/menaces");
    const rows = page.locator(".guard-glossary__row");
    await expect(rows).toHaveCount(TOTAL);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Sous 1024px, les lignes deviennent des fiches et l'en-tête de colonnes s'efface.
    await expect(page.getByRole("columnheader", { name: "Menace", exact: true })).toBeVisible({ visible: width > 1024 });
    await page.getByRole("group", { name: "Filtrer par usage IA", exact: true })
      .getByRole("button", { name: "AI scientist", exact: true }).click();
    await expect(page.locator("#empoisonnement")).toBeVisible();
    await page.getByRole("button", { name: "Empoisonnement des données d’entraînement", exact: true }).click();
    await expect(page.locator("#empoisonnement-details .diag")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "EN", exact: true }).click();
    await expect(page.getByRole("heading", { name: "AI threat glossary", exact: true })).toBeVisible();
    await expect(page.getByRole("searchbox", { name: "Search for a threat", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 390) {
      const first = await rows.nth(0).boundingBox();
      const second = await rows.nth(1).boundingBox();
      expect(second!.y).toBeGreaterThan(first!.y + first!.height - 1);
    }
  });
}
