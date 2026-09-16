import type { Lang } from "@/lib/strings";

export const GLOSSARY_USES = ["development", "workplace", "models"] as const;
export type GlossaryUse = (typeof GLOSSARY_USES)[number];

type GlossaryDefinition = {
  title: string;
  definition: string;
  example: string;
  reflex: string;
};

export type GlossaryEntry = {
  id: string;
  uses: readonly GlossaryUse[];
  source: { code: string; title: string; href: string };
  copy: Record<Lang, GlossaryDefinition>;
};

/** Editorial selection by use, without a severity ranking or product coverage claim.
 * Definitions reference the OWASP LLM Top 10 2025; examples are illustrative.
 * The existing ranked landscape in lib/menaces.ts remains owned by /evidence.
 */
export const THREAT_GLOSSARY: readonly GlossaryEntry[] = [
  {
    id: "fuite-de-donnees",
    uses: ["development", "workplace", "models"],
    source: {
      code: "LLM02:2025",
      title: "Sensitive Information Disclosure",
      href: "https://genai.owasp.org/llmrisk/llm022025-sensitive-information-disclosure/",
    },
    copy: {
      fr: {
        title: "Fuite de données et de secrets",
        definition: "Une information confidentielle est transmise à un service IA non autorisé ou ressort dans une réponse accessible à une personne non autorisée.",
        example: "Un développeur colle une clé API dans son prompt ; un collaborateur joint un fichier client à un assistant non autorisé.",
        reflex: "Retirer les secrets, réduire les données transmises et vérifier les destinataires autorisés.",
      },
      en: {
        title: "Data and secret leakage",
        definition: "Confidential information is sent to an unauthorised AI service or appears in a response available to someone without permission.",
        example: "A developer pastes an API key into a prompt; an employee attaches a customer file to an unapproved assistant.",
        reflex: "Remove secrets, minimise shared data and check who is allowed to receive it.",
      },
    },
  },
  {
    id: "code-vulnerable",
    uses: ["development"],
    source: {
      code: "LLM05:2025",
      title: "Improper Output Handling",
      href: "https://genai.owasp.org/llmrisk/llm052025-improper-output-handling/",
    },
    copy: {
      fr: {
        title: "Code généré vulnérable",
        definition: "Du code ou une commande proposés par l’IA sont intégrés sans validation suffisante et introduisent une faille dans l’application.",
        example: "Une requête SQL générée assemble directement la saisie utilisateur et ouvre la voie à une injection.",
        reflex: "Relire le code, valider les sorties et conserver les contrôles de sécurité du projet.",
      },
      en: {
        title: "Vulnerable generated code",
        definition: "AI-generated code or commands are integrated without adequate validation, introducing an application vulnerability.",
        example: "A generated SQL query directly joins user input, allowing an injection attack.",
        reflex: "Review code, validate outputs and retain the project’s security checks.",
      },
    },
  },
  {
    id: "injection-de-prompt",
    uses: ["development", "workplace", "models"],
    source: {
      code: "LLM01:2025",
      title: "Prompt Injection",
      href: "https://genai.owasp.org/llmrisk/llm01-prompt-injection/",
    },
    copy: {
      fr: {
        title: "Injection de prompt",
        definition: "Des instructions introduites dans un message, une page ou un document tentent de détourner l’IA de sa tâche.",
        example: "Un document à résumer contient une consigne demandant à l’assistant d’envoyer des informations internes ailleurs.",
        reflex: "Traiter les contenus externes comme non fiables et limiter les actions accessibles à l’agent.",
      },
      en: {
        title: "Prompt injection",
        definition: "Instructions placed in a message, webpage or document attempt to divert the AI from its intended task.",
        example: "A document being summarised tells the assistant to send internal information to another destination.",
        reflex: "Treat external content as untrusted and limit the actions available to the agent.",
      },
    },
  },
  {
    id: "autonomie-excessive",
    uses: ["development", "workplace"],
    source: {
      code: "LLM06:2025",
      title: "Excessive Agency",
      href: "https://genai.owasp.org/llmrisk/llm062025-excessive-agency/",
    },
    copy: {
      fr: {
        title: "Autonomie excessive",
        definition: "Un agent dispose de trop de droits ou de liberté pour agir. Une erreur peut alors modifier, publier ou supprimer des informations.",
        example: "Un assistant chargé de préparer une réponse peut aussi l’envoyer, sans validation du collaborateur.",
        reflex: "Accorder uniquement les droits nécessaires et faire valider les actions à fort impact.",
      },
      en: {
        title: "Excessive agency",
        definition: "An agent has more permissions or freedom than it needs. A mistake can then change, publish or delete information.",
        example: "An assistant asked to draft a reply can also send it without the employee’s approval.",
        reflex: "Grant only necessary permissions and require approval for high-impact actions.",
      },
    },
  },
  {
    id: "dependances-compromises",
    uses: ["development", "models"],
    source: {
      code: "LLM03:2025",
      title: "Supply Chain",
      href: "https://genai.owasp.org/llmrisk/llm032025-supply-chain/",
    },
    copy: {
      fr: {
        title: "Dépendances compromises",
        definition: "Une bibliothèque, un modèle ou un composant tiers introduit une vulnérabilité ou un comportement malveillant dans la chaîne IA.",
        example: "Une équipe importe un modèle depuis un dépôt imitant celui de son fournisseur habituel.",
        reflex: "Vérifier l’origine et l’intégrité des composants, puis suivre leurs versions et vulnérabilités.",
      },
      en: {
        title: "Compromised dependencies",
        definition: "A third-party library, model or component introduces a vulnerability or malicious behaviour into the AI supply chain.",
        example: "A team imports a model from a repository impersonating its usual supplier.",
        reflex: "Check component provenance and integrity, then track versions and vulnerabilities.",
      },
    },
  },
  {
    id: "empoisonnement",
    uses: ["models"],
    source: {
      code: "LLM04:2025",
      title: "Data and Model Poisoning",
      href: "https://genai.owasp.org/llmrisk/llm042025-data-and-model-poisoning/",
    },
    copy: {
      fr: {
        title: "Empoisonnement des données ou du modèle",
        definition: "Des données d’apprentissage ou un modèle sont altérés pour influencer les résultats ou introduire un comportement caché.",
        example: "Un jeu de données modifié apprend au modèle à favoriser systématiquement une réponse choisie par l’attaquant.",
        reflex: "Tracer la provenance des données, contrôler leurs modifications et évaluer le modèle avant déploiement.",
      },
      en: {
        title: "Data or model poisoning",
        definition: "Training data or a model is tampered with to influence results or introduce hidden behaviour.",
        example: "A modified dataset teaches the model to consistently favour an answer selected by an attacker.",
        reflex: "Track data provenance, review changes and evaluate the model before deployment.",
      },
    },
  },
  {
    id: "acces-rag",
    uses: ["workplace", "models"],
    source: {
      code: "LLM08:2025",
      title: "Vector and Embedding Weaknesses",
      href: "https://genai.owasp.org/llmrisk/llm082025-vector-and-embedding-weaknesses/",
    },
    copy: {
      fr: {
        title: "Accès indu aux documents du RAG",
        definition: "Un assistant enrichi par une base documentaire (RAG) récupère des contenus sans respecter les droits de la personne qui l’interroge.",
        example: "L’assistant interne cite un dossier RH à un collaborateur qui ne peut pas ouvrir ce dossier.",
        reflex: "Appliquer les droits d’accès lors de la recherche et cloisonner les bases documentaires.",
      },
      en: {
        title: "Unauthorised RAG document access",
        definition: "An assistant using a knowledge base (RAG) retrieves documents without respecting the requesting user’s permissions.",
        example: "An internal assistant quotes an HR file to an employee who cannot open that file.",
        reflex: "Enforce access permissions during retrieval and separate document collections appropriately.",
      },
    },
  },
  {
    id: "hallucinations",
    uses: ["development", "workplace", "models"],
    source: {
      code: "LLM09:2025",
      title: "Misinformation",
      href: "https://genai.owasp.org/llmrisk/llm092025-misinformation/",
    },
    copy: {
      fr: {
        title: "Hallucinations et confiance excessive",
        definition: "L’IA produit une réponse convaincante mais inexacte. Le risque augmente si cette réponse est utilisée sans vérification.",
        example: "Une synthèse invente un chiffre que le collaborateur reprend dans une présentation client.",
        reflex: "Vérifier les faits dans les sources et faire relire les décisions importantes par une personne compétente.",
      },
      en: {
        title: "Hallucinations and overreliance",
        definition: "AI produces a convincing but inaccurate answer. The risk grows when that answer is used without verification.",
        example: "A summary invents a number that an employee copies into a customer presentation.",
        reflex: "Check facts against their sources and have important decisions reviewed by a qualified person.",
      },
    },
  },
];

export const GLOSSARY_COPY = {
  fr: {
    title: "Glossaire des menaces IA",
    description: "Comprendre les risques de l’IA au travail : définitions, exemples et repères pour le développement, les collaborateurs et les modèles et données.",
    kicker: "COMPRENDRE LES RISQUES",
    intro: "Les bons mots pour reconnaître les risques. Des définitions simples, des situations concrètes et les premiers réflexes à adopter dans vos usages IA.",
    home: "Accueil",
    search: "Rechercher une menace",
    placeholder: "Ex. : secrets, prompt, données…",
    filter: "Filtrer par usage IA",
    all: "Tous les usages",
    uses: { development: "Développement", workplace: "Collaborateurs", models: "Modèles & données" },
    count: "définitions affichées",
    countOne: "définition affichée",
    emptyTitle: "Aucune définition trouvée",
    emptyText: "Essayez un autre mot ou élargissez les usages sélectionnés.",
    reset: "Réinitialiser les filtres",
    example: "Exemple illustratif",
    reflex: "Premier réflexe",
    reference: "Référence OWASP",
    scope: "Ces repères décrivent les risques ; la couverture de chaque produit est précisée dans son offre.",
    deeper: "Explorer le relevé de couverture",
    nextTitle: "Passer des risques à vos usages.",
    nextText: "Découvrez les solutions AI Guard et choisissez votre point de départ.",
    nextLink: "Découvrir nos produits",
    footer: "xSOM AI Guard · Monitoring et cybersécurité des usages IA",
    cabinet: "Le cabinet xSOM",
    display: "Affichage",
    skip: "Aller aux définitions",
  },
  en: {
    title: "AI threat glossary",
    description: "Understand AI risks at work: definitions, examples and guidance for development, employees, and models and data.",
    kicker: "UNDERSTAND THE RISKS",
    intro: "The words to recognise the risks. Simple definitions, practical examples and first steps for your everyday AI use.",
    home: "Home",
    search: "Search for a threat",
    placeholder: "E.g. secrets, prompt, data…",
    filter: "Filter by AI use",
    all: "All uses",
    uses: { development: "Development", workplace: "Employees", models: "Models & data" },
    count: "definitions shown",
    countOne: "definition shown",
    emptyTitle: "No definitions found",
    emptyText: "Try another word or broaden the selected uses.",
    reset: "Reset filters",
    example: "Illustrative example",
    reflex: "First step",
    reference: "OWASP reference",
    scope: "These entries describe risks; each product’s coverage is detailed in its offer.",
    deeper: "Explore the coverage record",
    nextTitle: "Connect the risks to your AI use.",
    nextText: "Explore AI Guard solutions and choose where to start.",
    nextLink: "Discover our products",
    footer: "xSOM AI Guard · AI monitoring and cybersecurity",
    cabinet: "About xSOM",
    display: "Display",
    skip: "Skip to definitions",
  },
} as const;
