import { expect, test } from "@playwright/test";
import { GUARD_COPY } from "../components/guard-copy";
import { GUARD_HOME_COPY } from "../components/guard-home-copy";
import { HOME_COPY } from "../components/home/home-copy";
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
    const phrases = copyLeaves([GUARD_COPY[language], GUARD_HOME_COPY[language], HOME_COPY[language]]);
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
  await expect(film.locator("video")).toHaveAttribute("src", /xsom-products-v1-fr\.mp4$/);
  expect(await film.locator("video").getAttribute("controls")).toBeNull();
  expect(await film.locator("video").getAttribute("aria-label")).not.toMatch(/Secret Guard|AI Guard/);
  await expect(film.getByRole("link", { name: "Découvrir" })).toHaveAttribute("href", "#gamme");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("du poste à l’infrastructure");

  // Une diapositive par produit, chacune avec sa porte d'entrée.
  const carousel = page.getByRole("region", { name: "Nos produits" });
  const slides = carousel.locator(".xp-slide");
  await expect(slides).toHaveCount(2);
  await expect(slides.nth(0).getByRole("heading", { name: "Secret Guard", exact: true })).toBeAttached();
  await expect(slides.nth(0).getByRole("link", { name: "Découvrir Secret Guard" })).toHaveAttribute("href", "/extension");
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
  await expect(page.locator("#offres")).toContainText("Secret Guard Équipe");
  await expect(page.locator("#offres")).toContainText("Secret Guard Renforcé");
  await expect(page.locator("main")).not.toContainText("Developer Guard");
  await expect(page.locator('.guard-glossary-link a[href="/menaces"]')).toHaveAttribute("href", "/menaces");
});

test("every public header carries the same orientation menu", async ({ page }) => {
  for (const chemin of ["/", "/produits", "/extension", "/menaces"]) {
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
    if (/xsom-ai-home-v3-(?:fr|en)\.mp4(?:\?|$)/.test(request.url())) videoRequests.push(request.url());
  });
  await page.goto("/");
  const video = page.locator(".home-film__video");
  await expect(video).toBeVisible();
  await expect(video).toHaveAttribute("poster", "/signal-media/xsom-ai-home-v3-fr.jpg");
  await expect(video).toHaveAttribute("preload", "none");
  await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).paused)).toBe(true);
  await expect(video).toHaveAttribute("src", "/signal-media/xsom-ai-home-v3-fr.mp4");
  expect(videoRequests).toEqual([]);
});

test("the extension page hands over a file that installs, and names its limits", async ({ page }) => {
  await page.goto("/produits");
  await page.locator('#gamme a[href="/extension"]').click();
  await expect(page).toHaveURL(/\/extension$/);

  // Le bouton est le produit de cette page. Un lien relatif ou un chemin de
  // release daté ne tiendrait pas d'une version à l'autre : le nom d'asset est
  // fixe, et c'est ce qui rend `latest/download` utilisable comme lien permanent.
  const telecharger = page.getByRole("link", { name: /Télécharger l’extension/ });
  await expect(telecharger).toHaveAttribute(
    "href",
    "https://github.com/jt33120/poc-AI_guard/releases/latest/download/xsom-secret-guard-vscode.vsix",
  );

  // La bannière porte son média. L'affiche part au chargement : un chemin mort
  // laisserait un rectangle vide derrière le titre, sans rien casser d'autre.
  const fond = page.locator(".guard-masthead__video");
  await expect(fond).toHaveAttribute("poster", "/signal-media/ai-guard-extension-v1.png");
  await expect(fond).toHaveAttribute("preload", "none");

  // Trois gestes, et le deuxième dit comment on installe un VSIX. Sans lui, la
  // page rendrait un fichier sans mode d'emploi.
  const gestes = page.locator(".guard-start__steps li");
  await expect(gestes).toHaveCount(3);
  await expect(gestes.nth(1)).toContainText("VSIX");
  await expect(gestes.nth(2)).toContainText("/hooks");
  await expect(page.locator("#individual")).toContainText("Gratuit");
  await expect(page.locator("#enterprise")).toContainText("MDM");
  await expect(page.locator("#enterprise")).toContainText("requirements.toml");
  await expect(page.locator("#enterprise")).toContainText("Codex ne distribue pas les scripts");
  // L'offre Équipe se lit sur la page des produits, avec ses éditions et ses tarifs.
  await expect(page.locator("#enterprise a.guard-button")).toHaveAttribute("href", "/produits#offres");

  // Les trois hôtes réellement configurés sont publiés, sans élargir la promesse.
  await expect(page.locator(".guard-ext-hosts li")).toHaveCount(3);
  const claude = page.locator(".guard-ext-hosts li", { hasText: "Claude Code" });
  await expect(claude.locator('img[src*="claude-ai-icon"]')).toBeVisible();

  // Les quatre bornes. Celle de la version est la plus facile à taire, et c'est
  // celle qui fait échouer une installation par ailleurs correcte : le premier
  // lecteur de la page s'est arrêté là, en 1.133, avec le bon fichier et la
  // bonne commande. Les deux planchers sont donc tenus tous les deux, parce que
  // ne nommer que 1.137 laissait croire qu'on installe quand même en 1.133 pour
  // couvrir les trois autres assistants.
  const bornes = page.locator(".guard-gateway:has(#ext-local) .guard-ext-limits li");
  await expect(bornes).toHaveCount(4);
  await expect(bornes.nth(1)).toContainText("1.136");
  await expect(bornes.nth(1)).toContainText("1.137");
  await expect(page.getByText("est un indicateur", { exact: false })).toBeVisible();

  // Tant que la fiche n'existe pas, la page ne propose pas de l'ouvrir.
  await expect(page.getByRole("link", { name: /Installer depuis VS Code/ })).toHaveCount(0);
  await expect(page.getByText("pas encore distribuée sur la Place de marché", { exact: false })).toBeVisible();
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

    await page.goto("/extension");
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
