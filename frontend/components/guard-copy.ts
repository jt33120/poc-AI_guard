/**
 * La porte « parlez-nous », et il n'y en a qu'une.
 *
 * Deux endroits y mènent — le chemin « organisation » de l'accueil et la passerelle
 * contraignante sur `/saas` — et une seconde copie de cette adresse finirait par
 * diverger de la première sans que personne ne le remarque, puisque rien ne teste une
 * chaîne de caractères recopiée.
 */
export const CONTACT_MAILTO =
  "mailto:julian.talou@xsom.fr?subject=xSOM%20AI%20Guard%20%3A%20cas%20d%E2%80%99usage";

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
    routeLabel: "Architecture à étudier, pas une connexion active",
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
      "Vous créez un compte, vous branchez vos agents, vous écrivez vos règles. L’action refusée par la règle n’a pas lieu, et ce qui passe est écrit.",
    saasOpen:
      "Tout est ouvert à l’inscription, rien n’est facturé : on montre ce que le produit sait faire.",
    saasIncluded: "Ce que ça sait faire",
    saasFamilies: [
      {
        title: "Décider avant d’agir",
        body: "Le moteur est déterministe. Le modèle n’est consulté que sur les cas ambigus, et son silence compte comme un refus.",
        list: [
          "Classes d’action et règles par outil",
          "Score de risque sur quatre facteurs, autonomie graduée",
          "Juge LLM sur les seuls cas ambigus",
          "Contamination de session : ce qui a lu une source douteuse perd des droits",
        ],
      },
      {
        title: "Tenir l’humain dans la boucle",
        body: "L’attente est tenue par le contrôle lui-même, jamais déléguée au modèle.",
        list: [
          "File d’approbation, aperçu avant exécution, expiration",
          "Double approbation sur les actes les plus lourds",
          "Chaîne d’approbation : qui a approuvé quoi, inaltérable",
          "Notification des demandes en attente",
        ],
      },
      {
        title: "Surveiller les modèles",
        body: "Une adresse de base à changer, et chaque appel est vu.",
        list: [
          "Proxy de surveillance : votre clé fournisseur est transmise, jamais stockée",
          "Inspection DLP de la sortie, réglable par organisation",
          "Garde-prompt tiers orchestré et attesté : il ne bloque pas, et c’est écrit",
          "Détection de fuite du prompt système et des secrets",
          "Fenêtres d’observation : regarder sans contraindre, pour une durée bornée",
        ],
      },
      {
        title: "Prouver ce qui s’est passé",
        body: "Le journal n’accepte que des ajouts. Une entrée réécrite se voit ; une entrée disparue aussi.",
        list: [
          "Journal hash-chaîné, vérifiable à la demande",
          "Témoins signés Ed25519 : une troncature se voit, même par un tiers",
          "Export brut CSV et JSON",
          "Attestation AI Act art. 12 et 14, échafaudage FRIA art. 26",
          "Empreintes d’outils, quarantaine, verdicts d’outils tiers chaînés",
        ],
      },
      {
        title: "Écrire la règle, et la faire évoluer",
        body: "Un document lisible, pas une grille de cases à cocher.",
        list: [
          "Éditeur : quel outil, quelle classe d’action, quelle décision",
          "Assistant : la règle rédigée depuis une phrase",
          "Promotion de la règle, du bac à sable à la production",
          "Inventaire des agents, de leurs jetons, des serveurs en aval",
          "Regroupement par client, jetons de lecture serveur-à-serveur",
        ],
      },
      {
        title: "Voir",
        body: "Une console, et ce qu’elle montre vient du journal, pas d’un compteur tenu à côté.",
        list: [
          "Inspecteur, file d’approbation, explorateur du journal, vue de direction",
          "Consommation et coût, calculés sur vos propres clés fournisseurs",
          "Synthèses rédigées, inventaire des IA non déclarées",
          "Corpus déclarés, triage selon votre profil de déploiement",
        ],
      },
    ],
    saasProof: "Ce qui est bloqué, orchestré ou seulement attesté, ligne par ligne",
    saasGatewayTitle: "La seule chose qui ne s’ouvre pas toute seule",
    saasGatewayBody:
      "La passerelle MCP contraignante s’installe chez vous et demande un accès direct à la base. Elle s’accorde à la main, pas à l’inscription. Le reste de cette page marche sans elle : vos agents appellent la décision avant d’exécuter, et les modèles passent par le proxy.",
    saasGatewayCta: "Demander la passerelle",
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
        body: "Un appel à la décision juste avant que l’agent exécute un outil, et l’adresse de base de votre SDK pour les modèles. La console vous donne les deux, prêts à coller.",
      },
      {
        title: "Écrire la règle",
        body: "Partez du modèle fourni : lecture autorisée, écriture tracée, irréversible tenu.",
      },
    ],
    saasCta: "Créer un compte",
    saasBack: "Retour à l’accueil",
    saasNote:
      "Le périmètre dépend de ce que vous branchez : ce qui ne passe pas par nous n’est pas contrôlé.",
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
    routeLabel: "Architecture to explore, not an active connection",
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
      "Create an account, connect your agents, write your rules. An action the rule refuses does not happen, and whatever passes is recorded.",
    saasOpen:
      "Everything is open on sign-up and nothing is billed: we are showing what the product can do.",
    saasIncluded: "What it can do",
    saasFamilies: [
      {
        title: "Decide before acting",
        body: "The engine is deterministic. The model is only consulted on ambiguous cases, and its silence counts as a refusal.",
        list: [
          "Action classes and per-tool rules",
          "Risk score on four factors, graduated autonomy",
          "LLM judge on ambiguous cases only",
          "Session taint: whatever read an untrusted source loses rights",
        ],
      },
      {
        title: "Keep a human in the loop",
        body: "The wait is held by the control itself, never delegated to the model.",
        list: [
          "Approval queue, preview before execution, expiry",
          "Dual approval on the heaviest acts",
          "Approval chain: who approved what, tamper-evident",
          "Notification of pending requests",
        ],
      },
      {
        title: "Watch the models",
        body: "One base URL to change, and every call is seen.",
        list: [
          "Monitoring proxy: your provider key is forwarded, never stored",
          "DLP inspection of egress, tunable per organisation",
          "Third-party prompt guard orchestrated and attested: it does not block, and we say so",
          "System-prompt and secret leak detection",
          "Observation windows: watch without enforcing, for a bounded time",
        ],
      },
      {
        title: "Prove what happened",
        body: "The log only accepts additions. A rewritten entry shows; so does a missing one.",
        list: [
          "Hash-chained log, verifiable on demand",
          "Ed25519-signed witnesses: a truncation shows, even to a third party",
          "Raw CSV and JSON export",
          "AI Act art. 12 and 14 attestation, art. 26 FRIA scaffold",
          "Tool fingerprints, quarantine, chained third-party verdicts",
        ],
      },
      {
        title: "Write the rule, and move it",
        body: "A readable document, not a grid of checkboxes.",
        list: [
          "Editor: which tool, which action class, which decision",
          "Assistant: the rule drafted from a sentence",
          "Promotion from sandbox to production",
          "Inventory of agents, their tokens, downstream servers",
          "Grouping by client, server-to-server read tokens",
        ],
      },
      {
        title: "See",
        body: "A console, and what it shows comes from the log, not from a counter kept on the side.",
        list: [
          "Inspector, approval queue, log explorer, executive view",
          "Usage and cost, computed on your own provider keys",
          "Written summaries, inventory of undeclared AI",
          "Declared corpora, triage against your deployment profile",
        ],
      },
    ],
    saasProof: "What is blocked, orchestrated or merely attested, row by row",
    saasGatewayTitle: "The one thing that does not open on its own",
    saasGatewayBody:
      "The binding MCP gateway installs on your side and needs direct database access. It is granted by hand, not on sign-up. The rest of this page works without it: your agents call the decision before executing, and models go through the proxy.",
    saasGatewayCta: "Ask for the gateway",
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
        body: "One call to the decision right before your agent runs a tool, and your SDK base URL for models. The console hands you both, ready to paste.",
      },
      {
        title: "Write the rule",
        body: "Start from the shipped template: reads allowed, writes recorded, irreversible held.",
      },
    ],
    saasCta: "Create an account",
    saasBack: "Back to the home page",
    saasNote:
      "Scope depends on what you connect: anything that does not go through us is not governed.",
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
