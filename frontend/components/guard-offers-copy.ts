/** Public launch proposal. Activation and paid terms are agreed with xSOM, never automatic. */
export const PILOT_MAILTO = `mailto:julian.talou@xsom.fr?subject=${encodeURIComponent("Secret Guard Pro — découverte 90 jours")}`;
export const ENTERPRISE_MAILTO = `mailto:julian.talou@xsom.fr?subject=${encodeURIComponent("Secret Guard Grand Compte — demande de devis")}`;

/** Each offer's diagram: what runs on the workstation, and what xSOM adds. */
export type OfferDiagramKind = "basic" | "pro" | "enterprise";

export const GUARD_OFFERS_COPY = {
  fr: {
    kicker: "DÉMARRER AVEC XSOM",
    title: "La protection est gratuite. Vous payez la preuve.",
    intro: "Bloquer et expurger tournent sur votre poste, en open source. Les offres payantes ajoutent ce qu’un tiers doit tenir pour vous : le journal, l’attestation et le suivi pour vos clients.",
    offers: [
      { id: "basic", diagram: "basic", name: "Secret Guard Basic", audience: "Pour chaque développeur", price: "0 €", unit: "open source · sans compte", badge: "Gratuit · Apache 2.0", body: "Le secret reste sur votre poste : bloqué avant l’envoi, ou retiré du prompt avant qu’il parte.", features: ["Bloquer pour Copilot, Codex et Claude Code", "Expurger pour Claude Code, via un relais sur votre PC", "Détection sans réseau ni IA", "Sans compte xSOM, code vérifiable par tous"], action: "Installer gratuitement", href: "/secret-guard", note: "Expurger sans compte arrive avec la version 0.8 de l’extension. Le contrôle reste désactivable par l’utilisateur." },
      { id: "pro", diagram: "pro", name: "Secret Guard Pro", audience: "Pour les indépendants et les petites équipes", price: "24 €", unit: "HT / poste actif / mois · tarif cible", badge: "90 jours de découverte offerts", body: "Montrez à vos clients que leurs secrets sont restés chez vous.", features: ["Tout Secret Guard Basic", "Journal tenu par xSOM : daté, chaîné, sans contenu", "Relevé PDF par période et par assistant, à remettre au client", "Tableau de bord du suivi et documentation"], action: "Demander mes 90 jours", href: PILOT_MAILTO, note: "Le relevé couvre ce qui passe par le relais. Il ne voit ni le navigateur, ni un autre ordinateur. Sans carte ; aucun prélèvement automatique." },
      { id: "enterprise", diagram: "enterprise", name: "Secret Guard Grand Compte", audience: "Pour les entreprises et les environnements sensibles", price: "Sur devis", unit: "Licences et conseil xSOM, chiffrés sur votre périmètre", badge: "Accompagnement conseil", body: "Adaptez la détection à vos données et encadrez vos équipes avec les consultants xSOM.", features: ["Tout Secret Guard Pro", "Règles calibrées sur vos données : identifiants clients, formats internes", "Politiques d’équipe signées et état du parc", "Session de travail isolée, déploiement accompagné"], action: "Demander un devis", href: ENTERPRISE_MAILTO, note: "Session isolée : référence Linux validée localement. macOS, Windows et gestion de parc à qualifier. Intégration et exploitation chiffrées séparément." },
    ],
    diagram: {
      caption: "Comment ça marche",
      pc: "VOTRE PC",
      assistant: "Claude Code",
      relay: "Relais Secret Guard",
      provider: "Fournisseur d’IA",
      secret: "pwd=●●●●",
      masked: "pwd=‹masqué›",
      others: "Copilot · Codex",
      hook: "Hook : bloque",
      journal: "Journal xSOM",
      report: "Relevé client",
      meta: "métadonnées",
      rules: "Règles signées",
      fleet: "Console d’équipe",
      labels: {
        basic: "Le relais retire le secret avant l’envoi. Copilot et Codex ne passent pas par un relais : leur hook bloque.",
        pro: "Même nettoyage sur le poste. Seules des métadonnées partent chez xSOM, qui tient le journal et le relevé.",
        enterprise: "xSOM fournit en plus des règles calibrées sur vos données, signées, et une console pour l’équipe.",
      },
    },
    priceNote: "Tarifs cibles de lancement, confirmés par devis avant toute souscription. Les abonnements aux assistants IA restent à votre charge. La découverte porte sur la licence Pro ; toute prestation spécifique fait l’objet d’un devis préalable.",
    sovereigntyTitle: "La souveraineté commence par vos choix.",
    sovereigntyBody: "Un éditeur français. Des contrôles locaux. Des règles décidées par votre organisation. Les fournisseurs d’IA et les services cloud conservent leurs propres lieux de traitement : l’hébergement, les flux et les dépendances sont à préciser pour chaque déploiement.",
    faqTitle: "Avant de commencer",
    faqs: [
      ["Pourquoi un compte xSOM pour Pro, si tout tourne sur mon poste ?", "Pour la preuve. Un journal gardé sur votre propre PC ne prouve rien à votre client, puisque vous pourriez le modifier. xSOM reçoit les métadonnées au fil de l’eau, les date et les chaîne. Le prompt et les secrets ne quittent jamais votre poste."],
      ["Que prouve le relevé ?", "Que chaque requête passée par le relais a été analysée et que les secrets détectés ont été masqués avant le fournisseur, avec l’état de protection déclaré par chaque poste sur la période. Il ne voit ni un assistant ouvert dans le navigateur, ni un autre ordinateur, ni un poste dont la protection a été retirée, ni un secret que la détection ne reconnaît pas. Il ne prouve donc pas qu’aucun secret n’a été envoyé."],
      ["Que se passe-t-il après les 90 jours ?", "Nous faisons le bilan du pilote. Vous choisissez une souscription sur devis ou l’arrêt du service Pro. Il n’y a ni bascule payante automatique ni retrait de Secret Guard Basic. La fin du service ne transforme pas une action refusée en action autorisée."],
      ["Qu’est-ce qu’un poste actif ?", "Le devis précise les postes enrôlés facturables, la période de mesure et le traitement des postes de test ou retirés. Aucun montant n’est débité depuis ce site."],
      ["Que garantit xSOM ?", "Un périmètre documenté et des engagements écrits à convenir : droit d’usage, conformité documentaire, maintenance, support et recours. Aucun produit ne garantit l’absence d’incident. SLA, plafonds de responsabilité et assurance éventuelle sont précisés dans le dossier contractuel, sans présumer d’une couverture existante."],
      ["Est-ce une solution 100 % souveraine ?", "L’éditeur est français et la détection de secrets est locale. Cela ne rend pas français vos assistants IA ou tous les services cloud. Un déploiement répondant à vos exigences de souveraineté nécessite de qualifier l’ensemble des flux et des prestataires."],
    ],
  },
  en: {
    kicker: "START WITH XSOM", title: "Protection is free. You pay for the proof.",
    intro: "Blocking and redaction run on your workstation, as open source. The paid offers add what a third party must hold for you: the log, the attestation and the follow-up for your clients.",
    offers: [
      { id: "basic", diagram: "basic", name: "Secret Guard Basic", audience: "For every developer", price: "€0", unit: "open source · no account", badge: "Free · Apache 2.0", body: "The secret stays on your workstation: blocked before sending, or removed from the prompt before it leaves.", features: ["Block for Copilot, Codex and Claude Code", "Redact for Claude Code, through a relay on your PC", "Detection with no network and no AI", "No xSOM account, code anyone can check"], action: "Install for free", href: "/secret-guard", note: "Account-free redaction ships with version 0.8 of the extension. The user can disable the control." },
      { id: "pro", diagram: "pro", name: "Secret Guard Pro", audience: "For freelancers and small teams", price: "€24", unit: "excl. VAT / active workstation / month · target price", badge: "90 days of free discovery", body: "Show your clients that their secrets stayed with you.", features: ["Everything in Secret Guard Basic", "Log held by xSOM: dated, chained, without content", "PDF statement per period and per assistant, for your client", "Follow-up dashboard and documentation"], action: "Request my 90 days", href: PILOT_MAILTO, note: "The statement covers what passes through the relay. It does not see the browser or another computer. No card; no automatic charge." },
      { id: "enterprise", diagram: "enterprise", name: "Secret Guard Enterprise", audience: "For companies and sensitive environments", price: "On quote", unit: "xSOM licences and consulting, priced for your scope", badge: "Consulting engagement", body: "Fit detection to your data and govern your teams with xSOM consultants.", features: ["Everything in Secret Guard Pro", "Rules calibrated on your data: customer identifiers, internal formats", "Signed team policies and fleet status", "Isolated work session, guided deployment"], action: "Request a quote", href: ENTERPRISE_MAILTO, note: "Isolated session: Linux reference validated locally. macOS, Windows and fleet management require qualification. Integration and operations are quoted separately." },
    ],
    diagram: {
      caption: "How it works",
      pc: "YOUR PC",
      assistant: "Claude Code",
      relay: "Secret Guard relay",
      provider: "AI provider",
      secret: "pwd=●●●●",
      masked: "pwd=‹masked›",
      others: "Copilot · Codex",
      hook: "Hook: blocks",
      journal: "xSOM log",
      report: "Client statement",
      meta: "metadata",
      rules: "Signed rules",
      fleet: "Team console",
      labels: {
        basic: "The relay removes the secret before sending. Copilot and Codex do not go through a relay: their hook blocks.",
        pro: "Same cleaning on the workstation. Only metadata goes to xSOM, which holds the log and the statement.",
        enterprise: "xSOM also supplies rules calibrated on your data, signed, and a console for the team.",
      },
    },
    priceNote: "Target launch prices, confirmed by a quote before subscription. AI assistant subscriptions remain your expense. Discovery covers the Pro licence; any custom services require a prior quote.",
    sovereigntyTitle: "Sovereignty starts with your choices.",
    sovereigntyBody: "A French publisher. Local controls. Rules chosen by your organisation. AI providers and cloud services retain their own processing locations: hosting, data flows and dependencies must be specified for each deployment.",
    faqTitle: "Before you start",
    faqs: [
      ["Why an xSOM account for Pro, if everything runs on my workstation?", "For the proof. A log kept on your own PC proves nothing to your client, since you could edit it. xSOM receives the metadata as it happens, dates it and chains it. The prompt and the secrets never leave your workstation."],
      ["What does the statement prove?", "That every request through the relay was analysed and detected secrets were masked before reaching the provider, with each workstation's declared protection status over the period. It cannot see an assistant open in a browser, another computer, a workstation whose protection was removed, or a secret detection does not recognise. So it does not prove that no secret was ever sent."],
      ["What happens after 90 days?", "We review the pilot together. Choose a quoted subscription or stop the Pro service. There is no automatic paid conversion and Secret Guard Basic stays available. Service expiry does not turn a denied action into an allowed one."],
      ["What is an active workstation?", "The quote defines billable enrolled workstations, the measurement period and treatment of test or removed devices. This site does not charge you."],
      ["What does xSOM guarantee?", "A documented scope and written commitments to agree: usage rights, documentation conformity, maintenance, support and remedies. No product guarantees zero incidents. SLAs, liability caps and any insurance are specified in the contract pack, without assuming existing coverage."],
      ["Is this a 100% sovereign solution?", "The publisher is French and secret detection runs locally. That does not make your AI assistants or all cloud services French. Meeting your sovereignty requirements calls for assessing every data flow and provider."],
    ],
  },
} as const;

export const GUARD_OFFER_FAMILIES_COPY = {
  fr: {
    kicker: "Nos offres",
    title: "Trois façons d’avancer avec xSOM AI Studio.",
    intro: "En solo, en équipe ou à l’échelle de votre organisation : choisissez l’accompagnement adapté à vos usages.",
    offers: [
      { id: "open-source", badge: "01 · En solo", name: "Produits gratuits", body: "Des outils gratuits pour protéger vos usages individuels de l’IA, directement sur votre poste.", features: ["Pour un usage individuel", "Détection locale, sans envoi au cloud", "Installation en autonomie"], href: "/secret-guard", action: "Découvrir les outils" },
      { id: "software", badge: "02 · En équipe", name: "Offre logiciel", body: "Nos produits sous licence ou en SaaS pour équiper vos équipes et organiser la protection de vos usages de l’IA.", features: ["Licences et abonnements payants", "Des produits adaptés à vos usages", "Une offre selon votre périmètre"], href: "/produits", action: "Explorer nos logiciels" },
      { id: "consulting", badge: "03 · Sur mesure", name: "Offre conseil", body: "Un accompagnement dédié aux grands comptes et aux besoins personnalisés, avec le cabinet xSOM.", features: ["Cadrage de vos enjeux", "Accompagnement de vos équipes", "Réponse adaptée à votre organisation"], href: "https://www.xsom.fr", action: "Rencontrer xSOM" },
    ],
  },
  en: {
    kicker: "Our offers",
    title: "Three ways forward with xSOM AI Studio.",
    intro: "On your own, as a team or across your organisation: choose the support that fits your needs.",
    offers: [
      { id: "open-source", badge: "01 · Solo", name: "Free products", body: "Free tools to protect your individual AI usage, right on your workstation.", features: ["For individual use", "Local detection, no cloud upload", "Self-service installation"], href: "/secret-guard", action: "Discover the tools" },
      { id: "software", badge: "02 · Teams", name: "Software", body: "Our licensed and SaaS products to equip your teams and organise protection across your AI workflows.", features: ["Paid licences and subscriptions", "Products suited to your workflows", "An offer tailored to your scope"], href: "/produits", action: "Explore our software" },
      { id: "consulting", badge: "03 · Tailored", name: "Consulting", body: "Dedicated support for large organisations and custom requirements, with xSOM consulting.", features: ["Define your priorities", "Support your teams", "An approach tailored to your organisation"], href: "https://www.xsom.fr", action: "Meet xSOM" },
    ],
  },
} as const;
