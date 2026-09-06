---
title: "xSOM AI Guard v2.5 — Démonstrateur de protection cyber souveraine pour l'IA"
product: xSOM AI Guard
strate: v2.5
status: draft
created: 2026-08-27
updated: 2026-08-27
owner: "Produit (BMAD PM)"
socle: docs/product/THREAT-COVERAGE.md
complète: "docs/product/PRD.md (v2, FR-1..152) — ne le remplace pas"
absorbe: "docs/product/PLAN-REVIEW.md (34 correctifs contraignants)"
autorité: "CLAUDE.md §4 (invariants non négociables) prime sur toute exigence de ce document."
---

# PRD — strate v2.5

## 0. Objet, autorité, lecture

Cette PRD définit la strate **v2.5** : faire de xSOM AI Guard le démonstrateur de notre capacité de protection cyber souveraine pour l'IA, à destination des grands comptes.

Elle se pose **au-dessus** de `docs/product/PRD.md` (v2, 152 exigences) : celle-ci reste valide et n'est ni réécrite ni annulée. Les nouvelles exigences sont numérotées à partir de **FR-153**.

Elle **absorbe** les 34 correctifs contraignants de `docs/product/PLAN-REVIEW.md`. Ce n'est pas de l'hygiène adjacente : plusieurs d'entre eux *sont* la crédibilité du démonstrateur, et un a été retrouvé dans la démo elle-même (`FR-156`).

**Ordre d'autorité.** `CLAUDE.md §4` prime. Là où une exigence entre en collision avec un invariant, la collision est énoncée et tranchée **en faveur de l'invariant**.

**Traçabilité.** Chaque exigence porte sa source : `INV-n`/`DEP-n`/`EXH-n` pour les correctifs de la revue, `G-nn` pour les écarts du socle de couverture, `D-n` pour les défauts confirmés en lisant le code. Les 55 identifiants sources se réduisent à **45 exigences**, cinq paires étant recouvrantes et les onze correctifs de déploiement étant regroupés.

**Ce document ne définit pas le *comment*.** L'architecture ira dans `docs/product/ARCHITECTURE-V2.5.md`, le découpage dans les epics — tous deux en anglais, par cohérence avec le code et les artefacts techniques v2.

---

## 1. Vision

Un RSSI de grand compte sort de la démonstration en ayant compris trois choses qu'aucun fournisseur ne lui a montrées cette année.

**Il a compris les vrais enjeux derrière les mots-clés.** Le marché lui vend quinze menaces indifférenciées. Nous lui montrons lesquelles le concernent *lui*, compte tenu de son usage réel de l'IA — parce que les attaques qui visent un éditeur de modèle ne sont pas celles qui visent une banque qui consomme une API. Six des seize lignes ne sont pas son sujet, et le lui dire est un argument de crédibilité, pas une concession.

**Il a compris que les outils existent et sont prêts à être posés.** Pas une étude, pas une feuille de route : un système qui tourne, qu'il voit bloquer une action devant lui, et dont il peut vérifier lui-même la trace.

**Il a compris que c'est français.** Non pas par la localisation d'un datacentre — un hébergement européen opéré sous droit américain n'est pas une réponse — mais par l'absence de dépendance opérationnelle : aucun appel hors UE n'est nécessaire pour qu'une décision d'autorisation soit prise, journalisée et vérifiable.

**Positionnement par rapport à la v2.** La v2 disait : *nous contrôlons ce que l'agent fait, et nous le prouvons.* La v2.5 ajoute : *et nous vous disons d'abord ce qui vous menace vraiment.* Le triage est la porte d'entrée ; l'enforcement et la preuve restent le produit.

---

## 2. Cible

### 2.1 Le modèle économique dicte la forme

**Dominante prestation.** Certains déploiements sont autonomes, mais la majorité des clients exige une infrastructure et une compétence qu'ils n'ont pas en interne. Le déploiement en autonomie n'est donc pas le mouvement commercial : c'est la **preuve de substance** — « ce n'est pas une maquette, un inconnu peut le poser ».

*Conséquence sur l'héritage v2 :* `SM-1` (médiane ≤ 10 min pour un inconnu) devient une métrique de crédibilité et non un objectif métier. Cela ne condamne pas l'Epic 1, mais change ce que « terminé » y signifie — voir `AR-3` (§7).

### 2.2 Les profils d'usage

Le sous-ensemble de menaces applicables se déduit de la position du client dans la chaîne de valeur IA. Détail et bascules : `THREAT-COVERAGE.md §2`.

| Profil | Réalité marché FR | Priorité produit |
|---|---|---|
| **P1a** — API hyperscaler (Azure et assimilés) | Très répandu | Socle |
| **P1b** — IA embarquée SaaS (Copilot et assimilés) | Très répandu | **Angle mort déclaré** (`FR-174`) |
| **P2** — RAG interne | **À maîtriser absolument** | **Priorité 1** |
| **P3** — Agents outillés | En croissance — la trajectoire | **Priorité 2** — cœur historique |
| **P4** — Poids ouverts hébergés | **Nombreux** (modèle de distribution Mistral) | Porte la souveraineté (§3.4) |
| **P5** — Entraînement / fine-tuning | Rare | Hors priorité |

**P2 avant P3.** C'est contre-intuitif : le cœur du produit est le contrôle d'action, donc P3. Mais le terrain dit que P2 doit être maîtrisé d'abord, et la défense P2 (`M-02`, injection indirecte) est précisément celle qui porte deux contournements connus. La priorité suit le terrain.

---

## 3. Exigences

### 3.1 Groupe A — Réparer le cœur d'enforcement

Ces sept exigences ne sont pas des améliorations : ce sont des **défauts de contrôles déjà livrés et déjà revendiqués**. Tant qu'ils tiennent, le produit affirme des garanties qu'il ne tient pas — que l'on démontre ou non, que l'on vende ou non.

Elles viennent en premier pour cette seule raison. La démonstration vient ensuite, quand le produit est vrai : on ne filme pas ce qui n'existe pas.

*La démonstration a néanmoins servi de révélateur* : c'est en examinant ce qu'on montrerait qu'on a lu `scripts/demo.py` et trouvé une contrainte décorative dans la policy de démonstration elle-même (`FR-156`). Utile comme détecteur, jamais comme moteur.

| FR | Exigence | Source |
|---|---|---|
| **FR-153** | La détection de contenu injecté couvre le français, l'espagnol et l'allemand, et normalise l'entrée (unicode, encodages, homoglyphes) avant analyse. | `D-1`, `G-02`, cohérence `FR-6` |
| **FR-154** | Le taint est lié au **jeton de passerelle** et non au seul `session_id` déclaré par l'agent : présenter un identifiant de session neuf ne remet pas la session à blanc. | `INV-4`, `G-03` |
| **FR-155** | Le vocabulaire des contraintes de policy est **fermé et versionné**. Une clé inconnue fait échouer le document au chargement ; aucune contrainte n'est silencieusement ignorée. | `EXH-2`, `D-2`, `G-11` |
| **FR-156** | Toute contrainte publiée dans un exemple, un gabarit ou une démo est **effectivement appliquée**, ou retirée de l'exemple. | `EXH-2`, constat `scripts/demo.py:28` |
| **FR-157** | Les règles peuvent porter un **prédicat déterministe borné** sur la valeur des arguments (comparaison, appartenance, motif, plafond), non Turing-complet, échouant fermé sur champ absent ou mal typé. | `EXH-3` |
| **FR-158** | Les outils exécuteurs génériques (`bash`, `execute_sql`, `kubectl`…) reçoivent une **classification déterministe** par motif d'argument, sans passer par le juge, échouant fermé au plafond déclaré de l'outil. | `EXH-4`, `G-06` |
| **FR-159** | Une approbation par canal interactif n'est **pas rejouable** : l'identité provient de la signature vérifiée du fournisseur de canal et désigne le *cliqueur*, la séparation des devoirs est vérifiée contre lui, et la classe irréversible renvoie vers la console plutôt que de se décider dans le canal. | `INV-5`, `D-3`, `G-07` |
| **FR-198** | Sans juge configuré, une règle `classify: ambiguous` est **plancherisée en irréversible**, jamais honorée à son `approval` déclaré. | `D-4` (revue d'architecture) |
| **FR-199** | Les contraintes d'une règle sont évaluées sur **toutes** les branches, y compris `classify: ambiguous`. | `D-5` (revue d'architecture) |

> **`FR-198` et `FR-199` sont deux défauts vivants découverts tardivement**, par la revue adversariale de l'architecture — absents des 34 correctifs comme des 21 écarts. Ils portent des numéros hauts parce qu'un identifiant est stable, jamais renuméroté ; leur rang de priorité est celui du groupe A, pas celui de leur numéro.
>
> **`D-4` est le plus grave de la strate.** `.env.example:117-119` affirme qu'une clé Mistral vide désactive le juge *« fail-closed : les outils ambigus sont traités comme irréversibles, donc soumis à approbation humaine au lieu d'être auto-autorisés »*. Le code fait l'inverse : `core/policy.py:295` renvoie l'`approval` déclaré avec `action_class=None`, et l'escalade est court-circuitée par `judge is not None` (`gateway/server.py:149`, `core/decision.py:94`). La garantie documentée n'existe pas, dans la configuration par défaut, dans le fichier que tout déployeur lit. On corrige le code pour qu'il tienne la promesse — pas la promesse pour qu'elle décrive le code.
>
> **`D-5`** : sur la branche `classify: ambiguous`, `evaluate` retourne **avant** `_constraints_ok`. Les contraintes d'une règle ambiguë ne sont jamais évaluées — et `docs/SPEC.md:197` livre un exemple portant `dry_run` et `business_hours_only`, deux contraintes sans effet. C'est le jumeau moteur de `FR-156`.

> **Collision / Résolution.** `FR-156` impose de retirer `constraints: {dry_run: true}` de `scripts/demo.py` *ou* d'implémenter `dry_run`. Résolution : **implémenter**, parce que le dry-run est une promesse du discours HITL. À défaut, retirer — jamais laisser en place.

> **Pourquoi `FR-159` est ici et non au groupe B.** L'intégrité de l'approbation porte toute la garantie anti-usurpation (`M-08`) : « le faux dirigeant ne peut pas approuver le virement ». Tant que le lien d'approbation est un porteur rejouable par quiconque lit le message, cette phrase est fausse — et c'est une des rares que le produit énonce sans réserve.

### 3.2 Groupe B — Intégrité de la preuve

Ce qu'une revue de sécurité de grand compte trouve en premier. Sur un produit vendu sur la preuve, ces défauts sont plus coûteux que n'importe quelle fonction manquante.

| FR | Exigence | Source |
|---|---|---|
| **FR-160** | `enforcement_mode` est **dérivé par l'adaptateur d'ingestion**, jamais accepté du corps de requête ; le champ soumis par un client est rejeté explicitement. | `INV-2` |
| **FR-161** | Les champs d'audit **déclarés par l'agent** sont distingués des champs **dérivés par le serveur**, dans le stockage comme dans l'export. | `INV-3` |
| **FR-162** | Toute table créée active RLS dans la migration qui la crée ; un test d'intégration en CI échoue sinon. | `INV-1` |
| **FR-163** | Les événements de plan de contrôle disposent de leurs propres colonnes ; aucune donnée de contrôle n'est logée dans les colonnes de la charge utile chaînée, et aucune note libre d'opérateur n'entre dans le journal inaltérable. | `INV-6` |
| **FR-164** | Toute requête sortante vers une URL fournie par le tenant passe par un **helper unique** : schéma contraint, résolution puis rejet des plages internes, pas de suivi de redirection, réponse jamais renvoyée au tenant. | `INV-7` |
| **FR-165** | Les politiques d'écriture sur les tables d'appartenance portent `using` **et** `with check` ; aucune ligne ne peut être déplacée vers un autre tenant. | `INV-8` |
| **FR-166** | Un échec de lecture de l'état d'arrêt d'urgence refuse **toute classe sauf lecture**. | `INV-9` |
| **FR-167** | L'adoption d'une base de migrations existante sonde **chaque fichier** et exige une commande explicite ; un état mixte refuse de démarrer. | `INV-10` |
| **FR-168** | La sonde de disponibilité publique ne divulgue aucune posture de sécurité ; l'inventaire de capacités passe derrière authentification. | `INV-11` |
| **FR-169** | La clé de signature des checkpoints ne réside jamais en base ; quand elle partage l'hôte de la base, le système le déclare **explicitement** et l'Evidence Pack ne présente pas la vérification comme indépendante. | `INV-12` |
| **FR-170** | La monotonie du pipeline est une **propriété structurelle** vérifiée par test de propriété : aucun garde ne peut abaisser le verdict d'un garde antérieur. | `INV-13` |
| **FR-171** | La représentation canonique de l'horodatage est figée et documentée, et un test CI vérifie un **export réel** via le vérificateur autonome. | `INV-14` |

### 3.3 Groupe C — Le triage · **pilier 1 de la vision**

| FR | Exigence | Source |
|---|---|---|
| **FR-172** | Un **diagnostic de profil d'usage** positionne un client sur P1a/P1b/P2→P5 et en déduit son sous-ensemble de menaces applicables. | `G-19` |
| **FR-173** | La carte de couverture publiée est **bidimensionnelle** : applicabilité × mode de couverture, lignes non couvertes incluses. | `G-18`, `FR-144` |
| **FR-174** | L'impossibilité d'interposition devant une IA embarquée SaaS est **déclarée explicitement** ; la couverture s'y limite à la détection et à l'attestation par journaux. | `G-20` |
| **FR-175** | Seul le mode « Bloqué » autorise le verbe « bloquer » dans un support commercial ou une réponse à appel d'offres. | `THREAT-COVERAGE §1` |

### 3.4 Groupe D — Souveraineté · **pilier 3**

| FR | Exigence | Source |
|---|---|---|
| **FR-176** | Aucun contrôle du **chemin de décision** ne dépend d'un service hors UE ; le produit fonctionne intégralement hors ligne. | `G-17` |
| **FR-177** | L'**architecture de référence souveraine** est documentée et démontrable de bout en bout. | `G-21` |
| **FR-178** | Chaque contrôle tiers orchestré a un **substitut européen nommé** ; sans substitut, la ligne reste `Hors périmètre` plutôt que `Orchestré`. | `QO-3`, `G-01`/`G-10`/`G-14` |

#### Le critère : dépendance opérationnelle, pas nationalité de l'éditeur

La souveraineté porte sur ce dont on **dépend pour décider**, pas sur le passeport de l'auteur du code. Un outil open-source exécuté localement, sans rappel réseau, ne perce pas la chaîne quelle que soit son origine — c'est exactement la raison pour laquelle `ruff`, `mypy` et `pip-audit` sont déjà dans la CI sans que quiconque y voie une dépendance américaine. Ce qui perce la chaîne, c'est un **service appelé en ligne**, qui voit les données, et dont dépend la décision.

Appliqué aux quatre contrôles orchestrés, ce critère les tranche :

| Contrôle | Substitut retenu | Raison |
|---|---|---|
| **Garde-prompt** (`FR-193`) | **Mistral** — modération via la plateforme, ou poids auto-hébergés en P4 | C'est un service en ligne qui voit le prompt : ici la nationalité compte vraiment. Mistral est déjà imposé par `CLAUDE.md §3` pour le juge — zéro fournisseur supplémentaire. En P4 le client héberge déjà les poids : dépendance nulle. |
| **Artefacts de modèles** (`FR-188`) | **Scanners d'artefacts open-source exécutés localement** | Binaires locaux, aucun rappel réseau, verdict auditable. Aucune dépendance opérationnelle créée. |
| **Analyse statique** (`FR-191`) | **Ce qui est déjà là** — règles bandit de `ruff`, `pip-audit`, `trufflehog` — complété au besoin par un analyseur auto-hébergé | Idem : local, sans rappel. Inutile d'introduire un service pour produire un verdict qu'on sait déjà calculer. |
| **Découverte du Shadow AI** (`FR-189`) | **Aucun CASB.** L'inventaire se dérive des journaux d'egress du client. | Le marché CASB est intégralement non-UE et ce sont des services qui voient tout le trafic. Pas de substitut crédible : la règle de `FR-178` s'applique et la ligne descend de `Orchestré` à `Attesté`. La dérivation depuis les journaux existants est de toute façon plus souveraine, moins chère, et n'ajoute aucun fournisseur. |

**Un seul contrôle exige donc un choix de fournisseur** — le garde-prompt — et il tombe sur Mistral, que la stack impose déjà. Les trois autres se résolvent en exécutant localement ce qui existe. La ligne `Découverte du Shadow AI` perd son statut `Orchestré` : c'est la doctrine qui fonctionne comme prévu, pas un échec.

### 3.5 Groupe E — Le démonstrateur

| FR | Exigence | Source |
|---|---|---|
| **FR-179** | Un **mode observation** exécute le pipeline complet et journalise la décision qui *aurait* été prise, sans bloquer : opt-in par agent, borné dans le temps, tracé comme événement de plan de contrôle, exclu des preuves de supervision. | `EXH-1` |
| **FR-180** | Le mode observation produit le **rapport de promotion** : « en enforcement, N appels auraient été tenus et M refusés, sur ces outils ». | `EXH-1` |
| **FR-181** | Chaque scénario d'attaque est un **script déterministe qui asserte** que la défense a tenu et sort non-zéro sinon ; la vidéo n'en est qu'un rendu. | Section Démo |
| **FR-182** | Le **tenant de démonstration** est synthétique : formes de données réalistes, contenu entièrement fabriqué. Aucune donnée personnelle de tiers, aucune donnée de client. | Section Démo |
| **FR-183** | Le compte de démonstration porte un **historique accumulé** suffisant pour que la supervision continue soit lisible. | Section Démo |

### 3.6 Groupe F — Couverture des menaces restante

| FR | Exigence | Source | Profil |
|---|---|---|---|
| **FR-184** | Provenance des corpus et bases vectorielles déclarée au registre, portée dans l'Evidence Pack. | `G-04` | P2 |
| **FR-185** | La DLP participe aux décisions postérieures à un taint. | `G-08` | P2 |
| **FR-186** | Détection de charge exécutable dans les résultats d'outils, sur le canal déjà instrumenté par le taint. | `G-12` | P2/P3 |
| **FR-187** | Détecteur d'extraction déterministe (volume et motif de requêtage) + alerte. | `G-05` | P4 |
| **FR-188** | Analyse des artefacts de modèles et entrée au registre. | `G-10` | P4 |
| **FR-189** | Inventaire du Shadow AI : découverte des usages non supervisés. | `G-09` | Tous |
| **FR-190** | Détection de fuite de system prompt sur l'egress. | `G-13` | Tous |
| **FR-191** | Ingestion de verdicts d'analyse statique comme preuve chaînée. | `G-14` | Tous |
| **FR-192** | Attestation « décision critique sous revue humaine », adossée au HITL existant. | `G-15` | Tous |
| **FR-193** | Connecteur de garde-prompt tiers souverain, verdicts chaînés. | `G-01` | Tous |
| **FR-194** | Correspondance OWASP LLM Top 10 + MITRE ATLAS dans la table déclarative. | `G-16`, arbitré `AR-1` | Tous |

### 3.7 Groupe G — Déployabilité, identité, positionnement

| FR | Exigence | Source |
|---|---|---|
| **FR-195** | Les onze correctifs de réalité de déploiement sont traités ; `DEP-6` en particulier est résolu par une **réduction honnête du périmètre annoncé** — le produit fédère les émetteurs présentant des revendications compatibles, et non « n'importe quel fournisseur d'identité par configuration seule ». | `DEP-1`, `DEP-2`, `DEP-3`, `DEP-4`, `DEP-5`, `DEP-6`, `DEP-7`, `DEP-8`, `DEP-9`, `DEP-10`, `DEP-11` |
| **FR-196** | La fédération d'identité de la console accepte un émetteur OIDC client et une correspondance groupe→rôle déclarative, chaque attribution de rôle étant un événement de plan de contrôle. | `EXH-8` |
| **FR-197** | Le positionnement publié nomme les alternatives réelles et énonce la **proposition à deux étages** : enforcement obligatoire et preuve vérifiable sur MCP ; policy unifiée et preuve vérifiable sur les autres chemins. | `EXH-9` |

> `EXH-5` (découpage de release) n'est pas une exigence produit mais un arbitrage de périmètre : voir `AR-3`.

---

## 4. Ce que la v2.5 ne fait pas

- **Elle ne devient pas un pare-feu de prompts.** Le non-objectif v2 §5.1 tient. `FR-193` orchestre un tiers et l'atteste ; il ne construit pas le contrôle.
- **Elle ne mesure pas la qualité des modèles.** Non-objectif v2 §5.2. `FR-192` atteste d'une revue humaine, ne score aucune hallucination.
- **Elle ne devient pas un produit DLP.** Non-objectif v2 §5.4. La DLP reste une entrée de décision (`FR-185`).
- **Elle ne supervise pas les IA embarquées SaaS.** Déclaré (`FR-174`), pas contourné.
- **Elle ne traite pas les menaces du plan endpoint, mail et poste de travail.** Elles appartiennent au SOC du client.
- **Elle ne produit pas de correspondance vers les référentiels de management** sans revue d'un assesseur en exercice — voir `AR-1`.

---

## 5. Priorité et séquencement

L'ordre découle de trois contraintes, dans cet ordre : ce que le produit affirme sans le tenir, ce que le terrain exige (P2 avant P3), ce qu'une revue de sécurité trouve en premier.

| Rang | Lot | Contenu | Pourquoi ici |
|---|---|---|---|
| **1** | **Cœur d'enforcement** | `FR-153` → `FR-159`, `FR-198`, `FR-199` | Des contrôles déjà livrés ne tiennent pas leurs garanties : la défense P2 porte deux contournements, une contrainte de la policy de démonstration est décorative, l'approbation est rejouable, et `.env.example` documente une garantie fail-closed que le code n'implémente pas. Rien d'autre ne compte tant que ce n'est pas vrai. |
| **2** | **Intégrité de la preuve** | `FR-160`, `FR-161`, `FR-162`, `FR-164`, `FR-169` | Ce qu'une revue de sécurité trouve en premier sur un produit vendu sur la preuve. `FR-162` est le plus fort rayon de souffle du lot. |
| **3** | **Le triage** | `FR-172` → `FR-175` | Pilier 1 de la vision. Sans lui, la démonstration retombe dans le catalogue. |
| **4** | **Mode observation** | `FR-179`, `FR-180` | Une branche au point de décision, et l'artefact de conversion le plus fort du produit. Rang 4 et non 1 seulement parce qu'il ne bloque pas le tournage. |
| **5** | **Le démonstrateur** | `FR-181` → `FR-183` | Dépend des rangs 1 et 4. |
| **6** | **Souveraineté** | `FR-176` → `FR-178` | Pilier 3. `FR-178` est bloqué par `QO-3` tant que les substituts ne sont pas choisis. |
| **7** | **Couverture P2** | `FR-184`, `FR-185`, `FR-186` | Le terrain dit P2 avant P3. |
| **8** | **Reste de l'intégrité** | `FR-163`, `FR-165` → `FR-168`, `FR-170`, `FR-171` | Contraignants, non bloquants pour la démonstration. |
| **9** | **Couverture P4 et au-delà** | `FR-187` → `FR-194` | Suit la base installée Mistral. |
| **10** | **Déployabilité et positionnement** | `FR-195` → `FR-197` | Ré-évalué par `AR-3`. `FR-197` peut être produit en parallèle : c'est de la rédaction, pas du code. |

**Ce qui tombe si nous sommes en retard :** les rangs 9 et 10 d'abord, puis 8. Les rangs 1 à 5 sont le démonstrateur ; en retirer un revient à ne pas livrer la strate.

---

## 6. Métriques

| ID | Métrique | Cible |
|---|---|---|
| **SM-12** | Part des menaces applicables couvertes en mode `Bloqué`, sur le profil P2/P3 de référence | ≥ 6 sur 9 |
| **SM-13** | Scénarios d'attaque assertés en CI | 100 % des vidéos publiées |
| **SM-14** | Délai entre une régression de défense et sa détection | Un cycle CI |
| **SM-15** | Appels sortants hors UE requis sur le chemin de décision | **0** |
| **CM-6** | *Contre-métrique* — clients restant indéfiniment en mode observation | À surveiller |
| **CM-7** | *Contre-métrique* — écart entre lignes revendiquées `Bloqué` et lignes réellement assertées par un scénario | **0 attendu** |

---

## 7. Arbitrages à trancher

Absorber les 34 correctifs n'est pas purement additif : trois contredisent la direction v2.5.

**AR-1 — Référentiels.** `EXH-7` demande de ne livrer que la correspondance EU AI Act et de différer les autres, au motif qu'une correspondance rejetée par un auditeur est pire que pas de correspondance. `G-16` en ajoute quatre familles.
*Résolution proposée :* la mise en garde vise les référentiels **de management** (ISO 42001, SOC 2), dont la correspondance engage un jugement d'assesseur. OWASP LLM Top 10 et MITRE ATLAS sont des taxonomies **techniques** — s'y aligner est descriptif, pas assertif : retenus (`FR-194`). NIS2, DORA et ANSSI retombent dans la catégorie visée : différés jusqu'à revue par un assesseur en exercice.

**AR-2 — Proxy LLM. Tranché : séparable.** `EXH-6` demandait de le rétrograder en sonde de télémétrie non bloquante ; or la DLP d'egress y tourne, donc la couverture `Bloqué` de `M-10`.
*Résolution, validée sur le code* (`THREAT-COVERAGE.md` §8.3) : la séparation est acquise parce que le couplage n'existait pas. Dans `_forward`, la DLP est un filtre de la requête, en amont de l'appel amont et de la branche streaming ; la télémétrie s'exécute après coup sur les seules réponses non-streamées. Abandonner la comptabilité de coûts ne touche aucune ligne du chemin bloquant. **`M-10` conserve son `Bloqué` et la démonstration ne perd pas de ligne.**
*Ce que l'inspection a trouvé en plus :* une troisième fonction vit sur ce chemin — la garde d'appels d'outils de `_process` — avec deux défauts nouveaux, `G-25` (l'agent contrôlé décide s'il est contrôlé, via l'en-tête `x-xsom-mode`) et `G-26` (le streaming la contourne entièrement). Conséquence contraignante : **le chemin proxy LLM ne compte dans aucune revendication de contrôle d'appels d'outils** (`M-06`, `M-12`) tant que les deux tiennent. `G-25` se corrige avec le mode observation du plan de contrôle, pas en inversant le défaut.

**AR-3 — Périmètre de déploiement.** `EXH-5` découpe `v2.0-core = Epics 1-5`, ce qui repousse l'Epic 6 (arrêt d'urgence, dont dépend `M-06`) et l'Epic 7 (taint persisté, dont dépend `FR-154`). Par ailleurs, le modèle à dominante prestation (§2.1) réduit la valeur de `SM-1`.
*Résolution proposée :* promouvoir dans la strate les seules stories des Epics 6 et 7 dont dépendent des lignes de couverture revendiquées, et re-calibrer l'Epic 1 sur « déployable par nous chez un client, et crédible pour un évaluateur » plutôt que sur une médiane de dix minutes.

> **Tranchée — aucune story à promouvoir.** Vérifiées contre le code, deux des trois prémisses sont mortes : les 12 scénarios de `M-06/chaine` sont des gardes d'exécuteur et de HITL sur l'ingestion `mcp` et n'en touchent aucun d'arrêt (et l'arrêt est livré depuis le rang 8, `gateway/server.py::_stop_blocks`) ; le taint persisté de `FR-154` est livré (`supabase/migrations/0018_session_taint.sql` + `core/taint_store.py`). Ce que l'arbitrage redoutait — une revendication publiée reposant sur un epic repoussé — est désormais impossible par construction : `CM-7` fait échouer le build sur toute facette `Bloqué` sans scénario qui passe. Seule la troisième prémisse était vivante, et c'est la recalibration de `SM-1`, faite. Détail et preuves : `docs/product/DECOUPAGE.md` §7 bis.

---

## 8. Questions ouvertes

- **QO-3 — Résolue** (§3.4). Le critère retenu est la **dépendance opérationnelle**, pas la nationalité de l'éditeur. Un seul contrôle exige un choix de fournisseur — le garde-prompt, résolu sur Mistral que la stack impose déjà ; les trois autres s'exécutent localement sans rappel réseau. La découverte du Shadow AI perd son statut `Orchestré` faute de substitut, conformément à `FR-178`. `FR-178`, `FR-188`, `FR-191` et `FR-193` sont débloquées.
- **QO-7** — Le diagnostic de profil (`FR-172`) est-il un livrable de mission ou une fonction de la console ? §2.1 penche pour le premier ; le second génère des leads en autonomie.
- **QO-8 — Résolue** (`THREAT-COVERAGE.md` §8.3). Oui, séparable : DLP en amont sur la requête, télémétrie en aval sur la réponse, aucun couplage. `M-10` garde son `Bloqué`. La question a en revanche ouvert `G-25` et `G-26`, qui retirent le chemin proxy LLM des revendications de contrôle d'appels d'outils.
- **QO-9** — Quel domaine pour le tenant synthétique (`FR-182`) ? La forme d'UTI (matching consultants/appels d'offres) est la plus proche du métier, donc la plus crédible à raconter.
