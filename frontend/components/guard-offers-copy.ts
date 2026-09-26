/** Public launch proposal. Activation and paid terms are agreed with xSOM, never automatic. */
export const PILOT_MAILTO = `mailto:julian.talou@xsom.fr?subject=${encodeURIComponent("Secret Guard Équipe — découverte 90 jours")}`;
export const REINFORCED_MAILTO = `mailto:julian.talou@xsom.fr?subject=${encodeURIComponent("Secret Guard Renforcé — demande de devis")}`;

export const GUARD_OFFERS_COPY = {
  fr: {
    kicker: "DÉMARRER AVEC XSOM",
    title: "La confiance se construit à l’usage.",
    intro: "Commencez gratuitement. Évaluez le cadre d’équipe sur vos usages. Choisissez ensuite le niveau de gouvernance et d’accompagnement dont vous avez besoin.",
    offers: [
      { id: "local", name: "Secret Guard Local", audience: "Pour chaque développeur", price: "0 €", unit: "sans limite de durée", badge: "Gratuit", body: "Retenez les secrets avant leur envoi dans les prompts pris en charge.", features: ["Détection locale, sans envoi au cloud pour analyser", "Sans compte obligatoire ni carte bancaire", "Sans quota de scans locaux"], action: "Installer gratuitement", href: "/extension", note: "Extension VSIX. Les chemins compatibles sont détaillés à l’installation. Le contrôle local reste désactivable par l’utilisateur." },
      { id: "team", name: "Secret Guard Équipe", audience: "Pour les équipes de développement", price: "24 €", unit: "HT / poste actif / mois · tarif cible", badge: "90 jours de découverte offerts", body: "Donnez aux agents un cadre commun et à votre équipe un interlocuteur cyber.", features: ["Politiques signées et validations ciblées", "État du parc et preuves de décision minimales", "Périmètre et support définis avec xSOM"], action: "Demander mes 90 jours", href: PILOT_MAILTO, note: "Jusqu’à 10 postes, après qualification et accord de pilote. Sans carte. La souscription payante exige votre accord ; aucun prélèvement automatique." },
      { id: "reinforced", name: "Secret Guard Renforcé", audience: "Pour les environnements sensibles", price: "Sur devis", unit: "Prestation de conseil xSOM, chiffrée sur votre périmètre", badge: "Accompagnement conseil", body: "Ajoutez un environnement contraint au cadre d’équipe, déployé avec les consultants xSOM.", features: ["Socle Équipe et session de travail isolée", "Restrictions de fichiers, privilèges et réseau", "Déploiement et engagements de service sur devis"], action: "Demander un devis", href: REINFORCED_MAILTO, note: "Référence Linux validée localement. macOS, Windows et gestion de parc à qualifier. Intégration et exploitation chiffrées séparément." },
    ],
    priceNote: "Tarifs cibles de lancement, confirmés par devis avant toute souscription. Les abonnements aux assistants IA restent à votre charge. La découverte porte sur la licence Équipe ; toute prestation spécifique fait l’objet d’un devis préalable.",
    sovereigntyTitle: "La souveraineté commence par vos choix.",
    sovereigntyBody: "Un éditeur français. Des contrôles locaux. Des règles décidées par votre organisation. Les fournisseurs d’IA et les services cloud conservent leurs propres lieux de traitement : l’hébergement, les flux et les dépendances sont à préciser pour chaque déploiement.",
    faqTitle: "Avant de commencer",
    faqs: [
      ["Que se passe-t-il après les 90 jours ?", "Nous faisons le bilan du pilote. Vous choisissez une souscription sur devis ou l’arrêt du service Équipe. Il n’y a ni bascule payante automatique ni retrait du scanner local gratuit. La fin du service ne transforme pas une action refusée en action autorisée."],
      ["Qu’est-ce qu’un poste actif ?", "Le devis précise les postes enrôlés facturables, la période de mesure et le traitement des postes de test ou retirés. Aucun montant n’est débité depuis ce site."],
      ["Que garantit xSOM ?", "Un périmètre documenté et des engagements écrits à convenir : droit d’usage, conformité documentaire, maintenance, support et recours. Aucun produit ne garantit l’absence d’incident. SLA, plafonds de responsabilité et assurance éventuelle sont précisés dans le dossier contractuel, sans présumer d’une couverture existante."],
      ["Est-ce une solution 100 % souveraine ?", "L’éditeur est français et la détection de secrets est locale. Cela ne rend pas français vos assistants IA ou tous les services cloud. Un déploiement répondant à vos exigences de souveraineté nécessite de qualifier l’ensemble des flux et des prestataires."],
    ],
  },
  en: {
    kicker: "START WITH XSOM", title: "Build trust through use.",
    intro: "Start for free. Evaluate team governance in your own workflows. Then choose the governance and support your organisation needs.",
    offers: [
      { id: "local", name: "Secret Guard Local", audience: "For every developer", price: "€0", unit: "with no time limit", badge: "Free", body: "Hold secrets back before they leave in supported prompts.", features: ["Local detection, no cloud upload for analysis", "No mandatory account or payment card", "No local scan quota"], action: "Install for free", href: "/extension", note: "VSIX extension. Supported paths are detailed at installation. The user can disable the local control." },
      { id: "team", name: "Secret Guard Team", audience: "For development teams", price: "€24", unit: "excl. VAT / active workstation / month · target price", badge: "90 days of free discovery", body: "Give agents shared rules and your team an accountable security partner.", features: ["Signed policies and focused approvals", "Fleet posture and minimal decision evidence", "Scope and support agreed with xSOM"], action: "Request my 90 days", href: PILOT_MAILTO, note: "Up to 10 workstations, after qualification and a pilot agreement. No card. Paid subscriptions require your agreement; no automatic charge." },
      { id: "reinforced", name: "Secret Guard Reinforced", audience: "For sensitive environments", price: "On quote", unit: "xSOM consulting engagement, priced for your scope", badge: "Consulting engagement", body: "Add a constrained environment to team governance, deployed with xSOM consultants.", features: ["Team foundation and isolated work session", "File, privilege and network restrictions", "Quoted deployment and service commitments"], action: "Request a quote", href: REINFORCED_MAILTO, note: "Linux reference validated locally. macOS, Windows and fleet management require qualification. Integration and operations are quoted separately." },
    ],
    priceNote: "Target launch prices, confirmed by a quote before subscription. AI assistant subscriptions remain your expense. Discovery covers the Team licence; any custom services require a prior quote.",
    sovereigntyTitle: "Sovereignty starts with your choices.",
    sovereigntyBody: "A French publisher. Local controls. Rules chosen by your organisation. AI providers and cloud services retain their own processing locations: hosting, data flows and dependencies must be specified for each deployment.",
    faqTitle: "Before you start",
    faqs: [
      ["What happens after 90 days?", "We review the pilot together. Choose a quoted subscription or stop the Team service. There is no automatic paid conversion and the free local scanner stays available. Service expiry does not turn a denied action into an allowed one."],
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
      { id: "open-source", badge: "01 · En solo", name: "Produits open source", body: "Des outils ouverts pour protéger vos usages individuels de l’IA et garder la main sur votre environnement.", features: ["Pour un usage individuel", "Code ouvert et consultable", "Installation en autonomie"], href: "/extension", action: "Découvrir les outils" },
      { id: "software", badge: "02 · En équipe", name: "Offre logiciel", body: "Nos produits sous licence ou en SaaS pour équiper vos équipes et organiser la protection de vos usages de l’IA.", features: ["Licences et abonnements payants", "Des produits adaptés à vos usages", "Une offre selon votre périmètre"], href: "/produits", action: "Explorer nos logiciels" },
      { id: "consulting", badge: "03 · Sur mesure", name: "Offre conseil", body: "Un accompagnement dédié aux grands comptes et aux besoins personnalisés, avec le cabinet xSOM.", features: ["Cadrage de vos enjeux", "Accompagnement de vos équipes", "Réponse adaptée à votre organisation"], href: "https://www.xsom.fr", action: "Rencontrer xSOM" },
    ],
  },
  en: {
    kicker: "Our offers",
    title: "Three ways forward with xSOM AI Studio.",
    intro: "On your own, as a team or across your organisation: choose the support that fits your needs.",
    offers: [
      { id: "open-source", badge: "01 · Solo", name: "Open source products", body: "Open tools to protect your individual AI usage and stay in control of your environment.", features: ["For individual use", "Open, inspectable code", "Self-service installation"], href: "/extension", action: "Discover the tools" },
      { id: "software", badge: "02 · Teams", name: "Software", body: "Our licensed and SaaS products to equip your teams and organise protection across your AI workflows.", features: ["Paid licences and subscriptions", "Products suited to your workflows", "An offer tailored to your scope"], href: "/produits", action: "Explore our software" },
      { id: "consulting", badge: "03 · Tailored", name: "Consulting", body: "Dedicated support for large organisations and custom requirements, with xSOM consulting.", features: ["Define your priorities", "Support your teams", "An approach tailored to your organisation"], href: "https://www.xsom.fr", action: "Meet xSOM" },
    ],
  },
} as const;
