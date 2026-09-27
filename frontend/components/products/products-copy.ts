import { CONTACT_MAILTO } from "@/components/guard-copy";
import type { FilmMedia } from "@/components/home/HomeFilm";

/** Le film de la page produits (`scripts/render-products-film.mjs`) : ses mots sont repris dans `label`. */
export const PRODUCTS_HERO_MEDIA: FilmMedia = {
  fr: {
    mp4: "/signal-media/xsom-products-v1-fr.mp4",
    poster: "/signal-media/xsom-products-v1-fr.jpg",
    label: "Nos produits : sur le poste, protéger ce que vos équipes envoient aux IA. Dans votre infrastructure, contrôler chaque action de vos agents. Du poste au serveur : nos produits de cybersécurité IA.",
  },
  en: {
    mp4: "/signal-media/xsom-products-v1-en.mp4",
    poster: "/signal-media/xsom-products-v1-en.jpg",
    label: "Our products: on the workstation, protect what your teams send to AI. In your infrastructure, control every action your agents take. From laptop to server: our AI cybersecurity products.",
  },
};

/** Les produits du carrousel. La gamme va s'agrandir : ni le film ni les titres ne les comptent. */
export const PRODUCTS_COPY = {
  fr: {
    kicker: "Nos produits",
    title: "Sécuriser l’IA, du poste à l’infrastructure.",
    carousel: "Nos produits",
    previous: "Produit précédent",
    next: "Produit suivant",
    of: "sur",
    slides: [
      {
        id: "secret-guard",
        tag: "01 · Extension VS Code",
        name: "Secret Guard",
        lead: "Profitez des agents de code en entreprise, sans exposer vos secrets.",
        body: "Secret Guard filtre sur le poste ce que vos développeurs envoient à GitHub Copilot, Claude Code et Codex. L’édition Local est gratuite ; Équipe ajoute des validations, des preuves et, en pilote, des règles calibrées et signées par xSOM.",
        features: ["Filtrage déterministe, sans LLM", "Usage inchangé, sans latence perceptible", "Éditions Local, Équipe et Renforcé"],
        primary: { label: "Découvrir Secret Guard", href: "/secret-guard" },
        secondary: { label: "Voir les éditions", href: "#offres" },
        note: "Le pilote vérifie chaque capacité dans vos versions d’assistants.",
        imageAlt: "VS Code sous Windows avec Claude Code : Secret Guard retient un message contenant un access_token, sans afficher sa valeur.",
      },
      {
        id: "ai-guard",
        tag: "02 · Plateforme sur site",
        name: "AI Guard",
        lead: "Tracez et monitorez les actions de vos agents, dans votre infrastructure.",
        body: "La passerelle se place entre vos agents et leurs outils. Chaque action rencontre une règle : automatique, soumise à une validation humaine, ou refusée. Le journal garde la décision, et il s’exporte.",
        features: ["Règles d’action et validation humaine", "Journal d’audit immuable et exportable", "Déployée dans votre infrastructure"],
        primary: { label: "Explorer la plateforme", href: "/login" },
        secondary: { label: "Chiffrer un déploiement", href: CONTACT_MAILTO },
        note: "Console de découverte gratuite. Passerelle et intégration sur devis, distinctes des tarifs Secret Guard. Seuls les outils raccordés sont contrôlés.",
        imageAlt: "La console AI Guard : registre des outils, règle effective pour l’outil choisi, et le récit d’un appel jusqu’à sa trace.",
      },
    ],
  },
  en: {
    kicker: "Our products",
    title: "Securing AI, from workstation to infrastructure.",
    carousel: "Our products",
    previous: "Previous product",
    next: "Next product",
    of: "of",
    slides: [
      {
        id: "secret-guard",
        tag: "01 · VS Code extension",
        name: "Secret Guard",
        lead: "Use AI coding agents at work without exposing your secrets.",
        body: "Secret Guard filters, on the workstation, what your developers send to GitHub Copilot, Claude Code and Codex. The Local edition is free; Team adds approvals, evidence and, in pilot, rules calibrated and signed by xSOM.",
        features: ["Deterministic filtering, no LLM", "Same workflow, no perceptible latency", "Local, Team and Reinforced editions"],
        primary: { label: "Discover Secret Guard", href: "/secret-guard" },
        secondary: { label: "See the editions", href: "#offres" },
        note: "The pilot checks each capability in your assistant versions.",
        imageAlt: "VS Code on Windows with Claude Code: Secret Guard holds back a message containing an access_token, without showing its value.",
      },
      {
        id: "ai-guard",
        tag: "02 · On-premise platform",
        name: "AI Guard",
        lead: "Trace and monitor what your agents do, inside your infrastructure.",
        body: "The gateway sits between your agents and their tools. Every action meets a rule: automatic, held for human approval, or refused. The log keeps the decision, and it exports.",
        features: ["Action rules and human approval", "Immutable, exportable audit log", "Deployed in your infrastructure"],
        primary: { label: "Explore the platform", href: "/login" },
        secondary: { label: "Request a deployment quote", href: CONTACT_MAILTO },
        note: "Free discovery console. Gateway and integration quoted separately from Secret Guard pricing. Only connected tools are controlled.",
        imageAlt: "The AI Guard console: the tool registry, the effective rule for the selected tool, and one call told through to its trace.",
      },
    ],
  },
} as const;
