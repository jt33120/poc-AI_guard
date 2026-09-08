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

// --- Le paysage des menaces (L4) ------------------------------------------------
//
// La section a remplacé les cartes de fonctionnalités. Elle ne revendique aucune
// couverture : c'est le relevé (L5) qui le fait, et `tests/test_menaces_section.py`
// tient la frontière côté source. Ici on vérifie ce que le source ne peut pas dire,
// à savoir que la section arrive **rendue** et complète.
test("le paysage des menaces publie le classement en entier", async ({ page }) => {
  await page.goto("/");
  const paysage = page.locator(".paysage");

  // Vingt-trois rangées, et le compte est le contrôle : une liste tronquée par une
  // erreur de rendu se lirait comme un classement volontairement court.
  await expect(paysage.locator(".menace")).toHaveCount(23);

  // Le rang 01 ouvre, et il porte son numéro de relevé : c'est le lien vers la
  // section qui, elle, prouve quelque chose.
  const premiere = paysage.locator(".menace").first();
  await expect(premiere).toContainText("Injection de prompts indirecte");
  await expect(premiere.locator(".menace__releve")).toHaveText("M-02");
  await expect(premiere).toContainText("critique");

  // Une menace ajoutée hors carte n'affiche aucun numéro : sans quoi elle
  // promettrait une preuve que le relevé ne porte pas.
  const horsReleve = paysage.locator(".menace").nth(5);
  await expect(horsReleve).toContainText("Outil piégé ou description empoisonnée");
  await expect(horsReleve.locator(".menace__releve")).toHaveCount(0);

  // La chaîne d'attaque sert de légende aux pastilles : cinq étapes, et celle que la
  // passerelle tient est marquée.
  await expect(page.locator(".chaine__etape")).toHaveCount(5);
  await expect(page.locator('.chaine__etape[data-tenu="true"]')).toContainText("Ses actions");
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
  // Porté au relevé, et non à la page : le paysage des menaces (L4) nomme la même
  // ligne plus bas, mot pour mot, et un `getByText` de page en trouverait deux.
  // C'est justement ce que `tests/test_menaces_section.py` impose : les deux sections
  // ne peuvent pas appeler une menace autrement l'une que l'autre.
  await expect(page.locator("#menaces").getByText("Injection de prompts indirecte")).toBeVisible();
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

// --- « Pour qui » (L7) ---------------------------------------------------------
//
// Ce que cette section ajoute au relevé : non pas ce qui concerne le visiteur, mais
// ce qui le **concernerait**, et à quelle condition.
//
// Note de méthode, apprise deux fois : `innerText` applique `text-transform`, donc
// toute assertion sur un texte porté par une classe `uppercase` doit être insensible
// à la casse. Deux vérifications manuelles ont échoué sur ce point avant que les
// tests ne soient écrits.

test("un seul sélecteur de profil pilote les deux sections", async ({ page }) => {
  await page.route("**/api/threats**", async (route) => {
    await route.fulfill({
      json: {
        profiles: ["P1a"],
        cap: null,
        counts: { lines: 16, applicable: 8, ours: 5, blocked: 2 },
        statement: "Énoncé du moteur.",
        rows: [
          {
            id: "M-06",
            titre: "Piratage d'agents autonomes",
            applicable: false,
            blocked: false,
            owner: "le client — notre terrain",
            facets: [],
            activates_at: ["P3"],
          },
        ],
      },
    });
  });

  await page.goto("/");
  // Un seul bouton `P1a` sur toute la page : deux sélecteurs poseraient au visiteur
  // une question à laquelle il a déjà répondu, avec deux réponses possibles.
  await expect(page.getByRole("button", { name: /P1a/ })).toHaveCount(1);
  await page.getByRole("button", { name: /P1a/ }).click();

  // Et la bascule apparaît dans « Pour qui », alimentée par le même appel.
  const section = page.locator("#pour-qui");
  await expect(section.getByText("Piratage d'agents autonomes")).toBeVisible();
  await expect(section.getByText(/P3/)).toBeVisible();
});

test("le profil sur lequel nous perdons est publié sans qu'on ait à le cocher", async ({
  page,
}) => {
  await page.goto("/");

  // Rien de coché : l'affirmation la plus crédible de la page doit déjà être là.
  // La cacher derrière une case la réserverait à ceux qui ont deviné.
  const section = page.locator("#pour-qui");
  await expect(section.getByText(/nous n'y bloquons rien/i)).toBeVisible();
  await expect(section.getByText(/aucune passerelle ne s'y intercale/i)).toBeVisible();
});

// --- L'instantané de démonstration (L8) ----------------------------------------
//
// Cette page affichait `governed: 8`, `allow: 124`, `review: 37`, `block: 9` — des
// chiffres **écrits à la main**. Le tenant de démonstration réel en compte 5 gouvernés
// et 93 autorisations : les chiffres inventés flattaient, comme le fait toujours un
// chiffre inventé, sans qu'on l'ait décidé.

test("l'aperçu public montre une lecture réelle, datée et signée", async ({ page }) => {
  const reponse = await page.goto("/executive-preview");
  const html = (await reponse?.text()) ?? "";

  // Le bandeau de provenance : sans lui, un lecteur ne peut pas distinguer une lecture
  // d'une maquette, et c'est précisément la distinction que ce produit vend.
  await expect(page.getByText(/Instantané du tenant de démonstration/)).toBeVisible();
  expect(html).toMatch(/commit [0-9a-f]{7}/);
  await expect(page.getByText(/Chaîne d'audit vérifiée/)).toBeVisible();

  // Et le journal, rendu par le serveur : un robot le voit, et un lecteur sans
  // JavaScript aussi.
  expect(html).toContain("crm.search_consultants");
});

test("les chiffres inventés ne peuvent pas revenir sur l'aperçu", async ({ page }) => {
  await page.goto("/executive-preview");
  const texte = await page.locator("body").innerText();

  // Les quatre valeurs de l'échantillon retiré. Ce test ne vérifie pas une mise en
  // page : il vérifie qu'on n'a pas réintroduit une affirmation sans preuve.
  for (const invente of ["124", "37"]) {
    expect(texte).not.toContain(invente);
  }
  // Et le « 100 % » de couverture, qui n'était pas démontrable : un taux demande un
  // dénominateur, et une action non journalisée ne laisse aucune trace pour le fournir.
  expect(texte).not.toContain("100%");
});

test("ce que l'instantané ne montre pas est dit, avec sa raison", async ({ page }) => {
  await page.goto("/executive-preview");
  // Pas de file d'approbation fabriquée : une demande en attente dans un instantané
  // daté se lit comme une demande à laquelle personne n'a jamais répondu.
  await expect(page.getByText(/Une file est vivante ou n'est pas/)).toBeVisible();
});

// `/mise-en-oeuvre` (`L9`). Les gardes Python de `tests/test_integration_snippets.py`
// prouvent que les extraits n'ont **qu'une** définition, partagée avec l'assistant
// d'intégration. Ce qu'ils ne peuvent pas atteindre : que cette définition ait
// réellement produit du texte, et que ce texte soit arrivé dans la page. Un composant
// serveur qui échoue, ou un `<pre>` qui rendrait `[object Object]`, passerait chacun
// d'eux au vert. La leçon de `L5`, `L7` et `L8` s'est répétée trois fois : regarder la
// page rendue trouve ce que les types, les tests et le build ne trouvent pas.

test("la page d'intégration livre un extrait MCP réellement rendu", async ({ page }) => {
  const reponse = await page.goto("/mise-en-oeuvre");
  const html = (await reponse?.text()) ?? "";

  // Rendu par le serveur : un lecteur sans JavaScript, et un robot, voient l'extrait.
  expect(html).toContain("XSOM_TENANT_TOKEN");
  expect(html).toContain("xsom-ai-guard");
  // Le signe qu'une fonction a bien tourné plutôt qu'un objet collé tel quel.
  expect(html).not.toContain("[object Object]");
});

test("les trois voies apparaissent dans l'ordre décroissant de garantie", async ({ page }) => {
  await page.goto("/mise-en-oeuvre");
  // L'ordre du DOM, et non celui du fichier source : c'est celui que le lecteur subit.
  const titres = await page.locator("h2").allInnerTexts();
  const rangs = ["Passerelle MCP", "/v1/authorize", "Proxy du fournisseur LLM"].map((t) =>
    titres.findIndex((titre) => titre.includes(t)),
  );
  expect(rangs.every((r) => r >= 0)).toBe(true);
  expect(rangs).toEqual([...rangs].sort((a, b) => a - b));

  // Et la distinction qui justifie l'ordre est écrite, pas seulement implicite : sans
  // elle, trois voies se lisent comme trois goûts.
  await expect(page.getByText(/nous exécutons, ou nous n'exécutons pas/)).toBeVisible();
  await expect(page.getByText(/votre agent honore le verdict/)).toBeVisible();
});

test("aucun jeton de la page publique ne peut se lire comme un vrai", async ({ page }) => {
  await page.goto("/mise-en-oeuvre");
  const texte = await page.locator("body").innerText();

  // Un paramètre qui ressemble à un secret finit collé tel quel, et le premier appel
  // échoue sans que personne comprenne pourquoi. Il doit se voir comme un modèle.
  expect(texte).toContain("<votre-jeton-de-passerelle>");
  expect(texte).not.toMatch(/\b(sk|xsg)[-_](live|test|proj)[-_][A-Za-z0-9]{6,}/);
});

// Le favicon. Trois contrôles que les gardes Python de `tests/test_brand_mark.py` ne
// peuvent pas atteindre, et il a fallu les trois : la route se sert, la balise est
// posée, et le navigateur sait **décoder** le fichier.
//
// La première version se servait en 200 avec le bon type MIME et passait tous les
// gardes de structure — et ne s'affichait nulle part : le commentaire du SVG citait les
// jetons de couleur sous leur forme CSS, avec leur préfixe de deux tirets, séquence
// interdite dans un commentaire XML. Seul un rendu réel l'a montré.

test("le favicon est servi, déclaré, et décodable par le navigateur", async ({ page }) => {
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
