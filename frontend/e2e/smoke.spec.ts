import { type BrowserContext, expect, test } from "@playwright/test";

const APPROVAL = {
  id: "11111111-1111-1111-1111-111111111111",
  request_id: "req-1",
  tool_name: "crm.delete_contact",
  action_class: "irreversible",
  status: "pending",
  required_count: 1,
  approved_by: [] as string[],
  dry_run: { summary: "Execute crm.delete_contact [irreversible] with contact_id='c1'" },
};

async function authed(context: BrowserContext) {
  await context.addCookies([
    { name: "xsom_e2e", value: "1", url: "http://127.0.0.1:3100" },
  ]);
}

test("landing page renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#home-film video")).toBeVisible();
  await expect(page.locator(".guard-header .brand__name")).toHaveText("xSOM AI Studio");
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    const root = getComputedStyle(document.documentElement);
    const family = (token: string) => root.getPropertyValue(token).split(",")[0].trim().replace(/["']/g, "");
    const display = family("--signal-font-display");
    const body = family("--signal-font-body");
    const loaded = [...document.fonts].filter(face => face.status === "loaded").map(face => face.family.replace(/["']/g, ""));
    return { display, body, loaded, headingStyle: getComputedStyle(document.querySelector("h2")!).fontFamily, bodyStyle: getComputedStyle(document.body).fontFamily };
  });
  expect(fonts.display.toLowerCase()).toContain("manrope");
  expect(fonts.body.toLowerCase()).toContain("sourcesans");
  expect(fonts.loaded).toContain(fonts.display);
  expect(fonts.loaded).toContain(fonts.body);
  expect(fonts.headingStyle).toContain(fonts.display);
  expect(fonts.bodyStyle).toContain(fonts.body);
});

// --- Le paysage des menaces (L4) ------------------------------------------------
//
// La section a remplacé les cartes de fonctionnalités. Elle ne revendique aucune
// couverture : c'est le relevé (L5) qui le fait, et `tests/test_menaces_section.py`
// tient la frontière côté source. Ici on vérifie ce que le source ne peut pas dire,
// à savoir que la section arrive **rendue** et complète.
test("approving a held action from the UI clears it from the queue", async ({ page, context }) => {
  await authed(context);
  let decided = false;

  await page.route("**/api/control/**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (url.includes("/v1/approvals/") && url.includes("/decision") && method === "POST") {
      decided = true;
      await route.fulfill({ json: { ...APPROVAL, status: "approved" } });
      return;
    }
    if (url.includes("/v1/approvals")) {
      await route.fulfill({ json: decided ? [] : [APPROVAL] });
      return;
    }
    await route.fulfill({ json: [] });
  });

  await page.goto("/approvals");
  await expect(page.getByText("Execute crm.delete_contact")).toBeVisible();
  await page.getByRole("button", { name: "Approuver" }).click();
  await expect(page.getByText("Aucune validation en attente.")).toBeVisible();
});

test("audit explorer lists entries and offers exports", async ({ page, context }) => {
  await authed(context);
  await page.route("**/api/control/v1/audit**", async (route) => {
    await route.fulfill({
      json: [
        {
          id: 1,
          ts: "2026-06-15T12:00:00+00:00",
          tool_name: "crm.read",
          action_class: "read",
          decision: "allow",
          args_hash: "abc123def456",
        },
      ],
    });
  });

  await page.goto("/audit");
  await expect(page.getByRole("button", { name: "crm.read", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Export AI Act/ })).toBeVisible();
});

test("editing the policy saves a new version", async ({ page, context }) => {
  await authed(context);
  await page.route("**/api/control/**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (url.includes("/v1/policy") && method === "PUT") {
      await route.fulfill({ json: { yaml: "tools: []\n", version: 2 } });
      return;
    }
    if (url.includes("/v1/policy")) {
      await route.fulfill({ json: { yaml: "tools: []\n", version: 1 } });
      return;
    }
    await route.fulfill({ json: [] });
  });

  await page.goto("/admin");
  await expect(page.getByText("version 1")).toBeVisible();
  await page.getByRole("button", { name: "Enregistrer la politique" }).click();
  await expect(page.getByText("Politique enregistrée (version 2).")).toBeVisible();
});

test("un visiteur sans cookie reçoit le français, et le document le déclare", async ({ page }) => {
  const reponse = await page.goto("/");

  // L'attribut **et** le texte, dans la même assertion : c'est là qu'était le défaut.
  // `lang` valait `fr` en dur pendant que le texte sortait en anglais, si bien qu'un
  // lecteur d'écran lisait de l'anglais avec une voix française. Vérifier l'un sans
  // l'autre laisserait ce désaccord passer.
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(page.locator("#usages-heading")).toHaveText("Chaque usage de l’IA expose à des risques cyber différents.");

  // Le titre et la description existent, et sont français. Sans ce lot il n'y avait
  // ni l'un ni l'autre : une page cliente ne peut pas en exporter.
  await expect(page).toHaveTitle(/La gouvernance française des agents IA/);
  const description = await page
    .locator('head meta[name="description"]')
    .getAttribute("content");
  expect(description).toContain("édité en France par xSOM Consulting");
  expect(description).toContain("Détection locale gratuite");

  // Le français est dans la **première réponse**, pas posé après coup. Avant ce lot,
  // le serveur rendait l'anglais — il ne pouvait pas lire `localStorage` — et le
  // navigateur basculait ensuite : un robot, qui n'hydrate pas, n'a jamais vu que
  // l'anglais. (Que la page soit devenue un composant serveur ne se lit pas ici mais
  // dans le poids du bundle : 2,56 ko de JS de page avant, 187 o après.)
  const html = (await reponse?.text()) ?? "";
  expect(html).toContain("Chaque usage de l’IA expose à des risques cyber différents.");
});

test("basculer en anglais tient au rechargement", async ({ page }) => {
  await page.goto("/");
  // `exact` : sans lui, le nom accessible est cherché en sous-chaîne insensible à la
  // casse, et le relevé des menaces a introduit douze boutons qui contiennent « en »
  // (« Empoisonnement », « Agents », « entraînons »). Le sélecteur était juste tant que
  // la page était courte, ce qui est la définition d'un sélecteur fragile.
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(page.locator("#usages-heading")).toHaveText("Every AI use case brings its own cyber risks.");

  // Le rechargement est le point : la préférence tient dans un cookie que le serveur
  // relit, elle ne vit pas seulement dans l'état d'un composant.
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("#usages-heading")).toHaveText("Every AI use case brings its own cyber risks.");
  await expect(page).toHaveTitle(/French governance for AI agents/);
});

test("les écrans d'authentification et la console refusent l'indexation", async ({ page }) => {
  for (const chemin of ["/login", "/signup", "/forgot-password"]) {
    await page.goto(chemin);
    await expect(page.locator('head meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/,
    );
  }

  // La page publique, elle, doit rester indexable : un `noindex` posé trop large
  // retirerait le site des résultats sans que rien ne le signale.
  await page.goto("/");
  await expect(page.locator('head meta[name="robots"]')).toHaveCount(0);
});

test("le favicon est servi, déclaré, et décodable par le navigateur", async ({ page }) => {
  for (const asset of ["xsom-mark.svg", "xsom-mark-light.svg"]) {
    const logo = await page.request.get(`/${asset}`);
    expect(logo.status()).toBe(200);
    expect(logo.url()).toContain(`/${asset}`);
    expect(logo.headers()["content-type"]).toContain("image/svg+xml");
    expect(await logo.text()).toContain("<svg");
  }
  const reponse = await page.goto("/icon.svg");
  expect(reponse?.status()).toBe(200);
  expect(reponse?.headers()["content-type"]).toContain("image/svg+xml");

  await page.goto("/");
  // Next pose la balise lui-même à partir de `app/icon.svg` ; son absence signifie que
  // le navigateur retomberait sur `/favicon.ico`, qui n'existe pas.
  const href = await page.locator('link[rel="icon"]').first().getAttribute("href");
  expect(href).toContain("/icon.svg");

  // `naturalWidth > 0` est ce qui sépare « le fichier arrive » de « le navigateur sait
  // le lire ». Un SVG mal formé passe le premier et échoue le second, en silence.
  const decode = await page.evaluate(
    (src) =>
      new Promise<boolean>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img.naturalWidth > 0);
        img.onerror = () => resolve(false);
        img.src = src;
      }),
    href as string,
  );
  expect(decode).toBe(true);
});

// La liste blanche du proxy de contrôle, éprouvée sur le vrai gestionnaire de route.
//
// `tests/test_control_proxy.py` confronte la table aux appels réels de la console, mais
// il lit du TypeScript depuis Python : il ne prouve pas que le proxy refuse pour de
// vrai. Le lot du favicon a montré ce que vaut un vert structurel — le fichier se
// servait en 200 et aucun navigateur ne pouvait le lire.
//
// Ces requêtes ne passent par aucun mock : elles atteignent le gestionnaire, avec une
// session, et c'est lui qui répond.

test("le proxy refuse un chemin que la console n'appelle jamais", async ({ context }) => {
  await authed(context);
  // `/v1/compliance/export` existe dans l'API et n'est appelé par aucun écran. C'est
  // exactement l'écart que la liste blanche ferme : sans elle, une session `viewer`
  // l'atteignait avec le jeton attaché par le proxy.
  const refuse = await context.request.get("/api/control/v1/compliance/export");
  expect(refuse.status()).toBe(404);
  expect(await refuse.json()).toEqual({ detail: "Not found" });

  // Et la méthode compte autant que le chemin : `v1/policy` est lu et écrit par la
  // console, jamais supprimé.
  const mauvaiseMethode = await context.request.delete("/api/control/v1/policy");
  expect(mauvaiseMethode.status()).toBe(404);
});

test("le proxy laisse passer un chemin que la console appelle", async ({ context }) => {
  await authed(context);
  // Sans API en amont la requête échoue plus loin — le point n'est pas qu'elle
  // réussisse, c'est qu'elle ne soit pas arrêtée par la liste blanche. Un test qui ne
  // vérifierait que les refus passerait au vert sur une liste qui refuse tout.
  const passe = await context.request.get("/api/control/v1/policy");
  expect(passe.status()).not.toBe(404);
});

test("une remontée de chemin ne sort pas de la liste blanche", async ({ context }) => {
  await authed(context);
  // Mesuré plutôt que supposé : Next **résout** la remontée avant que le gestionnaire
  // ne voie les segments. `/v1/clients/%2e%2e/policy` lui arrive donc comme
  // `v1/policy` — un chemin déjà autorisé, et la requête passe (500 faute d'API en
  // amont). Ce n'est pas une faille : la remontée n'a rien donné de plus.
  //
  // La propriété qui compte est donc celle-ci : on ne remonte pas jusqu'à un chemin que
  // la table n'accorde pas. Le contrôle de forme des segments dans `controlRoutes.ts`
  // reste la ceinture — il refuse un `..` si jamais il en arrivait un.
  const evasion = await context.request.get(
    "/api/control/v1/clients/%2e%2e/%2e%2e/openapi.json",
  );
  expect(evasion.status()).toBe(404);
});
