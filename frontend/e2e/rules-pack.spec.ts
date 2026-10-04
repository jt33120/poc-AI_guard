import { WORKSPACE } from "./workspace-fixture";
import {
  type BrowserContext,
  expect,
  type Page,
  type Route,
  test,
} from "@playwright/test";

/**
 * Règles sur mesure : le client lit, l'opérateur xSOM compose et signe.
 * Toutes les réponses de l'API sont simulées ; aucune n'est écrite nulle part.
 */

const TENANT = "00000000-0000-4000-8000-000000000001";
const DIGEST = "3e02ed3f19f8a0180a54830ea71ff600f057b56c82f631bda3065a42cf798ea5";
const KEY = "56475aa75463474c0285df5dbf2bcab73da651358839e9b77481b2eab107708c";

const PACK = {
  packId: "acme-main",
  version: 3,
  issuedAt: "2026-09-01T00:00:00Z",
  expiresAt: "2099-09-01T00:00:00Z",
  issuer: "xSOM",
  keyId: KEY,
  payloadDigest: DIGEST,
  publishedAt: "2026-09-01T00:00:05Z",
  revoked: false,
  expired: false,
  detectors: [
    {
      id: "acme.customer-id",
      label: "Identifiant client ACME",
      category: "customer_data",
      action: "block",
      type: "pattern",
      context: null,
      pattern: "CLI-[0-9]{8}",
      caseInsensitive: false,
      minEntropyTenths: null,
    },
    {
      id: "acme.siret",
      label: "Numéro SIRET d’un client",
      category: "customer_data",
      action: "warn",
      type: "pattern",
      context: { keywords: ["siret"], window: 24 },
      pattern: "[0-9]{14}",
      caseInsensitive: false,
      minEntropyTenths: null,
    },
    {
      id: "acme.codenames",
      label: "Nom de code de projet",
      category: "project",
      action: "block",
      type: "terms",
      context: null,
      termsCount: 2,
      maxWords: 2,
    },
  ],
  tests: { positives: 2, negatives: 2 },
};

const COVERAGE = {
  total: 3,
  up_to_date: 2,
  behind: 0,
  refused: 1,
  devices: [
    { id: "d1", name: "PC-COMPTA-01", state: "up_to_date", appliedVersion: 3, appliedDigest: DIGEST, expired: false },
    { id: "d2", name: "PC-DEV-02", state: "up_to_date", appliedVersion: 3, appliedDigest: DIGEST, expired: false },
    { id: "d3", name: "PC-DEV-03", state: "refused", appliedVersion: 2, appliedDigest: null, expired: false },
  ],
};

const TENANT_VIEW = {
  pack: PACK,
  coverage: COVERAGE,
  history: [
    { event: "published", packId: "acme-main", version: 3, payloadDigest: DIGEST, at: "2026-09-01T00:00:05Z" },
  ],
  chainIntact: true,
  xsomOperator: false,
};

const OPERATOR_VIEW = {
  tenant: { id: TENANT, name: "ACME" },
  pack: { ...PACK, version: 2 },
  draft: {
    packId: "acme-main",
    detectors: [
      {
        id: "acme.customer-id",
        label: "Identifiant client ACME",
        category: "customer_data",
        action: "block",
        match: { type: "pattern", pattern: "CLI-[0-9]{8}" },
      },
      {
        id: "acme.codenames",
        label: "Nom de code de projet",
        category: "project",
        action: "block",
        match: { type: "terms", termsCount: 2, maxWords: 2 },
      },
    ],
    tests: {
      positives: [{ detector: "acme.customer-id", text: "Le client CLI-00421337 a appelé." }],
      negatives: ["Le ticket JIRA-12345678 est clos."],
    },
  },
  coverage: COVERAGE,
  history: [],
  chainIntact: true,
  signingReady: true,
};

async function authenticate(context: BrowserContext, lang: "fr" | "en" = "fr") {
  await context.addCookies([
    { name: "xsom_e2e", value: "1", url: "http://127.0.0.1:3100" },
    { name: "xsom_lang", value: lang, url: "http://127.0.0.1:3100" },
  ]);
}

type Handler = (route: Route) => Promise<void> | void;

async function control(page: Page, handlers: Record<string, Handler>) {
  await page.route("**/api/control/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/control/", "");
    if (path === "v1/workspace") return route.fulfill({ json: WORKSPACE });
    const handler = handlers[path];
    if (handler) return handler(route);
    if (path === "v1/clients") return route.fulfill({ json: [] });
    if (path === "v1/agents") return route.fulfill({ json: { customer: null, agents: [] } });
    return route.fulfill({ status: 404, json: { detail: "Not found" } });
  });
}

test.describe("client : lecture seule", () => {
  test("le client lit son réglage, sa couverture, et ne peut rien modifier", async ({ page, context }) => {
    await authenticate(context);
    await control(page, { "v1/rules-pack": (route) => route.fulfill({ json: TENANT_VIEW }) });
    await page.goto("/extensions/reglage");
    await expect(page.getByRole("heading", { name: "Réglage sur mesure", level: 1 })).toBeVisible();
    await expect(page.getByText("v3 · acme-main")).toBeVisible();
    await expect(page.getByText("2 / 3 postes à jour")).toBeVisible();
    await expect(page.getByText("Refusé par le poste")).toBeVisible();
    await expect(page.getByRole("cell", { name: /Identifiant client ACME/ })).toBeVisible();
    await expect(page.getByText("CLI-[0-9]{8}")).toBeVisible();
    await expect(page.getByText(/2 terme\(s\) confidentiel\(s\), jamais transmis en clair/)).toBeVisible();
    await expect(page.getByText(/chaîné et intact/)).toBeVisible();
    const ask = page.getByRole("link", { name: "Demander un ajustement à xSOM" });
    const href = await ask.getAttribute("href");
    expect(href).toContain("mailto:julian.talou@xsom.fr?subject=");
    expect(decodeURIComponent(href ?? "")).toContain("ajustement du réglage sur mesure (v3)");
    // Aucune saisie : ni champ, ni case, ni liste, ni bouton de signature.
    await expect(page.getByRole("textbox")).toHaveCount(0);
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await expect(page.getByRole("combobox")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Signer/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Atelier opérateur/ })).toHaveCount(0);
  });

  test("sans réglage, le client est invité à le demander à xSOM", async ({ page, context }) => {
    await authenticate(context);
    await control(page, {
      "v1/rules-pack": (route) =>
        route.fulfill({ json: { ...TENANT_VIEW, pack: null, coverage: null, history: [] } }),
    });
    await page.goto("/extensions/reglage");
    await expect(page.getByRole("heading", { name: "Aucun réglage sur mesure pour l’instant" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Demander un réglage à xSOM" }).first()).toBeVisible();
  });

  test("un service indisponible reste une erreur, pas un réglage vide", async ({ page, context }) => {
    await authenticate(context);
    await control(page, {
      "v1/rules-pack": (route) => route.fulfill({ status: 503, json: { detail: "down" } }),
    });
    await page.goto("/extensions/reglage");
    await expect(page.getByRole("alert").filter({ hasText: "Action interrompue" })).toBeVisible();
    await expect(page.getByText("Aucun réglage sur mesure pour l’instant")).toHaveCount(0);
  });

  test("le chargement s'annonce, puis le réglage s'affiche en anglais", async ({ page, context }) => {
    await authenticate(context, "en");
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await control(page, {
      "v1/rules-pack": async (route) => {
        await gate;
        await route.fulfill({ json: { ...TENANT_VIEW, xsomOperator: true } });
      },
    });
    await page.goto("/extensions/reglage");
    await expect(page.getByRole("status", { name: "Loading…" })).toBeVisible();
    release();
    await expect(page.getByRole("heading", { name: "Custom tuning", level: 1 })).toBeVisible();
    await expect(page.getByText("2 / 3 workstations up to date")).toBeVisible();
    await expect(page.getByRole("link", { name: "xSOM operator workshop →" })).toBeVisible();
  });

  test("une chaîne rompue s'annonce, et un lecteur ne voit pas les motifs", async ({ page, context }) => {
    await authenticate(context);
    const hidden = {
      ...TENANT_VIEW,
      chainIntact: false,
      pack: {
        ...PACK,
        detectors: PACK.detectors.map((detector) => {
          const { pattern: _pattern, ...rest } = detector as typeof detector & { pattern?: string };
          return rest;
        }),
      },
    };
    await control(page, { "v1/rules-pack": (route) => route.fulfill({ json: hidden }) });
    await page.goto("/extensions/reglage");
    await expect(page.getByRole("alert").filter({ hasText: "ne se vérifie plus" })).toBeVisible();
    await expect(page.getByText("Motif réservé aux administrateurs").first()).toBeVisible();
    await expect(page.getByText("CLI-[0-9]{8}")).toHaveCount(0);
  });

  test("la page des postes mène au réglage", async ({ page, context }) => {
    await authenticate(context);
    await control(page, {
      "v1/extensions/devices": (route) => route.fulfill({ json: [] }),
      "v1/extensions/events": (route) => route.fulfill({ json: { events: [], next_before: null } }),
      "v1/rules-pack": (route) => route.fulfill({ json: TENANT_VIEW }),
    });
    await page.goto("/extensions");
    await page.getByRole("link", { name: "Consulter le réglage" }).click();
    await expect(page).toHaveURL(/\/extensions\/reglage$/);
  });
});

test("le réglage et l'atelier exigent une session console", async ({ page }) => {
  await page.goto("/extensions/reglage");
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/xsom/regles");
  await expect(page).toHaveURL(/\/login/);
});

test.describe("opérateur xSOM : composer, éprouver, signer", () => {
  test("un compte qui n'est pas opérateur xSOM voit la frontière", async ({ page, context }) => {
    await authenticate(context);
    await control(page, {
      "v1/xsom/tenants": (route) => route.fulfill({ status: 403, json: { detail: "xSOM operator only" } }),
    });
    await page.goto("/xsom/regles");
    await expect(page.getByRole("heading", { name: "Réservé aux opérateurs xSOM" })).toBeVisible();
    await expect(page.getByRole("combobox")).toHaveCount(0);
  });

  test("l'opérateur éprouve en direct puis signe la version suivante", async ({ page, context }) => {
    await authenticate(context);
    const dryRuns: Record<string, unknown>[] = [];
    let published: Record<string, unknown> | null = null;
    await control(page, {
      "v1/xsom/tenants": (route) =>
        route.fulfill({
          json: [{ id: TENANT, name: "ACME", packId: "acme-main", version: 2, publishedAt: "2026-09-01T00:00:00Z" }],
        }),
      [`v1/xsom/tenants/${TENANT}/rules-pack`]: (route) =>
        route.fulfill({
          json: published ? { ...OPERATOR_VIEW, pack: { ...PACK, version: 3 } } : OPERATOR_VIEW,
        }),
      [`v1/xsom/tenants/${TENANT}/rules-pack/dry-run`]: (route) => {
        const body = route.request().postDataJSON() as { sample: string | null };
        dryRuns.push(body);
        const sample = body.sample ?? "";
        const start = sample.indexOf("CLI-");
        return route.fulfill({
          json: {
            valid: true,
            error: null,
            version: 3,
            detections:
              start >= 0
                ? [{ detector: "acme.customer-id", label: "Identifiant client ACME", start, end: start + 12 }]
                : [],
          },
        });
      },
      [`v1/xsom/tenants/${TENANT}/rules-pack/publish`]: (route) => {
        published = route.request().postDataJSON() as Record<string, unknown>;
        return route.fulfill({ json: { version: 3, packId: "acme-main", payloadDigest: DIGEST, keyId: KEY } });
      },
    });
    await page.goto("/xsom/regles");
    await page.getByLabel("Client").selectOption(TENANT);
    await expect(page.getByText("v2 · acme-main")).toBeVisible();
    await expect(page.getByText("Laisser vide pour conserver les 2 terme(s) déjà publiés.")).toBeVisible();
    await page.getByLabel(/Texte synthétique, jamais conservé/).fill("Dossier CLI-12345678 à relire.");
    await expect(page.getByText("Paquet valide : prêt à signer en version 3.")).toBeVisible();
    await expect(page.locator("mark", { hasText: "CLI-12345678" })).toBeVisible();

    // Un terme saisi ne va ni dans le stockage du navigateur ni dans l'adresse.
    await page.getByLabel("Termes confidentiels, un par ligne").fill("Opération Albatros");
    const stored = await page.evaluate(
      () => JSON.stringify(window.localStorage) + JSON.stringify(window.sessionStorage) + window.location.href,
    );
    expect(stored).not.toContain("Albatros");
    await page.getByLabel("Termes confidentiels, un par ligne").fill("");
    await expect(page.getByText("Paquet valide : prêt à signer en version 3.")).toBeVisible();

    await page.getByRole("button", { name: "Signer et publier la version 3" }).click();
    const confirmTitle = page.getByRole("heading", { name: "Signer la version 3 pour ACME ?" });
    await expect(confirmTitle).toBeFocused();
    await page.getByRole("button", { name: "Signer et publier", exact: true }).click();
    await expect(page.getByText(/Version 3 signée et publiée pour ACME · empreinte 3e02ed3f19f8/)).toBeFocused();
    expect(published).not.toBeNull();
    const body = published as unknown as {
      expectedVersion: number;
      draft: { detectors: { match: { type: string; terms?: string[] | null } }[] };
    };
    expect(body.expectedVersion).toBe(2);
    expect(body.draft.detectors[1].match).toEqual({ type: "terms", terms: null });
    expect(dryRuns.some((run) => run.sample === "Dossier CLI-12345678 à relire.")).toBe(true);
  });

  test("un motif refusé s'explique en français et bloque la signature", async ({ page, context }) => {
    await authenticate(context);
    await control(page, {
      "v1/xsom/tenants": (route) =>
        route.fulfill({ json: [{ id: TENANT, name: "ACME", packId: null, version: null, publishedAt: null }] }),
      [`v1/xsom/tenants/${TENANT}/rules-pack`]: (route) =>
        route.fulfill({ json: { ...OPERATOR_VIEW, pack: null, draft: null, coverage: null } }),
      [`v1/xsom/tenants/${TENANT}/rules-pack/dry-run`]: (route) =>
        route.fulfill({
          json: {
            valid: false,
            error: { code: "invalid_pattern", detector: "acme.customer-id", test: null, reason: "unbounded_quantifier" },
            version: 1,
            detections: [],
          },
        }),
    });
    await page.goto("/xsom/regles");
    await page.getByLabel("Client").selectOption(TENANT);
    await page.getByLabel("Identifiant", { exact: true }).fill("acme.customer-id");
    await page.getByLabel("Libellé affiché").fill("Identifiant client ACME");
    await page.getByLabel("Motif", { exact: true }).fill("CLI-\\d+");
    await expect(
      page.getByText("Le motif du détecteur « acme.customer-id » est refusé : répétition sans borne (*, + ou {n,}) : écrivez {n,m}."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Signer et publier la version 1" })).toBeDisabled();
  });

  test("sans clé de signature, l'essai reste possible et la publication fermée", async ({ page, context }) => {
    await authenticate(context);
    await control(page, {
      "v1/xsom/tenants": (route) =>
        route.fulfill({ json: [{ id: TENANT, name: "ACME", packId: "acme-main", version: 2, publishedAt: null }] }),
      [`v1/xsom/tenants/${TENANT}/rules-pack`]: (route) =>
        route.fulfill({ json: { ...OPERATOR_VIEW, signingReady: false } }),
      [`v1/xsom/tenants/${TENANT}/rules-pack/dry-run`]: (route) =>
        route.fulfill({ json: { valid: true, error: null, version: 3, detections: [] } }),
    });
    await page.goto("/xsom/regles");
    await page.getByLabel("Client").selectOption(TENANT);
    await expect(page.getByText(/Clé de signature xSOM absente sur ce serveur/)).toBeVisible();
    await expect(page.getByText("Paquet valide : prêt à signer en version 3.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Signer et publier la version 3" })).toBeDisabled();
  });
});

test.describe("opérateur xSOM : ce que la signature protège", () => {
  function operatorRoutes(view: typeof OPERATOR_VIEW, publish: Handler) {
    return {
      "v1/xsom/tenants": (route: Route) =>
        route.fulfill({ json: [{ id: TENANT, name: "ACME", packId: "acme-main", version: 2, publishedAt: null }] }),
      [`v1/xsom/tenants/${TENANT}/rules-pack`]: (route: Route) => route.fulfill({ json: view }),
      [`v1/xsom/tenants/${TENANT}/rules-pack/dry-run`]: (route: Route) =>
        route.fulfill({ json: { valid: true, error: null, version: 3, detections: [] } }),
      [`v1/xsom/tenants/${TENANT}/rules-pack/publish`]: publish,
    };
  }

  test("republier conserve contexte, casse et entropie, et jamais un positif sur des termes", async ({ page, context }) => {
    await authenticate(context);
    const view = structuredClone(OPERATOR_VIEW);
    const detectors = view.draft.detectors as unknown as Record<string, unknown>[];
    detectors[0] = {
      ...view.draft.detectors[0],
      context: { keywords: ["client", "dossier"], window: 32 },
      match: { type: "pattern", pattern: "CLI-[0-9]{8}", caseInsensitive: true, minEntropyTenths: 25 },
    };
    let sent: { draft: { detectors: Record<string, unknown>[] } } | null = null;
    await control(
      page,
      operatorRoutes(view, (route) => {
        sent = route.request().postDataJSON() as typeof sent;
        return route.fulfill({ json: { version: 3, packId: "acme-main", payloadDigest: DIGEST, keyId: KEY } });
      }),
    );
    await page.goto("/xsom/regles");
    await page.getByLabel("Client").selectOption(TENANT);
    const expected = page.getByLabel("Détecteur attendu").first();
    await expect(expected.locator("option")).toHaveText(["—", "Identifiant client ACME"]);
    await expect(page.getByText("Paquet valide : prêt à signer en version 3.")).toBeVisible();
    await page.getByRole("button", { name: "Signer et publier la version 3" }).click();
    await page.getByRole("button", { name: "Signer et publier", exact: true }).click();
    await expect(page.getByText(/Version 3 signée et publiée pour ACME/)).toBeVisible();
    const detector = (sent as unknown as { draft: { detectors: Record<string, unknown>[] } }).draft.detectors[0];
    expect(detector.context).toEqual({ keywords: ["client", "dossier"], window: 32 });
    expect(detector.match).toEqual({
      type: "pattern",
      pattern: "CLI-[0-9]{8}",
      caseInsensitive: true,
      minEntropyTenths: 25,
    });
  });

  test("modifier après avoir ouvert la confirmation la referme ; Échap rend le focus", async ({ page, context }) => {
    await authenticate(context);
    await control(page, operatorRoutes(OPERATOR_VIEW, (route) => route.fulfill({ status: 500, json: {} })));
    await page.goto("/xsom/regles");
    await page.getByLabel("Client").selectOption(TENANT);
    const open = page.getByRole("button", { name: "Signer et publier la version 3" });
    await expect(open).toBeEnabled();
    await open.click();
    await expect(page.getByRole("heading", { name: /Signer la version 3/ })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(open).toBeFocused();
    await open.click();
    await page.getByLabel("Libellé affiché").first().fill("Identifiant client ACME (modifié)");
    await expect(page.getByRole("heading", { name: /Signer la version 3/ })).toHaveCount(0);
  });

  test("une publication concurrente est annoncée, pas écrasée", async ({ page, context }) => {
    await authenticate(context);
    await control(
      page,
      operatorRoutes(OPERATOR_VIEW, (route) => route.fulfill({ status: 409, json: { detail: { code: "version_conflict" } } })),
    );
    await page.goto("/xsom/regles");
    await page.getByLabel("Client").selectOption(TENANT);
    await page.getByRole("button", { name: "Signer et publier la version 3" }).click();
    await page.getByRole("button", { name: "Signer et publier", exact: true }).click();
    await expect(page.getByText("Une autre version a été publiée entre-temps. Rechargez le client.")).toBeFocused();
  });

  test("l'atelier se lit en anglais", async ({ page, context }) => {
    await authenticate(context, "en");
    await control(page, operatorRoutes(OPERATOR_VIEW, (route) => route.fulfill({ status: 500, json: {} })));
    await page.goto("/xsom/regles");
    await expect(page.getByRole("heading", { name: "Compose, test, sign", level: 1 })).toBeVisible();
    await page.getByLabel("Customer").selectOption(TENANT);
    await expect(page.getByText("Valid pack: ready to sign as version 3.")).toBeVisible();
  });
});
