/**
 * La page xSOM Fleet. La promesse d'abord : les abonnements à l'échelle de
 * l'entreprise. La sécurité et les preuves viennent ensuite, comme conditions
 * d'achat. Règles : aucun client nommé, aucun prix de licence publié, aucune
 * promesse de « conformité », toute estimation est signée et datée.
 */

export const FLEET_CONTACT = "mailto:julian.talou@xsom.fr?subject=xSOM%20Fleet";

export const FLEET_COPY = {
  fr: {
    meta: {
      title: "xSOM Fleet · vos abonnements d’assistants de code à l’échelle de l’entreprise",
      description: "Claude Code et Codex pour 150 développeurs et plus, avec des abonnements par siège plutôt qu’une facture à l’usage. Une console, un agent sur chaque poste, le coût réel par développeur.",
    },
    hero: {
      kicker: "xSOM Fleet · programme pilote 2026",
      title: ["Vos abonnements d’assistants de code,", "à l’échelle de toute l’entreprise."],
      lead: "Claude Code et Codex pour 150 à plus de 600 développeurs, au prix d’un abonnement par siège plutôt qu’à la consommation. Une console pour tout le groupe, un agent sur chaque poste, le coût réel par développeur.",
      contact: "Demander une démonstration",
      how: "Comment ça marche",
      hosts: "Fonctionne avec",
    },
    cost: {
      kicker: "Le constat",
      title: "Le même travail, deux factures.",
      api: {
        label: "Au tarif API",
        value: "1 500 – 2 500 $",
        unit: "par développeur et par mois, en usage agentique intensif",
        source: "Estimation xSOM · octobre 2026",
      },
      seat: {
        label: "En abonnement par siège",
        value: "20 – 125 $",
        unit: "par développeur et par mois, selon le palier du siège",
        source: "Prix publics des offres Team et Business · octobre 2026",
      },
      note: "Depuis 2026, les offres Enterprise des fournisseurs facturent l’usage au tarif API. Les abonnements par siège restent forfaitaires, mais une organisation Claude Team s’arrête à 150 sièges et un espace ChatGPT Business à 200. xSOM Fleet administre les organisations et espaces dont votre groupe dispose, dans le cadre fixé par chaque fournisseur.",
    },
    pillars: {
      kicker: "Comment ça marche",
      title: "Une console, un agent, un coût réel.",
      items: [
        ["Une console pour tout le groupe", "Toutes vos organisations Claude Team et espaces ChatGPT Business, sous votre authentification unique. Sièges, paliers, arrivées et départs, au même endroit."],
        ["Un agent sur chaque poste", "Déployé par votre outil de gestion de flotte (Intune ou autre MDM). Il impose vos réglages à Claude Code et à Codex et retient les secrets avant tout envoi."],
        ["Le coût réel par développeur", "La facture réelle par développeur, par équipe et au total, et à côté l’équivalent au tarif API : l’économie se voit, chiffrée."],
        ["Des preuves pour l’audit", "Registre des assistants, état des postes, journal infalsifiable des blocages. Aucun contenu de prompt n’est conservé."],
      ],
    },
    principles: {
      kicker: "Nos principes",
      title: "Dans le cadre fixé par les fournisseurs.",
      items: [
        ["Outils officiels, non modifiés", "Vos développeurs gardent Claude Code et Codex tels que les fournisseurs les livrent."],
        ["Chacun garde sa propre connexion", "xSOM ne collecte aucun identifiant et ne revend aucun usage. Vous achetez vos abonnements directement aux fournisseurs."],
        ["Rien ne sort du poste", "La détection des secrets tourne en local, sans réseau ni modèle d’IA. Seuls remontent des métriques d’usage et des événements sans contenu."],
        ["Le contrôle reste en Europe", "Console, politiques et journaux hébergés dans l’Union européenne, ou chez vous."],
      ],
    },
    steps: {
      kicker: "La démarche",
      title: "Une preuve, un pilote, puis l’équipe entière.",
      items: [
        ["La preuve", "Une démonstration en direct, sur nos propres comptes : console, blocage d’un secret, coût réel face à l’équivalent API. Gratuite."],
        ["Le pilote", "Deux à trois mois chez vous, sur 150 développeurs ou plus, avec vos comptes et votre outil de déploiement."],
        ["Le déploiement", "Un abonnement annuel par développeur, avec l’accompagnement de xSOM Consulting : installation, formation, suivi."],
      ],
    },
    cta: {
      title: "Parlons de votre équipe.",
      body: "Combien de développeurs, quels assistants, quel outil de déploiement : trente minutes suffisent pour savoir si xSOM Fleet vous convient.",
      button: "Écrire à xSOM",
    },
  },
  en: {
    meta: {
      title: "xSOM Fleet · your coding-assistant subscriptions at enterprise scale",
      description: "Claude Code and Codex for 150 developers and more, on per-seat subscriptions instead of a usage bill. One console, an agent on every workstation, the real cost per developer.",
    },
    hero: {
      kicker: "xSOM Fleet · 2026 pilot programme",
      title: ["Your coding-assistant subscriptions,", "across the whole company."],
      lead: "Claude Code and Codex for 150 to 600+ developers, at per-seat subscription prices rather than pay-per-use. One console for the whole group, an agent on every workstation, the real cost per developer.",
      contact: "Request a demo",
      how: "How it works",
      hosts: "Works with",
    },
    cost: {
      kicker: "The problem",
      title: "Same work, two bills.",
      api: {
        label: "At API rates",
        value: "$1,500 – 2,500",
        unit: "per developer per month, under heavy agentic use",
        source: "xSOM estimate · October 2026",
      },
      seat: {
        label: "On per-seat subscriptions",
        value: "$20 – 125",
        unit: "per developer per month, depending on the seat tier",
        source: "Public prices of Team and Business plans · October 2026",
      },
      note: "Since 2026, the providers’ Enterprise plans bill usage at API rates. Per-seat subscriptions stay flat, but a Claude Team organisation stops at 150 seats and a ChatGPT Business workspace at 200. xSOM Fleet administers the organisations and workspaces your group holds, within each provider’s terms.",
    },
    pillars: {
      kicker: "How it works",
      title: "One console, one agent, one real cost.",
      items: [
        ["One console for the whole group", "All your Claude Team organisations and ChatGPT Business workspaces, behind your single sign-on. Seats, tiers, joiners and leavers, in one place."],
        ["An agent on every workstation", "Deployed by your fleet management tool (Intune or another MDM). It enforces your settings on Claude Code and Codex and holds secrets back before anything is sent."],
        ["The real cost per developer", "The actual bill per developer, per team and in total, next to the API-rate equivalent: the savings are visible and quantified."],
        ["Evidence for your auditors", "Assistant register, workstation status, tamper-evident log of blocks. No prompt content is kept."],
      ],
    },
    principles: {
      kicker: "Our principles",
      title: "Within the providers’ terms.",
      items: [
        ["Official tools, unmodified", "Your developers keep Claude Code and Codex exactly as the providers ship them."],
        ["Everyone keeps their own sign-in", "xSOM collects no credentials and resells no usage. You buy your subscriptions directly from the providers."],
        ["Nothing leaves the workstation", "Secret detection runs locally, with no network and no AI model. Only usage metrics and content-free events are sent."],
        ["Control stays in Europe", "Console, policies and logs hosted in the European Union, or on your premises."],
      ],
    },
    steps: {
      kicker: "The approach",
      title: "A proof, a pilot, then the whole team.",
      items: [
        ["The proof", "A live demo on our own accounts: console, a secret blocked, real cost against the API equivalent. Free."],
        ["The pilot", "Two to three months on your side, with 150 developers or more, your accounts and your deployment tool."],
        ["The rollout", "An annual per-developer subscription, with xSOM Consulting’s support: installation, training, follow-up."],
      ],
    },
    cta: {
      title: "Let’s talk about your team.",
      body: "How many developers, which assistants, which deployment tool: thirty minutes is enough to know whether xSOM Fleet fits.",
      button: "Write to xSOM",
    },
  },
} as const;
