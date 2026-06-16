"use client";

import { createContext, useContext, useEffect, useState } from "react";

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
    en: "Waking the secure backend — the first load after a quiet period can take up to a minute.",
    fr: "Réveil du serveur sécurisé — le premier chargement après une période d'inactivité peut prendre jusqu'à une minute.",
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
    en: "Not a prompt filter — a gate on real actions: sending emails, deleting records, deploying. Each call is allowed, held, or blocked by your policy.",
    fr: "Pas un filtre de prompt — un contrôle sur les actions réelles : envoyer un email, supprimer un enregistrement, déployer. Chaque appel est autorisé, retenu ou bloqué selon votre politique.",
  },
  "welcome.p2.title": { en: "Human in the loop", fr: "L'humain dans la boucle" },
  "welcome.p2.body": {
    en: "Irreversible actions pause for a human decision. Nothing critical happens without explicit approval — and you can require two approvers for the riskiest moves.",
    fr: "Les actions irréversibles s'arrêtent pour une décision humaine. Rien de critique ne se produit sans validation explicite — et vous pouvez exiger deux validateurs pour les opérations les plus sensibles.",
  },
  "welcome.p3.title": { en: "Compliance-ready audit", fr: "Audit prêt pour la conformité" },
  "welcome.p3.body": {
    en: "An immutable, hash-chained log of every decision and approval — your evidence for the EU AI Act and GDPR, exportable in one click.",
    fr: "Un journal immuable et chaîné par hash de chaque décision et validation — votre preuve pour l'AI Act européen et le RGPD, exportable en un clic.",
  },
  "welcome.monitors.title": { en: "What it monitors", fr: "Ce qu'il surveille" },
  "welcome.monitors.body": {
    en: "Every tool-call your agent makes — reads run automatically; sensitive sends and irreversible operations are gated and logged.",
    fr: "Chaque appel d'outil de votre agent — les lectures passent automatiquement ; les envois sensibles et les opérations irréversibles sont contrôlés et journalisés.",
  },

  // ── Public landing (pre-login marketing) ─────────────────────────────
  "land.nav.signin": { en: "Sign in", fr: "Se connecter" },
  "land.nav.demo": { en: "Request a demo", fr: "Demander une démo" },
  "land.hero.badge": {
    en: "Action governance for AI agents",
    fr: "Gouvernance des actions pour agents IA",
  },
  "land.hero.title": {
    en: "Ship AI agents to production — without losing control.",
    fr: "Déployez vos agents IA en production — sans perdre le contrôle.",
  },
  "land.hero.sub": {
    en: "xSOM AI Guard sits between your agent and the tools it uses. Every action is checked against your policy, paused for human approval when it's irreversible, and written to a tamper-proof audit trail — so you get the productivity of autonomous agents with the control your business and regulators require.",
    fr: "xSOM AI Guard s'intercale entre votre agent et les outils qu'il utilise. Chaque action est vérifiée selon votre politique, suspendue pour validation humaine si elle est irréversible, et inscrite dans un journal d'audit inviolable — la productivité des agents autonomes, avec le contrôle qu'exigent votre entreprise et vos régulateurs.",
  },
  "land.hero.cta": { en: "Open the console", fr: "Ouvrir la console" },
  "land.hero.cta2": { en: "See how it works", fr: "Voir comment ça marche" },
  "land.hero.trust": {
    en: "Designed for the EU AI Act & GDPR",
    fr: "Conçu pour l'AI Act européen et le RGPD",
  },

  "land.stat.1.v": { en: "100%", fr: "100%" },
  "land.stat.1.l": {
    en: "of irreversible actions held for human approval",
    fr: "des actions irréversibles soumises à validation humaine",
  },
  "land.stat.2.v": { en: "0", fr: "0" },
  "land.stat.2.l": {
    en: "actions executed without a policy decision",
    fr: "action exécutée sans décision de politique",
  },
  "land.stat.3.v": { en: "< 1s", fr: "< 1s" },
  "land.stat.3.l": {
    en: "deterministic decision on every tool-call",
    fr: "décision déterministe à chaque appel d'outil",
  },
  "land.stat.4.v": { en: "2 clicks", fr: "2 clics" },
  "land.stat.4.l": {
    en: "to export AI Act & GDPR evidence",
    fr: "pour exporter les preuves AI Act & RGPD",
  },

  "land.problem.kicker": { en: "The problem", fr: "Le problème" },
  "land.problem.title": {
    en: "AI agents don't just talk. They act.",
    fr: "Les agents IA ne font pas que parler. Ils agissent.",
  },
  "land.problem.body": {
    en: "They send emails, update records, move money, delete data, call internal APIs. A prompt filter can't stop a bad action — by the time the text is generated, the action is one tool-call away. You need a control point on what the agent does, not just on what it says.",
    fr: "Ils envoient des emails, modifient des enregistrements, déplacent de l'argent, suppriment des données, appellent des API internes. Un filtre de prompt ne peut pas arrêter une mauvaise action — quand le texte est généré, l'action n'est qu'à un appel d'outil. Il faut un point de contrôle sur ce que l'agent fait, pas seulement sur ce qu'il dit.",
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
    en: "Every tool-call is classified — read, write, external send, or irreversible.",
    fr: "Chaque appel d'outil est classé — lecture, écriture, envoi externe ou irréversible.",
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
    en: "A gate on real operations — not a text filter. Allow, block, or pause any tool-call.",
    fr: "Un contrôle des opérations réelles — pas un filtre de texte. Autoriser, bloquer ou suspendre chaque appel d'outil.",
  },
  "land.feat.2.t": { en: "Human in the loop", fr: "L'humain dans la boucle" },
  "land.feat.2.b": {
    en: "Irreversible actions pause for explicit approval — with dual control for the riskiest moves.",
    fr: "Les actions irréversibles s'arrêtent pour validation explicite — avec double validation pour les plus sensibles.",
  },
  "land.feat.3.t": { en: "Tamper-proof audit", fr: "Audit inviolable" },
  "land.feat.3.b": {
    en: "Every decision hash-chained and append-only. Prove what your agents did — and didn't do.",
    fr: "Chaque décision chaînée par hash et append-only. Prouvez ce que vos agents ont fait — et n'ont pas fait.",
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
    en: "Let employees' AI tools act on real systems — safely.",
    fr: "Laissez les outils IA des employés agir sur les vrais systèmes — en toute sécurité.",
  },
  "land.who.3.t": { en: "Back-office automation", fr: "Automatisation back-office" },
  "land.who.3.b": {
    en: "Gate the irreversible steps inside autonomous workflows.",
    fr: "Contrôlez les étapes irréversibles des workflows autonomes.",
  },

  "land.cta.title": {
    en: "Put your agents to work — under control.",
    fr: "Mettez vos agents au travail — sous contrôle.",
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
    en: "The human-in-the-loop queue. Each card shows a dry-run of an irreversible action — approve or deny. Some require two distinct approvers.",
    fr: "La file de validation humaine. Chaque carte montre un dry-run d'une action irréversible — approuvez ou refusez. Certaines exigent deux validateurs distincts.",
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
    en: "Green — allowed automatically",
    fr: "Vert — autorisé automatiquement",
  },
  "home.legend.amber": {
    en: "Amber — held for human approval",
    fr: "Ambre — en attente de validation humaine",
  },
  "home.legend.red": { en: "Red — blocked by policy", fr: "Rouge — bloqué par la politique" },

  "home.tech.title": { en: "Under the hood", fr: "Sous le capot" },
  "home.tech.body": {
    en: "A standards-based MCP gateway, a deterministic policy engine, a hash-chained audit log, and a lightweight LLM judge for the ambiguous cases. How we classify, chain, and decide at scale is our secret sauce.",
    fr: "Une passerelle MCP basée sur des standards, un moteur de politique déterministe, un journal d'audit chaîné par hash, et un juge LLM léger pour les cas ambigus. Notre façon de classer, chaîner et décider à grande échelle reste notre secret de fabrication.",
  },

  // ── Executive summary (non-technical, for execs & sales) ─────────────
  "nav.exec": { en: "Executive", fr: "Synthèse" },
  "exec.title": { en: "Executive summary", fr: "Synthèse exécutive" },
  "exec.subtitle": {
    en: "How xSOM keeps your AI agents productive, safe, and compliant — at a glance.",
    fr: "Comment xSOM garde vos agents IA productifs, sûrs et conformes — en un coup d'œil.",
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
  "exec.kpi.coverage.l": { en: "Audit coverage", fr: "Couverture d'audit" },
  "exec.kpi.coverage.s": {
    en: "Every decision recorded, tamper-proof.",
    fr: "Chaque décision enregistrée, inviolable.",
  },
  "exec.means.title": { en: "What this means for you", fr: "Ce que cela signifie pour vous" },
  "exec.means.1.t": { en: "You stay in control", fr: "Vous gardez le contrôle" },
  "exec.means.1.b": {
    en: "You decide what your AI can and can't do — enforced automatically on every action, not left to the model.",
    fr: "Vous décidez ce que votre IA peut faire ou non — appliqué automatiquement à chaque action, sans dépendre du modèle.",
  },
  "exec.means.2.t": { en: "Nothing risky slips through", fr: "Rien de risqué ne passe" },
  "exec.means.2.b": {
    en: "No irreversible action runs without a person approving it first.",
    fr: "Aucune action irréversible ne s'exécute sans qu'une personne l'approuve d'abord.",
  },
  "exec.means.3.t": { en: "You can prove it", fr: "Vous pouvez le prouver" },
  "exec.means.3.b": {
    en: "A complete, tamper-proof record of every decision — ready for auditors and regulators in one click.",
    fr: "Un registre complet et inviolable de chaque décision — prêt pour auditeurs et régulateurs en un clic.",
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
    en: "EU AI Act human-oversight and record-keeping, plus GDPR-friendly data handling — evidence you can export anytime.",
    fr: "Supervision humaine et traçabilité de l'AI Act européen, plus un traitement des données conforme au RGPD — des preuves exportables à tout moment.",
  },
  "exec.bottom": {
    en: "The bottom line: the productivity of autonomous AI — without the blind trust.",
    fr: "En résumé : la productivité de l'IA autonome — sans la confiance aveugle.",
  },
  "exec.preview.note": {
    en: "Preview — illustrative sample data. Your live numbers appear once your agents are connected.",
    fr: "Aperçu — données d'exemple illustratives. Vos chiffres réels s'affichent une fois vos agents connectés.",
  },
  "land.exec.link": { en: "Executive snapshot", fr: "Synthèse pour dirigeants" },

  // ── Onboarding wizard ────────────────────────────────────────────────
  "nav.onboard": { en: "Connect agent", fr: "Connecter un agent" },
  "onb.title": { en: "Connect an agent", fr: "Connecter un agent" },
  "onb.subtitle": {
    en: "Put your agent under control in three steps — no YAML to write.",
    fr: "Mettez votre agent sous contrôle en trois étapes — sans écrire de YAML.",
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
  "onb.generate": { en: "Generate key & apply", fr: "Générer la clé & appliquer" },
  "onb.generating": { en: "Setting up…", fr: "Configuration…" },
  "onb.warn": {
    en: "This sets your account's protection policy (replaces the current one).",
    fr: "Ceci définit la politique de protection du compte (remplace l'actuelle).",
  },
  "onb.key.title": { en: "Your agent's API key", fr: "La clé d'API de votre agent" },
  "onb.key.note": {
    en: "Copy it now — it's shown only once.",
    fr: "Copiez-la maintenant — affichée une seule fois.",
  },
  "onb.snippet.title": { en: "Drop this into your agent", fr: "Ajoutez ceci à votre agent" },
  "onb.snippet.note": {
    en: "Call xSOM right before your agent runs a tool; if it isn't allowed, don't run it.",
    fr: "Appelez xSOM juste avant que votre agent exécute un outil ; si ce n'est pas autorisé, ne l'exécutez pas.",
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
  "login.footer": { en: "Every agent action — authorized, gated, and logged.", fr: "Chaque action d'agent — autorisée, contrôlée et journalisée." },

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
  "reset.success": { en: "Password updated — redirecting you to sign in…", fr: "Mot de passe mis à jour — redirection vers la connexion…" },
  "reset.tooshort": { en: "Password must be at least 8 characters.", fr: "Le mot de passe doit comporter au moins 8 caractères." },
  "reset.mismatch": { en: "The two passwords don't match.", fr: "Les deux mots de passe ne correspondent pas." },
  "reset.invalid": { en: "This reset link is invalid or has expired — request a new one.", fr: "Ce lien est invalide ou expiré — demandez-en un nouveau." },

  // Inspector
  "inspector.title": { en: "Inspector", fr: "Inspecteur" },
  "inspector.subtitle": { en: "The actions your agent may take, and how each is handled.", fr: "Les actions que votre agent peut effectuer, et comment chacune est traitée." },
  "inspector.col.tool": { en: "Action", fr: "Action" },
  "inspector.col.class": { en: "Type", fr: "Type" },
  "inspector.col.decision": { en: "Policy", fr: "Politique" },
  "inspector.empty": { en: "No actions defined yet — set them in the policy editor (Admin).", fr: "Aucune action définie — configurez-les dans l'éditeur de politique (Admin)." },

  // Approvals
  "approvals.title": { en: "Approval queue", fr: "File de validation" },
  "approvals.subtitle": { en: "Irreversible actions held for a human decision.", fr: "Actions irréversibles en attente d'une décision humaine." },
  "approvals.empty": { en: "No pending approvals.", fr: "Aucune validation en attente." },
  "approvals.count": { en: "approvals", fr: "validations" },
  "approvals.approve": { en: "Approve", fr: "Approuver" },
  "approvals.deny": { en: "Deny", fr: "Refuser" },
  "approvals.approved": { en: "Approved — the agent may proceed.", fr: "Approuvée — l'agent peut continuer." },
  "approvals.denied": { en: "Denied — the action is blocked.", fr: "Refusée — l'action est bloquée." },
  "approvals.recorded": { en: "Your approval is recorded — a second, different approver is still required.", fr: "Votre validation est enregistrée — un second validateur distinct est requis." },
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
  "admin.servers.title": { en: "Downstream servers", fr: "Serveurs en aval" },
  "admin.servers.empty": { en: "No servers declared.", fr: "Aucun serveur déclaré." },

  // API keys
  "keys.title": { en: "API keys", fr: "Clés d'API" },
  "keys.subtitle": { en: "Tokens for agents calling /v1/authorize. The secret is shown once at creation.", fr: "Jetons pour les agents appelant /v1/authorize. Le secret est affiché une seule fois à la création." },
  "keys.placeholder": { en: "Key name (e.g. uti-agent)", fr: "Nom de la clé (ex. uti-agent)" },
  "keys.generate": { en: "Generate", fr: "Générer" },
  "keys.created": { en: "New key “{name}” — copy it now, it won't be shown again.", fr: "Nouvelle clé « {name} » — copiez-la maintenant, elle ne sera plus affichée." },
  "keys.active": { en: "active", fr: "active" },
  "keys.revoked": { en: "revoked", fr: "révoquée" },
  "keys.never": { en: "never used", fr: "jamais utilisée" },
  "keys.used": { en: "used {date}", fr: "utilisée {date}" },
  "keys.revoke": { en: "Revoke", fr: "Révoquer" },
  "keys.revoking": { en: "Revoking…", fr: "Révocation…" },
  "keys.empty": { en: "No API keys yet.", fr: "Aucune clé d'API." },

  // Action-class explanations (tooltips)
  "class.read": { en: "Read", fr: "Lecture" },
  "class.read.desc": { en: "Reads data only — allowed automatically, no risk.", fr: "Lecture de données uniquement — autorisé automatiquement, sans risque." },
  "class.write": { en: "Write", fr: "Écriture" },
  "class.write.desc": { en: "Changes data but is reversible — allowed automatically.", fr: "Modifie des données mais réversible — autorisé automatiquement." },
  "class.external_send": { en: "External send", fr: "Envoi externe" },
  "class.external_send.desc": { en: "Sends something outside (email, message) — held for human approval.", fr: "Envoie quelque chose à l'extérieur (email, message) — retenu pour validation humaine." },
  "class.irreversible": { en: "Irreversible", fr: "Irréversible" },
  "class.irreversible.desc": { en: "Cannot be undone (delete, deploy) — held for human approval.", fr: "Ne peut être annulé (suppression, déploiement) — retenu pour validation humaine." },
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
} satisfies Record<string, Entry>;

export type StrKey = keyof typeof STR;

const LangContext = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({
  lang: "en",
  setLang: () => {},
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>("en");
  useEffect(() => {
    const saved = (typeof window !== "undefined" && localStorage.getItem("xsom_lang")) as Lang | null;
    if (saved === "en" || saved === "fr") setLang(saved);
  }, []);
  const set = (l: Lang) => {
    setLang(l);
    if (typeof window !== "undefined") localStorage.setItem("xsom_lang", l);
  };
  return <LangContext.Provider value={{ lang, setLang: set }}>{children}</LangContext.Provider>;
}

export function useT() {
  const { lang, setLang } = useContext(LangContext);
  const t = (key: StrKey, vars?: Record<string, string | number>) => {
    let s = STR[key]?.[lang] ?? STR[key]?.en ?? String(key);
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
    return s;
  };
  return { t, lang, setLang };
}

export function LanguageToggle() {
  const { lang, setLang } = useT();
  return (
    <div className="flex items-center rounded-pill border border-white/15 bg-white/[0.04] p-0.5 text-xs font-semibold">
      {(["en", "fr"] as Lang[]).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          className={`rounded-pill px-2.5 py-1 transition ${
            lang === l ? "bg-brand text-white" : "text-white/55 hover:text-white"
          }`}
          aria-pressed={lang === l}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
