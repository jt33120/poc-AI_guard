# Journal des versions

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
