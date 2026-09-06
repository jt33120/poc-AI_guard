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
  await expect(page.getByRole("heading", { name: "xSOM AI Guard" })).toBeVisible();
});

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
  await expect(page.getByText("crm.read")).toBeVisible();
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

// --- Public profile diagnostic (QO-7) ------------------------------------------
//
// No `authed()`: the whole point is that a prospect with no account reaches it.
// A test that signed in first would pass on a screen locked behind a login.

const DIAGNOSTIC = {
  profiles: ["P1a", "P2", "P3"],
  lines: 16,
  applicable: 14,
  ours: 11,
  blocked: 8,
  statement:
    "Sur les 16 lignes de la matrice de menaces, 14 vous concernent réellement compte tenu de votre usage. Sur ces 14, nous en bloquons 8 nativement, chez vous, aujourd'hui.",
  privacy:
    "Votre adresse sert à vous recontacter au sujet de ce diagnostic. Base légale : intérêt légitime (prospection B2B).",
};

test("a prospect with no account gets a diagnostic after giving an e-mail", async ({ page }) => {
  let sent: { profiles?: string[]; email?: string } = {};
  await page.route("**/api/triage", async (route) => {
    sent = JSON.parse(route.request().postData() ?? "{}");
    await route.fulfill({ json: DIAGNOSTIC });
  });

  await page.goto("/triage");

  // The purpose is readable BEFORE anything is handed over — a purpose met only
  // after the fact was not disclosed.
  await expect(page.getByText(/ni revendue ni transmise|neither sold nor passed/)).toBeVisible();

  // Nothing ticked: the submit is refused, so an empty diagnostic can never be
  // presented as an answer.
  await expect(page.getByRole("button", { name: /diagnostic|Voir mon/i })).toBeDisabled();

  await page.getByRole("checkbox").first().check();
  await page.getByLabel(/E-mail|Professional/).fill("prospect@exemple-client.test");
  await page.getByRole("button", { name: /diagnostic|Voir mon/i }).click();

  await expect(page.getByTestId("triage-statement")).toContainText("nous en bloquons 8");
  expect(sent.email).toBe("prospect@exemple-client.test");
  expect(sent.profiles).toEqual(["P1a"]);
});

// --- Langue et métadonnées (L2) ------------------------------------------------
//
// Ces quatre affirmations tenaient toutes au même défaut : le dictionnaire vivait
// dans un hook, donc toute page affichant un mot était un composant client, donc
// aucune page ne pouvait exporter `metadata`, et la langue n'était connue qu'après
// hydratation. Le site démarrait en anglais alors que `<html lang>` était écrit en
// dur à `fr`, et il n'y avait ni titre ni description à indexer.

test("un visiteur sans cookie reçoit le français, et le document le déclare", async ({ page }) => {
  const reponse = await page.goto("/");

  // L'attribut **et** le texte, dans la même assertion : c'est là qu'était le défaut.
  // `lang` valait `fr` en dur pendant que le texte sortait en anglais, si bien qu'un
  // lecteur d'écran lisait de l'anglais avec une voix française. Vérifier l'un sans
  // l'autre laisserait ce désaccord passer.
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(page.getByText("Déployez vos agents IA en production.")).toBeVisible();

  // Le titre et la description existent, et sont français. Sans ce lot il n'y avait
  // ni l'un ni l'autre : une page cliente ne peut pas en exporter.
  await expect(page).toHaveTitle(/Le contrôle des actions de vos agents IA/);
  const description = await page
    .locator('head meta[name="description"]')
    .getAttribute("content");
  expect(description).toContain("gateway MCP");

  // Le français est dans la **première réponse**, pas posé après coup. Avant ce lot,
  // le serveur rendait l'anglais — il ne pouvait pas lire `localStorage` — et le
  // navigateur basculait ensuite : un robot, qui n'hydrate pas, n'a jamais vu que
  // l'anglais. (Que la page soit devenue un composant serveur ne se lit pas ici mais
  // dans le poids du bundle : 2,56 ko de JS de page avant, 187 o après.)
  const html = (await reponse?.text()) ?? "";
  expect(html).toContain("Déployez vos agents IA en production.");
});

test("basculer en anglais tient au rechargement", async ({ page }) => {
  await page.goto("/");
  // `exact` : sans lui, le nom accessible est cherché en sous-chaîne insensible à la
  // casse, et le relevé des menaces a introduit douze boutons qui contiennent « en »
  // (« Empoisonnement », « Agents », « entraînons »). Le sélecteur était juste tant que
  // la page était courte, ce qui est la définition d'un sélecteur fragile.
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(page.getByText("Ship AI agents to production.")).toBeVisible();

  // Le rechargement est le point : la préférence tient dans un cookie que le serveur
  // relit, elle ne vit pas seulement dans l'état d'un composant.
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByText("Ship AI agents to production.")).toBeVisible();
  await expect(page).toHaveTitle(/Action control for your AI agents/);
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

// --- Le relevé des menaces (L5) ------------------------------------------------
//
// Trois propriétés, et la deuxième est celle qui protège la réunion.
//
// Le relevé est **rendu par le serveur** : un prospect qui n'exécute pas de
// JavaScript, et un robot d'indexation, voient les seize lignes.
//
// La page est un **afficheur, pas une calculatrice**. Les comptes viennent du moteur.
// Pour le prouver plutôt que l'affirmer, le mock ci-dessous renvoie des nombres que la
// page ne pourrait pas retrouver seule : si elle recalculait, elle afficherait autre
// chose. C'est la seule façon de distinguer « elle relaie » de « elle recalcule et
// tombe juste ».
//
// Sans le moteur, elle **ne se vide pas**. Une liste vide se lit « aucune menace ».

const RELEVE_P1A = {
  profiles: ["P1a"],
  cap: null as string | null,
  // Volontairement invraisemblables : aucune arithmétique locale ne produirait ça.
  counts: { lines: 16, applicable: 7, ours: 4, blocked: 1 },
  statement: "Énoncé rendu par le moteur, et pas recomposé par la page.",
  rows: [
    {
      id: "M-07",
      titre: "Phishing hyper-personnalisé",
      applicable: true,
      blocked: false,
      owner: "le SOC du client (cyber classique)",
      // Seule la facette « réception » s'applique à P1a. La facette « émission », qui
      // porte les scénarios et le chemin MCP, appartient à un client sous agents.
      facets: [{ cle: "reception", libelle: "réception — passerelle mail", mode: "X" }],
      activates_at: [] as string[],
    },
  ],
};

test("le relevé des seize lignes est rendu par le serveur, sans JavaScript", async ({
  page,
}) => {
  const reponse = await page.goto("/");
  const html = (await reponse?.text()) ?? "";

  for (const id of ["M-01", "M-08", "M-16"]) {
    expect(html).toContain(id);
  }
  // Le titre porte le compte de lignes **interpolé** depuis les faits générés : s'il
  // était écrit à la main, `gen_marketing.py --check` le refuserait en CI.
  expect(html).toContain("lignes de menace");
  expect(html).toContain("Injection de prompts indirecte");

  // Et l'estampille de provenance : un relevé qui ne dit pas de quelle carte il vient
  // ne peut être confronté à rien.
  expect(html).toMatch(/commit [0-9a-f]{7}/);
});

test("la page relaie les comptes du moteur au lieu de les recalculer", async ({ page }) => {
  await page.route("**/api/threats**", async (route) => {
    await route.fulfill({ json: RELEVE_P1A });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /P1a/ }).click();

  // L'énoncé du moteur, mot pour mot. Une page qui le recomposerait écrirait le sien.
  await expect(page.getByText(RELEVE_P1A.statement)).toBeVisible();
});

test("une ligne positionnée ne mêle pas la preuve d'une facette qu'on n'a pas", async ({
  page,
}) => {
  await page.route("**/api/threats**", async (route) => {
    await route.fulfill({ json: RELEVE_P1A });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /P1a/ }).click();

  // `M-07` est applicable à `P1a` par sa seule facette « réception », qui ne porte ni
  // scénario ni chemin d'entrée. Afficher malgré tout « Prouvé sur Passerelle MCP »
  // montrerait la preuve de la facette « émission », que ce visiteur n'a pas : deux
  // affirmations contradictoires sur la même ligne, et la seconde flatterait.
  const rangee = page
    .locator("#menaces div")
    .filter({ hasText: "Phishing hyper-personnalisé" })
    .last();
  await expect(rangee).toContainText("aucun chemin d'entrée asserté");
  await expect(rangee).not.toContainText("Passerelle MCP");
});

test("sans le moteur, le relevé se montre sans se prétendre positionné", async ({ page }) => {
  await page.route("**/api/threats**", async (route) => {
    await route.fulfill({ status: 503, json: { detail: "Relevé momentanément indisponible" } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /P3/ }).click();

  // Il le dit, et les seize lignes restent là. Se vider se lirait « aucune menace »,
  // qui est la plus mauvaise des réponses fausses.
  await expect(page.getByText(/n'ont pas pu être recalculés|could not be recomputed/)).toBeVisible();
  await expect(page.getByText("Injection de prompts indirecte")).toBeVisible();
});

test("ouvrir une ligne hors périmètre affiche la raison publiée dans la carte", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Vol de modèle/ }).click();

  // La raison vient de `coverage/map.json`, pas d'une rédaction de la page : `FR-144`
  // exige qu'une ligne non couverte soit publiée **avec sa raison**.
  await expect(page.getByText(/usage_events/)).toBeVisible();
});

// --- Le rejeu (L6) -------------------------------------------------------------
//
// `AD-26` : une vidéo est l'enregistrement d'une exécution qui passe, jamais un
// substitut. Ces deux tests tiennent ce que cela impose à l'écran.

test("le rejeu montre deux traces réelles, et le même appel des deux côtés", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Injection de prompts indirecte/ }).click();

  const panneau = page.locator("#menaces").getByText("Le même appel, joué deux fois");
  await expect(panneau).toBeVisible();

  // Les deux colonnes, nommées. Le sens de lecture est le propos : à gauche l'action
  // arrive, à droite elle est refusée.
  await expect(page.getByText("Garde retiré", { exact: true })).toBeVisible();
  await expect(page.getByText("Garde en place", { exact: true })).toBeVisible();

  // Le point de divergence est dit, une fois. Sans lui, un lecteur compare deux
  // listes sans savoir où regarder.
  await expect(page.getByText(/cessent d'être la même/)).toBeVisible();

  // Et les traces sont nommées : un rejeu anonyme n'est pas vérifiable, nommé il se
  // relance. C'est ce qui le distingue d'une animation.
  await expect(page.getByText(/tests\/test_taint_gate\.py::/).first()).toBeVisible();
});

test("une ligne sans rejeu publie sa raison plutôt qu'un cadre vide", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Fuite du system prompt/ }).click();

  // `M-14` ne peut pas être rejouée : sa preuve est qu'un argument secret n'atteint
  // pas le journal, si bien que les deux exécutions décident légitimement `allow`.
  // Publier deux colonnes identiques y montrerait un écran où rien ne se passe.
  await expect(page.getByText(/la preuve est une \*\*absence\*\*|preuve est une/)).toBeVisible();
  await expect(
    page.locator("#menaces").getByText("Le même appel, joué deux fois"),
  ).toHaveCount(0);
});
