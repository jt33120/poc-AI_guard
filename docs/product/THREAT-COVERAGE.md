---
title: "xSOM AI Guard — Matrice de couverture des menaces IA"
product: xSOM AI Guard
strate: "v2.5 — Démonstrateur de protection cyber souveraine pour l'IA"
statut: draft
owner: "Sécurité produit (BMAD Analyst)"
created: 2026-08-26
source: docs/product/threat-matrix-source.csv (15 menaces, 5 domaines)
autorité: "CLAUDE.md §4 (invariants non négociables) prime sur ce document. docs/product/PRD.md (v2) reste valide : cette strate le référence et le complète, elle ne le remplace pas."
---

# Matrice de couverture des menaces IA

## 0. Objet et statut

Ce document est le **socle de cadrage** de la strate v2.5 : transformer xSOM AI Guard en démonstrateur de notre capacité de protection cyber souveraine pour l'IA, à destination des grands comptes.

Il ne définit **aucune** exigence fonctionnelle. Il établit, pour chacune des 15 menaces de la matrice source, trois faits vérifiables :

1. **ce que le produit fait déjà**, prouvé par `fichier:ligne` dans le code livré ;
2. **le mode de couverture revendicable** — et donc ce que le commercial a le droit de dire ;
3. **l'écart résiduel** (`G-nn`), qui deviendra une exigence dans la PRD de strate.

**Il est le préalable au BMAD.** Sans lui, la PRD re-spécifierait des contrôles déjà livrés (le pipeline actuel enchaîne déjà 8 gardes) et en promettrait d'inatteignables (aucun POC ne construit un EDR, une passerelle mail et un détecteur de deepfake).

**Ordre d'autorité.** `CLAUDE.md §4` prime. Là où une menace entre en collision avec un non-objectif déclaré de la PRD v2, la collision est énoncée explicitement et tranchée **en faveur du non-objectif** — jamais l'inverse. Ces arbitrages sont marqués **Collision / Résolution**.

---

## 1. La doctrine de couverture graduée

Le piège commercial est de promettre « nous bloquons les 15 menaces ». C'est faux, invérifiable, et cela détruit la crédibilité au premier test d'un RSSI. La doctrine graduée dit l'inverse : **chaque menace reçoit un mode de couverture déclaré, et chaque mode a une preuve associée.**

| Mode | Signification | Ce que le commercial a le droit de dire | Preuve exigible |
|---|---|---|---|
| **B — Bloqué** | Le gateway refuse ou suspend l'action de façon déterministe, sans LLM dans la décision. | « L'action n'a pas lieu. » | Entrée `deny` / `hitl_*` dans la chaîne d'audit, rejouable via `evaluate_only`. |
| **D — Détecté** | Le produit observe et enregistre, mais n'interrompt pas. | « Vous le voyez, horodaté et attribué. » | Événement d'audit chaîné + alerte. |
| **O — Orchestré** | Un contrôle tiers fait le travail ; xSOM le pilote, collecte son verdict et le chaîne. | « Nous intégrons et prouvons le contrôle. » | Verdict tiers chaîné + attestation de présence du contrôle. |
| **A — Attesté** | Aucun contrôle runtime. Le produit atteste d'une posture et la porte dans l'Evidence Pack. | « Nous prouvons que la mesure existe chez vous. » | Section d'Evidence Pack + gate de complétude du registre. |
| **X — Hors périmètre** | Déclaré non couvert, avec la raison. | Rien. Et le dire est un **atout** de crédibilité. | Ligne « non couvert » publiée (`FR-144`). |

**Règle d'or, non négociable :** seul le mode **B** autorise le verbe « bloquer » dans un support commercial, une démo ou une réponse à appel d'offres. `FR-144` (carte de couverture publiée avec les lignes honnêtement non couvertes) devient le garde-fou contractuel de cette règle.

**Pourquoi la doctrine graduée résout aussi nos collisions internes.** La PRD v2 déclare explicitement `§5.1 « xSOM n'est pas un pare-feu de prompts »`, `§5.2 « pas une plateforme d'évaluation de modèle »`, `§5.4 « pas un produit DLP »` (PRD.md:913-926). Trois menaces de la matrice tombent dessus. La graduation les dissout sans renier les non-objectifs : nous ne **bloquons** pas nativement un prompt (B interdit), mais nous pouvons **orchestrer** un garde tiers (O) et **attester** de sa présence (A). Le non-objectif porte sur *ce que nous construisons*, pas sur *ce que nous prouvons*.

---

## 2. La matrice

Les 15 lignes de la matrice source produisent **16 lignes de couverture** : la menace « Injection de prompts (Directe / Indirecte) » regroupe deux vecteurs dont les plans techniques et les modes de couverture diffèrent radicalement, et doit être scindée.

Légende écart : ✅ couvert · ⚠️ partiel / durci à faire · ❌ absent

### Domaine 1 — Attaque ciblée IA

| # | Menace | Mode | État réel du code | Écart |
|---|---|---|---|---|
| **M-01** | Injection de prompts **directe** | **O** + A | ❌ Rien. Non-objectif assumé (PRD.md:917). | `G-01` |
| **M-02** | Injection de prompts **indirecte** | **B** | ⚠️ `gateway/taint.py:35-43` — garde de taint sur les *résultats* d'outils. **Regex anglaise uniquement** (`taint.py:20-30`). État en mémoire, non persisté. | `G-02` `G-03` |
| **M-03** | Empoisonnement de données | **A** | ❌ Rien. « data poisoning » absent des 4 docs produit. `poison` ne désigne que le *Tool Poisoning* (PRD.md:291). | `G-04` |
| **M-04** | Vol de modèle / extraction | **D** | ⚠️ `api/ratelimit.py`, `core/usage.py` — la télémétrie existe, mais cadrée « équité multi-tenant », jamais anti-extraction. | `G-05` |
| **M-05** | Attaques par évasion (adversarial) | **X** | ❌ Rien — et c'est le bon choix : la robustesse du modèle est un problème d'entraînement. | — |
| **M-06** | Piratage d'agents autonomes | **B** | ✅ **Cœur du produit.** `gateway/server.py:127-203` : integrity → RBAC → policy → judge → risk → taint → HITL. Plancher irréversible (`FR-33`). | `G-06` |

**M-05 — Résolution.** Nous ne prévenons pas la duperie du modèle. Nous garantissons que **le modèle dupé n'exécute pas l'action irréversible** — exactement la position déjà tenue sur le jailbreak (PRD.md:917). C'est une ligne `X` sur la détection et une ligne `B` sur la conséquence. Formulée ainsi, elle *renforce* le discours au lieu de l'affaiblir.

**M-06 — Écart critique.** `PLAN-REVIEW.md:243-245` (EXH-4) : les outils exécuteurs génériques — `bash`, `run_python`, `execute_sql`, `kubectl` — n'ont **aucune classification déterministe**. Or c'est précisément par eux que passe un agent détourné. Le cœur du produit a un trou sur son propre scénario phare.

### Domaine 2 — Cyberattaque dopée à l'IA

| # | Menace | Mode | État réel du code | Écart |
|---|---|---|---|---|
| **M-07** | Phishing hyper-personnalisé | **B** (émission) / **X** (réception) | ✅ Côté émission : un agent qui envoie du mail passe par la policy — `mail.send` hors allowlist est le scénario `make demo` (CLAUDE.md §7). ❌ Détection entrante : hors produit. | — |
| **M-08** | Usurpation par deepfake | **B** (approbation) / **X** (média) | ⚠️ SoD `FR-19`, canal signé `FR-21`. **Mais** `PLAN-REVIEW.md:77` (INV-5) : le callback d'approbation Slack *est* un porteur — quiconque lit le message peut l'exercer, et la SoD tombe par le même biais. | `G-07` |
| **M-09** | Malwares polymorphes | **X** | ❌ Rien. Plan endpoint (EDR/XDR). | — |

**M-07 / M-08 — l'inversion qui vend.** Ces deux lignes semblaient hors sujet ; elles sont en réalité nos meilleurs arguments, à condition d'inverser la question. Nous ne détectons pas le mail de phishing entrant : **nous empêchons votre agent d'en devenir l'émetteur**. Nous ne détectons pas la voix clonée du dirigeant : **le faux dirigeant ne peut pas approuver le virement**, parce qu'une approbation exige une décision signée, attribuée, en séparation des devoirs, et inscrite dans la chaîne. C'est le discours « arnaque au président » que tout grand compte comprend immédiatement — et il est aujourd'hui **affaibli par INV-5**, qui doit être corrigé avant toute démo.

### Domaine 3 — Shadow AI & Confidentialité

| # | Menace | Mode | État réel du code | Écart |
|---|---|---|---|---|
| **M-10** | Exfiltration de données / PI via LLM | **B** (chemin supervisé) / **O** (découverte) | ✅ `core/dlp.py:59-75` (secret bloqué / PII signalé / entropie), `api/llm_proxy.py`, coffre `core/secrets.py`. ⚠️ `FR-64` (DLP post-taint) **différé**. ❌ Découverte du Shadow AI non supervisé = territoire CASB. | `G-08` `G-09` |
| **M-11** | Supply chain (modèles / bibliothèques) | **B** (outils MCP) / **A** (libs) / **O** (modèles ML) | ✅ Outils MCP : empreinte + quarantaine, `gateway/server.py:130-134`, `FR-53/54/68` — différenciateur revendiqué (PRD.md:1087). ✅ Libs : SBOM `FR-141`, `pip-audit` + `trufflehog` en CI. ❌ Modèles ML (picklescan/modelscan) : absent. | `G-10` |

**M-10 — Collision / Résolution.** PRD `§5.4` : « xSOM n'est pas un produit DLP ; la DLP est une *entrée* des décisions de risque et d'egress, pas un plan de contrôle vendu ». **Résolution :** la ligne reste `B` sur le chemin supervisé — le blocage d'un secret sortant est réel et prouvable — mais le support commercial ne vend jamais « une DLP ». Il vend « aucun secret ne franchit la frontière d'action sans décision tracée ». Le non-objectif tient.

### Domaine 4 — Architecture & Configuration

| # | Menace | Mode | État réel du code | Écart |
|---|---|---|---|---|
| **M-12** | Privilèges excessifs (excessive agency) | **B** | ✅ RBAC par outil `gateway/server.py:238-252`, jetons scopés, défaut `unknown_tool: deny` (`FR-107`). ⚠️ `FR-44/45/81` différés. **⛔ `core/policy.py:252-256` : fail-open confirmé.** | `G-11` |
| **M-13** | Traitement non sécurisé des sorties | **D** + O | ❌ Rien. `FR-69` enregistre volontairement « statut et classe d'erreur uniquement — jamais le corps du résultat » (PRD.md:576). | `G-12` |
| **M-14** | Fuite du system prompt & secrets | **B** (secrets) / **O** (prompt) | ✅ Coffre `core/secrets.py`, `FR-111` rejette les secrets inline, `FR-37` les exclut des événements, `gen_ai.system_instructions` sur liste de rejet à l'ingestion (`FR-137`). ❌ Détection de fuite du prompt lui-même : absent. | `G-13` |

**M-13 — l'opportunité asymétrique.** Le produit affirme ne pas lire les résultats d'outils… alors que **le garde de taint les lit déjà** (`gateway/taint.py:35`). Le canal de lecture existe et est instrumenté. Étendre la détection aux charges exécutables (SQL/HTML/shell) dans les sorties est donc bien moins coûteux qu'il n'y paraît : c'est un détecteur supplémentaire sur un flux déjà scanné, pas un nouveau plan d'architecture.

### Domaine 5 — Facteur humain & usages

| # | Menace | Mode | État réel du code | Écart |
|---|---|---|---|---|
| **M-15** | Validation aveugle de code (Copilot) | **O** + A | ⚠️ CI : `pip-audit`, `trufflehog`, `scripts/audit_security.py`. `FR-145` (SAST) **différé**. | `G-14` |
| **M-16** | Décision fondée sur une hallucination | **A** | ❌ Non-objectif explicite `§5.2` ; `FR-73` impose même de l'afficher. | `G-15` |

**M-16 — Collision / Résolution.** PRD `§5.2` interdit tout scoring de groundedness. **Résolution :** nous ne mesurons pas l'hallucination — nous garantissons qu'**aucune décision hallucinée ne s'exécute sans revue humaine**, ce qui est très exactement le HITL déjà livré. La menace est couverte par le contrôle existant, sous un angle différent. Aucun code nouveau, un argument commercial fort, et le non-objectif intact.

**M-15 — angle sous-exploité.** Un agent de code *est* un agent. S'il exécute `git push` ou `bash` via le gateway, il retombe sous M-06/M-12 — et donc sous le trou **EXH-4**. Le lien entre « validation aveugle de code » et « outils exécuteurs non classifiés » est le même défaut vu de deux côtés.

---

## 3. Synthèse de couverture

| Mode | Lignes | Part |
|---|---|---|
| **B** — Bloqué nativement | M-02, M-06, M-07(ém.), M-08(appr.), M-10, M-11(MCP), M-12, M-14(secrets) | **8 / 16** |
| **D** — Détecté | M-04, M-13 | 2 / 16 |
| **O** — Orchestré | M-01, M-11(modèles), M-13, M-14(prompt), M-15 | 5 / 16 |
| **A** — Attesté | M-03, M-16 | 2 / 16 |
| **X** — Hors périmètre déclaré | M-05, M-07(réc.), M-09 | 3 / 16 |

**Le message qui en sort est meilleur que « nous couvrons tout ».** Sur 16 vecteurs, **8 sont bloqués nativement et prouvables en démo**, 3 sont honnêtement déclarés hors périmètre, et les 5 restants sont gouvernés. Un RSSI qui lit cette table nous fait davantage confiance qu'un fournisseur qui coche 15 cases sur 15 — parce qu'il sait qu'aucun produit ne les coche.

---

## 4. Défauts confirmés dans le code livré — bloquants pour toute démo

Ces trois points ne sont pas des écarts de périmètre : ce sont des **défauts du cœur d'enforcement existant**, confirmés en lisant le code, sur des chemins que la démonstration expose directement.

| ID | Défaut | Preuve | Pourquoi c'est bloquant |
|---|---|---|---|
| **D-1** | Le garde anti-injection indirecte ne détecte qu'en **anglais**. | `gateway/taint.py:20-30` — motifs `ignore previous`, `disregard`, `new instructions:`… Aucune variante FR/ES/DE, aucune normalisation unicode/base64/homoglyphes. | M-02 est la menace n°1 de la matrice et notre argument phare. Un prospect qui teste `« ignore les instructions précédentes »` en français passe au travers — **en direct, pendant la démo.** Contredit aussi `FR-6` (classification multilingue FR/ES/DE) : le plan exige déjà le multilingue ailleurs. |
| **D-2** | Les contraintes de policy non reconnues **autorisent silencieusement**. | `core/policy.py:252-256` : seul `allowed_domains` est lu ; toute autre clé ⇒ `return True`. `allowed_clients` est lu ailleurs (`gateway/server.py:246`), d'où la confusion. | Une contrainte mal orthographiée ou pas encore implémentée ouvre la règle au lieu de la fermer. Violation frontale de `CLAUDE.md §4.4` (fail-closed) et de la promesse `unknown → deny`. |
| **D-3** | L'approbation par canal interactif est un **porteur rejouable**. | `PLAN-REVIEW.md:77` (INV-5), sur `FR-21`. | C'est le contrôle sur lequel repose tout le discours anti-deepfake (M-08). S'il est contournable par relecture du message, l'argument « le faux dirigeant ne peut pas approuver » s'effondre. |

`PLAN-REVIEW.md:13-15` qualifie ses 34 correctifs de **contraignants** (« une story qui atterrit sans traiter les points qui la concernent n'est pas terminée »), et INV-1/2/4/5/6 « doivent atterrir avant tout merge de code ». **Aucun n'a été reporté dans la PRD, l'architecture ou les epics** — les trois documents se lisent encore comme s'ils n'existaient pas.

---

## 5. Axe souveraineté

C'est le mot du brief, et c'est aujourd'hui le point le plus faible du plan v2.

**Constat.** `« sovereign hosting bundles »` est **explicitement hors périmètre** de la v2.0 (PRD.md:961). **Mistral n'apparaît pas une seule fois** dans les 6 800 lignes des quatre documents produit — alors que `CLAUDE.md §3` impose `LiteLLM → Mistral` pour le juge. **OVH : zéro occurrence.** Keycloak apparaît deux fois, et `PLAN-REVIEW.md:174-178` (DEP-6) qualifie l'affirmation « Keycloak/Entra/Okta fonctionnent par configuration seule » de **fausse**.

**Constat aggravant sur la matrice source.** Les outils qu'elle recommande sont presque tous non européens : NeMo Guardrails, Llama Guard, Snyk, SonarQube, les CASB du marché, FIDO2. **Un démonstrateur « souverain » ne peut pas s'appuyer sur eux pour les lignes `O` (Orchestré).** Chaque contrôle orchestré doit avoir un substitut UE identifié, sans quoi la revendication de souveraineté est décorative.

**Principe à porter dans la PRD :** *aucun contrôle du chemin de décision ne dépend d'un service hors UE, et le produit doit fonctionner intégralement hors ligne.* Le socle technique existe déjà — `OP-10` (opération hors ligne), l'ancre `file` « seule option fonctionnant en air-gap » (ARCHITECTURE-V2.md:395), le vérificateur autonome sans dépendance. La souveraineté est donc à **assembler et à nommer**, pas à inventer.

---

## 6. Référentiels à mapper

Décision : les quatre familles sont retenues. `FR-131` mappe déjà EU AI Act, RGPD, ISO 42001, NIST AI RMF et SOC 2 via une **table de correspondance déclarative** (`core/frameworks.py`, ARCHITECTURE-V2.md). Les nouveaux référentiels s'y ajoutent comme des lignes de données, pas comme du code : **le coût d'intégration est faible et l'effort réel est le travail de correspondance lui-même.**

| Famille | Rôle | Coût |
|---|---|---|
| **OWASP LLM Top 10 + MITRE ATLAS** | Colonne vertébrale technique. La matrice s'y aligne presque 1:1 (M-01→LLM01, M-03→LLM04, M-10→LLM02, M-11→LLM03, M-12→LLM06, M-13→LLM05, M-14→LLM07, M-16→LLM09). Langage des équipes sécurité en face. | Faible — extension de table |
| **EU AI Act + RGPD** | Déjà produit (`FR-131`, exports art. 12/14/26). | Nul — existant |
| **NIS2 + DORA** | Attendu des grands comptes régulés (finance, assurance, OIV/OSE). Fort levier commercial. | Élevé — travail de correspondance |
| **ANSSI / SecNumCloud** | L'axe souveraineté au sens français. Contraint la stack d'hébergement. | Élevé — contraint l'architecture |

---

## 7. Écarts à instruire dans la PRD de strate

Chaque `G-nn` deviendra une ou plusieurs exigences fonctionnelles, numérotées à partir de **FR-153** pour ne pas entrer en collision avec les 152 existantes.

| ID | Écart | Menace | Priorité pressentie |
|---|---|---|---|
| `G-01` | Connecteur de garde-prompt tiers souverain + attestation de présence, verdicts chaînés | M-01 | Moyenne |
| `G-02` | Détection de taint multilingue + normalisation (unicode, encodages, homoglyphes) | M-02 | **Critique (D-1)** |
| `G-03` | Taint persisté survivant à la reconnexion (`FR-62`, non implémenté) | M-02 | Haute |
| `G-04` | Déclaration de provenance des jeux de données / bases vectorielles au registre + section Evidence Pack | M-03 | Moyenne |
| `G-05` | Détecteur d'extraction déterministe (volume / motif de requêtage) + alerte | M-04 | Moyenne |
| `G-06` | Classification déterministe des outils exécuteurs (`bash`, `execute_sql`, `kubectl`…) — EXH-4 | M-06, M-15 | **Critique** |
| `G-07` | Approbation non rejouable : liaison au décideur, usage unique, expiration — INV-5 | M-08 | **Critique (D-3)** |
| `G-08` | Activation de `FR-64` (DLP en entrée des décisions post-taint) | M-10 | Haute |
| `G-09` | Inventaire du Shadow AI : découverte des outils non supervisés (orchestré) | M-10 | Moyenne |
| `G-10` | Analyse d'artefacts de modèles ML (orchestré) + entrée au registre | M-11 | Basse |
| `G-11` | Fail-closed sur clé de contrainte inconnue — EXH-2 | M-12 | **Critique (D-2)** |
| `G-12` | Détection de charge exécutable dans les résultats d'outils (extension du canal de taint) | M-13 | Moyenne |
| `G-13` | Détection de fuite de system prompt sur l'egress (orchestré / extension DLP) | M-14 | Basse |
| `G-14` | Ingestion de verdicts SAST/DAST comme preuve chaînée (`FR-145`, différé) | M-15 | Basse |
| `G-15` | Attestation « décision critique sous revue humaine » adossée au HITL existant | M-16 | Faible coût, fort rendement |
| `G-16` | Mapping OWASP LLM Top 10 + MITRE ATLAS + NIS2 + DORA + ANSSI dans `core/frameworks.py` | Tous | Haute |
| `G-17` | Doctrine de souveraineté : substituts UE pour tout contrôle orchestré, fonctionnement hors ligne prouvé | Tous | Haute |
| `G-18` | Carte de couverture publiée (`FR-144`) portant cette matrice, lignes non couvertes incluses | Tous | Haute |

---

## 8. Questions ouvertes

- **QO-1** — Les correctifs contraignants de `PLAN-REVIEW.md` (34, dont 5 « avant tout merge ») sont-ils absorbés par cette strate, ou traités comme un chantier antérieur distinct ? `D-1`, `D-2` et `D-3` en font partie et bloquent la démonstration.
- **QO-2** — Le démonstrateur cible-t-il un appel d'offres identifié ? Si oui, le mapping NIS2/DORA/ANSSI doit être priorisé sur les écarts techniques ; sinon l'inverse.
- **QO-3** — Pour les lignes `O`, quel est le substitut souverain retenu par contrôle ? Sans réponse, `G-01`, `G-10` et `G-14` ne sont pas spécifiables.
- **QO-4** — La strate v2.5 se démontre-t-elle sur les Epics 1-5 (v2.0-core) uniquement, ou suppose-t-elle des epics post-core (6-13) que `PLAN-REVIEW.md:18-29` a repoussés en v2.1/v2.2 ? M-08 dépend de l'Epic 4 et M-06 de l'Epic 6.
