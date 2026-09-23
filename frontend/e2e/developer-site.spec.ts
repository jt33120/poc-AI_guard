import { expect, test } from "@playwright/test";

import coverage from "../lib/generated/product-coverage.json";

test("the developer journey states its boundary and simulates three local decisions", async ({ page }) => {
  let apiRequests = 0;
  await page.route("**/api/**", async (route) => {
    apiRequests += 1;
    await route.fulfill({ status: 503, json: { detail: "No service is used by the public simulation" } });
  });
  await page.goto("/developpeurs");
  await expect(page.getByRole("heading", { level: 1, name: "Vos agents codent. Vos règles restent les vôtres." })).toBeVisible();
  await expect(page.getByText("Éditeur français · implémentation locale validée · pilote administré à qualifier", { exact: true })).toBeVisible();
  const scenario = page.getByTestId("developer-scenario");
  await expect(scenario.getByText("SIMULATION · DONNÉES SYNTHÉTIQUES", { exact: true })).toBeVisible();
  await scenario.getByRole("button", { name: "Action destructive", exact: true }).click();
  await scenario.getByRole("button", { name: "Équipe", exact: true }).click();
  await expect(scenario.getByText("Validation unique requise", { exact: true })).toBeVisible();
  await scenario.getByRole("button", { name: "Instruction réseau induite", exact: true }).click();
  await scenario.getByRole("button", { name: "Renforcé", exact: true }).click();
  await expect(scenario.getByText("Destination interdite même si le runner est coupé", { exact: true })).toBeVisible();
  expect(apiRequests).toBe(0);
});

test("security page renders the generated 77-threat register and honest evidence modes", async ({ page }) => {
  await page.goto("/developpeurs/securite");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Savoir où la décision est prise");
  const explorer = page.getByTestId("developer-coverage");
  await expect(explorer.getByRole("status")).toContainText(`${coverage.threats.length} / ${coverage.threats.length}`);
  await explorer.getByLabel("Mode de preuve").selectOption("B");
  await expect(explorer.locator(".developer-coverage__entry")).toHaveCount(Math.min(8, coverage.threats.filter((entry) => entry.mode === "B").length));
  await explorer.getByLabel("Assistant").selectOption("claude");
  await expect(explorer.locator(".developer-coverage__entry")).toHaveCount(Math.min(8, coverage.threats.filter((entry) => entry.mode === "B" && entry.hosts.some((host) => host.assistant === "claude")).length));
  await expect(page.getByText("Un administrateur local peut retirer un contrôle utilisateur.", { exact: true })).toBeVisible();
});

test("the same offers lead to free installation or a qualified pilot without checkout", async ({ page }) => {
  for (const path of ["/", "/produits", "/developpeurs", "/developpeurs/tarifs"]) {
    await page.goto(path);
    const local = page.locator('[data-offer="local"]');
    const team = page.locator('[data-offer="team"]');
    await expect(local).toContainText("sans limite de durée");
    await expect(local.getByRole("link")).toHaveAttribute("href", "/extension");
    await expect(team).toContainText("24 €");
    await expect(team).toContainText("Jusqu’à 10 postes");
    await expect(team).toContainText("aucun prélèvement automatique");
    await expect(team.getByRole("link")).toHaveAttribute("href", /^mailto:julian.talou@xsom.fr/);
    await expect(page.locator('[data-offer="reinforced"]')).toContainText("49 €");
  }
  await page.getByText("Que se passe-t-il après les 90 jours ?", { exact: true }).click();
  await expect(page.getByText(/ni retrait du scanner local gratuit/)).toBeVisible();
});

test("trust page names xSOM as the accountable publisher without making an absolute security claim", async ({ page }) => {
  await page.goto("/developpeurs/confiance");
  await expect(page.getByTestId("developer-trust").getByRole("heading", { level: 1 })).toContainText("Un produit de sécurité doit aussi avoir un responsable.");
  await expect(page.getByText("XSOM CONSULTING SASU · ÉDITEUR FRANÇAIS", { exact: true })).toBeVisible();
  await expect(page.getByText("Aucune détection de menace n’est exhaustive.", { exact: true })).toBeVisible();
  await expect(page.getByText(/Projets de travail v0.1/)).toBeVisible();
  for (const link of await page.locator('a[href^="/contracts/"]').all()) {
    const response = await page.request.get((await link.getAttribute("href"))!);
    expect(response.ok()).toBe(true);
    expect(await response.text()).toContain("Version de travail");
  }
  await expect(page.getByRole("link", { name: "Demander le dossier xSOM" })).toHaveAttribute("href", /mailto:julian.talou@xsom.fr/);
});

test("developer pages switch language and remain contained at target widths", async ({ page }) => {
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/developpeurs", "/developpeurs/securite", "/developpeurs/tarifs", "/developpeurs/confiance"]) {
      await page.goto(path);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.locator("main h1")).toBeVisible();
    }
  }
  await page.goto("/developpeurs");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your agents code. Your rules stay yours." })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("reduced motion keeps developer content visible", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/developpeurs");
  await expect(page.getByTestId("developer-scenario")).toBeVisible();
  await expect(page.locator(".developer-levels article")).toHaveCount(3);
});
