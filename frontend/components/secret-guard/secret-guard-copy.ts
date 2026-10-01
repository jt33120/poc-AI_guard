/**
 * La page Secret Guard : peu de mots, chacun à sa place. Les explications des
 * boutons reprennent ce que l'extension affiche elle-même (`status-tooltip.ts`).
 */

/** Les boutons du panneau que la page explique, dans l'ordre de lecture. */
export type TooltipControl = "dashboard" | "observe" | "redact" | "block" | "effects" | "purge" | "statusbar";

export const SECRET_GUARD_COPY = {
  fr: {
    meta: {
      title: "Secret Guard, l’extension VS Code",
      description: "Claude Code, Codex et GitHub Copilot en entreprise, sans exposer vos secrets. Filtrage local et déterministe, avant l’envoi.",
    },
    hero: {
      kicker: "Extension VS Code · gratuite",
      title: ["Les meilleurs agents de code.", "Sans exposer vos secrets."],
      lead: "Claude Code, Codex et GitHub Copilot en entreprise : les secrets détectés ne partent pas vers l’assistant.",
      download: "Télécharger",
      how: "Comment ça marche",
      hosts: "Compatible avec",
      video: "Un poste de développement de nuit : une ligne de code est saisie par un trait de lumière bleue.",
    },
    flow: {
      kicker: "Comment ça marche",
      title: "Un filtre entre le prompt et le serveur.",
      prompt: "Votre prompt",
      guard: "Secret Guard · sur le poste",
      server: "Serveurs de l’IA",
      layers: [
        ["Règles déterministes", "Clés, jetons, mots de passe"],
        ["Entropie", "Les chaînes trop aléatoires"],
        ["Réglage sur mesure", "Vos données clients · signé par xSOM"],
      ],
      team: "Grand Compte",
      sent: "Envoyé",
      masked: "‹ secret masqué ›",
      promptLine: "Déploie avec",
      footnote: "Sans LLM · sans réseau · avant l’envoi",
    },
    tour: {
      kicker: "Le panneau",
      title: "Tout se règle en un clic.",
      hint: "Survolez un bouton.",
      alt: "Le panneau Secret Guard dans VS Code, niveau Expurger : trois niveaux de protection, l’effet du niveau choisi, le bouton Expurger le presse-papiers et l’élément de la barre d’état.",
      recommended: "Recommandé",
      controls: {
        dashboard: ["Centre de protection", "L’état de chaque assistant et du relais, en un coup d’œil."],
        observe: ["Avertir", "Prévient, puis laisse passer le texte tel quel pendant 15 min, 1 h, 4 h ou 8 h, au choix dans le panneau. Puis retour à Expurger."],
        redact: ["Expurger", "Le secret est masqué, le message part quand même : dans @secretguard et Claude raccordé. Ailleurs, l’envoi s’arrête et un clic expurge le presse-papiers : il n’y a plus qu’à recoller."],
        block: ["Bloquer", "Arrête tout message où un secret est détecté, ambigu ou mal analysé."],
        effects: ["Ce qui part", "Le niveau d’exposition et le sort de votre message, assistant par assistant."],
        purge: ["Expurger le presse-papiers", "Remplace le presse-papiers par sa version expurgée, prête à coller. Rien ne change si le nettoyage est incomplet."],
        statusbar: ["Barre d’état", "Toujours visible. Un clic expurge le presse-papiers en niveau Expurger, le vérifie sinon."],
      } satisfies Record<TooltipControl, readonly [string, string]>,
    },
    download: {
      kicker: "Télécharger",
      title: "Secret Guard pour VS Code",
      version: "Version",
      button: "Télécharger le VSIX",
      notes: "Notes de version",
      requirement: "VS Code 1.133 ou plus récent · 1.137 pour GitHub Copilot",
      steps: [
        ["Télécharger", "Le fichier .vsix, sans compte."],
        ["Installer", "Palette › « Extensions : Installer à partir d’un VSIX »."],
        ["Activer", "Palette › « Secret Guard: Activer la protection automatique ». Dans Codex, approuvez le hook dans /hooks."],
      ],
      team: "Un relevé pour vos clients ? Voir Secret Guard Pro et Grand Compte",
    },
  },
  en: {
    meta: {
      title: "Secret Guard, the VS Code extension",
      description: "Claude Code, Codex and GitHub Copilot at work, without exposing your secrets. Local, deterministic filtering before anything is sent.",
    },
    hero: {
      kicker: "VS Code extension · free",
      title: ["The best coding agents.", "Without exposing your secrets."],
      lead: "Claude Code, Codex and GitHub Copilot at work: detected secrets are not sent to the assistant.",
      download: "Download",
      how: "How it works",
      hosts: "Works with",
      video: "A developer workstation at night: one line of code is caught by a streak of blue light.",
    },
    flow: {
      kicker: "How it works",
      title: "A filter between the prompt and the server.",
      prompt: "Your prompt",
      guard: "Secret Guard · on the workstation",
      server: "AI servers",
      layers: [
        ["Deterministic rules", "Keys, tokens, passwords"],
        ["Entropy", "Strings too random to be text"],
        ["Custom tuning", "Your customer data · signed by xSOM"],
      ],
      team: "Enterprise",
      sent: "Sent",
      masked: "‹ secret masked ›",
      promptLine: "Deploy with",
      footnote: "No LLM · no network · before sending",
    },
    tour: {
      kicker: "The panel",
      title: "Everything is one click away.",
      hint: "Hover a button.",
      alt: "The Secret Guard panel in VS Code, on the Redact level: three protection levels, the effect of the chosen level, the Redact clipboard button and the status bar item.",
      recommended: "Recommended",
      controls: {
        dashboard: ["Protection centre", "The state of each assistant and of the relay, at a glance."],
        observe: ["Warn", "Warns, then lets the text through as is for 15 min, 1 h, 4 h or 8 h, chosen in the panel. Then back to Redact."],
        redact: ["Redact", "The secret is masked and the message still goes: in @secretguard and a connected Claude. Elsewhere, sending stops and one click redacts the clipboard: just paste again."],
        block: ["Block", "Stops any message where a secret is detected, ambiguous or not fully scanned."],
        effects: ["What gets sent", "The exposure level and what happens to your message, assistant by assistant."],
        purge: ["Redact the clipboard", "Replaces the clipboard with its redacted version, ready to paste. Nothing changes if cleaning is incomplete."],
        statusbar: ["Status bar", "Always visible. One click redacts the clipboard on the Redact level, checks it otherwise."],
      } satisfies Record<TooltipControl, readonly [string, string]>,
    },
    download: {
      kicker: "Download",
      title: "Secret Guard for VS Code",
      version: "Version",
      button: "Download the VSIX",
      notes: "Release notes",
      requirement: "VS Code 1.133 or later · 1.137 for GitHub Copilot",
      steps: [
        ["Download", "The .vsix file, no account."],
        ["Install", "Palette › “Extensions: Install from VSIX”."],
        ["Enable", "Palette › “Secret Guard: Activer la protection automatique”. In Codex, trust the hook in /hooks."],
      ],
      team: "A statement for your clients? See Secret Guard Pro and Enterprise",
    },
  },
} as const;
