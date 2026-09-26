# Journal des versions

## 0.7.0

- **Réglage sur mesure xSOM (édition Équipe)** : l’extension applique les règles
  calibrées et signées par xSOM pour votre organisation (motifs sûrs et termes
  confidentiels en empreintes salées), en plus des règles intégrées. Vérification
  hors ligne par la clé d’autorité xSOM compilée dans l’extension, liaison à
  l’organisation du poste, refus des versions plus anciennes ; un réglage expiré
  reste appliqué et signalé.
- Analyse bornée : préfiltre littéral et budget de travail par analyse ; au-delà,
  l’envoi est bloqué comme analyse incomplète, jamais laissé passer.
- Expurger masque aussi les détections sur mesure, sous le nom de la règle.
- Infobulle et centre de protection : état du réglage en une ligne ; demande de
  réglage pour les postes Local.
- Posture et audit sans contenu : identité du réglage, nombre de détections sur
  mesure et identifiants des règles.
- Correctif macOS : le pont d’approbation Developer Guard écoute sur un socket
  court et privé (le chemin précédent dépassait la limite de 104 octets).

## 0.6.1

- Panneau d’état simplifié.
