/**
 * Les chaînes de l'interface, et rien d'autre.
 *
 * Séparées de `i18n.tsx` parce que ce fichier-là est `"use client"` : tant que le
 * dictionnaire y vivait, toute page qui affichait un mot devenait un composant
 * client, et une page client **ne peut pas exporter `metadata`**. Aucune page du
 * site ne portait donc de titre propre, d'Open Graph ni de description — il n'y
 * avait aucun SEO exploitable, sur ce qui est pourtant une page de vente.
 *
 * Ce fichier ne contient aucune primitive React : le serveur et le client
 * l'importent tous les deux, et lisent la même source.
 */

export type Lang = "en" | "fr";

type Entry = { en: string; fr: string };

// All user-visible UI strings. Data (tool names, audit rows) stays as-is.
export const STR = {
  "nav.inspector": { en: "Inspector", fr: "Inspecteur" },
  "nav.approvals": { en: "Approvals", fr: "Approbations" },
  "nav.audit": { en: "Audit", fr: "Audit" },
  "nav.admin": { en: "Admin", fr: "Admin" },
  "nav.signout": { en: "Sign out", fr: "Déconnexion" },
  "nav.norole": { en: "no role", fr: "aucun rôle" },

  "common.loading": { en: "Loading…", fr: "Chargement…" },
  "common.waking": {
    en: "Waking the secure backend: the first load after a quiet period can take up to a minute.",
    fr: "Réveil du serveur sécurisé : le premier chargement après une période d'inactivité peut prendre jusqu'à une minute.",
  },

  // Public profile diagnostic (QO-7)
  "triage.title": {
    en: "What of this actually concerns you?",
    fr: "Qu'est-ce qui vous concerne vraiment ?",
  },
  "triage.lede": {
    en: "The market shows you a list of AI threats. Most of them are not yours. Tick how your organisation uses AI and see which lines apply, which are ours to hold, and which we block today.",
    fr: "Le marché vous montre une liste de menaces IA. La plupart ne sont pas les vôtres. Cochez la façon dont votre organisation utilise l'IA, et voyez quelles lignes vous concernent, lesquelles sont sur notre terrain, et lesquelles nous bloquons aujourd'hui.",
  },
  "triage.profiles": { en: "How do you use AI?", fr: "Comment utilisez-vous l'IA ?" },
  "triage.p1a": { en: "We call a hyperscaler API", fr: "Nous appelons une API hyperscaler" },
  "triage.p1a.hint": {
    en: "Azure OpenAI, Bedrock and the like, from our own code.",
    fr: "Azure OpenAI, Bedrock et similaires, depuis notre propre code.",
  },
  "triage.p1b": { en: "AI embedded in a SaaS suite", fr: "IA embarquée dans une suite SaaS" },
  "triage.p1b.hint": {
    en: "Copilot, Gemini in Workspace and the like.",
    fr: "Copilot, Gemini dans Workspace et similaires.",
  },
  "triage.p2": { en: "Internal RAG over our documents", fr: "RAG interne sur nos documents" },
  "triage.p2.hint": {
    en: "The AI reads our own corpora to answer.",
    fr: "L'IA lit nos propres corpus pour répondre.",
  },
  "triage.p3": { en: "Tooled agents that act", fr: "Agents outillés qui agissent" },
  "triage.p3.hint": {
    en: "The AI sends, writes, pays or deploys. It does not only answer.",
    fr: "L'IA envoie, écrit, paie ou déploie. Elle ne fait pas que répondre.",
  },
  "triage.p4": { en: "Self-hosted open weights", fr: "Poids ouverts auto-hébergés" },
  "triage.p4.hint": {
    en: "We run the model ourselves.",
    fr: "Nous exécutons le modèle nous-mêmes.",
  },
  "triage.p5": { en: "We train or fine-tune", fr: "Nous entraînons ou affinons" },
  "triage.p5.hint": {
    en: "Our own training or fine-tuning pipelines.",
    fr: "Nos propres chaînes d'entraînement ou d'affinage.",
  },
  "triage.email": { en: "Professional e-mail", fr: "E-mail professionnel" },
  "triage.submit": { en: "See my diagnostic", fr: "Voir mon diagnostic" },
  "triage.busy": { en: "Computing…", fr: "Calcul en cours…" },
  "triage.needprofile": {
    en: "Tick at least one: the diagnostic is the crossing of your usage with what we prove.",
    fr: "Cochez-en au moins un : le diagnostic est le croisement de votre usage avec ce que nous prouvons.",
  },
  "triage.failed": { en: "The diagnostic could not be computed.", fr: "Le diagnostic n'a pas pu être calculé." },
  "triage.result.lines": { en: "threat lines", fr: "lignes de menace" },
  "triage.result.applicable": { en: "concern you", fr: "vous concernent" },
  "triage.result.ours": { en: "are ours to hold", fr: "sont sur notre terrain" },
  "triage.result.blocked": { en: "we block today", fr: "nous bloquons aujourd'hui" },
  "triage.result.again": { en: "Change my answers", fr: "Modifier mes réponses" },
  // The purpose statement is rendered from the API response, never hardcoded here:
  // the text that governs a collection must travel with the collection.
  "triage.privacy.before": {
    en: "Your address is used to get back to you about this diagnostic. It is neither sold nor passed to a third party, and you may ask for its deletion at any time.",
    fr: "Votre adresse sert à vous recontacter au sujet de ce diagnostic. Elle n'est ni revendue ni transmise à un tiers, et vous pouvez demander sa suppression à tout moment.",
  },

  // Welcome / landing
  "welcome.badge": {
    en: "AI agent action governance",
    fr: "Gouvernance des actions des agents IA",
  },
  "welcome.tagline": {
    en: "The control layer for AI agents in production.",
    fr: "La couche de contrôle pour vos agents IA en production.",
  },
  "welcome.subtitle": {
    en: "Put your AI agents to work without losing control. Every action they take is authorized against your policy, held for human approval when it's irreversible, and recorded in a tamper-proof audit trail.",
    fr: "Faites travailler vos agents IA sans perdre le contrôle. Chaque action est autorisée selon votre politique, mise en attente d'une validation humaine si elle est irréversible, et consignée dans un journal d'audit inviolable.",
  },
  "welcome.cta.open": { en: "Open the console", fr: "Ouvrir la console" },
  "welcome.cta.signin": { en: "Sign in", fr: "Se connecter" },

  "welcome.p1.title": { en: "Control what the agent does", fr: "Contrôler ce que l'agent fait" },
  "welcome.p1.body": {
    en: "Not a prompt filter, but a gate on real actions: sending emails, deleting records, deploying. Each call is allowed, held, or blocked by your policy.",
    fr: "Pas un filtre de prompt, mais un contrôle sur les actions réelles : envoyer un email, supprimer un enregistrement, déployer. Chaque appel est autorisé, retenu ou bloqué selon votre politique.",
  },
  "welcome.p2.title": { en: "Human in the loop", fr: "L'humain dans la boucle" },
  "welcome.p2.body": {
    en: "Irreversible actions pause for a human decision. Nothing critical happens without explicit approval, and you can require two approvers for the riskiest moves.",
    fr: "Les actions irréversibles s'arrêtent pour une décision humaine. Rien de critique ne se produit sans validation explicite, et vous pouvez exiger deux validateurs pour les opérations les plus sensibles.",
  },
  "welcome.p3.title": { en: "Compliance-ready audit", fr: "Audit prêt pour la conformité" },
  "welcome.p3.body": {
    en: "An immutable, hash-chained log of every decision and approval. Your evidence for the EU AI Act and GDPR, exportable in one click.",
    fr: "Un journal immuable et chaîné par hash de chaque décision et validation. Votre preuve pour l'AI Act européen et le RGPD, exportable en un clic.",
  },
  "welcome.monitors.title": { en: "What it monitors", fr: "Ce qu'il surveille" },
  "welcome.monitors.body": {
    en: "Every tool-call your agent makes: reads run automatically; sensitive sends and irreversible operations are gated and logged.",
    fr: "Chaque appel d'outil de votre agent : les lectures passent automatiquement ; les envois sensibles et les opérations irréversibles sont contrôlés et journalisés.",
  },

  // ── Public landing (pre-login marketing) ─────────────────────────────
  "land.nav.signin": { en: "Sign in", fr: "Se connecter" },
  "land.nav.demo": { en: "Request a demo", fr: "Demander une démo" },
  "land.hero.badge": {
    en: "Action governance for AI agents",
    fr: "Gouvernance des actions pour agents IA",
  },
  // --- Mise en œuvre (L9) -----------------------------------------------------
  //
  // Trois voies, dans l'ordre décroissant de garantie. Les extraits ne sont pas
  // rédigés ici : ils viennent de `lib/integration.ts`, partagé avec l'assistant
  // d'intégration, pour qu'une page publique ne puisse pas apprendre autre chose que
  // ce qu'un client reçoit réellement.
  "mise.kicker": { en: "How it works", fr: "Comment ça marche" },
  "mise.title": {
    en: "Three ways in. They do not offer the same guarantee, and we say which.",
    fr: "Trois voies d'entrée. Elles n'offrent pas la même garantie, et nous disons laquelle.",
  },
  "mise.lede": {
    en: "Ordered by how much they can promise, strongest first. The difference is not a detail of integration: it decides whether a refused action can still happen.",
    fr: "Classées par ce qu'elles peuvent promettre, la plus forte d'abord. La différence n'est pas un détail d'intégration : elle décide si une action refusée peut malgré tout avoir lieu.",
  },
  "mise.garantie": { en: "Guarantee", fr: "Garantie" },
  "mise.livre": { en: "What you paste", fr: "Ce que vous collez" },

  "mise.mcp.t": { en: "MCP gateway", fr: "Passerelle MCP" },
  "mise.mcp.g": { en: "Binding: we execute, or we do not", fr: "Contraignante : nous exécutons, ou nous n'exécutons pas" },
  "mise.mcp.b": {
    en: "The gateway sits between your agent and its tool servers. A refused call never reaches the downstream, because the call goes through us. Nothing in the agent has to cooperate, which is why this is the only path we describe as binding.",
    fr: "La passerelle s'intercale entre votre agent et ses serveurs d'outils. Un appel refusé n'atteint jamais l'aval, parce que l'appel passe par nous. Rien dans l'agent n'a à coopérer, et c'est pourquoi c'est la seule voie que nous qualifions de contraignante.",
  },
  "mise.mcp.note": {
    en: "The stdio gateway reads two variables and no others. Any different name ships a snippet that cannot work, so what follows mirrors the runtime literally.",
    fr: "La passerelle stdio ne lit que deux variables. Tout autre nom livre un extrait qui ne peut pas fonctionner, donc ce bloc reproduit le runtime à la lettre.",
  },

  "mise.http.t": { en: "POST /v1/authorize", fr: "POST /v1/authorize" },
  "mise.http.g": { en: "Cooperative: your agent honours the verdict", fr: "Coopérative : votre agent honore le verdict" },
  "mise.http.b": {
    en: "One HTTP call before you execute a tool, in any language. We return a verdict; your code decides to obey it. That is a real difference from the gateway, and pretending otherwise would be the kind of claim this whole product exists to refuse. Use it when you own the agent's code.",
    fr: "Un appel HTTP avant d'exécuter un outil, dans n'importe quel langage. Nous rendons un verdict ; votre code décide de l'honorer. C'est une vraie différence avec la passerelle, et prétendre le contraire serait exactement le genre d'affirmation que ce produit existe pour refuser. À employer quand vous maîtrisez le code de l'agent.",
  },

  "mise.proxy.t": { en: "LLM provider proxy", fr: "Proxy du fournisseur LLM" },
  "mise.proxy.g": { en: "Binding on egress, zero code", fr: "Contraignante sur l'egress, sans code" },
  "mise.proxy.b": {
    en: "Point an SDK's base_url at xSOM. Every prompt and every tool call the model makes is inspected on the way out. Your provider key is forwarded and never stored. Nothing else in your stack changes.",
    fr: "Pointez le base_url d'un SDK sur xSOM. Chaque prompt et chaque appel d'outil du modèle est inspecté en sortie. Votre clé fournisseur est relayée et jamais stockée. Rien d'autre ne change dans votre pile.",
  },

  "mise.jeton": {
    en: "Replace the placeholder with the gateway token the console shows you once, at creation. Only its SHA-256 hash is stored.",
    fr: "Remplacez le paramètre fictif par le jeton de passerelle que la console affiche une seule fois, à la création. Seule son empreinte SHA-256 est conservée.",
  },
  "mise.identique": {
    en: "These are the same snippets the onboarding wizard hands you. A public page that taught something else would teach what does not work.",
    fr: "Ce sont les extraits que l'assistant d'intégration vous remet. Une page publique qui enseignerait autre chose enseignerait ce qui ne marche pas.",
  },

  // --- L'instantané de démonstration (L8) --------------------------------------
  //
  // Le bandeau dit ce que la page est : une lecture datée d'un tenant fabriqué, en
  // lecture seule. Aucun chiffre écrit ici — ils viennent tous de l'instantané.
  "demo.bandeau": {
    en: "Snapshot of the demonstration tenant, read on {date}, commit {commit}. Read-only, fabricated fixture, no customer data.",
    fr: "Instantané du tenant de démonstration, relu le {date}, commit {commit}. Lecture seule, fixture fabriquée, aucune donnée client.",
  },
  "demo.bandeau.chaine": { en: "Audit chain verified at capture", fr: "Chaîne d'audit vérifiée à la capture" },
  "demo.titre": { en: "What the console shows", fr: "Ce que la console montre" },
  "demo.lede": {
    en: "Not a mock-up and not a video: the figures below are read back from a seeded tenant whose fixture is committed and reviewable. What you see is what that tenant contains.",
    fr: "Ni maquette ni vidéo : les chiffres ci-dessous sont relus depuis un tenant semé dont la fixture est committée et relisible. Ce que vous voyez est ce que ce tenant contient.",
  },
  "demo.journal.t": { en: "The audit ledger", fr: "Le journal d'audit" },
  "demo.journal.b": {
    en: "Every governed action, in order, with the rule that decided it. Argument contents are never written: the product logs metadata and fingerprints.",
    fr: "Chaque action gouvernée, dans l'ordre, avec la règle qui l'a décidée. Le contenu des arguments n'est jamais écrit : le produit journalise des métadonnées et des empreintes.",
  },
  "demo.journal.jours": { en: "days ago", fr: "j" },
  "demo.journal.reste": { en: "and {n} more entries in the snapshot", fr: "et {n} autres entrées dans l'instantané" },
  "demo.portee": { en: "What is not here, and why", fr: "Ce qui n'y est pas, et pourquoi" },
  "demo.portee.b": {
    en: "No approval queue and no spend. The fixture writes neither, and a frozen queue would be worse than none: a request left pending in a dated snapshot reads as one nobody ever answered, which is the opposite of the mechanism. A queue is live or it is nothing.",
    fr: "Pas de file d'approbation, pas de dépense. La fixture n'en écrit aucune, et une file figée serait pire que pas de file : une demande en attente dans un instantané daté se lit comme une demande à laquelle personne n'a jamais répondu, soit l'inverse du mécanisme. Une file est vivante ou n'est pas.",
  },

  // --- Pour qui (L7) ----------------------------------------------------------
  //
  // Pas une liste de secteurs, pas de logos. Le visiteur lit son propre relevé, et
  // surtout ce qui **deviendrait** le sien. Aucun chiffre écrit ici : le gate de `L4`
  // les refuse, et ceux qui comptent viennent du moteur.
  "pourqui.kicker": { en: "Who this is for", fr: "Pour qui" },
  "pourqui.title": {
    en: "And, just as plainly, who it is not for.",
    fr: "Et, tout aussi clairement, pour qui ce n'est pas.",
  },
  "pourqui.lede": {
    en: "The market sells you all the threat rows because it can. Several of them belong to the outfit that trains your model, or to the SOC you already pay. Saying so out loud is not a concession, it is the reason you can believe the rest.",
    fr: "Le marché vous vend toutes les lignes de menace parce qu'il le peut. Plusieurs appartiennent à l'éditeur qui entraîne votre modèle, ou au SOC que vous payez déjà. Le dire à voix haute n'est pas une concession, c'est ce qui rend le reste croyable.",
  },

  "pourqui.tri.t": { en: "The founding sort", fr: "Le tri fondateur" },
  "pourqui.tri.b": {
    en: "Attacks aimed at a model publisher are not the ones aimed at a large company that uses AI. The matrix blends the one into the other without saying so, because everyone gains from selling the whole list.",
    fr: "Les attaques qui visent un éditeur de modèle ne sont pas celles qui visent un grand compte qui utilise l'IA. La matrice mélange les unes aux autres sans le dire, parce que tout le monde gagne à vendre la liste entière.",
  },

  "pourqui.profils.t": { en: "Where you sit", fr: "Où vous vous situez" },
  "pourqui.profils.b": {
    en: "Each profile adds to the ones before it. Tick yours: the ledger above recomputes, and so does what follows.",
    fr: "Chaque profil s'ajoute aux précédents. Cochez le vôtre : le relevé ci-dessus se recalcule, et ce qui suit aussi.",
  },
  "pourqui.plafond": {
    en: "We block nothing here, and we publish it",
    fr: "Nous n'y bloquons rien, et nous le publions",
  },
  "pourqui.plafond.vous": { en: "this is your case", fr: "c'est votre cas" },
  "pourqui.plafond.b": {
    en: "Inside a SaaS-embedded assistant, the actions run within the suite and no gateway comes between them. Detection and log attestation are reachable; refusing an action is not. A vendor claiming to supervise that through a proxy has either not understood the product or is counting on you not to ask.",
    fr: "Dans une IA embarquée d'une suite SaaS, les actions s'exécutent à l'intérieur de la suite et aucune passerelle ne s'y intercale. La détection et l'attestation de journal sont atteignables ; refuser une action ne l'est pas. Un éditeur qui prétend superviser cela par un proxy n'a pas compris le produit, ou compte sur le fait que vous ne poserez pas la question.",
  },
  "pourqui.coeur": { en: "Our ground", fr: "Notre terrain" },
  "pourqui.coeur.b": {
    en: "Tooled agents that act: send, write, pay, deploy. Mandatory enforcement, a human on the irreversible, recomputable proof.",
    fr: "Les agents outillés qui agissent : envoyer, écrire, payer, déployer. Contrôle obligatoire, un humain sur l'irréversible, preuve recalculable.",
  },

  "pourqui.bascules.t": { en: "What would become yours, and when", fr: "Ce qui deviendrait la vôtre, et quand" },
  "pourqui.bascules.b": {
    en: "These rows are not yours today. Each one names the condition that would make it yours. It is a date in your roadmap, not a scenario we invented.",
    fr: "Ces lignes ne sont pas les vôtres aujourd'hui. Chacune nomme la condition qui les ferait basculer. C'est une date de votre feuille de route, pas un scénario que nous avons inventé.",
  },
  "pourqui.bascules.vide": {
    en: "Tick a profile above and this list fills itself from the engine.",
    fr: "Cochez un profil ci-dessus et cette liste se remplit depuis le moteur.",
  },
  "pourqui.bascules.aucune": {
    en: "Nothing left to switch on: every row already concerns you.",
    fr: "Plus rien à faire basculer : toutes les lignes vous concernent déjà.",
  },
  "pourqui.bascules.le": { en: "becomes yours with", fr: "bascule avec" },

  // --- Le rejeu (L6) ----------------------------------------------------------
  //
  // Aucun chiffre de couverture ici : le gate de `L4` refuserait « nous bloquons N
  // lignes » au même titre écrit en lettres. Ce que ces chaînes décrivent, c'est une
  // séquence, pas un compte.
  "rejeu.titre": { en: "The same call, played twice", fr: "Le même appel, joué deux fois" },
  "rejeu.lede": {
    en: "Not an animation. Both columns are audit trails captured while the test suite ran: one with the guard removed, one with it in place. The tools called are identical. The difference is us.",
    fr: "Pas une animation. Les deux colonnes sont des traces d'audit capturées pendant l'exécution de la suite de tests : l'une garde retiré, l'autre garde en place. Les outils appelés sont les mêmes. La différence, c'est nous.",
  },
  "rejeu.sans": { en: "Guard removed", fr: "Garde retiré" },
  "rejeu.avec": { en: "Guard in place", fr: "Garde en place" },
  "rejeu.sans.b": { en: "The action reaches its target.", fr: "L'action atteint sa cible." },
  "rejeu.avec.b": { en: "The action is refused.", fr: "L'action est refusée." },
  "rejeu.divergence": {
    en: "From here on, the two runs stop being the same.",
    fr: "À partir d'ici, les deux exécutions cessent d'être la même.",
  },
  "rejeu.chainee": { en: "Audit chain verified", fr: "Chaîne d'audit vérifiée" },
  "rejeu.chainee.non": { en: "Audit chain not verified", fr: "Chaîne d'audit non vérifiée" },
  "rejeu.source": {
    en: "Captured during the test run named below, not re-enacted.",
    fr: "Capturé pendant l'exécution du test nommé ci-dessous, non rejoué.",
  },
  "rejeu.outils": { en: "Tools called", fr: "Outils appelés" },
  "rejeu.col.outil": { en: "Tool", fr: "Outil" },
  "rejeu.col.classe": { en: "Class", fr: "Classe" },
  "rejeu.col.decision": { en: "Decision", fr: "Décision" },
  "rejeu.col.empreinte": { en: "Args fingerprint", fr: "Empreinte des arguments" },
  "rejeu.empreinte.aucune": { en: "none", fr: "aucune" },
  "rejeu.empreinte.note": {
    en: "A fingerprint, never your arguments. That is what the product writes, and it is what you see here.",
    fr: "Une empreinte, jamais vos arguments. C'est ce que le produit écrit, et c'est ce que vous voyez ici.",
  },
  "rejeu.absent": {
    en: "No recorded sequence for this row yet.",
    fr: "Pas encore de séquence enregistrée pour cette ligne.",
  },

  // --- Le relevé des menaces (L5) ---------------------------------------------
  //
  // Aucun chiffre n'est écrit ici : `scripts/gen_marketing.py --check` le refuse, et
  // « seize lignes » serait refusé au même titre que « 16 lignes ». Tout passe par les
  // faits générés depuis la carte.
  "ledger.kicker": { en: "The ledger", fr: "Le relevé" },
  "ledger.title": {
    en: "{lignes} threat rows. What we hold, and what we do not.",
    fr: "{lignes} lignes de menace. Ce que nous tenons, et ce que nous ne tenons pas.",
  },
  "ledger.lede": {
    en: "The market hands you a list and sells you all of it. This one is generated from the test suite: each row carries its coverage mode, the ingress path it was proven on, and the scenario that proves it. Where we prove nothing, it says so.",
    fr: "Le marché vous tend une liste et vous la vend en entier. Celle-ci est générée depuis la suite de tests : chaque ligne porte son mode de couverture, le chemin d'entrée sur lequel elle est prouvée, et le scénario qui la prouve. Là où nous ne prouvons rien, elle le dit.",
  },
  "ledger.profil.title": { en: "How do you use AI?", fr: "Comment utilisez-vous l'IA ?" },
  "ledger.profil.hint": {
    en: "Tick your situation. The counts are recomputed by the same engine the product uses.",
    fr: "Cochez votre situation. Les comptes sont recalculés par le moteur que le produit utilise.",
  },
  "ledger.profil.none": {
    en: "Nothing ticked: every row is shown, none is claimed to be yours.",
    fr: "Rien de coché : toutes les lignes sont montrées, aucune n'est présentée comme la vôtre.",
  },
  "ledger.profil.busy": { en: "Recomputing…", fr: "Recalcul…" },
  "ledger.profil.failed": {
    en: "The counts could not be recomputed. The rows below are the published ledger, unpositioned.",
    fr: "Les comptes n'ont pas pu être recalculés. Les lignes ci-dessous sont le relevé publié, non positionné.",
  },

  // Les cinq modes. `Bloqué` est le seul qui autorise le verbe « bloquer » (FR-175).
  "ledger.mode.B": { en: "Blocked", fr: "Bloqué" },
  "ledger.mode.D": { en: "Detected", fr: "Détecté" },
  "ledger.mode.O": { en: "Orchestrated", fr: "Orchestré" },
  "ledger.mode.A": { en: "Attested", fr: "Attesté" },
  "ledger.mode.X": { en: "Out of scope", fr: "Hors périmètre" },
  "ledger.mode.NA": { en: "Not asserted", fr: "Non asserté" },
  "ledger.mode.B.def": {
    en: "We refuse the action ourselves. A passing scenario blocks it, and another lets a legitimate call through.",
    fr: "Nous refusons l'action nous-mêmes. Un scénario passant la bloque, un autre laisse passer un appel légitime.",
  },
  "ledger.mode.D.def": {
    en: "We see it and we log it. We do not stop it.",
    fr: "Nous la voyons et nous la journalisons. Nous ne l'arrêtons pas.",
  },
  "ledger.mode.O.def": {
    en: "We drive a third-party control that does it, and we name that control.",
    fr: "Nous pilotons un contrôle tiers qui le fait, et nous nommons ce contrôle.",
  },
  "ledger.mode.A.def": {
    en: "We attest that a control is in place. We do not claim to exercise it.",
    fr: "Nous attestons qu'un contrôle est en place. Nous ne prétendons pas l'exercer.",
  },
  "ledger.mode.X.def": {
    en: "Not ours. The row says who carries it.",
    fr: "Pas à nous. La ligne dit qui la porte.",
  },

  // Les chemins d'entrée. Une revendication vraie sur MCP n'est pas vraie partout
  // (AD-28) : le chemin voyage avec elle.
  "ledger.ingress.mcp": { en: "MCP gateway", fr: "Passerelle MCP" },
  "ledger.ingress.http": { en: "POST /v1/authorize", fr: "POST /v1/authorize" },
  "ledger.ingress.llm_proxy": { en: "LLM proxy", fr: "Proxy LLM" },
  "ledger.ingress.label": { en: "Proven on", fr: "Prouvé sur" },
  "ledger.ingress.none": { en: "no ingress path asserted", fr: "aucun chemin d'entrée asserté" },

  // Les quatre ouvertures. Elles ne sont pas un choix de rédaction : `core.threat_map`
  // les dérive de ce que la ligne a réellement.
  "ledger.open.rejeu.b": {
    en: "This row carries the proof whole: a scenario where the call is refused, and another where a legitimate call goes through. The replay plays them side by side, from the real audit trail.",
    fr: "Cette ligne porte la preuve entière : un scénario où l'appel est refusé, et un autre où un appel légitime passe. Le rejeu les joue côte à côte, depuis la trace d'audit réelle.",
  },
  "ledger.open.scenario.t": { en: "What the scenarios prove", fr: "Ce que les scénarios prouvent" },
  "ledger.open.scenario.b": {
    en: "Scenarios pass on this row, but none of them refuses the action. Showing a replay here would show a screen where nothing happens, which a crash would produce identically.",
    fr: "Des scénarios passent sur cette ligne, mais aucun ne refuse l'action. Un rejeu montrerait ici un écran où rien ne se passe, ce qu'un plantage produirait à l'identique.",
  },
  "ledger.open.raison.t": { en: "Why this one is not ours", fr: "Pourquoi celle-ci n'est pas à nous" },
  "ledger.open.attestation.t": { en: "What we attest", fr: "Ce que nous attestons" },
  "ledger.open.attestation.b": {
    en: "No scenario, and no published reason. We attest that the control exists and that its use is recorded. We do not claim to enforce it, and saying so is the point of the ledger.",
    fr: "Aucun scénario, aucune raison publiée. Nous attestons que le contrôle existe et que son usage est journalisé. Nous ne prétendons pas l'imposer, et le dire est la raison d'être du relevé.",
  },
  "ledger.open.scenarios": { en: "Scenarios that prove it", fr: "Les scénarios qui la prouvent" },
  "ledger.open.gaps": { en: "Named gaps", fr: "Écarts nommés" },
  "ledger.open.facets": { en: "Facets of this row", fr: "Les facettes de cette ligne" },

  "ledger.owner.mine": { en: "Yours, and our ground", fr: "La vôtre, et notre terrain" },
  "ledger.owner.not": { en: "Not yours today", fr: "Pas la vôtre aujourd'hui" },
  "ledger.activates": { en: "Becomes yours with", fr: "Le devient avec" },
  "ledger.applicable": { en: "concerns you", fr: "vous concerne" },
  "ledger.expand": { en: "Open this row", fr: "Ouvrir cette ligne" },
  "ledger.collapse": { en: "Close this row", fr: "Fermer cette ligne" },
  "ledger.stamp": {
    en: "Ledger generated from the passing test suite on {date}, commit {commit}. Nothing here is written by hand.",
    fr: "Relevé généré depuis la suite de tests passante le {date}, commit {commit}. Rien ici n'est écrit à la main.",
  },
  "ledger.cap": {
    en: "Your usage is capped: inside a SaaS-embedded assistant there is no tool boundary to interpose on. We block nothing in that perimeter, and we say so before you find out.",
    fr: "Votre usage est plafonné : dans une IA embarquée d'une suite SaaS, il n'y a aucune frontière d'outils où nous interposer. Nous ne bloquons rien de ce périmètre, et nous le disons avant que vous ne le découvriez.",
  },

  // Le `<title>` et la `<meta description>`, distincts du titre affiché. Le héros fait
  // 58 caractères et le sous-titre 350 : repris tels quels, un moteur de recherche
  // tronque les deux. Ces deux clés-ci sont taillées pour la place réellement offerte.
  "meta.tagline": {
    en: "Action control for your AI agents",
    fr: "Le contrôle des actions de vos agents IA",
  },
  "meta.description": {
    en: "An MCP gateway that checks every agent action against your policy, holds irreversible ones for human approval, and logs all of it.",
    fr: "Un gateway MCP qui vérifie chaque action de vos agents selon votre politique, suspend l'irréversible pour validation humaine, et journalise tout.",
  },
  "land.hero.title": {
    en: "Ship AI agents to production. Without losing control.",
    fr: "Déployez vos agents IA en production. Sans perdre le contrôle.",
  },
  "land.hero.sub": {
    en: "xSOM AI Guard sits between your agent and the tools it uses. Every action is checked against your policy, paused for human approval when it's irreversible, and written to a tamper-proof audit trail. You get the productivity of autonomous agents with the control your business and regulators require.",
    fr: "xSOM AI Guard s'intercale entre votre agent et les outils qu'il utilise. Chaque action est vérifiée selon votre politique, suspendue pour validation humaine si elle est irréversible, et inscrite dans un journal d'audit inviolable. Vous obtenez la productivité des agents autonomes, avec le contrôle qu'exigent votre entreprise et vos régulateurs.",
  },
  "land.hero.cta": { en: "Open the console", fr: "Ouvrir la console" },
  "land.hero.cta2": { en: "See how it works", fr: "Voir comment ça marche" },
  "land.hero.trust": {
    en: "Designed for the EU AI Act & GDPR",
    fr: "Conçu pour l'AI Act européen et le RGPD",
  },


  "land.problem.kicker": { en: "The problem", fr: "Le problème" },
  "land.problem.title": {
    en: "AI agents don't just talk. They act.",
    fr: "Les agents IA ne font pas que parler. Ils agissent.",
  },
  "land.problem.body": {
    en: "They send emails, update records, move money, delete data, call internal APIs. A prompt filter can't stop a bad action: by the time the text is generated, the action is one tool-call away. You need a control point on what the agent does, not just on what it says.",
    fr: "Ils envoient des emails, modifient des enregistrements, déplacent de l'argent, suppriment des données, appellent des API internes. Un filtre de prompt ne peut pas arrêter une mauvaise action : quand le texte est généré, l'action n'est qu'à un appel d'outil. Il faut un point de contrôle sur ce que l'agent fait, pas seulement sur ce qu'il dit.",
  },

  "land.how.kicker": { en: "How it works", fr: "Comment ça marche" },
  "land.how.title": {
    en: "A control point on every action",
    fr: "Un point de contrôle sur chaque action",
  },
  "land.how.agent": { en: "AI agent", fr: "Agent IA" },
  "land.how.agent.sub": {
    en: "Assistant, copilot, or autonomous workflow",
    fr: "Assistant, copilote ou workflow autonome",
  },
  "land.how.guard": { en: "xSOM AI Guard", fr: "xSOM AI Guard" },
  "land.how.guard.sub": {
    en: "Policy · Human-in-the-loop · Audit",
    fr: "Politique · Validation humaine · Audit",
  },
  "land.how.tools": { en: "Your tools & systems", fr: "Vos outils & systèmes" },
  "land.how.tools.sub": {
    en: "CRM, email, database, internal APIs",
    fr: "CRM, email, base de données, API internes",
  },
  "land.how.s1.t": { en: "1 · Classify", fr: "1 · Classer" },
  "land.how.s1.b": {
    en: "Every tool-call is classified: read, write, external send, or irreversible.",
    fr: "Chaque appel d'outil est classé : lecture, écriture, envoi externe ou irréversible.",
  },
  "land.how.s2.t": { en: "2 · Decide", fr: "2 · Décider" },
  "land.how.s2.b": {
    en: "A deterministic policy allows it, blocks it, or holds it for a human.",
    fr: "Une politique déterministe l'autorise, la bloque, ou la met en attente d'un humain.",
  },
  "land.how.s3.t": { en: "3 · Prove", fr: "3 · Prouver" },
  "land.how.s3.b": {
    en: "Each decision is hash-chained into an immutable, exportable audit trail.",
    fr: "Chaque décision est chaînée par hash dans un journal immuable et exportable.",
  },

  "land.feat.kicker": { en: "Key features", fr: "Fonctionnalités clés" },
  "land.feat.title": { en: "Everything you need to trust an agent", fr: "Tout pour faire confiance à un agent" },
  "land.feat.1.t": { en: "Control actions, not prompts", fr: "Contrôler les actions, pas les prompts" },
  "land.feat.1.b": {
    en: "A gate on real operations, not a text filter. Allow, block, or pause any tool-call.",
    fr: "Un contrôle des opérations réelles, pas un filtre de texte. Autoriser, bloquer ou suspendre chaque appel d'outil.",
  },
  "land.feat.2.t": { en: "Human in the loop", fr: "L'humain dans la boucle" },
  "land.feat.2.b": {
    en: "Irreversible actions pause for explicit approval, with dual control for the riskiest moves.",
    fr: "Les actions irréversibles s'arrêtent pour validation explicite, avec double validation pour les plus sensibles.",
  },
  "land.feat.3.t": { en: "Tamper-proof audit", fr: "Audit inviolable" },
  "land.feat.3.b": {
    en: "Every decision hash-chained and append-only. Prove what your agents did, and what they didn't.",
    fr: "Chaque décision chaînée par hash et append-only. Prouvez ce que vos agents ont fait, et ce qu'ils n'ont pas fait.",
  },
  "land.feat.4.t": { en: "Compliance, exported", fr: "Conformité, exportée" },
  "land.feat.4.b": {
    en: "One-click evidence packs for the EU AI Act and GDPR, ready for your auditors.",
    fr: "Des dossiers de preuve en un clic pour l'AI Act européen et le RGPD, prêts pour vos auditeurs.",
  },
  "land.feat.5.t": { en: "Deterministic + smart", fr: "Déterministe + intelligent" },
  "land.feat.5.b": {
    en: "A fast rules engine decides the clear cases; an LLM judge handles the ambiguous ones.",
    fr: "Un moteur de règles rapide tranche les cas clairs ; un juge LLM gère les cas ambigus.",
  },
  "land.feat.6.t": { en: "Multi-tenant by design", fr: "Multi-tenant par conception" },
  "land.feat.6.b": {
    en: "Strict tenant isolation at the database level. Your data never crosses lines.",
    fr: "Isolation stricte des locataires au niveau base de données. Vos données ne se croisent jamais.",
  },

  "land.comp.kicker": { en: "Built for compliance", fr: "Conçu pour la conformité" },
  "land.comp.title": { en: "Evidence, not promises", fr: "Des preuves, pas des promesses" },
  "land.comp.body": {
    en: "The EU AI Act requires human oversight (Article 14) and record-keeping for high-risk AI. xSOM produces exactly that: a complete, verifiable trail of every decision and approval, exportable for auditors and regulators in one click.",
    fr: "L'AI Act européen exige une supervision humaine (Article 14) et une traçabilité pour l'IA à haut risque. xSOM produit exactement cela : une trace complète et vérifiable de chaque décision et validation, exportable pour auditeurs et régulateurs en un clic.",
  },

  "land.who.kicker": { en: "Who it's for", fr: "Pour qui" },
  "land.who.title": {
    en: "For teams putting AI agents to work",
    fr: "Pour les équipes qui mettent les agents IA au travail",
  },
  "land.who.1.t": { en: "Customer-facing assistants", fr: "Assistants clients" },
  "land.who.1.b": {
    en: "Keep autonomous support and sales agents on-policy.",
    fr: "Gardez vos agents de support et de vente autonomes conformes à la politique.",
  },
  "land.who.2.t": { en: "Internal copilots", fr: "Copilotes internes" },
  "land.who.2.b": {
    en: "Let employees' AI tools act on real systems, safely.",
    fr: "Laissez les outils IA des employés agir sur les vrais systèmes, en toute sécurité.",
  },
  "land.who.3.t": { en: "Back-office automation", fr: "Automatisation back-office" },
  "land.who.3.b": {
    en: "Gate the irreversible steps inside autonomous workflows.",
    fr: "Contrôlez les étapes irréversibles des workflows autonomes.",
  },

  "land.cta.title": {
    en: "Put your agents to work, under control.",
    fr: "Mettez vos agents au travail, sous contrôle.",
  },
  "land.cta.body": {
    en: "Explore the live console, or talk to us about your agents.",
    fr: "Explorez la console en direct, ou parlez-nous de vos agents.",
  },
  "land.footer.tech": {
    en: "Standards-based: MCP gateway · deterministic policy · hash-chained audit.",
    fr: "Basé sur des standards : passerelle MCP · politique déterministe · audit chaîné par hash.",
  },
  "land.footer.rights": {
    en: "© 2026 xSOM. All rights reserved.",
    fr: "© 2026 xSOM. Tous droits réservés.",
  },

  // ── In-app Home / onboarding (post-login) ────────────────────────────
  "nav.home": { en: "Home", fr: "Accueil" },
  "home.title": { en: "Welcome to xSOM AI Guard", fr: "Bienvenue sur xSOM AI Guard" },
  "home.subtitle": {
    en: "Your control center for everything your AI agents do.",
    fr: "Votre centre de contrôle pour tout ce que font vos agents IA.",
  },
  "home.kpi.actions": { en: "Monitored actions", fr: "Actions surveillées" },
  "home.kpi.pending": { en: "Pending approvals", fr: "Validations en attente" },
  "home.kpi.gated": { en: "Gated actions", fr: "Actions contrôlées" },
  "home.kpi.audit": { en: "Audit entries", fr: "Entrées d'audit" },
  "home.chart.title": { en: "Decisions recorded", fr: "Décisions enregistrées" },
  "home.chart.allow": { en: "Allowed", fr: "Autorisées" },
  "home.chart.hitl": { en: "Held / approved", fr: "En attente / validées" },
  "home.chart.deny": { en: "Blocked", fr: "Bloquées" },
  "home.chart.empty": { en: "No decisions recorded yet.", fr: "Aucune décision enregistrée pour l'instant." },

  "home.start.kicker": { en: "Getting started", fr: "Pour commencer" },
  "home.start.title": { en: "Onboard a client in 5 steps", fr: "Intégrer un client en 5 étapes" },
  "home.start.s1.t": { en: "Connect a client", fr: "Connecter un client" },
  "home.start.s1.b": {
    en: "In Admin → API keys, generate a key for the client's agent. Their agent calls xSOM before each action.",
    fr: "Dans Admin → Clés d'API, générez une clé pour l'agent du client. Son agent appelle xSOM avant chaque action.",
  },
  "home.start.s2.t": { en: "Set the policy", fr: "Définir la politique" },
  "home.start.s2.b": {
    en: "In Admin, edit the policy: which actions are automatic, which need approval, which are blocked.",
    fr: "Dans Admin, modifiez la politique : quelles actions sont automatiques, lesquelles nécessitent une validation, lesquelles sont bloquées.",
  },
  "home.start.s3.t": { en: "Watch the actions", fr: "Observer les actions" },
  "home.start.s3.b": {
    en: "Open Inspector to see every action the agent can take and how each is handled.",
    fr: "Ouvrez l'Inspecteur pour voir chaque action que l'agent peut effectuer et comment elle est traitée.",
  },
  "home.start.s4.t": { en: "Approve the risky ones", fr: "Valider les actions sensibles" },
  "home.start.s4.b": {
    en: "Irreversible actions appear in Approvals. Review the dry-run, then approve or deny.",
    fr: "Les actions irréversibles apparaissent dans Approbations. Examinez le dry-run, puis approuvez ou refusez.",
  },
  "home.start.s5.t": { en: "Prove compliance", fr: "Prouver la conformité" },
  "home.start.s5.b": {
    en: "Open Audit to review the immutable trail and export AI Act / GDPR evidence.",
    fr: "Ouvrez Audit pour consulter le journal immuable et exporter les preuves AI Act / RGPD.",
  },

  "home.pages.kicker": { en: "The console", fr: "La console" },
  "home.pages.title": { en: "What each page is for", fr: "À quoi sert chaque page" },
  "home.pages.inspector.b": {
    en: "The catalogue of actions your agent can take, with the type and policy decision for each. Start here to see what's monitored.",
    fr: "Le catalogue des actions que votre agent peut effectuer, avec le type et la décision de politique pour chacune. Commencez ici pour voir ce qui est surveillé.",
  },
  "home.pages.approvals.b": {
    en: "The human-in-the-loop queue. Each card shows a dry-run of an irreversible action: approve or deny. Some require two distinct approvers.",
    fr: "La file de validation humaine. Chaque carte montre un dry-run d'une action irréversible : approuvez ou refusez. Certaines exigent deux validateurs distincts.",
  },
  "home.pages.audit.b": {
    en: "The immutable, hash-chained record of every decision. Read the chain and export compliance evidence in one click.",
    fr: "Le journal immuable et chaîné par hash de chaque décision. Parcourez la chaîne et exportez les preuves de conformité en un clic.",
  },
  "home.pages.admin.b": {
    en: "Edit the authorization policy and manage API keys for the agents (clients) you monitor.",
    fr: "Modifiez la politique d'autorisation et gérez les clés d'API des agents (clients) que vous surveillez.",
  },
  "home.pages.open": { en: "Open", fr: "Ouvrir" },

  "home.legend.title": { en: "Reading the badges", fr: "Lire les badges" },
  "home.legend.green": {
    en: "Green: allowed automatically",
    fr: "Vert : autorisé automatiquement",
  },
  "home.legend.amber": {
    en: "Amber: held for human approval",
    fr: "Ambre : en attente de validation humaine",
  },
  "home.legend.red": { en: "Red: blocked by policy", fr: "Rouge : bloqué par la politique" },

  "home.tech.title": { en: "Under the hood", fr: "Sous le capot" },
  "home.tech.body": {
    en: "A standards-based MCP gateway, a deterministic policy engine, a hash-chained audit log, and a lightweight LLM judge for the ambiguous cases. How we classify, chain, and decide at scale is our secret sauce.",
    fr: "Une passerelle MCP basée sur des standards, un moteur de politique déterministe, un journal d'audit chaîné par hash, et un juge LLM léger pour les cas ambigus. Notre façon de classer, chaîner et décider à grande échelle reste notre secret de fabrication.",
  },

  // ── Executive summary (non-technical, for execs & sales) ─────────────
  "nav.exec": { en: "Executive", fr: "Synthèse" },
  "nav.costs": { en: "Costs", fr: "Coûts" },
  "exec.title": { en: "Executive summary", fr: "Synthèse exécutive" },
  "exec.subtitle": {
    en: "How xSOM keeps your AI agents productive, safe, and compliant, at a glance.",
    fr: "Comment xSOM garde vos agents IA productifs, sûrs et conformes, en un coup d'œil.",
  },
  "exec.kpi.governed.l": { en: "Actions under governance", fr: "Actions sous gouvernance" },
  "exec.kpi.governed.s": {
    en: "Every action your agents can take follows your rules.",
    fr: "Chaque action possible de vos agents suit vos règles.",
  },
  "exec.kpi.review.l": { en: "Sent for human review", fr: "Soumises à un humain" },
  "exec.kpi.review.s": {
    en: "Risky actions paused before running.",
    fr: "Actions sensibles suspendues avant exécution.",
  },
  "exec.kpi.blocked.l": { en: "Blocked automatically", fr: "Bloquées automatiquement" },
  "exec.kpi.blocked.s": {
    en: "Off-policy actions stopped cold.",
    fr: "Actions hors politique arrêtées net.",
  },
  "exec.means.title": { en: "What this means for you", fr: "Ce que cela signifie pour vous" },
  "exec.means.1.t": { en: "You stay in control", fr: "Vous gardez le contrôle" },
  "exec.means.1.b": {
    en: "You decide what your AI can and can't do. The rule is enforced on every action, not left to the model.",
    fr: "Vous décidez ce que votre IA peut faire ou non. La règle s'applique à chaque action, sans dépendre du modèle.",
  },
  "exec.means.2.t": { en: "Nothing risky slips through", fr: "Rien de risqué ne passe" },
  "exec.means.2.b": {
    en: "No irreversible action runs without a person approving it first.",
    fr: "Aucune action irréversible ne s'exécute sans qu'une personne l'approuve d'abord.",
  },
  "exec.means.3.t": { en: "You can prove it", fr: "Vous pouvez le prouver" },
  "exec.means.3.b": {
    en: "A complete, tamper-proof record of every decision, ready for auditors and regulators in one click.",
    fr: "Un registre complet et inviolable de chaque décision, prêt pour auditeurs et régulateurs en un clic.",
  },
  "exec.chart.title": {
    en: "What happened to your agents' actions",
    fr: "Ce qu'il est advenu des actions de vos agents",
  },
  "exec.chart.allow": { en: "Ran automatically", fr: "Exécutées automatiquement" },
  "exec.chart.review": { en: "Paused for a human", fr: "Suspendues pour un humain" },
  "exec.chart.block": { en: "Blocked", fr: "Bloquées" },
  "exec.chart.empty": {
    en: "No agent activity recorded yet.",
    fr: "Aucune activité d'agent enregistrée pour l'instant.",
  },
  "exec.comp.title": { en: "Compliance-ready", fr: "Prêt pour la conformité" },
  "exec.comp.body": {
    en: "EU AI Act human-oversight and record-keeping, plus GDPR-friendly data handling. Evidence you can export anytime.",
    fr: "Supervision humaine et traçabilité de l'AI Act européen, plus un traitement des données conforme au RGPD. Des preuves exportables à tout moment.",
  },
  "exec.bottom": {
    en: "The bottom line: the productivity of autonomous AI, without the blind trust.",
    fr: "En résumé : la productivité de l'IA autonome, sans la confiance aveugle.",
  },
  "exec.kpi.entrees.l": { en: "Decisions on record", fr: "Décisions enregistrées" },
  "exec.kpi.entrees.s": {
    en: "Every one of them chained, and the chain was verified.",
    fr: "Toutes chaînées, et la chaîne a été vérifiée.",
  },
  "exec.preview.note": {
    en: "Public preview: the demonstration tenant, not yours. Your own figures appear once your agents are connected.",
    fr: "Aperçu public : le tenant de démonstration, pas le vôtre. Vos propres chiffres s'affichent une fois vos agents connectés.",
  },
  "land.exec.link": { en: "Executive snapshot", fr: "Synthèse pour dirigeants" },

  // ── Onboarding wizard ────────────────────────────────────────────────
  "nav.onboard": { en: "Connect agent", fr: "Connecter un agent" },
  "onb.title": { en: "Connect an agent", fr: "Connecter un agent" },
  "onb.subtitle": {
    en: "Put your agent under control in three steps, with no YAML to write.",
    fr: "Mettez votre agent sous contrôle en trois étapes, sans écrire de YAML.",
  },
  "onb.s1": { en: "Agent", fr: "Agent" },
  "onb.s2": { en: "Protection", fr: "Protection" },
  "onb.s3": { en: "Connect", fr: "Connexion" },
  "onb.name.label": { en: "Agent name", fr: "Nom de l'agent" },
  "onb.name.ph": { en: "e.g. support-bot", fr: "ex. support-bot" },
  "onb.stack.label": {
    en: "How does your agent run its tools?",
    fr: "Comment votre agent exécute-t-il ses outils ?",
  },
  "onb.next": { en: "Next", fr: "Suivant" },
  "onb.back": { en: "Back", fr: "Retour" },
  "onb.tpl.label": { en: "Choose a protection level", fr: "Choisissez un niveau de protection" },
  "onb.tpl.monitor.t": { en: "Monitor only", fr: "Observation seule" },
  "onb.tpl.monitor.d": {
    en: "Audit everything, block nothing. Great to start.",
    fr: "Tout auditer, ne rien bloquer. Idéal pour commencer.",
  },
  "onb.tpl.balanced.t": { en: "Balanced", fr: "Équilibré" },
  "onb.tpl.balanced.d": {
    en: "Reads & writes run; external sends and irreversible actions need a human.",
    fr: "Lectures et écritures passent ; envois externes et actions irréversibles requièrent un humain.",
  },
  "onb.tpl.strict.t": { en: "Strict", fr: "Strict" },
  "onb.tpl.strict.d": {
    en: "Writes need a human; sends and irreversible actions need two approvers.",
    fr: "Les écritures requièrent un humain ; envois et actions irréversibles, deux validateurs.",
  },
  "onb.recommended": { en: "Recommended", fr: "Recommandé" },
  "onb.tpl.mode.template": { en: "Use a template", fr: "Utiliser un modèle" },
  "onb.tpl.mode.ai": { en: "Describe it (AI)", fr: "Décrire (IA)" },
  "onb.ai.ready": {
    en: "Policy drafted. Continue to get your key.",
    fr: "Politique générée. Continuez pour obtenir votre clé.",
  },
  "onb.generate": { en: "Generate key & apply", fr: "Générer la clé & appliquer" },
  "onb.generating": { en: "Setting up…", fr: "Configuration…" },
  "onb.warn": {
    en: "This sets your account's protection policy (replaces the current one).",
    fr: "Ceci définit la politique de protection du compte (remplace l'actuelle).",
  },
  "onb.key.title": { en: "Your agent's API key", fr: "La clé d'API de votre agent" },
  "onb.key.note": {
    en: "Copy it now: it is shown only once.",
    fr: "Copiez-la maintenant : elle n'est affichée qu'une fois.",
  },
  "onb.snippet.title": { en: "Drop this into your agent", fr: "Ajoutez ceci à votre agent" },
  "onb.snippet.note": {
    en: "Call xSOM right before your agent runs a tool; if it isn't allowed, don't run it.",
    fr: "Appelez xSOM juste avant que votre agent exécute un outil ; si ce n'est pas autorisé, ne l'exécutez pas.",
  },
  "onb.snippet.proxy": {
    en: "Zero-code monitoring: just change the base_url. xSOM sees and audits every tool-call the model makes (your provider key is forwarded, never stored).",
    fr: "Monitoring zéro-code : changez seulement le base_url. xSOM voit et audite chaque tool-call du modèle (votre clé provider est transmise, jamais stockée).",
  },
  "onb.copy": { en: "Copy", fr: "Copier" },
  "onb.copied": { en: "Copied", fr: "Copié" },
  "onb.done.t": { en: "You're connected 🎉", fr: "Vous êtes connecté 🎉" },
  "onb.done.d": {
    en: "Watch actions in the Inspector and approve the risky ones in Approvals.",
    fr: "Suivez les actions dans l'Inspecteur et validez les sensibles dans Approbations.",
  },
  "onb.error": { en: "Setup failed", fr: "Échec de la configuration" },

  // Login
  "login.title": { en: "Sign in", fr: "Se connecter" },
  "login.subtitle": { en: "Access the action-control console.", fr: "Accédez à la console de contrôle des actions." },
  "login.email": { en: "Email", fr: "Email" },
  "login.password": { en: "Password", fr: "Mot de passe" },
  "login.submit": { en: "Sign in", fr: "Se connecter" },
  "login.submitting": { en: "Signing in…", fr: "Connexion…" },
  "login.securing": { en: "Securing your session", fr: "Sécurisation de votre session" },
  "login.failed": { en: "Sign in failed", fr: "Échec de la connexion" },
  "login.forgot": { en: "Forgot password?", fr: "Mot de passe oublié ?" },
  "login.footer": { en: "Every agent action: authorized, gated, and logged.", fr: "Chaque action d'agent : autorisée, contrôlée et journalisée." },

  // Forgot / reset password
  "forgot.title": { en: "Reset your password", fr: "Réinitialiser le mot de passe" },
  "forgot.subtitle": {
    en: "Enter your email and we'll send you a reset link.",
    fr: "Saisissez votre email et nous vous enverrons un lien de réinitialisation.",
  },
  "forgot.submit": { en: "Send reset link", fr: "Envoyer le lien" },
  "forgot.sending": { en: "Sending…", fr: "Envoi…" },
  "forgot.sent": {
    en: "If an account exists for that email, a reset link is on its way. Check your inbox (and spam).",
    fr: "Si un compte existe pour cet email, un lien de réinitialisation arrive. Vérifiez votre boîte (et les spams).",
  },
  "forgot.back": { en: "Back to sign in", fr: "Retour à la connexion" },
  "reset.title": { en: "Choose a new password", fr: "Choisir un nouveau mot de passe" },
  "reset.subtitle": { en: "Set a new password for your account.", fr: "Définissez un nouveau mot de passe pour votre compte." },
  "reset.password": { en: "New password", fr: "Nouveau mot de passe" },
  "reset.confirm": { en: "Confirm password", fr: "Confirmer le mot de passe" },
  "reset.submit": { en: "Update password", fr: "Mettre à jour" },
  "reset.saving": { en: "Updating…", fr: "Mise à jour…" },
  "reset.success": { en: "Password updated. Redirecting you to sign in…", fr: "Mot de passe mis à jour. Redirection vers la connexion…" },
  "reset.tooshort": { en: "Password must be at least 8 characters.", fr: "Le mot de passe doit comporter au moins 8 caractères." },
  "reset.mismatch": { en: "The two passwords don't match.", fr: "Les deux mots de passe ne correspondent pas." },
  "reset.invalid": { en: "This reset link is invalid or has expired. Request a new one.", fr: "Ce lien est invalide ou expiré. Demandez-en un nouveau." },

  // Inspector
  "inspector.title": { en: "Inspector", fr: "Inspecteur" },
  "inspector.subtitle": { en: "The actions your agent may take, and how each is handled.", fr: "Les actions que votre agent peut effectuer, et comment chacune est traitée." },
  "inspector.col.tool": { en: "Action", fr: "Action" },
  "inspector.col.class": { en: "Type", fr: "Type" },
  "inspector.col.decision": { en: "Policy", fr: "Politique" },
  "inspector.empty": { en: "No actions defined yet. Set them in the policy editor (Admin).", fr: "Aucune action définie. Configurez-les dans l'éditeur de politique (Admin)." },

  // Approvals
  "approvals.title": { en: "Approval queue", fr: "File de validation" },
  "approvals.subtitle": { en: "Irreversible actions held for a human decision.", fr: "Actions irréversibles en attente d'une décision humaine." },
  "approvals.empty": { en: "No pending approvals.", fr: "Aucune validation en attente." },
  "approvals.count": { en: "approvals", fr: "validations" },
  "approvals.approve": { en: "Approve", fr: "Approuver" },
  "approvals.deny": { en: "Deny", fr: "Refuser" },
  "approvals.approved": { en: "Approved: the agent may proceed.", fr: "Approuvée : l'agent peut continuer." },
  "approvals.denied": { en: "Denied: the action is blocked.", fr: "Refusée : l'action est bloquée." },
  "approvals.recorded": { en: "Your approval is recorded. A second, different approver is still required.", fr: "Votre validation est enregistrée. Un second validateur distinct est requis." },
  "approvals.deciding": { en: "Working…", fr: "Traitement…" },
  "approvals.status.pending": { en: "Pending", fr: "En attente" },

  // Audit
  "audit.title": { en: "Audit explorer", fr: "Explorateur d'audit" },
  "audit.subtitle": { en: "Immutable, hash-chained record of every decision.", fr: "Journal immuable et chaîné par hash de chaque décision." },
  "audit.export.aiact": { en: "Export AI Act (PDF)", fr: "Export AI Act (PDF)" },
  "audit.export.gdpr": { en: "Export GDPR (JSON)", fr: "Export RGPD (JSON)" },
  "audit.col.tool": { en: "Action", fr: "Action" },
  "audit.col.class": { en: "Type", fr: "Type" },
  "audit.col.decision": { en: "Decision", fr: "Décision" },
  "audit.empty": { en: "No audit entries.", fr: "Aucune entrée d'audit." },

  // Admin
  "admin.title": { en: "Admin", fr: "Admin" },
  "admin.subtitle": { en: "Authorization policy and downstream tool servers.", fr: "Politique d'autorisation et serveurs d'outils en aval." },
  "admin.policy.title": { en: "Policy editor", fr: "Éditeur de politique" },
  "admin.policy.save": { en: "Save policy", fr: "Enregistrer la politique" },
  "admin.policy.saved": { en: "Policy saved (version {v}).", fr: "Politique enregistrée (version {v})." },
  "admin.policy.invalid": { en: "Invalid policy:", fr: "Politique invalide :" },
  "admin.ai.title": { en: "Describe it, we'll write the policy", fr: "Décrivez-la, on écrit la politique" },
  "admin.ai.hint": {
    en: "Plain words. For example: “reads the CRM and emails candidates; never delete anything; deleting a database needs two approvers”.",
    fr: "En langage courant. Par exemple : « lit le CRM et envoie des emails aux candidats ; ne jamais supprimer ; supprimer une base demande deux validateurs ».",
  },
  "admin.ai.ph": {
    en: "Describe what your agent does and your rules…",
    fr: "Décrivez ce que fait votre agent et vos règles…",
  },
  "admin.ai.generate": { en: "Generate with AI", fr: "Générer avec l'IA" },
  "admin.ai.generating": { en: "Generating…", fr: "Génération…" },
  "admin.ai.review": {
    en: "Draft ready below. Review it, then Save policy to apply.",
    fr: "Brouillon prêt ci-dessous. Vérifiez-le, puis Enregistrer pour appliquer.",
  },
  "admin.ai.unavailable": {
    en: "The AI assistant isn't configured yet (no Mistral key on the server).",
    fr: "L'assistant IA n'est pas encore configuré (pas de clé Mistral sur le serveur).",
  },
  "admin.ai.error": { en: "Couldn't generate a policy. Try rephrasing.", fr: "Génération impossible. Reformulez." },
  "admin.servers.title": { en: "Downstream servers", fr: "Serveurs en aval" },
  "admin.servers.empty": { en: "No servers declared.", fr: "Aucun serveur déclaré." },

  // API keys
  "keys.title": { en: "API keys", fr: "Clés d'API" },
  "keys.subtitle": { en: "Tokens for agents calling /v1/authorize. The secret is shown once at creation.", fr: "Jetons pour les agents appelant /v1/authorize. Le secret est affiché une seule fois à la création." },
  "keys.placeholder": { en: "Key name (e.g. uti-agent)", fr: "Nom de la clé (ex. uti-agent)" },
  "keys.generate": { en: "Generate", fr: "Générer" },
  "keys.created": { en: "New key “{name}”. Copy it now, it won't be shown again.", fr: "Nouvelle clé « {name} ». Copiez-la maintenant, elle ne sera plus affichée." },
  "keys.active": { en: "active", fr: "active" },
  "keys.revoked": { en: "revoked", fr: "révoquée" },
  "keys.never": { en: "never used", fr: "jamais utilisée" },
  "keys.used": { en: "used {date}", fr: "utilisée {date}" },
  "keys.revoke": { en: "Revoke", fr: "Révoquer" },
  "keys.revoking": { en: "Revoking…", fr: "Révocation…" },
  "keys.empty": { en: "No API keys yet.", fr: "Aucune clé d'API." },

  // Action-class explanations (tooltips)
  "class.read": { en: "Read", fr: "Lecture" },
  "class.read.desc": { en: "Reads data only: allowed automatically, no risk.", fr: "Lecture de données uniquement : autorisé automatiquement, sans risque." },
  "class.write": { en: "Write", fr: "Écriture" },
  "class.write.desc": { en: "Changes data but is reversible: allowed automatically.", fr: "Modifie des données mais réversible : autorisé automatiquement." },
  "class.external_send": { en: "External send", fr: "Envoi externe" },
  "class.external_send.desc": { en: "Sends something outside (email, message): held for human approval.", fr: "Envoie quelque chose à l'extérieur (email, message) : retenu pour validation humaine." },
  "class.irreversible": { en: "Irreversible", fr: "Irréversible" },
  "class.irreversible.desc": { en: "Cannot be undone (delete, deploy): held for human approval.", fr: "Ne peut être annulé (suppression, déploiement) : retenu pour validation humaine." },
  // Decisions
  "dec.allow": { en: "Allowed automatically.", fr: "Autorisé automatiquement." },
  "dec.deny": { en: "Blocked by policy.", fr: "Bloqué par la politique." },
  "dec.hold": { en: "Held for a human decision.", fr: "Retenu pour une décision humaine." },
  "dec.human_in_the_loop": { en: "Requires one human approval.", fr: "Nécessite une validation humaine." },
  "dec.human_dual": { en: "Requires two distinct approvers.", fr: "Nécessite deux validateurs distincts." },
  "dec.auto": { en: "Allowed automatically.", fr: "Autorisé automatiquement." },
  // Short decision labels (badge text)
  "decl.auto": { en: "Auto", fr: "Auto" },
  "decl.human_in_the_loop": { en: "Human review", fr: "Validation humaine" },
  "decl.human_dual": { en: "Dual approval", fr: "Double validation" },
  "decl.deny": { en: "Blocked", fr: "Bloqué" },

  // ── Agent scope bar (customer + agent selector, shown across data views) ──
  "scope.customer": { en: "Customer", fr: "Client" },
  "scope.agents": { en: "{n} agents monitored", fr: "{n} agents surveillés" },
  "scope.agent_one": { en: "1 agent monitored", fr: "1 agent surveillé" },
  "scope.view": { en: "View", fr: "Vue" },
  "scope.all": { en: "All agents", fr: "Tous les agents" },
  "scope.actions": { en: "actions", fr: "actions" },
  "scope.spend": { en: "spend", fr: "dépensé" },
  "scope.tokens": { en: "tokens", fr: "tokens" },
  "scope.none": { en: "No agents connected yet.", fr: "Aucun agent connecté pour l'instant." },
  "scope.connect": { en: "Connect one", fr: "En connecter un" },

  // ── Costs / token monitoring ─────────────────────────────────────────────
  "costs.title": { en: "Token & cost monitoring", fr: "Suivi des tokens & des coûts" },
  "costs.subtitle": {
    en: "Every completion your agents run through xSOM: token usage and estimated spend, by provider, model and agent. One pane across OpenAI, Anthropic, Mistral and OpenRouter.",
    fr: "Chaque complétion que vos agents passent par xSOM : consommation de tokens et coût estimé, par provider, modèle et agent. Une seule vue pour OpenAI, Anthropic, Mistral et OpenRouter.",
  },
  "costs.kpi.spend": { en: "Estimated spend", fr: "Coût estimé" },
  "costs.kpi.tokens": { en: "Total tokens", fr: "Tokens totaux" },
  "costs.kpi.calls": { en: "Completions", fr: "Complétions" },
  "costs.kpi.io": { en: "Input / output", fr: "Entrée / sortie" },
  "costs.empty.title": { en: "No usage recorded yet", fr: "Aucune consommation enregistrée" },
  "costs.empty.body": {
    en: "Route an agent's LLM calls through the xSOM proxy (set its base_url to /proxy/…) and token usage with estimated cost will appear here automatically.",
    fr: "Routez les appels LLM d'un agent via le proxy xSOM (base_url vers /proxy/…) et la consommation de tokens avec le coût estimé apparaîtra ici automatiquement.",
  },
  "costs.by_provider": { en: "By provider", fr: "Par provider" },
  "costs.by_model": { en: "By model", fr: "Par modèle" },
  "costs.by_agent": { en: "By agent", fr: "Par agent" },
  "costs.trend": { en: "Daily spend", fr: "Dépense quotidienne" },
  "costs.col.tokens": { en: "Tokens", fr: "Tokens" },
  "costs.col.calls": { en: "Calls", fr: "Appels" },
  "costs.col.cost": { en: "Cost", fr: "Coût" },
  "costs.estimate.note": {
    en: "Costs are estimates from public list prices, for monitoring, not billing.",
    fr: "Les coûts sont estimés d'après les tarifs publics, à titre indicatif, pas une facturation.",
  },
  "costs.unknown_agent": { en: "Unattributed", fr: "Non attribué" },

  // Spend KPI reused on the executive view
  "exec.kpi.cost.l": { en: "Estimated spend", fr: "Coût estimé" },
  "exec.kpi.cost.s": {
    en: "LLM token cost governed in this view.",
    fr: "Coût des tokens LLM gouverné dans cette vue.",
  },

  // ── Billed (exact) vs estimated reconciliation ───────────────────────────
  "costs.billed.l": { en: "Billed (exact)", fr: "Facturé (exact)" },
  "costs.estimated.l": { en: "Estimated", fr: "Estimé" },
  "costs.recon": {
    en: "Billed is the cost providers report themselves; estimated is tokens × list price.",
    fr: "Le facturé est le coût rapporté par les providers ; l'estimé est tokens × tarif public.",
  },
  "costs.drift": { en: "drift", fr: "écart" },
  "costs.billed.hint": {
    en: "Route an agent through the OpenRouter proxy (or connect a provider in Admin) to populate exact billed cost.",
    fr: "Faites passer un agent par le proxy OpenRouter (ou connectez un provider dans Admin) pour alimenter le coût facturé exact.",
  },

  // ── Provider billing credentials (Admin) ─────────────────────────────────
  "creds.title": { en: "Provider billing", fr: "Facturation providers" },
  "creds.subtitle": {
    en: "Connect a provider so xSOM can pull the authoritative billed cost. Keys are envelope-encrypted (KMS) and never shown again.",
    fr: "Connectez un provider pour que xSOM tire le coût facturé qui fait foi. Les clés sont chiffrées (enveloppe + KMS) et jamais réaffichées.",
  },
  "creds.provider": { en: "Provider", fr: "Provider" },
  "creds.label": { en: "Label", fr: "Libellé" },
  "creds.secret": { en: "API key / secret", fr: "Clé API / secret" },
  "creds.connect": { en: "Connect", fr: "Connecter" },
  "creds.revoke": { en: "Revoke", fr: "Révoquer" },
  "creds.revoked": { en: "revoked", fr: "révoquée" },
  "creds.none": { en: "No providers connected yet.", fr: "Aucun provider connecté." },
  "creds.unavailable": {
    en: "Secret storage isn't configured on the server yet.",
    fr: "Le stockage des secrets n'est pas encore configuré sur le serveur.",
  },

  // ── Client / project scope (the monitored entity) ────────────────────────
  "scope.clientlabel": { en: "Client / project", fr: "Client / projet" },
  "scope.allclients": { en: "All clients", fr: "Tous les clients" },
  "scope.nclients": { en: "{n} clients", fr: "{n} clients" },
  "scope.nagents": { en: "{n} agents", fr: "{n} agents" },
  "scope.noclient": { en: "No clients yet", fr: "Aucun client" },
  "scope.manage": { en: "Manage", fr: "Gérer" },
  "scope.billed": { en: "billed", fr: "facturé" },

  // ── Clients manager (Admin) ──────────────────────────────────────────────
  "clients.title": { en: "Clients / projects", fr: "Clients / projets" },
  "clients.subtitle": {
    en: "The entities you monitor. Each agent belongs to a client, so cost rolls up per client.",
    fr: "Les entités que tu surveilles. Chaque agent appartient à un client, donc le coût s'agrège par client.",
  },
  "clients.name": { en: "Client name", fr: "Nom du client" },
  "clients.website": { en: "Website URL", fr: "URL du site" },
  "clients.add": { en: "Add client", fr: "Ajouter" },
  "clients.archive": { en: "Archive", fr: "Archiver" },
  "clients.none": { en: "No clients yet. Add one above.", fr: "Aucun client. Ajoutez-en un." },
  "clients.agents.title": { en: "Assign agents", fr: "Affecter les agents" },
  "clients.unassigned": { en: "unassigned", fr: "non affecté" },
  "clients.save": { en: "Save", fr: "Enregistrer" },
  "clients.empty.agents": {
    en: "No agents yet. Create one in Connect agent.",
    fr: "Aucun agent. Crées-en un dans Connecter un agent.",
  },

  // ── Self-serve signup ────────────────────────────────────────────────────
  "signup.title": { en: "Create your account", fr: "Créer votre compte" },
  "signup.subtitle": {
    en: "Spin up a workspace in seconds. You'll be its admin.",
    fr: "Créez un espace en quelques secondes. Vous en serez l'admin.",
  },
  "signup.org": { en: "Company / workspace name", fr: "Nom de l'entreprise / espace" },
  "signup.email": { en: "Work email", fr: "Email professionnel" },
  "signup.password": { en: "Password (min 8 chars)", fr: "Mot de passe (8 car. min)" },
  "signup.submit": { en: "Create account", fr: "Créer le compte" },
  "signup.submitting": { en: "Creating…", fr: "Création…" },
  "signup.failed": { en: "Could not create the account.", fr: "Impossible de créer le compte." },
  "signup.haveaccount": { en: "Already have an account?", fr: "Déjà un compte ?" },
  "signup.signin": { en: "Sign in", fr: "Se connecter" },
  "signup.footer": {
    en: "By creating an account you agree to govern your agents responsibly.",
    fr: "En créant un compte, vous vous engagez à gouverner vos agents de façon responsable.",
  },
  "login.signup": { en: "New here? Create an account", fr: "Nouveau ? Créer un compte" },

  // ── Onboarding: project picker ───────────────────────────────────────────
  "onb.project.label": { en: "Project", fr: "Projet" },
  "onb.project.none": { en: "No project", fr: "Aucun projet" },
  "onb.project.new": { en: "+ New project", fr: "+ Nouveau projet" },
  "onb.project.newph": { en: "New project name (e.g. Openclaw)", fr: "Nom du projet (ex. Openclaw)" },
  "onb.url.title": { en: "Base URL, paste into any tool", fr: "Base URL, à coller dans n'importe quel outil" },
  "onb.url.note": {
    en: "The gateway token is in the URL: no header, no code. Set this as your agent's base_url and keep your own provider key.",
    fr: "Le token est dans l'URL : aucun header, aucun code. Mets-la comme base_url de ton agent et garde ta propre clé provider.",
  },
  "onb.prompt.title": { en: "Integration prompt (self-modifying agent)", fr: "Prompt d'intégration (agent auto-modifiable)" },
  "onb.prompt.note": {
    en: "Paste this to an agent that can edit its own config (openclaw, Claude Code…) to route itself through xSOM.",
    fr: "Colle ça à un agent capable d'éditer sa config (openclaw, Claude Code…) pour qu'il passe par xSOM.",
  },

  // Egress data-loss guard (DLP)
  "dlp.title": { en: "Data-loss guard (egress)", fr: "Garde-fou de fuite (egress)" },
  "dlp.subtitle": {
    en: "Scan outbound prompts before they reach the model: block secrets, flag or mask personal data. Metadata only: the value is never stored.",
    fr: "Scanne les prompts sortants avant qu'ils n'atteignent le modèle : bloque les secrets, signale ou masque les données personnelles. Métadonnées seules : la valeur n'est jamais stockée.",
  },
  "dlp.enabled": { en: "Enabled", fr: "Activé" },
  "dlp.platform.off": {
    en: "DLP is off platform-wide. Your settings are saved but stay dormant until an operator enables the feature.",
    fr: "Le DLP est désactivé au niveau plateforme. Vos réglages sont sauvegardés mais restent dormants jusqu'à activation par un opérateur.",
  },
  "dlp.cat.secret": { en: "Secrets (API keys, tokens)", fr: "Secrets (clés API, tokens)" },
  "dlp.cat.pii": { en: "Personal data (email, card, IBAN…)", fr: "Données personnelles (email, carte, IBAN…)" },
  "dlp.cat.entropy": { en: "Unknown high-entropy blobs", fr: "Blobs à haute entropie inconnus" },
  "dlp.act.block": { en: "Block", fr: "Bloquer" },
  "dlp.act.redact": { en: "Mask", fr: "Masquer" },
  "dlp.act.flag": { en: "Flag", fr: "Signaler" },
  "dlp.act.off": { en: "Off", fr: "Désactivé" },
  "dlp.save": { en: "Save DLP settings", fr: "Enregistrer le DLP" },
  "dlp.saved": { en: "Saved.", fr: "Enregistré." },
  "dlp.egress": { en: "DLP", fr: "DLP" },

  // Read tokens (server-to-server /ai read credentials)
  "rtok.title": { en: "Read tokens (AI API)", fr: "Read tokens (API IA)" },
  "rtok.subtitle": {
    en: "Read-only, server-to-server credentials for the /ai read API (e.g. the mip-rum facade). They cannot ingest. The secret is shown once.",
    fr: "Identifiants lecture seule, serveur-à-serveur, pour l'API de lecture /ai (ex. la facade mip-rum). Ils ne peuvent pas ingérer. Le secret n'est affiché qu'une fois.",
  },
  "rtok.placeholder": { en: "Name (e.g. mip-rum)", fr: "Nom (ex. mip-rum)" },
  "rtok.generate": { en: "Generate", fr: "Générer" },
  "rtok.created": { en: "Read token “{name}” created. Copy it now:", fr: "Read token « {name} » créé. Copie-le maintenant :" },
  "rtok.active": { en: "active", fr: "actif" },
  "rtok.revoked": { en: "revoked", fr: "révoqué" },
  "rtok.revoke": { en: "Revoke", fr: "Révoquer" },
  "rtok.revoking": { en: "Revoking…", fr: "Révocation…" },
  "rtok.used": { en: "used {date}", fr: "utilisé {date}" },
  "rtok.never": { en: "never used", fr: "jamais utilisé" },
  "rtok.empty": { en: "No read tokens yet.", fr: "Aucun read token pour l'instant." },
} satisfies Record<string, Entry>;

export type StrKey = keyof typeof STR;
