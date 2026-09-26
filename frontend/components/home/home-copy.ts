/**
 * Les mots propres à la page d'accueil.
 *
 * Les usages par équipe et les trois façons d'avancer restent dans leurs fichiers
 * d'origine (`guard-home-copy.ts`, `guard-offers-copy.ts`), partagés avec d'autres
 * pages : l'accueil les lit, il ne les recopie pas.
 */
export const HOME_COPY = {
  fr: {
    menu: "Menu",
    closeMenu: "Fermer",
    film: {
      label: "Film d’introduction xSOM AI Studio",
      play: "Lecture",
      pause: "Pause",
      unmute: "Activer le son",
      mute: "Couper le son",
      next: "Découvrir",
    },
    exposure: {
      kicker: "01 · Vos équipes face à l’IA",
      risks: "Les risques · cliquer pour agrandir",
      readThreat: "Lire la fiche",
      teams: "Les équipes",
      close: "Fermer",
      enlarge: "Agrandir",
      attack: "Ce qui peut se passer",
      mitigation: "Comment réduire le risque",
      fullSheet: "Lire la fiche complète",
      closePreview: "Fermer l’aperçu",
    },
    paths: {
      kicker: "02 · Avancer avec xSOM",
      open: "Voir le détail",
    },
    secretGuard: {
      kicker: "Extension VS Code pour les équipes dev",
      badge: "Extension VS Code · xSOM",
      title: "Utilisez les meilleures IA de code sans compromettre la sécurité.",
      lead: "Secret Guard est une extension VS Code qui filtre de manière déterministe ce que vos équipes envoient aux assistants, et bloque les prompts contenant un secret, en toute transparence.",
      features: [
        ["Filtrage déterministe, sans LLM", "Des règles explicites et un calcul d’entropie repèrent clés, jetons et mots de passe dans le prompt, sur le poste : aucune IA ni appel réseau ne voit passer le secret."],
        ["Usage inchangé, action transparente", "Vos équipes gardent leurs assistants et leurs habitudes : pas de latence perceptible, pas d’usage différent. Seul le message contenant un secret est retenu, en toute transparence."],
        ["Réglage recommandé pour l’entreprise", "Pour protéger les données de vos clients et couvrir les besoins propres à votre organisation, notre équipe conseil calibre les règles de détection sur votre périmètre."],
      ],
      hosts: "Compatible avec",
      action: "Installer l’extension gratuite",
      imageAlt: "VS Code sous Windows avec Claude Code : Secret Guard indique « Message non envoyé » après avoir détecté un access_token, et son tooltip est ouvert sur le niveau Expurger.",
    },
  },
  en: {
    menu: "Menu",
    closeMenu: "Close",
    film: {
      label: "xSOM AI Studio introduction film",
      play: "Play",
      pause: "Pause",
      unmute: "Turn sound on",
      mute: "Turn sound off",
      next: "Discover",
    },
    exposure: {
      kicker: "01 · Your teams and AI",
      risks: "Risks · click to enlarge",
      readThreat: "Read the explanation",
      teams: "Teams",
      close: "Close",
      enlarge: "Enlarge",
      attack: "What can happen",
      mitigation: "How to reduce the risk",
      fullSheet: "Read the full explanation",
      closePreview: "Close preview",
    },
    paths: {
      kicker: "02 · Moving forward with xSOM",
      open: "See the details",
    },
    secretGuard: {
      kicker: "VS Code extension for dev teams",
      badge: "VS Code extension · xSOM",
      title: "Use the best AI coding assistants without compromising security.",
      lead: "Secret Guard is a VS Code extension that deterministically filters what your teams send to assistants and blocks prompts that contain a secret, transparently.",
      features: [
        ["Deterministic filtering, no LLM", "Explicit rules and an entropy check find keys, tokens and passwords in the prompt, on the workstation: no AI and no network call ever sees the secret."],
        ["Same workflow, transparent action", "Your teams keep their assistants and habits: no perceptible latency, no different usage. Only the message holding a secret is held back, transparently."],
        ["Tuning recommended for enterprises", "To protect your customers’ data and cover your organization’s specific needs, our consulting team calibrates the detection rules to your scope."],
      ],
      hosts: "Works with",
      action: "Install the free extension",
      imageAlt: "VS Code on Windows with Claude Code: Secret Guard reports “Message non envoyé” after detecting an access_token, with its tooltip open on the Redact level.",
    },
  },
} as const;

export type HomeCopy = (typeof HOME_COPY)[keyof typeof HOME_COPY];
