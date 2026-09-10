/** Concrete orientation copy; none of these illustrative paths claims live coverage. */
export const GUARD_COPY = {
  fr: {
    lab: "Le laboratoire IA de xSOM",
    poc: "Prototype en expérimentation",
    title: ["L’IA avance.", "Gardez la main."],
    intro:
      "Des collaborateurs qui créent. Des développeurs qui automatisent. Des données dont vous choisissez le chemin.",
    explore: "Voir les menaces",
    signin: "Accéder au POC",
    evidence: "Périmètre & preuves",
    heroNote:
      "AI Guard est un POC du cabinet xSOM, ESN spécialisée en cybersécurité.",
    demo: "Scénario illustratif · aucune action réelle",
    choose: "Choisir un exemple",
    scene: "Parcours illustratif d’une demande IA",
    examples: {
      document: "Un document",
      code: "Du code",
      action: "Une action",
    },
    scenarios: {
      document: {
        source: "Assistant interne",
        request: "Résumer un dossier client",
        rule: "Vérifier ce qui peut sortir",
        target: "Modèle autorisé",
        note: "Le contenu transmis et les contrôles disponibles dépendent du chemin intégré.",
        status: "Données à qualifier",
      },
      code: {
        source: "Application métier",
        request: "Aider à écrire du code",
        rule: "Encadrer l’appel au modèle",
        target: "OpenAI · Claude",
        note: "Un appel de votre application peut passer par le proxy. Un abonnement web personnel n’est pas couvert automatiquement.",
        status: "Connexion à configurer",
      },
      action: {
        source: "Agent développeur",
        request: "Supprimer une ressource",
        rule: "Demander une validation",
        target: "Outil de travail",
        note: "Ici, une politique impose une validation avant que la passerelle ne transmette l’action à l’outil.",
        status: "Validation requise",
      },
    },
    control: "AI Guard",
    policy: "Règles · supervision · traces",
    input: "Votre usage",
    output: "Sa destination",
    usageKicker: "Partir de votre quotidien",
    usageTitle: "Comment utilisez-vous l’IA ?",
    usageIntro:
      "Choisissez un usage. Puis regardez où circulent les informations.",
    audiences: {
      people: "Collaborateurs",
      developers: "Développeurs",
      data: "Données confidentielles",
    },
    details: {
      people: {
        title: "Une aide au quotidien, à l’échelle de l’entreprise.",
        list: [
          "Rédiger et synthétiser",
          "Rechercher dans les documents",
          "Préparer une analyse",
        ],
        source: "Vos collaborateurs",
        middle: "Assistant d’entreprise",
        note: "ChatGPT ou Claude dans un navigateur ne passent pas, par défaut, par AI Guard. Un assistant interne doit être intégré pour que les flux soient contrôlés.",
      },
      developers: {
        title: "Construire avec l’IA. Encadrer ce qu’elle peut faire.",
        list: [
          "Intégrer un modèle dans une application",
          "Assister le développement",
          "Automatiser des actions sous supervision",
        ],
        source: "Votre équipe dev",
        middle: "Application ou agent",
        note: "Le proxy reçoit les appels au modèle. La passerelle d’outils contrôle les actions qui lui sont confiées. Ce sont deux intégrations distinctes.",
      },
      data: {
        title: "Un document confidentiel mérite un chemin explicite.",
        list: [
          "Identifier les informations sensibles",
          "Choisir où le modèle s’exécute",
          "Définir les droits et garder une trace",
        ],
        source: "Vos documents",
        middle: "Assistant autorisé",
        note: "Un modèle hébergé en interne est une option d’architecture, pas une certification. Hébergement, droits et journalisation restent à vérifier pour chaque déploiement.",
      },
    },
    destination: "Où souhaitez-vous utiliser le modèle ?",
    cloud: "Services cloud",
    internal: "Dans votre infrastructure",
    cloudNames: "OpenAI · Claude",
    internalNames: "Modèle open-weight",
    cloudDetail: "Via une application intégrée",
    internalDetail: "Hébergé par votre organisation",
    routeLabel: "Architecture à étudier — pas une connexion active",
    routeScope:
      "AI Guard intervient uniquement sur les flux intégrés. Ce choix ne connecte aucun service.",
    next: "Étudier ce parcours",
    whyTitle: "Voir. Décider. Retrouver.",
    whyIntro: "Trois gestes à explorer dans le prototype.",
    steps: [
      {
        title: "Voir la demande",
        body: "Quel outil ? Quelles données ? Quelle destination ?",
      },
      {
        title: "Poser une règle",
        body: "Autoriser, refuser ou demander une validation.",
      },
      {
        title: "Retrouver la trace",
        body: "Consulter les décisions effectivement journalisées.",
      },
    ],
    problemKicker: "Le problème",
    problemTitle: "Les menaces IA se multiplient.",
    problemIntro:
      "Une requête IA traverse une chaîne : l’invite qu’elle reçoit, les données qu’elle lit, le modèle qui répond, les actions qu’elle déclenche, l’humain qui valide. Chaque maillon a ses propres attaques.",
    problemPick: "Choisir un maillon",
    problemTop: "Les plus coûteuses",
    problemTopNote: "Le haut du classement, tous maillons confondus.",
    problemLinkNote:
      "Ce classement décrit le paysage. Il n’affirme aucune protection : la couverture réellement prouvée est publiée à part.",
    problemLink: "Voir le relevé et les preuves",
    critical: "critique",
    whoKicker: "Vous",
    whoTitle: "Dites-nous en plus sur vous.",
    whoIntro: "Votre situation décide de la suite. Choisissez la vôtre.",
    paths: {
      company: {
        tag: "Organisation",
        title: "Vous avez des équipes, des données et des obligations.",
        list: [
          "Cartographier vos usages IA réels",
          "Poser des règles qui tiennent devant un auditeur",
          "Intégrer la passerelle dans votre système",
        ],
        action: "Écrire à xSOM",
        note: "Nous partons de votre contexte, pas d’un catalogue.",
      },
      builder: {
        tag: "Développeur",
        title: "Vous construisez seul ou en petite équipe.",
        list: [
          "Brancher vos agents sans nous appeler",
          "Encadrer les actions irréversibles",
          "Garder une trace de ce que l’agent a fait",
        ],
        action: "Voir l’offre libre-service",
        note: "Compte créé en ligne, mise en place guidée.",
      },
    },
    saasKicker: "Libre-service",
    saasTitle: "Encadrez vos agents, sans nous appeler.",
    saasIntro:
      "Vous créez un compte, vous branchez vos agents, vous écrivez vos règles. La passerelle refuse ce que la règle refuse, et écrit ce qu’elle a laissé passer.",
    saasIncluded: "Ce qui est inclus",
    saasIncludes: [
      {
        title: "La passerelle d’outils",
        body: "Vos agents parlent MCP à la passerelle. Elle applique la règle avant que l’outil ne soit appelé.",
      },
      {
        title: "L’attente humaine",
        body: "Une action irréversible s’arrête et attend un clic. Sans ce clic, elle n’a pas lieu.",
      },
      {
        title: "Le journal chaîné",
        body: "Chaque décision est écrite et chaînée à la précédente. Une entrée réécrite se voit.",
      },
      {
        title: "Le proxy de modèles",
        body: "Pointez votre SDK sur une autre adresse. Les appels de modèle passent par nous, sans changer votre code.",
      },
      {
        title: "L’éditeur de règles",
        body: "Un document lisible : quel outil, quelle classe d’action, quelle décision.",
      },
      {
        title: "La console",
        body: "La file d’attente, l’explorateur du journal, la consommation.",
      },
    ],
    saasStart: "Démarrer",
    saasStartIntro: "Quatre gestes. Comptez une matinée pour le premier agent.",
    saasSteps: [
      {
        title: "Créer le compte",
        body: "Une adresse, un mot de passe, et votre organisation existe.",
      },
      {
        title: "Créer un jeton d’agent",
        body: "Dans la console. Il s’affiche une fois, il identifie l’agent dans le journal.",
      },
      {
        title: "Brancher",
        body: "Pour les outils, la passerelle MCP lit le jeton et l’adresse de la base. Pour les modèles, changez l’adresse de base de votre SDK.",
      },
      {
        title: "Écrire la règle",
        body: "Partez du modèle fourni : lecture autorisée, écriture tracée, irréversible tenu.",
      },
    ],
    saasCta: "Créer un compte",
    saasBack: "Retour à l’accueil",
    saasNote:
      "Le périmètre dépend de ce que vous branchez : ce qui ne passe pas par la passerelle n’est pas contrôlé.",
    limits: "Ce que le POC ne promet pas",
    limitsText:
      "Pas de protection automatique de tous les usages IA. Pas de certification de conformité. Le périmètre réel dépend du branchement, des règles et des fonctions éprouvées.",
    finalTitle: "Un usage concret à examiner ?",
    finalBody: "Commençons par votre équipe, vos données et vos contraintes.",
    contact: "Échanger avec xSOM",
    cabinet: "Le cabinet xSOM",
    footer: "Un terrain d’expérimentation, pas une offre généralisée.",
  },
  en: {
    lab: "The xSOM AI lab",
    poc: "Experimental prototype",
    title: ["AI moves forward.", "Stay in control."],
    intro:
      "People creating. Developers automating. Data with a clearly defined path.",
    explore: "See the threats",
    signin: "Open the POC",
    evidence: "Scope & evidence",
    heroNote:
      "AI Guard is a POC by xSOM, an IT services firm specialising in cybersecurity.",
    demo: "Illustrative scenario · no real action",
    choose: "Choose an example",
    scene: "Illustrative path of an AI request",
    examples: {
      document: "A document",
      code: "Some code",
      action: "An action",
    },
    scenarios: {
      document: {
        source: "Internal assistant",
        request: "Summarise a client file",
        rule: "Check what may leave",
        target: "Authorised model",
        note: "The information sent and available controls depend on the integrated route.",
        status: "Data to assess",
      },
      code: {
        source: "Business application",
        request: "Help write code",
        rule: "Govern the model request",
        target: "OpenAI · Claude",
        note: "Your application can send requests through the proxy. A personal web subscription is not automatically covered.",
        status: "Integration to configure",
      },
      action: {
        source: "Developer agent",
        request: "Delete a resource",
        rule: "Request human approval",
        target: "Work tool",
        note: "Here a policy requires approval before the gateway forwards the action to the tool.",
        status: "Approval required",
      },
    },
    control: "AI Guard",
    policy: "Rules · supervision · records",
    input: "Your use case",
    output: "Its destination",
    usageKicker: "Start with your work",
    usageTitle: "How do you use AI?",
    usageIntro: "Choose a use case. Then see where the information goes.",
    audiences: {
      people: "Employees",
      developers: "Developers",
      data: "Confidential data",
    },
    details: {
      people: {
        title: "Everyday assistance, across your organisation.",
        list: [
          "Write and summarise",
          "Search internal documents",
          "Prepare an analysis",
        ],
        source: "Your employees",
        middle: "Enterprise assistant",
        note: "ChatGPT or Claude in a browser do not go through AI Guard by default. An internal assistant needs integration before its traffic can be controlled.",
      },
      developers: {
        title: "Build with AI. Define what it can do.",
        list: [
          "Integrate a model into an application",
          "Support software development",
          "Automate actions with supervision",
        ],
        source: "Your dev team",
        middle: "Application or agent",
        note: "The model proxy receives model requests. The tools gateway controls actions routed through it. These are separate integrations.",
      },
      data: {
        title: "Confidential documents need an explicit path.",
        list: [
          "Identify sensitive information",
          "Choose where the model runs",
          "Define access and keep records",
        ],
        source: "Your documents",
        middle: "Authorised assistant",
        note: "An internally hosted model is an architecture choice, not a certification. Hosting, permissions and logging must be checked for every deployment.",
      },
    },
    destination: "Where would you like to use the model?",
    cloud: "Cloud services",
    internal: "Your infrastructure",
    cloudNames: "OpenAI · Claude",
    internalNames: "Open-weight model",
    cloudDetail: "Through an integrated application",
    internalDetail: "Hosted by your organisation",
    routeLabel: "Architecture to explore — not an active connection",
    routeScope:
      "AI Guard only acts on integrated traffic. This selection does not connect a service.",
    next: "Discuss this path",
    whyTitle: "See. Decide. Trace.",
    whyIntro: "Three things to explore in the prototype.",
    steps: [
      {
        title: "See the request",
        body: "Which tool? Which data? Which destination?",
      },
      { title: "Set a rule", body: "Allow, deny, or request human approval." },
      {
        title: "Find the record",
        body: "Review decisions that were actually logged.",
      },
    ],
    problemKicker: "The problem",
    problemTitle: "AI threats keep multiplying.",
    problemIntro:
      "An AI request travels a chain: the prompt it receives, the data it reads, the model that answers, the actions it triggers, the human who approves. Every link has its own attacks.",
    problemPick: "Choose a link",
    problemTop: "The costliest",
    problemTopNote: "The top of the ranking, across every link.",
    problemLinkNote:
      "This ranking describes the landscape. It claims no protection: proven coverage is published separately.",
    problemLink: "See the ledger and the evidence",
    critical: "critical",
    whoKicker: "You",
    whoTitle: "Tell us about you.",
    whoIntro: "Your situation decides what comes next. Pick yours.",
    paths: {
      company: {
        tag: "Organisation",
        title: "You have teams, data and obligations.",
        list: [
          "Map your real AI usage",
          "Set rules that hold up in an audit",
          "Integrate the gateway into your systems",
        ],
        action: "Email xSOM",
        note: "We start from your context, not from a catalogue.",
      },
      builder: {
        tag: "Developer",
        title: "You build alone or in a small team.",
        list: [
          "Connect your agents without calling us",
          "Govern irreversible actions",
          "Keep a record of what the agent did",
        ],
        action: "See the self-serve offer",
        note: "Sign up online, guided setup.",
      },
    },
    saasKicker: "Self-serve",
    saasTitle: "Govern your agents, without calling us.",
    saasIntro:
      "Create an account, connect your agents, write your rules. The gateway refuses what the rule refuses, and records what it let through.",
    saasIncluded: "What is included",
    saasIncludes: [
      {
        title: "The tools gateway",
        body: "Your agents speak MCP to the gateway. It applies the rule before the tool is called.",
      },
      {
        title: "Human approval",
        body: "An irreversible action stops and waits for a click. Without that click, it does not happen.",
      },
      {
        title: "The chained log",
        body: "Every decision is written and chained to the previous one. A rewritten entry shows.",
      },
      {
        title: "The model proxy",
        body: "Point your SDK at a different base URL. Model calls go through us, with no code change.",
      },
      {
        title: "The policy editor",
        body: "A readable document: which tool, which action class, which decision.",
      },
      {
        title: "The console",
        body: "The approval queue, the log explorer, usage.",
      },
    ],
    saasStart: "Get started",
    saasStartIntro: "Four steps. Allow a morning for your first agent.",
    saasSteps: [
      {
        title: "Create the account",
        body: "An address, a password, and your organisation exists.",
      },
      {
        title: "Create an agent token",
        body: "In the console. Shown once, it identifies the agent in the log.",
      },
      {
        title: "Connect",
        body: "For tools, the MCP gateway reads the token and the database address. For models, change your SDK base URL.",
      },
      {
        title: "Write the rule",
        body: "Start from the shipped template: reads allowed, writes recorded, irreversible held.",
      },
    ],
    saasCta: "Create an account",
    saasBack: "Back to the home page",
    saasNote:
      "Scope depends on what you connect: anything that does not go through the gateway is not governed.",
    limits: "What the POC does not promise",
    limitsText:
      "No automatic protection for every AI use. No compliance certification. Actual scope depends on integration, policies and proven functionality.",
    finalTitle: "Have a real use case in mind?",
    finalBody: "Let’s start with your team, data and constraints.",
    contact: "Talk to xSOM",
    cabinet: "The xSOM firm",
    footer: "An experimental project, not a generally available offering.",
  },
} as const;
