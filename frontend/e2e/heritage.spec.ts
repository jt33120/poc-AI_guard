import { expect, test } from "@playwright/test";
import { GUARD_COPY } from "../components/guard-copy";
import { GUARD_HOME_COPY } from "../components/guard-home-copy";

function copyLeaves(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") return Object.values(value).flatMap(copyLeaves);
  return [];
}

test("the entire nested orientation copy stays illustrative, without invented coverage counts", () => {
  const coverage = /menace|ligne|facette|couvert|couvre|matrice|bloqu|threat|row|facet|cover|block/i;
  const number = /\d+|\b(?:dix-sept|dix-huit|dix-neuf|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|vingt|seventeen|eighteen|nineteen|two|three|four|five|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|twenty)\b/i;
  for (const language of ["fr", "en"] as const) {
    const phrases = copyLeaves([GUARD_COPY[language], GUARD_HOME_COPY[language]]);
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

test("the landing explains AI uses, introduces the extension and keeps both next steps", async ({ page }) => {
  let apiRequests = 0;
  await page.route("**/api/**", async (route) => {
    apiRequests += 1;
    await route.fulfill({ status: 503, json: { detail: "No service call belongs to this illustration" } });
  });
  await page.goto("/");

  // Le parcours présente les usages, puis les produits, puis les deux suites.
  await expect(page.getByText("Prototype en expérimentation", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".guard-masthead")).toBeVisible();
  await expect(page.locator("#usages .guard-campus")).toBeVisible();
  await expect(page.locator("#menaces-accueil")).toHaveCount(0);
  expect(await page.locator(".guard-masthead, #usages, #produits, #vous").evaluateAll(
    (sections) => sections.map((section) => section.classList.contains("guard-masthead") ? "masthead" : section.id),
  )).toEqual(["masthead", "usages", "produits", "vous"]);

  const navigation = page.getByRole("navigation", { name: "Navigation principale" });
  await expect(navigation.getByRole("link", { name: "Nos usages", exact: true })).toHaveAttribute("href", "#usages");
  await expect(navigation.getByRole("link", { name: "Nos produits", exact: true })).toHaveAttribute("href", "#produits");
  await expect(navigation.getByRole("link", { name: "Glossaire", exact: true })).toHaveAttribute("href", "/menaces");

  const produits = page.locator("#produits");
  await expect(produits.getByRole("heading", { name: "AI Guard pour VS Code", exact: true })).toBeVisible();
  await expect(produits.getByRole("link").first()).toHaveAttribute("href", "/extension");
  await expect(produits.locator('a[href="/saas"]')).toHaveCount(1);

  const chemins = page.locator("#vous .guard-path");
  await expect(chemins).toHaveCount(2);
  await expect(chemins.filter({ hasText: "Organisation" }).getByRole("link")).toHaveAttribute("href", /^mailto:/);
  await expect(chemins.filter({ hasText: "Développeur" }).getByRole("link")).toHaveAttribute("href", "/saas");

  expect(apiRequests).toBe(0);

  await page.getByRole("link", { name: "Périmètre & preuves", exact: true }).first().click();
  await expect(page).toHaveURL(/\/evidence$/);
  await expect(page.locator("#menaces .paysage .menace")).toHaveCount(23);
});

test("the campus switches risks and universes with a keyboard, without service calls", async ({ page }) => {
  let apiRequests = 0;
  await page.route("**/api/**", async (route) => {
    apiRequests += 1;
    await route.fulfill({ status: 503, json: { detail: "Illustrative campus only" } });
  });
  await page.goto("/");
  const usages = page.locator("#usages");
  const toggle = usages.getByRole("switch", { name: "Afficher les risques", exact: true });
  const universes = usages.getByRole("group", { name: "Choisir un univers IA", exact: true });
  const detail = page.locator("#campus-detail");
  const risks = usages.locator(".guard-campus__risk-label:visible");

  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(risks).toHaveCount(0);
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(risks).toHaveCount(3);

  const contentByUniverse = new Set<string>();
  for (const name of ["Développement", "Collaborateurs", "Modèles & données"]) {
    const choice = universes.getByRole("button", { name, exact: true });
    await choice.focus();
    await page.keyboard.press("Enter");
    await expect(choice).toHaveAttribute("aria-pressed", "true");
    await expect(universes.locator('[aria-pressed="true"]')).toHaveCount(1);
    await expect(detail).toContainText(name);
    await expect(detail.locator(".guard-campus__risks li")).toHaveCount(3);
    await expect(detail.getByText("Le rôle des contrôles", { exact: true })).toBeVisible();
    await expect(detail.locator(".guard-campus__safeguards li")).toHaveCount(3);
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    contentByUniverse.add((await detail.innerText()).trim());
  }
  expect(contentByUniverse.size).toBe(3);

  // Les repères posés sur le bâtiment pilotent la même sélection que la liste.
  const pins = usages.locator(".guard-campus__annotations");
  for (const name of ["Collaborateurs", "Modèles & données", "Développement"]) {
    const pin = pins.getByRole("button", { name, exact: true });
    await pin.click();
    await expect(pin).toHaveAttribute("aria-pressed", "true");
    await expect(pins.locator('[aria-pressed="true"]')).toHaveCount(1);
    await expect(universes.getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(detail.getByRole("heading", { name, exact: true })).toBeVisible();
  }

  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(risks).toHaveCount(0);
  expect(apiRequests).toBe(0);
});

test("the hero respects reduced motion without downloading its video", async ({ page }) => {
  const videoRequests: string[] = [];
  await page.emulateMedia({ reducedMotion: "reduce" });
  page.on("request", (request) => {
    if (/ai-guard-hero-v2\.webm(?:\?|$)/.test(request.url())) videoRequests.push(request.url());
  });
  await page.goto("/");
  const video = page.locator(".guard-masthead__video");
  await expect(video).toBeVisible();
  await expect(video).toHaveAttribute("poster", "/signal-media/ai-guard-hero-v2.png");
  await expect(video).toHaveAttribute("preload", "none");
  await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).paused)).toBe(true);
  await expect(video).not.toHaveAttribute("src", /\S/);
  expect(videoRequests).toEqual([]);
});

test("the self-serve page says what the product does, and where that stops", async ({ page }) => {
  await page.goto("/");
  await page.locator(".guard-path").filter({ hasText: "Développeur" }).getByRole("link").click();
  await expect(page).toHaveURL(/\/saas$/);

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Encadrez vos agents");

  // L'inventaire : six familles, et chacune porte des lignes concrètes. Le compte
  // par famille est ce qui distingue cette page de celle d'avant, qui tenait en six
  // phrases vagues — sans lui, six titres vides passeraient le test.
  const familles = page.locator(".guard-included__list > li");
  await expect(familles).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    await expect(familles.nth(i).locator("ul > li").count()).resolves.toBeGreaterThanOrEqual(4);
  }
  await expect(familles.first()).toContainText("Juge LLM sur les seuls cas ambigus");

  // La nuance que l'inventaire ne porte pas vit sur la page qui la prouve.
  await expect(page.locator(".guard-included").getByRole("link")).toHaveAttribute("href", "/evidence");

  // La borne, et c'est la raison d'être de cette section : la passerelle
  // contraignante ne s'obtient pas en s'inscrivant. La page le dit, et elle donne
  // la porte — un courriel, comme le chemin du conseil.
  const passerelle = page.locator(".guard-gateway");
  await expect(passerelle).toContainText("accès direct à la base");
  await expect(passerelle.getByRole("link")).toHaveAttribute("href", /^mailto:/);

  // Le geste « Brancher » décrit les deux voies qu'un inscrit obtient vraiment.
  // Promettre la passerelle ici apprendrait à faire ce qui ne marchera pas.
  const brancher = page.locator(".guard-start__steps li").nth(2);
  await expect(brancher).toContainText("adresse de base");
  await expect(brancher).not.toContainText("passerelle");

  await expect(page.locator(".guard-start__steps li")).toHaveCount(4);
  await expect(page.locator(".guard-start__steps li").first()).toContainText("Créer le compte");

  // Le périmètre est dit sur la page qui vend, pas seulement sur celle qui prouve.
  await expect(page.getByText("n’est pas contrôlé", { exact: false })).toBeVisible();

  // La sortie mène à la création de compte, pas à un formulaire de contact : c'est
  // toute la différence entre ce chemin et celui du conseil.
  await expect(page.getByRole("link", { name: /Créer un compte/ }).first()).toHaveAttribute("href", "/signup");
});

test("the extension page hands over a file that installs, and names its limits", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: "Extension", exact: true }).click();
  await expect(page).toHaveURL(/\/extension$/);

  // Le bouton est le produit de cette page. Un lien relatif ou un chemin de
  // release daté ne tiendrait pas d'une version à l'autre : le nom d'asset est
  // fixe, et c'est ce qui rend `latest/download` utilisable comme lien permanent.
  const telecharger = page.getByRole("link", { name: /Télécharger l’extension/ });
  await expect(telecharger).toHaveAttribute(
    "href",
    "https://github.com/jt33120/poc-AI_guard/releases/latest/download/xsom-secret-guard-vscode.vsix",
  );

  // Trois gestes, et le deuxième dit comment on installe un VSIX. Sans lui, la
  // page rendrait un fichier sans mode d'emploi.
  const gestes = page.locator(".guard-start__steps li");
  await expect(gestes).toHaveCount(3);
  await expect(gestes.nth(1)).toContainText("VSIX");

  // Une installation, quatre assistants : c'est l'argument, il doit être vérifiable.
  await expect(page.locator(".guard-ext-hosts li")).toHaveCount(4);

  // Les quatre bornes. Celle de la version est la plus facile à taire, et c'est
  // celle qui fait échouer une installation par ailleurs correcte : le premier
  // lecteur de la page s'est arrêté là, en 1.133, avec le bon fichier et la
  // bonne commande. Les deux planchers sont donc tenus tous les deux, parce que
  // ne nommer que 1.137 laissait croire qu'on installe quand même en 1.133 pour
  // couvrir les trois autres assistants.
  const bornes = page.locator(".guard-ext-limits li");
  await expect(bornes).toHaveCount(4);
  await expect(bornes.nth(1)).toContainText("1.136");
  await expect(bornes.nth(1)).toContainText("1.137");
  await expect(page.getByText("est un indicateur", { exact: false })).toBeVisible();

  // Tant que la fiche n'existe pas, la page ne propose pas de l'ouvrir.
  await expect(page.getByRole("link", { name: /Installer depuis VS Code/ })).toHaveCount(0);
  await expect(page.getByText("compte éditeur", { exact: false })).toBeVisible();
});

for (const width of [390, 768, 1440]) {
  test(`the landing stays contained in French and English at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.getByRole("group", { name: "Choisir un univers IA", exact: true })
      .getByRole("button", { name: "Modèles & données", exact: true })
      .click();
    await page.getByRole("switch", { name: "Afficher les risques", exact: true }).click();
    await expect(page.locator(".guard-campus__risk-label:visible")).toHaveCount(3);
    await expect(page.locator("#campus-detail")).toContainText("Modèles & données");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "EN", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Tell us about you.", exact: true })).toBeVisible();
    await expect(page.locator("#campus-detail")).not.toContainText("Modèles & données");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await page.goto("/saas");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    if (width === 390) {
      // Une grille à quatre colonnes tient dans 390 px sans déborder : le contrôle
      // de débordement ci-dessus la laisse passer, à deux mots par ligne. Ce qu'on
      // veut, c'est qu'elle soit EMPILÉE, et deux étapes empilées ne partagent pas
      // la même ordonnée. (C'est ce qui manquait quand la requête de média perdait
      // en spécificité contre sa propre règle de base.)
      const etapes = page.locator(".guard-start__steps li");
      const premiere = await etapes.nth(0).boundingBox();
      const seconde = await etapes.nth(1).boundingBox();
      expect(seconde!.y).toBeGreaterThan(premiere!.y);
    }

    await page.goto("/extension");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
