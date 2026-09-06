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
  await page.getByRole("button", { name: "EN" }).click();
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
