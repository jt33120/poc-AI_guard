# Journal des versions

## Non publié

- **Un message bloqué ne part plus pour le titre de session de Claude Code** :
  lancé depuis son extension VS Code, Claude Code demandait au modèle un titre
  de session dès l’envoi du message, avant la décision de Secret Guard. Un
  message retenu partait donc quand même chez Anthropic, secret compris, dans
  cette requête de titre. Secret Guard ajoute désormais
  `CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1` à la clé `env` des réglages de Claude
  Code, ce qui supprime cette requête sans toucher à la télémétrie, et la
  retire à la désactivation comme à la désinstallation. Une installation
  existante est complétée au rafraîchissement suivant.

## 0.8.2

- **Avertir tient la durée choisie avec plusieurs fenêtres VS Code ouvertes** :
  choisir 8 h dans une fenêtre ne repasse plus en Expurger au bout d’une heure.
  Chaque fenêtre réagissait au changement de mode en relançant Avertir avec sa
  propre durée en mémoire (souvent 1 h), et sa minuterie remettait ensuite tout
  le poste en Expurger. Désormais, la fenêtre où l’on choisit la durée l’écrit
  avant d’enregistrer le mode, les autres la conservent, et une minuterie
  relit l’échéance avant de mettre fin à Avertir.

## 0.8.1

- **Désinstaller retire tout** : les hooks Claude Code, Codex et GitHub Copilot
  ne survivent plus à l’extension. Le hook détecte lui-même la désinstallation à
  l’appel suivant (VS Code ne liste plus l’extension), retire ses entrées des
  réglages des assistants sans toucher aux autres hooks, supprime son script et
  laisse passer le message. Un script `vscode:uninstall` nettoie au redémarrage
  de VS Code les entrées restées sans appel. Avant cette version, désinstaller
  laissait des hooks actifs qui continuaient de bloquer ou d’expurger.

## 0.8.0

- **Purge transparente pour Claude Code, sans compte (Secret Guard Basic)** : en
  mode Expurger, un relais local retire les secrets des requêtes de Claude Code
  avant Anthropic, et la session continue avec le message « Prompt purgé avant
  envoi ». Le relais tourne hors du fil de l'hôte d'extensions, n'écoute que sur
  `127.0.0.1` et n'envoie rien à xSOM. Activation proposée une fois en choisissant
  Expurger, ou par la commande « Activer la purge transparente (Claude Code) ».
- Captures d'écran : bloquées par défaut avant d'entrer dans la conversation ; sur
  choix explicite à l'activation, transmises sans analyse avec un message.
- Le hook ne confie au relais local que ce qu'il sait nettoyer entièrement :
  caractères invisibles et analyses incomplètes restent bloqués sur le poste.
- Le message « session non raccordée » vaut pour la passerelle comme pour le relais
  local.
- Activation refusée : le message nomme désormais la cause exacte (contrôle du
  hook en échec, entrée Secret Guard non reconnue, fichier de réglages illisible,
  ou fichier inaccessible avec son code système), sans jamais citer le contenu
  du fichier.
- Windows : le remplacement du hook et des réglages est retenté quelques instants
  quand un antivirus ou un autre programme tient le fichier ouvert.

## 0.7.1

- Correctif : les notifications de tâche que Claude Code soumet comme prompt
  étaient bloquées, leur identifiant d'appel d'outil (`toolu_…`) étant pris pour
  un secret. Ce format public est désormais reconnu ; un vrai secret placé dans la
  même notification reste bloqué.
- **Avertir plafonné par votre organisation (édition Équipe)** : la politique signée
  du poste peut limiter Avertir à 4 heures, 1 heure ou 15 minutes, ou l’interdire.
  Le hook applique ce plafond lui-même, à partir de la politique revérifiée avec la
  clé épinglée, même si VS Code est fermé : au-delà, Avertir devient Expurger. Une
  politique absente, altérée ou signée par une autre clé n’élargit rien ; le plafond
  de 8 heures reste.
- La modale d’activation et le panneau ne proposent que les durées permises, et
  disent « plafonné à 1 h par votre organisation ». Interdit, Avertir garde sa tuile,
  inactive, avec la raison ; l’activer, depuis le panneau, une durée ou les
  paramètres, est refusé avec un message.
- Quand une politique plafonnée arrive pendant Avertir, une fenêtre plus longue est
  raccourcie au plafond à partir de maintenant ; interdit, Secret Guard repasse
  aussitôt en Expurger.
- Une politique qui porte ce plafond exige l’extension 0.7.1 : une version plus
  ancienne la refuse au lieu de l’ignorer.
- Correctif : le hook comparait l’exigence de version d’une politique à 0.1.0, et
  refusait donc toute politique demandant une extension récente. Il la compare
  désormais à la version installée.

## 0.7.0

- **Réglage sur mesure xSOM (édition Équipe)** : l’extension applique les règles
  calibrées et signées par xSOM pour votre organisation (motifs sûrs et termes
  confidentiels en empreintes salées), en plus des règles intégrées. Vérification
  hors ligne par la clé d’autorité xSOM compilée dans l’extension, liaison à
  l’organisation du poste, refus des versions plus anciennes ; un réglage expiré
  reste appliqué et signalé.
- Import hors ligne d’un réglage signé pour les postes sans accès à la plateforme,
  avec les mêmes vérifications que la synchronisation.
- Analyse bornée : préfiltre littéral et budget de travail par analyse ; au-delà,
  l’envoi est bloqué comme analyse incomplète, jamais laissé passer.
- Expurger masque aussi les détections sur mesure, sous le nom de la règle ; le relais
  Claude ne reçoit jamais un message concerné par le réglage.
- Le réglage voit à travers les caractères invisibles (trait d’union conditionnel,
  espace sans chasse) collés depuis un traitement de texte.
- Infobulle et centre de protection : état du réglage en une ligne ; demande de
  réglage pour les postes Local.
- Posture et audit sans contenu : identité du réglage, nombre de détections sur
  mesure et identifiants des règles.
- **Durée d’Avertir au choix** : 15 minutes, 1 heure, 4 heures ou 8 heures (le travail d’une nuit), demandée à
  l’activation et modifiable d’un clic dans le panneau de contrôle pendant que le
  mode tourne. Le hook refuse toute fenêtre plus longue que 8 heures, même si VS
  Code est fermé.
- Correctif macOS : le pont d’approbation Developer Guard écoute sur un socket
  court et privé (le chemin précédent dépassait la limite de 104 octets).

## 0.6.1

- Panneau d’état simplifié.
