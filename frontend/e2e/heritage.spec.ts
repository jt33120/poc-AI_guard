import { expect, test } from "@playwright/test";
import { GUARD_COPY } from "../components/guard-copy";
import { GUARD_HOME_COPY } from "../components/guard-home-copy";
import { HOME_COPY } from "../components/home/home-copy";
import { SECRET_GUARD_COPY } from "../components/secret-guard/secret-guard-copy";
import { THREAT_GLOSSARY } from "../lib/threat-glossary";

function copyLeaves(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") return Object.values(value).flatMap(copyLeaves);
  return [];
}

test("the entire nested orientation copy stays illustrative, without invented coverage counts", () => {
  // En début de mot (lettres accentuées comprises) : « découverte » et « discovery »
  // ne parlent pas de couverture.
  const coverage = /(?<!\p{L})(?:menace|ligne|facette|couvert|couvre|matrice|bloqu|threat|row|facet|cover|block)/iu;
  const number = /\d+|\b(?:dix-sept|dix-huit|dix-neuf|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|vingt|seventeen|eighteen|nineteen|two|three|four|five|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|twenty)\b/i;
  for (const language of ["fr", "en"] as const) {
    const phrases = copyLeaves([GUARD_COPY[language], GUARD_HOME_COPY[language], HOME_COPY[language], SECRET_GUARD_COPY[language]]);
    expect(phrases.length).toBeGreaterThan(50);
    for (const phrase of phrases) {
      expect(phrase.trim(), `${language}: an empty visible label`).not.toBe("");
      // Per-row proof never belongs in an illustrative route selector.
      expect(phrase, `${language}: an unbound evidence claim`).not.toMatch(/\bM-\d{2}\b|100\s*%/i);
      if (coverage.test(phrase)) expect(phrase, `${language}: hardcoded coverage count`).not.toMatch(number);
    }
  }
  expect(coverage.test("Huit menaces bloquées")).toBe(true);
  expect(number.test("Huit menaces bloquées")).toBe(true);
  expect(number.test("Une liste de menaces")).toBe(false);
  expect(coverage.test("90 jours de découverte offerts")).toBe(false);
});

test("the landing explains AI uses, introduces the extension and keeps both next steps", async ({ page }) => {
  let apiRequests = 0;
  await page.route("**/api/**", async (route) => {
    apiRequests += 1;
    await route.fulfill({ status: 503, json: { detail: "No service call belongs to this illustration" } });
  });
  await page.goto("/");

  // Le parcours : le film, les équipes, les trois façons d'avancer, Secret Guard.
  await expect(page.locator("#home-film video")).toBeVisible();
  // L'illustration est chargée à l'approche, comme toute image sous la ligne de flottaison.
  const campus = page.locator(".home-campus__image");
  await campus.scrollIntoViewIfNeeded();
  await campus.evaluate(async (image: HTMLImageElement) => {
    await image.decode();
    if (!image.naturalWidth) throw new Error("Campus illustration failed to load");
  });
  expect(await page.locator("main > section").evaluateAll(
    (sections) => sections.map((section) => section.id || section.className),
  )).toEqual(["home-film", "usages", "offres", "secret-guard"]);

  // Le menu expose les produits, les besoins cyber et le cabinet, puis la porte de
  // découverte des solutions xSOM.
  const navigation = page.getByRole("navigation", { name: "Navigation principale" });
  await expect(navigation.getByRole("link")).toHaveCount(3);
  await expect(navigation.getByRole("link", { name: "Nos Produits", exact: true })).toHaveAttribute("href", "/produits");
  await expect(navigation.getByRole("link", { name: "Vos besoins", exact: true })).toHaveAttribute("href", "/menaces");
  await expect(navigation.getByRole("link", { name: /Nos conseils/ })).toHaveAttribute("href", "https://www.xsom.fr");

  // Le film porte ses propres commandes, lecture et son, à la place des contrôles natifs.
  const film = page.locator("#home-film");
  expect(await film.locator("video").getAttribute("controls")).toBeNull();
  await expect(film.getByRole("button", { name: "Activer le son", exact: true })).toBeVisible();

  // Secret Guard se montre par une capture réelle dans VS Code.
  await expect(page.locator("#secret-guard .home-laptop__window img")).toHaveAttribute("src", /secret-guard-vscode/);
  await expect(page.locator("#secret-guard .home-sg__hosts li")).toHaveText(["GitHub Copilot", "Claude Code", "Codex"]);

  expect(apiRequests).toBe(0);

});

test("the products page opens on its film, then shows each product in a carousel", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Navigation principale" })
    .getByRole("link", { name: "Nos Produits", exact: true }).click();
  await expect(page).toHaveURL(/\/produits$/);

  // Le film de la gamme, avec ses propres commandes, et une invitation à descendre
  // vers le carrousel. Il ne nomme aucun produit : la gamme va s'agrandir.
  const film = page.locator("#home-film");
  await expect(film.locator("video")).toHaveAttribute("src", /xsom-products-v2-fr\.mp4$/);
  expect(await film.locator("video").getAttribute("controls")).toBeNull();
  expect(await film.locator("video").getAttribute("aria-label")).not.toMatch(/Secret Guard|AI Guard/);
  await expect(film.getByRole("link", { name: "Découvrir" })).toHaveAttribute("href", "#gamme");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("du poste à l’infrastructure");

  // Une diapositive par produit, chacune avec sa porte d'entrée.
  const carousel = page.getByRole("region", { name: "Nos produits" });
  const slides = carousel.locator(".xp-slide");
  await expect(slides).toHaveCount(2);
  await expect(slides.nth(0).getByRole("heading", { name: "Secret Guard", exact: true })).toBeAttached();
  await expect(slides.nth(0).getByRole("link", { name: "Découvrir Secret Guard" })).toHaveAttribute("href", "/secret-guard");
  await expect(slides.nth(1).getByRole("heading", { name: "AI Guard", exact: true })).toBeAttached();
  // La plateforme s'ouvre sur la connexion au compte.
  await expect(slides.nth(1).getByRole("link", { name: "Explorer la plateforme" })).toHaveAttribute("href", "/login");
  await expect(slides.nth(1).locator('a[href^="mailto:"]')).toHaveCount(1);

  // Les sélecteurs et les flèches suivent la diapositive affichée.
  const pickers = carousel.getByRole("group", { name: "Nos produits" }).getByRole("button");
  await expect(pickers.nth(0)).toHaveAttribute("aria-pressed", "true");
  await expect(carousel.getByRole("button", { name: "Produit précédent" })).toBeDisabled();
  await pickers.nth(1).click();
  await expect(pickers.nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(carousel.getByRole("button", { name: "Produit suivant" })).toBeDisabled();
  const decalage = (index: number) => slides.nth(index).evaluate((slide) =>
    Math.round(slide.getBoundingClientRect().left - slide.parentElement!.getBoundingClientRect().left));
  await expect.poll(() => decalage(1)).toBe(0);
  await carousel.getByRole("button", { name: "Produit précédent" }).click();
  await expect(pickers.nth(0)).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => decalage(0)).toBe(0);

  // Les deux captures sont de vraies images, et elles se décodent : un chemin mort
  // laisserait une figure vide que `toBeVisible` accepterait sans broncher.
  const captures = slides.locator(".xp-slide__shot img");
  await expect(captures).toHaveCount(2);
  for (const capture of await captures.all()) {
    await capture.evaluate((image) => (image as HTMLImageElement).decode());
    expect((await capture.getAttribute("alt"))?.length ?? 0).toBeGreaterThan(20);
  }

  // Les éditions payantes portent le nom du produit, pas un second nom de gamme.
  await expect(page.locator("#offres")).toContainText("Secret Guard Pro");
  await expect(page.locator("#offres")).toContainText("Secret Guard Entreprise");
  await expect(page.locator("main")).not.toContainText("Developer Guard");
  await expect(page.locator('.guard-glossary-link a[href="/menaces"]')).toHaveAttribute("href", "/menaces");
});

test("every public header carries the same orientation menu", async ({ page }) => {
  for (const chemin of ["/", "/produits", "/secret-guard", "/menaces"]) {
    await page.goto(chemin);
    const navigation = page.getByRole("navigation", { name: "Navigation principale" });
    await expect(navigation.getByRole("link", { name: "Nos Produits", exact: true })).toHaveAttribute("href", "/produits");
    await expect(navigation.getByRole("link", { name: "Vos besoins", exact: true })).toHaveAttribute("href", "/menaces");
    await expect(navigation.getByRole("link", { name: /Nos conseils/ })).toHaveAttribute("href", "https://www.xsom.fr");
    await expect(navigation.getByRole("link")).toHaveCount(3);
  }
});

test("reducing motion reveals the content instead of hiding it for good", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/produits");

  // L'effet existe bien : sans `is-visible`, la cible est masquée.
  const masquee = await page.evaluate(() => {
    const cible = document.querySelector(".guard-glossary-link") as HTMLElement;
    cible.classList.remove("is-visible");
    document.documentElement.dataset.motion = "on";
    return getComputedStyle(cible).opacity;
  });
  expect(masquee).toBe("0");

  // Et le réglage « Réduire les animations » écrit `off`, pas l'absence de marqueur.
  // Un sélecteur de présence gardait alors l'opacité à zéro sur un contenu que plus
  // rien n'allait révéler : un clic effaçait la page, durablement.
  const reduite = await page.evaluate(() => {
    const cible = document.querySelector(".guard-glossary-link") as HTMLElement;
    cible.classList.remove("is-visible");
    document.documentElement.dataset.motion = "off";
    return getComputedStyle(cible).opacity;
  });
  expect(reduite).toBe("1");
});

test("a page reached by an internal link still reveals what it hides", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await page.getByRole("navigation", { name: "Navigation principale" })
    .getByRole("link", { name: "Nos Produits", exact: true }).click();
  await expect(page).toHaveURL(/\/produits$/);

  // Le layout racine reste monté d'une page à l'autre : sans relevé des cibles à
  // chaque navigation, cette page gardait ses révélations à zéro pour toujours.
  const cible = page.locator(".guard-glossary-link");
  await cible.scrollIntoViewIfNeeded();
  await expect.poll(
    () => cible.evaluate((n) => getComputedStyle(n).opacity),
    { timeout: 5_000 },
  ).toBe("1");
});

test("the campus opens each team over the illustration, with a keyboard", async ({ page }) => {
  await page.goto("/");
  const tabs = page.locator("#usages").getByRole("group", { name: "Les équipes" });
  const detail = page.locator("#campus-detail");
  await expect(detail).toBeHidden();
  for (const name of ["Équipes métier", "Équipes de développement", "Équipes modèles & données"]) {
    const tab = tabs.getByRole("button", { name: new RegExp(name) });
    await tab.focus();
    await page.keyboard.press("Enter");
    await expect(tab).toHaveAttribute("aria-pressed", "true");
    await expect(detail.getByRole("heading", { name, exact: true })).toBeVisible();
    await expect(detail.locator(".home-campus__lists li")).toHaveCount(6);
    const visuals = detail.getByRole("button", { name: /^Agrandir/ });
    await expect(visuals).toHaveCount(3);
    await visuals.first().click();
    const preview = page.getByRole("dialog");
    await expect(preview).toBeVisible();
    await expect(preview.getByText("Comment réduire le risque", { exact: true })).toBeVisible();
    // Échap ferme l'aperçu seul : le panneau de l'équipe reste ouvert.
    await page.keyboard.press("Escape");
    await expect(preview).toBeHidden();
    await expect(detail).toBeVisible();
    await tab.click();
    await expect(detail).toBeHidden();
  }
});

test("each team opens its own filtered cyber risks", async ({ page }) => {
  const teams = [
    { name: "Équipes de développement", use: "development" },
    { name: "Équipes métier", use: "workplace" },
    { name: "Équipes modèles & données", use: "models" },
  ] as const;

  for (const team of teams) {
    await page.goto("/");
    await page.locator("#usages").getByRole("group", { name: "Les équipes" })
      .getByRole("button", { name: new RegExp(team.name) }).click();
    const link = page.locator("#campus-detail").getByRole("link", {
      name: `Explorer les risques liés à mon équipe : ${team.name}`,
    });
    await expect(link).toHaveAttribute("href", `/menaces?use=${team.use}#definitions`);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/menaces\\?use=${team.use}#definitions$`));
    await expect(page.getByRole("group", { name: "Filtrer par usage IA" })
      .getByRole("button", { name: team.name, exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".guard-glossary__row")).toHaveCount(
      THREAT_GLOSSARY.filter((entry) => entry.uses.includes(team.use)).length,
    );
  }
});

test("the hero respects reduced motion without downloading its video", async ({ page }) => {
  const videoRequests: string[] = [];
  await page.emulateMedia({ reducedMotion: "reduce" });
  page.on("request", (request) => {
    if (/xsom-ai-home-v4-(?:fr|en)\.mp4(?:\?|$)/.test(request.url())) videoRequests.push(request.url());
  });
  await page.goto("/");
  const video = page.locator(".home-film__video");
  await expect(video).toBeVisible();
  await expect(video).toHaveAttribute("poster", "/signal-media/xsom-ai-home-v4-fr.jpg");
  await expect(video).toHaveAttribute("preload", "none");
  await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).paused)).toBe(true);
  await expect(video).toHaveAttribute("src", "/signal-media/xsom-ai-home-v4-fr.mp4");
  expect(videoRequests).toEqual([]);
});

test("the Secret Guard page says what it solves, how, and hands over the file", async ({ page }) => {
  // L'ancienne adresse mène à la page du produit.
  await page.goto("/extension");
  await expect(page).toHaveURL(/\/secret-guard$/);

  await page.goto("/produits");
  await page.locator('#gamme a[href="/secret-guard"]').click();
  await expect(page).toHaveURL(/\/secret-guard$/);

  // Ce qu'on résout, en une phrase, avec les trois assistants.
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Les meilleurs agents de code.");
  await expect(page.locator(".sg-hero__hosts li")).toHaveText(["GitHub Copilot", "Claude Code", "Codex"]);
  const fond = page.locator(".sg-hero__video");
  await expect(fond).toHaveAttribute("poster", "/signal-media/ai-guard-extension-v2.jpg");
  await expect(fond).toHaveAttribute("preload", "none");

  // Le schéma : le filtre et ses trois couches, dont le réglage réservé à l'édition Entreprise.
  const couches = page.locator("#fonctionnement .sg-layers li");
  await expect(couches).toHaveCount(3);
  await expect(couches.nth(1)).toContainText("Entropie");
  await expect(couches.nth(2)).toContainText("Entreprise");

  // Le vrai panneau, ses sept boutons légendés ; Expurger est déplié d'office, et
  // survoler une autre légende la déplie à son tour.
  const panneau = page.locator("#panneau");
  await expect(panneau.locator(".sg-tour__spots span")).toHaveCount(7);
  await expect(panneau.locator(".sg-callout")).toHaveCount(7);
  await expect(panneau.getByRole("button", { name: /Expurger Recommandé/ })).toHaveAttribute("aria-expanded", "true");
  await panneau.getByRole("button", { name: /^Bloquer/ }).hover();
  await expect(panneau.getByRole("button", { name: /^Bloquer/ })).toHaveAttribute("aria-expanded", "true");
  await expect(panneau.getByRole("button", { name: /Expurger Recommandé/ })).toHaveAttribute("aria-expanded", "false");
  const capture = panneau.locator(".sg-tour__picture img");
  await capture.scrollIntoViewIfNeeded();
  await capture.evaluate((image) => (image as HTMLImageElement).decode());

  // Le fichier, sa version et ses planchers. Le nom d'asset est fixe : c'est ce qui
  // rend `latest/download` utilisable comme lien permanent.
  const telechargement = page.locator("#telecharger");
  await expect(telechargement.getByRole("link", { name: "Télécharger le VSIX" })).toHaveAttribute(
    "href",
    "https://github.com/jt33120/poc-AI_guard/releases/latest/download/xsom-secret-guard-vscode.vsix",
  );
  await expect(telechargement.locator(".sg-download__version strong")).toHaveText(/^\d+\.\d+\.\d+$/);
  await expect(telechargement).toContainText("1.133");
  await expect(telechargement).toContainText("1.137");
  await expect(telechargement.locator(".sg-download__steps li")).toHaveCount(3);
  await expect(telechargement.getByRole("link", { name: /Secret Guard Pro/ })).toHaveAttribute("href", "/produits#offres");
});


for (const width of [390, 768, 1440]) {
  test(`the landing stays contained in French and English at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.locator("#usages").getByRole("group", { name: "Les équipes" })
      .getByRole("button", { name: /Équipes modèles & données/ }).click();
    await expect(page.locator("#campus-detail")).toContainText("Équipes modèles & données");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // L'en-tête s'efface en descente et revient en haut de page ; sous 900 px, la
    // langue se choisit dans son menu.
    await page.evaluate(() => window.scrollTo(0, 0));
    const menu = page.getByRole("button", { name: "Menu", exact: true });
    if (await menu.isVisible()) await menu.click();
    await page.getByRole("button", { name: "EN", exact: true }).click();
    await expect(page.locator("#campus-detail")).toContainText("Model & data teams");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await page.goto("/secret-guard");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    if (width === 390) {
      // Trois colonnes tiennent dans 390 px sans déborder, à deux mots par ligne :
      // le contrôle de débordement les laisserait passer. Les étapes doivent être
      // EMPILÉES, et deux étapes empilées ne partagent pas la même ordonnée.
      const etapes = page.locator(".sg-download__steps li");
      const premiere = await etapes.nth(0).boundingBox();
      const seconde = await etapes.nth(1).boundingBox();
      expect(seconde!.y).toBeGreaterThan(premiere!.y);
    }

    await page.goto("/produits");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 390) {
      // Sur mobile, chaque diapositive empile son texte puis sa capture : deux
      // colonnes serrées tiendraient dans 390 px, à deux mots par ligne.
      const diapositive = page.locator(".xp-slide").first();
      const texte = await diapositive.locator("h2").boundingBox();
      const capture = await diapositive.locator(".xp-slide__shot").boundingBox();
      expect(capture!.y).toBeGreaterThan(texte!.y);
    }
  });
}
