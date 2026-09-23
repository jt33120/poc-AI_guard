# Design spec — xSOM Developer Guard

## 1. Intention

Faire ressentir en trois secondes qu’un agent de code peut rester rapide tout en travaillant dans un cadre vérifiable. Le site est précis, calme et technique. Il refuse l’esthétique de tableau de bord tapageur, la promesse de sécurité absolue et les cartes SaaS interchangeables.

## 2. Références

- Documentation d’architecture : densité utile, légendes proches des mécanismes et limites visibles.
- Revue scientifique : preuves, protocoles et statuts séparés des hypothèses.
- Signal xSOM existant : palette bleu ardoise, corps Source Sans 3, titres Manrope, repères monospace et surfaces à bordure unique.

## 3. La décision forte

Une page se lit comme un dossier de contrôle : grands énoncés éditoriaux à gauche, rail de preuve numéroté à droite, puis scénarios composés en séquences. Les limites occupent le même niveau visuel que les capacités.

## 4. Tokens

Preset : `editorial`. Accent bleu xSOM, réservé aux actions et preuves actives. Les statuts utilisent uniquement les tokens sémantiques Signal. Manrope pour les titres, Source Sans 3 pour le texte, JetBrains Mono pour les repères. Rayons, ombres, espaces et mouvements viennent de `design/tokens.json`.

## 5. Assets

Icônes : pictogrammes Signal déjà présents. Illustrations : aucune nouvelle collection. Photos : aucune. Images génératives : aucune pour ces pages ; les mécanismes sont expliqués par le contenu et les composants de preuve.

## 6. Inventaire de composants

- `GuardNav`, `Wordmark`, `XsomMark`, `SignalPreferences` : identité et navigation existantes.
- `DeveloperPublicShell` : en-tête, sous-navigation et pied de page communs.
- `DeveloperScenario` : simulation locale à trois menaces et trois profils.
- `DeveloperCoverageExplorer` : lecture filtrable du registre généré.
- `DeveloperCostSimulator` : comparaison modifiable, calculée uniquement dans le navigateur.
- `DeveloperEvidenceScale`, `DeveloperControlLevels` : explication des modes et niveaux de contrôle.

## 7. Plateformes

Web responsive aux largeurs 390, 768 et 1440 px. Les tableaux deviennent des séquences verticales sur mobile. Toutes les cibles utilisent le minimum tactile Signal et le focus visible partagé.

## 8. Non-buts

Pas de nouveau thème, de bibliothèque UI, de témoignage, de logo client, de métrique commerciale inventée, de mouvement décoratif continu ni d’illustration imitant une capture réelle. Le simulateur ne présente aucun tarif comme officiel. Le site ne transforme pas une preuve locale en disponibilité de production.

## 9. Repositionnement commercial — 23 septembre 2026

L’accueil présente Developer Guard comme la gouvernance française des agents de code. Les bénéfices et les offres précèdent le registre technique. Une seule définition FR/EN alimente accueil, produits et tarifs : Local gratuit, découverte Équipe 90 jours / 10 postes, cibles 24 € et 49 € HT par poste actif/mois confirmées par devis. La carte Équipe reçoit le seul accent de la comparaison. La gamme distingue la plateforme AI Guard sur devis.

La souveraineté porte sur l’éditeur français, les choix de déploiement et le contrôle local ; aucun hébergement France universel n’est affirmé. Les documents contractuels téléchargeables sont explicitement des projets. Le parcours aboutit au téléchargement local ou à une demande de pilote par courriel. Stripe reste différé.

## 10. Vérification visuelle

Tour 1 : captures accueil et tarifs à 390 / 768 / 1440, zéro débordement et zéro erreur console. Hiérarchie claire, mais titre tarifs trop étroit et boutons des offres décalés par la longueur des notes. Corrections : titre tarifs sur 22ch, respiration réduite, hauteur commune des notes sur desktop ; rythme mobile conservé. Le paragraphe de contact reprend le style du corps après ajout de son repère de section.

Tour 2 : captures recapturées après correction aux trois largeurs, contrôle des cartes en clair/sombre et des vues mobiles. Boutons alignés sur desktop, conditions lisibles sur mobile, aucun débordement ni erreur console. Les 19 tests E2E publics passent (navigation, offres, demandes par courriel, docs, simulation, langues, clavier, mouvement réduit).
