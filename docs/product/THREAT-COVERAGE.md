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

Il ne définit **aucune** exigence fonctionnelle. Il établit, pour chacune des 15 menaces de la matrice source, quatre faits vérifiables :

1. **à qui la menace appartient** (§2) — un éditeur de modèle et un grand compte utilisateur d'IA n'affrontent pas les mêmes attaques ;
2. **ce que le produit fait déjà**, prouvé par `fichier:ligne` dans le code livré ;
3. **le mode de couverture revendicable** — et donc ce que le commercial a le droit de dire ;
4. **l'écart résiduel** (`G-nn`), qui deviendra une exigence dans la PRD de strate.

Les deux premiers points forment deux **axes indépendants** : l'applicabilité (§2) dit *si ça le concerne*, la couverture (§1, §3) dit *ce que nous savons en faire*. Les croiser produit l'énoncé de la démo (§2.5) ; les confondre produit un catalogue.

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

## 2. L'axe d'applicabilité — qui est vraiment visé

La couverture (§1) dit *ce que nous savons faire*. Elle ne dit pas *si la menace concerne ce client*. C'est le second axe, et c'est celui qui porte le premier pilier de la vision : **faire comprendre les vrais enjeux derrière les mots-clés**.

### 2.1 Le tri fondateur : fournisseur de modèle ≠ utilisateur d'IA

Les attaques qui visent **un éditeur de modèle** ne sont pas celles qui visent **un grand compte qui utilise l'IA**. La matrice source — comme OWASP LLM Top 10, comme l'essentiel du discours du marché — mélange les deux populations sans jamais le dire, parce que tout le monde a intérêt à vendre les quinze lignes.

| Famille | Menaces | À qui le problème appartient |
|---|---|---|
| **Menaces du fournisseur** | Empoisonnement du jeu d'entraînement · Attaques adverses / évasion · Vol de modèle | L'éditeur qui entraîne et expose le modèle. **Sauf bascule de profil** — voir §2.3. |
| **Cyber classique dopé à l'IA** | Phishing hyper-personnalisé · Deepfake · Malwares polymorphes | Réel pour le client, mais c'est son SOC, sa passerelle mail, son EDR. Nous n'en gardons que la facette IA : l'agent comme *émetteur* (M-07) et l'intégrité de l'*approbation* (M-08). |
| **Sécurité de l'usage de l'IA** | Injection directe et indirecte · Piratage d'agent · Exfiltration & Shadow AI · Supply chain d'outils · Privilèges excessifs · Sorties non assainies · Fuite de system prompt · Validation aveugle de code · Hallucinations | **Le client, et notre terrain.** |

Dire à voix haute que **6 des 16 lignes ne sont pas son sujet** est le moment où le RSSI comprend qu'on ne lui vend pas un catalogue. C'est un argument de crédibilité, pas une concession.

### 2.2 Les profils d'usage

Le sous-ensemble applicable se déduit de la position du client dans la chaîne de valeur. Chaque profil **ajoute** aux précédents.

| Profil | Ce que fait le client | Réalité du marché français | Ce qui s'active en plus |
|---|---|---|---|
| **P1a — API hyperscaler** | Consomme Azure OpenAI et assimilés | **Très répandu** | Socle : exfiltration, Shadow AI, fuite de prompt, hallucinations. Tension de souveraineté : hébergement UE ≠ droit UE. |
| **P1b — IA embarquée SaaS** | Microsoft Copilot et assimilés | **Très répandu** | Même socle, **mais aucune interposition possible** — voir §2.4. |
| **P2 — RAG interne** | Base vectorielle nourrie de ses propres documents | **À maîtriser absolument** — socle non négociable | **+ injection indirecte**, **+ empoisonnement de la base vectorielle** |
| **P3 — Agents outillés** | L'IA *agit* : envoie, écrit, paie, déploie | **En croissance** — la trajectoire | **+ piratage d'agent, privilèges excessifs, sorties non assainies, supply chain d'outils** ← cœur du produit |
| **P4 — Poids ouverts hébergés** | Héberge lui-même les poids d'un modèle | **Nombreux** — c'est le modèle de distribution de Mistral auprès des grands comptes français | + supply chain de modèles (artefacts sérialisés), + extraction si le modèle est exposé, + **souveraineté réelle atteignable** (§6.2) |
| **P5 — Entraînement / fine-tuning** | Entraîne ou affine un modèle | Rare | + empoisonnement du jeu d'entraînement, + attaques adverses |

**P4 n'est pas un profil de niche en France.** C'est l'erreur d'analyse la plus coûteuse qu'on puisse faire ici : le modèle de distribution de Mistral place une part significative des grands comptes français en position d'hébergeur de poids. Cela change deux choses — des menaces réputées « côté fournisseur » redeviennent les leurs, et la souveraineté cesse d'être un argument pour devenir une architecture.

### 2.3 Les bascules — la nuance qui prouve qu'on connaît le métier

Trois menaces changent de camp selon le profil. Ce sont elles qu'il faut savoir expliquer en réunion.

| Menace | Côté fournisseur tant que… | Devient le problème du client dès… |
|---|---|---|
| **Empoisonnement de données** (M-03) | le client ne détient aucun corpus | **P2** — sa base vectorielle est empoisonnable même s'il n'entraîne rien |
| **Vol de modèle / extraction** (M-04) | le client ne fait que consommer une API | **P4** — il héberge et expose un modèle, fût-ce en interne |
| **Attaques adverses** (M-05) | le client ne touche pas aux poids | **P5** seulement — et la conséquence reste confinée au plan action (§3, M-05) |

### 2.4 L'angle mort déclaré : l'IA embarquée SaaS (P1b)

**Nous ne pouvons pas nous interposer devant Microsoft Copilot.** Il n'y a pas de frontière d'outils à instrumenter : l'assistant est encastré dans la suite, ses actions s'exécutent dans le tenant, et aucun gateway MCP ne s'intercale. Au mieux, une couverture **Détecté / Attesté** par ingestion des journaux d'audit de la suite — jamais **Bloqué**.

C'est une ligne `X` sur l'enforcement, et elle doit être annoncée **avant** que le prospect ne la découvre, d'autant qu'il est probablement déjà équipé. Le dire sert le pilier « vrais enjeux » : un fournisseur qui prétend superviser Copilot par un proxy ment ou n'a pas compris le produit.

### 2.5 Ce que la démo revendique

La combinaison des deux axes donne l'énoncé de vente, à calculer devant le client plutôt qu'à asséner :

> « Sur les 15 menaces que le marché vous présente, **N vous concernent réellement** compte tenu de votre usage. Sur ces N, nous en **bloquons M nativement, chez vous, aujourd'hui** — et voici les preuves. Les autres, nous vous disons qui les porte. »

Un RSSI accorde davantage de crédit à ce compte-là qu'à quinze cases cochées, parce qu'il sait qu'aucun produit ne les coche.

---

## 3. La matrice de couverture

Les 15 lignes de la matrice source produisent **16 lignes de couverture** : la menace « Injection de prompts (Directe / Indirecte) » regroupe deux vecteurs dont les plans techniques et les modes de couverture diffèrent radicalement, et doit être scindée.

Légende écart : ✅ couvert · ⚠️ partiel / durci à faire · ❌ absent

### Domaine 1 — Attaque ciblée IA

> **Cette table est rédigée ; elle ne fait plus foi.** Depuis `G-18`, la carte est
> **générée** depuis les scénarios qui passent (`coverage/`, `AD-30`), et une facette
> revendiquée `Bloqué` sans scénario fait échouer le build (`CM-7`). En cas d'écart
> entre cette prose et `coverage/COVERAGE-MAP.md`, c'est la carte générée qui a raison
> — et l'écart est lui-même le défaut à corriger.

| # | Menace | Mode | État réel du code | Écart |
|---|---|---|---|---|
| **M-01** | Injection de prompts **directe** | **O** + A | ❌ Rien. Non-objectif assumé (PRD.md:917). | `G-01` |
| **M-02** | Injection de prompts **indirecte** | **B** | ✅ `gateway/taint.py` — garde de taint sur les *résultats* d'outils, **FR/ES/DE + normalisation** (`FR-153`). État persisté par agent (`FR-154`). | `G-02` `G-03` |
| **M-03** | Empoisonnement de données | **A** | ✅ `core/corpora.py`, `api/corpora.py`, migration `0022` — provenance déclarée, datée, et **périssable** ; publiée dans l'Evidence Pack avec son compte de déclarations périmées. Reste `A` : c'est une attestation de l'exploitant, pas un contrôle sur ses données. | ~~`G-04`~~ |
| **M-04** | Vol de modèle / extraction | **D** | ⚠️ `api/ratelimit.py`, `core/usage.py` — la télémétrie existe, mais cadrée « équité multi-tenant », jamais anti-extraction. | `G-05` |
| **M-05** | Attaques par évasion (adversarial) | **X** | ❌ Rien — et c'est le bon choix : la robustesse du modèle est un problème d'entraînement. | — |
| **M-06** | Piratage d'agents autonomes | **B** | ✅ **Cœur du produit.** `gateway/server.py:127-203` : integrity → RBAC → policy → judge → risk → taint → HITL. Plancher irréversible (`FR-33`). | `G-06` |

**M-05 — Résolution.** Nous ne prévenons pas la duperie du modèle. Nous garantissons que **le modèle dupé n'exécute pas l'action irréversible** — exactement la position déjà tenue sur le jailbreak (PRD.md:917). C'est une ligne `X` sur la détection et une ligne `B` sur la conséquence. Formulée ainsi, elle *renforce* le discours au lieu de l'affaiblir.

**M-06 — Écart critique.** `PLAN-REVIEW.md:243-245` (EXH-4) : les outils exécuteurs génériques — `bash`, `run_python`, `execute_sql`, `kubectl` — n'ont **aucune classification déterministe**. Or c'est précisément par eux que passe un agent détourné. Le cœur du produit a un trou sur son propre scénario phare.

### Domaine 2 — Cyberattaque dopée à l'IA

| # | Menace | Mode | État réel du code | Écart |
|---|---|---|---|---|
| **M-07** | Phishing hyper-personnalisé | **B** (émission) / **X** (réception) | ✅ Côté émission : un agent qui envoie du mail passe par la policy — `mail.send` hors allowlist est le scénario `make demo` (CLAUDE.md §7). ❌ Détection entrante : hors produit. | — |
| **M-08** | Usurpation par deepfake | **B** (approbation) / **X** (média) | ✅ SoD réelle : le décideur est le principal authentifié (`api/approvals.py`), la quorum compte des identités signées distinctes, et aucun canal interactif n'existe — donc aucun porteur rejouable. `INV-5` vise un canal à construire, pas le code actuel. | `G-07` |
| **M-09** | Malwares polymorphes | **X** | ❌ Rien. Plan endpoint (EDR/XDR). | — |

**M-07 / M-08 — l'inversion qui vend.** Ces deux lignes semblaient hors sujet ; elles sont en réalité nos meilleurs arguments, à condition d'inverser la question. Nous ne détectons pas le mail de phishing entrant : **nous empêchons votre agent d'en devenir l'émetteur**. Nous ne détectons pas la voix clonée du dirigeant : **le faux dirigeant ne peut pas approuver le virement**, parce qu'une approbation exige une décision signée, attribuée, en séparation des devoirs, et inscrite dans la chaîne. C'est le discours « arnaque au président » que tout grand compte comprend immédiatement — et il est aujourd'hui **affaibli par INV-5**, qui doit être corrigé avant toute démo.

### Domaine 3 — Shadow AI & Confidentialité

| # | Menace | Mode | État réel du code | Écart |
|---|---|---|---|---|
| **M-10** | Exfiltration de données / PI via LLM | **B** (chemin supervisé) / **O** (découverte) | ✅ `core/dlp.py:59-75` (secret bloqué / PII signalé / entropie), `api/llm_proxy.py`, coffre `core/secrets.py`. ✅ `FR-64` (DLP post-taint) livré — facette `post_taint`. ❌ Découverte du Shadow AI non supervisé = territoire CASB. | `G-08` `G-09` |
| **M-11** | Supply chain (modèles / bibliothèques) | **B** (outils MCP) / **A** (libs) / **O** (modèles ML) | ✅ Outils MCP : empreinte + quarantaine, `gateway/server.py:130-134`, `FR-53/54/68` — différenciateur revendiqué (PRD.md:1087). ✅ Libs : SBOM `FR-141`, `pip-audit` + `trufflehog` en CI. ❌ Modèles ML (picklescan/modelscan) : absent. | `G-10` |

**M-10 — Chemin d'ingestion (`AD-28`).** Le `Bloqué` porte sur l'**egress du proxy LLM**, et il y est inconditionnel : le blocage DLP précède l'appel amont et la branche streaming, donc ni l'en-tête `x-xsom-mode` ni le mode flux ne l'atteignent (§8.3). Il ne porte **pas** sur la garde d'appels d'outils du même proxy, qui relève de `M-06`/`M-12` et tombe sous `G-25`/`G-26`.

**M-10 — Collision / Résolution.** PRD `§5.4` : « xSOM n'est pas un produit DLP ; la DLP est une *entrée* des décisions de risque et d'egress, pas un plan de contrôle vendu ». **Résolution :** la ligne reste `B` sur le chemin supervisé — le blocage d'un secret sortant est réel et prouvable — mais le support commercial ne vend jamais « une DLP ». Il vend « aucun secret ne franchit la frontière d'action sans décision tracée ». Le non-objectif tient.

### Domaine 4 — Architecture & Configuration

| # | Menace | Mode | État réel du code | Écart |
|---|---|---|---|---|
| **M-12** | Privilèges excessifs (excessive agency) | **B** | ✅ RBAC par outil `gateway/server.py:238-252`, jetons scopés, défaut `unknown_tool: deny` (`FR-107`). ⚠️ `FR-44/45/81` différés. **⛔ `core/policy.py:252-256` : fail-open confirmé.** | `G-11` |
| **M-13** | Traitement non sécurisé des sorties | **D** + O | ✅ `gateway/taint.py` — charge exécutable détectée sur le canal du taint, qui porte déjà le corps du résultat là où `FR-69` ne journalise que statut et classe d'erreur. Reste `D` : ce qui est bloqué est l'action *suivante*, pas le résultat. | ~~`G-12`~~ |
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

## 4. Synthèse de couverture

| Mode | Lignes | Part |
|---|---|---|
| **B** — Bloqué nativement | M-02, M-06, M-07(ém.), M-08(appr.), M-10, M-11(MCP), M-12, M-14(secrets) | **8 / 16** |
| **D** — Détecté | M-04, M-13 | 2 / 16 |
| **O** — Orchestré | M-01, M-11(modèles), M-13, M-14(prompt), M-15 | 5 / 16 |
| **A** — Attesté | M-03, M-16 | 2 / 16 |
| **X** — Hors périmètre déclaré | M-05, M-07(réc.), M-09 | 3 / 16 |

**Le message qui en sort est meilleur que « nous couvrons tout ».** Sur 16 vecteurs, **8 sont bloqués nativement et prouvables en démo**, 3 sont honnêtement déclarés hors périmètre, et les 5 restants sont gouvernés. Un RSSI qui lit cette table nous fait davantage confiance qu'un fournisseur qui coche 15 cases sur 15 — parce qu'il sait qu'aucun produit ne les coche.

---

## 5. Défauts confirmés dans le code livré — bloquants pour toute démo

Ces trois points ne sont pas des écarts de périmètre : ce sont des **défauts du cœur d'enforcement existant**, confirmés en lisant le code, sur des chemins que la démonstration expose directement.

| ID | Défaut | Preuve | Pourquoi c'est bloquant |
|---|---|---|---|
| **D-1** | Le garde anti-injection indirecte ne détecte qu'en **anglais**. | `gateway/taint.py:20-30` — motifs `ignore previous`, `disregard`, `new instructions:`… Aucune variante FR/ES/DE, aucune normalisation unicode/base64/homoglyphes. | M-02 est la menace n°1 de la matrice et notre argument phare. Un prospect qui teste `« ignore les instructions précédentes »` en français passe au travers — **en direct, pendant la démo.** Contredit aussi `FR-6` (classification multilingue FR/ES/DE) : le plan exige déjà le multilingue ailleurs. |
| **D-2** | Les contraintes de policy non reconnues **autorisent silencieusement**. | `core/policy.py:252-256` : seul `allowed_domains` est lu ; toute autre clé ⇒ `return True`. `allowed_clients` est lu ailleurs (`gateway/server.py:246`), d'où la confusion. | Une contrainte mal orthographiée ou pas encore implémentée ouvre la règle au lieu de la fermer. Violation frontale de `CLAUDE.md §4.4` (fail-closed) et de la promesse `unknown → deny`. |
| **D-3** | L'approbation par canal interactif est un **porteur rejouable**. | `PLAN-REVIEW.md:77` (INV-5), sur `FR-21`. | C'est le contrôle sur lequel repose tout le discours anti-deepfake (M-08). S'il est contournable par relecture du message, l'argument « le faux dirigeant ne peut pas approuver » s'effondre. |

`PLAN-REVIEW.md:13-15` qualifie ses 34 correctifs de **contraignants** (« une story qui atterrit sans traiter les points qui la concernent n'est pas terminée »), et INV-1/2/4/5/6 « doivent atterrir avant tout merge de code ». **Aucun n'a été reporté dans la PRD, l'architecture ou les epics** — les trois documents se lisent encore comme s'ils n'existaient pas.

---

## 6. Axe souveraineté

C'est le mot du brief, et c'est aujourd'hui le point le plus faible du plan v2.

### 6.1 L'écart entre la promesse et le plan

**Constat.** `« sovereign hosting bundles »` est **explicitement hors périmètre** de la v2.0 (PRD.md:961). **Mistral n'apparaît pas une seule fois** dans les 6 800 lignes des quatre documents produit — alors que `CLAUDE.md §3` impose `LiteLLM → Mistral` pour le juge. **OVH : zéro occurrence.** Keycloak apparaît deux fois, et `PLAN-REVIEW.md:174-178` (DEP-6) qualifie l'affirmation « Keycloak/Entra/Okta fonctionnent par configuration seule » de **fausse**.

**Constat aggravant sur la matrice source.** Les outils qu'elle recommande sont presque tous non européens : NeMo Guardrails, Llama Guard, Snyk, SonarQube, les CASB du marché, FIDO2. **Un démonstrateur « souverain » ne peut pas s'appuyer sur eux pour les lignes `O` (Orchestré).** Chaque contrôle orchestré doit avoir un substitut UE identifié, sans quoi la revendication de souveraineté est décorative.

**Principe à porter dans la PRD :** *aucun contrôle du chemin de décision ne dépend d'un service hors UE, et le produit doit fonctionner intégralement hors ligne.* Le socle technique existe déjà — `OP-10` (opération hors ligne), l'ancre `file` « seule option fonctionnant en air-gap » (ARCHITECTURE-V2.md:395), le vérificateur autonome sans dépendance. La souveraineté est donc à **assembler et à nommer**, pas à inventer.

### 6.2 L'architecture de référence souveraine — ce que P4 rend possible

Le profil **P4** (§2.2) transforme la souveraineté d'argument en architecture démontrable. Un grand compte qui héberge déjà les poids d'un modèle français peut faire tourner une chaîne complète sans dépendance hors UE **sur le chemin de décision** :

| Couche | Composant souverain | État |
|---|---|---|
| Modèle | Poids Mistral auto-hébergés (ou plateforme FR) | Chez le client (P4) |
| Contrôle d'action | Gateway xSOM | Existant |
| Juge (cas ambigus) | Mistral via LiteLLM | **Imposé par `CLAUDE.md §3`, à rendre visible dans le plan** |
| Données & audit | Postgres auto-hébergé | Existant |
| Identité | Keycloak / GoTrue auto-hébergé | Existant, mais voir `DEP-6` |
| Hébergement | OVH, Scaleway, Outscale, ou on-premise | À nommer |
| Ancrage de preuve | Ancre `file`, fonctionne en air-gap | Existant (ARCHITECTURE-V2.md:395) |

**C'est le seul argument de souveraineté qui résiste à un RSSI.** Il ne repose pas sur une localisation de datacentre — un hébergement UE opéré sous droit américain n'est pas une réponse — mais sur l'absence de dépendance opérationnelle : aucun appel sortant nécessaire pour qu'une décision d'autorisation soit prise, journalisée et vérifiable.

**Corollaire contraignant pour les lignes `Orchestré` (§1).** Chaque contrôle tiers que nous orchestrons doit avoir un substitut européen identifié, faute de quoi il perce la chaîne. Les outils recommandés par la matrice source (NeMo Guardrails, Llama Guard, Snyk, SonarQube, CASB du marché) ne sont pas utilisables tels quels dans cette architecture : `G-01`, `G-10` et `G-14` ne sont pas spécifiables tant que leurs substituts ne sont pas choisis.

---

## 7. Référentiels à mapper

Décision : les quatre familles sont retenues. `FR-131` mappe déjà EU AI Act, RGPD, ISO 42001, NIST AI RMF et SOC 2 via une **table de correspondance déclarative** (`core/frameworks.py`, ARCHITECTURE-V2.md). Les nouveaux référentiels s'y ajoutent comme des lignes de données, pas comme du code : **le coût d'intégration est faible et l'effort réel est le travail de correspondance lui-même.**

| Famille | Rôle | Coût |
|---|---|---|
| **OWASP LLM Top 10 + MITRE ATLAS** | Colonne vertébrale technique. Langage des équipes sécurité en face. **Livré (`FR-194`)** : la correspondance vit dans `coverage/rows.yaml`, millésimée, et se publie avec la carte — elle n'est plus une phrase de documentation qui dérive. Le vocabulaire est **fermé** : y écrire un référentiel de management (ISO 42001, SOC 2, NIS2, DORA, ANSSI) échoue au parse, ce qui est la façon dont `AR-1` tient. | Livré |
| **EU AI Act + RGPD** | Déjà produit (`FR-131`, exports art. 12/14/26). | Nul — existant |
| **NIS2 + DORA** | Attendu des grands comptes régulés (finance, assurance, OIV/OSE). Fort levier commercial. | Élevé — travail de correspondance |
| **ANSSI / SecNumCloud** | L'axe souveraineté au sens français. Contraint la stack d'hébergement. | Élevé — contraint l'architecture |

---

## 8. Écarts à instruire dans la PRD de strate

Chaque `G-nn` deviendra une ou plusieurs exigences fonctionnelles, numérotées à partir de **FR-153** pour ne pas entrer en collision avec les 152 existantes.

| ID | Écart | Menace | Priorité pressentie |
|---|---|---|---|
| `G-01` | Connecteur de garde-prompt tiers souverain + attestation de présence, verdicts chaînés | M-01 | Moyenne |
| `G-02` | ~~Détection de taint multilingue + normalisation~~ — **fermé.** FR/ES/DE, plus normalisation NFKC, entités HTML, pourcent-encodage, homoglyphes cyrilliques et grecs, diacritiques. `gateway/taint.py`, scénario de garde en français. | M-02 | ✅ |
| `G-03` | ~~Taint persisté survivant à la reconnexion~~ — **fermé.** Table `session_taint` (migration `0018`), indexée sur le **jeton de passerelle** et non sur une session déclarée par l'agent, bornée en temps. Lecture impossible → teinté (`AD-10`). | M-02 | ✅ |
| ~~`G-04`~~ | ~~Déclaration de provenance des jeux de données / bases vectorielles~~ — **fermé** (`FR-184`). Table `corpora` (RLS + `grant`), routes `admin` pour déclarer, lecture scopée par RLS, et un bloc `corpus_provenance` sous l'article 26. La facette **reste `A`** : nous ne vérifions pas la provenance, nous rendons la déclaration auditable — et le bloc le dit lui-même, dans le bloc. Ce qui la distingue d'un formulaire est la **péremption** : la date de revue est obligatoire, une revue future est refusée, et l'Evidence Pack publie combien de déclarations sont périmées. | M-03 | ✅ |
| `G-05` | Détecteur d'extraction déterministe (volume / motif de requêtage) + alerte | M-04 | Moyenne |
| `G-06` | ~~Classification déterministe des outils exécuteurs~~ — **fermé.** `classify: by_argument` + prédicat borné (`core/predicates.py`) : un exécuteur est classé par ce qu'on lui demande, sans juge, tout imprévu prenant le plafond déclaré. | M-06, M-15 | ✅ |
| `G-07` | **Requalifié** : contrainte *sur du non-construit*, pas défaut vivant. Il n'existe aucun canal d'approbation interactif — `core/notify.py` envoie un e-mail portant un identifiant, jamais un porteur, et `POST /v1/approvals/{id}/decision` prend l'identité du décideur dans le JWT vérifié, jamais du payload. À tenir le jour où un canal est construit (`FR-159`) ; l'invariant est désormais asserté. | M-08 | ✅ (invariant verrouillé) |
| ~~`G-08`~~ | ~~Activation de `FR-64` (DLP en entrée des décisions post-taint)~~ — **fermé** (`FR-185`). Une cible en forme d'exfiltration dans les **arguments** d'une action post-taint élève le verdict, y compris pour une classe que la policy ne gate pas : un `write` vers un webhook externe passe en temps normal, pas dans une session où une injection vient d'être détectée. Facette `M-10 / post_taint` distincte de `egress` — celle-ci porte sur le chemin MCP et sur les arguments, pas sur le scan du prompt sortant. Le coût en faux positifs est borné par le taint lui-même. | M-10 | ✅ |
| `G-09` | Inventaire du Shadow AI : découverte des outils non supervisés (orchestré) | M-10 | Moyenne |
| `G-10` | Analyse d'artefacts de modèles ML (orchestré) + entrée au registre | M-11 | Basse |
| `G-11` | Fail-closed sur clé de contrainte inconnue — EXH-2 | M-12 | **Critique (D-2)** |
| ~~`G-12`~~ | ~~Détection de charge exécutable dans les résultats d'outils~~ — **fermé** (`FR-186`). Branchée sur le canal du taint, qui porte déjà le corps du résultat, plutôt que sur un second chemin d'inspection. Périmètre étroit et assumé : tube vers un interpréteur, URI `data:` porteuse de HTML, shebang, `eval`/`exec` sur chaîne, `<script>` **couplé à** une exfiltration — et un blob base64 qui *décode* vers l'un de ceux-là. `<script>` seul n'est pas un signal : une page récupérée en contient presque toujours. | M-13 | ✅ |
| `G-13` | Détection de fuite de system prompt sur l'egress (orchestré / extension DLP) | M-14 | Basse |
| `G-14` | Ingestion de verdicts SAST/DAST comme preuve chaînée (`FR-145`, différé) | M-15 | Basse |
| `G-15` | Attestation « décision critique sous revue humaine » adossée au HITL existant | M-16 | Faible coût, fort rendement |
| `G-16` | Mapping OWASP LLM Top 10 + MITRE ATLAS + NIS2 + DORA + ANSSI dans `core/frameworks.py` | Tous | Haute |
| ~~`G-17`~~ | ~~Doctrine de souveraineté : substituts UE pour tout contrôle orchestré, fonctionnement hors ligne prouvé~~ — **fermé** (`FR-176`/`FR-178`) : `SM-15` est mesuré en CI, et une facette `Orchestré` sans substitut est publiée `Hors périmètre` | Tous | ✅ |
| `G-18` | ~~Carte de couverture publiée portant cette matrice~~ — **fermé.** `coverage/rows.yaml` + `scripts/gen_coverage.py` : la carte est générée depuis les scénarios, et `CM-7` est une garde de CI. Reste ouvert : la publication du fragment sur le site, encore manuelle. | Tous | ✅ |
| `G-19` | ~~Diagnostic de profil d'usage~~ — **fermé.** `core/profiles.py` porte l'axe (profils, familles, bascules §2.3, plafonds) ; `core/triage.py` produit l'énoncé de §2.5 en citant la carte **publiée**, jamais la revendication ; `xsom triage --profils P1a,P2,P3` le rend au consultant. Les nombres sont calculés : P1a → 8/16, P1a+P2+P3 → 14/16 dont 8 bloquées. | Tous (axe §2) | ✅ |
| `G-20` | ~~Déclarer l'angle mort de l'IA embarquée SaaS (P1b)~~ — **fermé sur la déclaration**, et structurellement : P1b porte un plafond `D`, la colonne « Bloqué » de sa ligne est à zéro dans la carte générée, et le diagnostic dit l'impossibilité d'interposition avant que le prospect ne la découvre. Reste ouvert : l'ingestion effective des journaux d'audit de la suite, qui est une capacité, pas une déclaration. | §2.4 | ✅ (déclaration) |
| ~~`G-21`~~ | ~~Documenter et rendre démontrable l'architecture de référence souveraine (§6.2)~~ — **fermé** (`FR-177`) : `docs/product/ARCHI-SOUVERAINE.md`, et le recensement des substituts est dérivé du registre plutôt que rédigé | Tous (pilier 3) | ✅ |
| ~~`G-22`~~ | ~~Rédaction de contenu avant l'envoi au juge : `core/approvals.py` masque par *nom de clé*, pas par contenu~~ — **fermé.** Le défaut portait sur **deux** frontières, pas une : le juge (Mistral, un tiers) et la **notification d'approbation** (SMTP, hors périmètre), dont le docstring promettait déjà « must never carry secrets/PII ». Chacune passe désormais les détecteurs de `core/dlp.py` — les mêmes que la DLP d'egress, pas une seconde série de motifs. Le dry-run stocké garde son contenu : un opérateur ne peut pas approuver un virement dont le bénéficiaire lui est caché. Résidu déclaré : les noms en texte libre n'ont pas de forme et ne sont pas détectés. | M-10, §4.10 | ✅ |
| `G-23` | `business_hours_only` : borne temporelle d'exécution, retirée de l'exemple `SPEC.md` faute d'implémentation. Demande un fuseau par tenant et une horloge testable. | M-12 | Basse |
| `G-24` | `allowed_clients` n'est appliqué que par le gateway MCP (`_rbac_blocks`) : sur `/v1/authorize` la même policy n'est pas également bornée. Le vocabulaire le nomme désormais, il ne le corrige pas. | M-12, divergence d'ingress | **Haute** |
| `G-25` | ~~Le mode d'enforcement du proxy LLM est lu dans un en-tête de requête~~ — **fermé.** L'enforcement est le défaut ; seule une fenêtre d'observation bornée, ouverte par un `admin` via `/v1/monitor-windows`, le relâche — et jamais sur l'irréversible ni l'envoi externe (`AD-27.2`). `core/monitor.py`, migration `0017`. | M-06, M-12 | ✅ |
| `G-26` | ~~La branche streaming n'écrit aucune ligne d'audit~~ — **option `B` retenue et livrée.** Une ligne `streamed_uninspected` par complétion streamée, métadonnées seules : l'angle mort devient *auditable* au lieu d'être indiscernable d'une absence de trafic. Elle est écrite **avant** le relais, pas à la fermeture du flux — une trace posée après manquerait exactement pour les sessions interrompues. La couverture réelle (option `C`) reste ouverte, au déclencheur convenu : un client `P3` qui route ses agents par le proxy plutôt que par le gateway MCP. | M-06, M-12 | ✅ (`B`) |
| `G-27` | Une URL de serveur en aval fournie par le tenant était remise telle quelle au client MCP : aucun schéma contraint, aucun rejet des plages internes, et le défaut du SDK suit les redirections. Une écriture en base atteignait le service de métadonnées cloud, les sidecars du cluster, et l'API de contrôle sur l'hôte. **Fermé** — `core/egress.py`, une seule porte, contrôle au texte à l'écriture et à l'adresse à la connexion. Résidu déclaré : DNS rebinding. | M-12, M-14 | ✅ |
| `G-28` | `audit_log.request_id` portait deux provenances : un UUID4 du serveur, et — sur le proxy LLM — l'identifiant de complétion du fournisseur, dans la charge hachée. L'amont choisissait une part de ce que la chaîne atteste. **Fermé** — `request_id` toujours dérivé, valeurs déclarées dans leurs propres colonnes, regroupées sous `declared` à l'export. Migration `0019`. | Art. 12, `INV-3` | ✅ |
| `G-29` | La ligne d'audit n'enregistrait pas son chemin d'entrée, donc `AD-28` — « une revendication de couverture porte son chemin d'entrée » — n'était pas démontrable depuis le journal. **Fermé** — `audit.Origin`, sans constructeur depuis une chaîne, exigé par `log_event`. Migration `0020`. | `AD-28`, `INV-2` | ✅ |
| `G-30` | Le récit de conformité ne bouclait pas : quatre clés extraites du décompte alors que le total les comptait toutes — `notify`, `hold`, les événements de garde et surtout la famille `monitor_*` (actions laissées passer sous fenêtre d'observation) disparaissaient du résumé remis au régulateur. **Fermé** — partition close, seau `unclassified` pour toute décision future, `observed_not_enforced` nommé explicitement. | Art. 12, Art. 26 | ✅ |
| `G-31` | `article_12.tamper_evident: true` provenait d'une recomputation de la chaîne par le système qui l'a écrite, sur sa propre base. Présenté sans qualification, cela répond à « la chaîne est-elle cohérente » en laissant croire qu'on répond à « l'exploitant l'a-t-il réécrite ». **Fermé** — bloc `verification` calculé, `independent: false` tant qu'aucun témoin n'est configuré, et l'énoncé voyage jusque dans le PDF. La signature de checkpoint (`FR-169` première moitié) reste **non construite**. | Art. 12, `INV-12` | ✅ (moitié) |
| `G-32` | Deux policies RLS se lisaient comme des autorisations sans en être : `create policy ... to authenticated` sans `grant` correspondant, sur `monitor_windows` (0017) et `session_taint` (0018). En Postgres la policy filtre **après** le contrôle de privilège, donc le rôle nommé ne pouvait jamais l'exercer. **Fermé** — grant sur la première (lecteur réel), policy retirée sur la seconde (aucun lecteur), garde de CI adossé au cluster. | `INV-1`, CLAUDE.md §4.3 | ✅ |
| `G-33` | Le verdict de la suite dépendait de l'environnement de la machine : `Settings` lit des noms nus et `_env_file=None` ne désactive que le fichier. Un `MISTRAL_API_KEY` exporté faisait remonter `doctor` plus sain que le déploiement. **Fermé** — fixture hermétique dérivée de `model_fields`. | Qualité du harnais | ✅ |
| `G-34` | Les huit facettes `Bloqué` publiées se prouvaient en deux parties (refus + appel légitime) et **aucune** ne portait de contrôle négatif au sens d'`AD-30.3` — la garde retirée, la même action atteint l'aval. Trois existaient sans être déclarées, deux portaient sur un **autre outil** (`M-11`, `M-12`), une ne vérifiait qu'une requête et non la fuite (`M-10`), trois manquaient. **Fermé** — troisième sens obligatoire dans le vocabulaire du marqueur et du générateur. | `AD-26`, `AD-30.3`, `CM-7` | ✅ |
| `G-35` | Le chemin de décision pouvait joindre le réseau : `api/security.py` portait l'authentification de la console (JWT Supabase vérifié contre un **JWKS distant**, donc `httpx`) et celle de l'agent (jeton de passerelle, Postgres seul) dans le même module. Le proxy LLM important le second héritait du premier, et la revendication « le produit décide hors ligne » devenait fausse par un import. **Fermé** — `api/gateway_auth.py` sépare les deux, et `scripts/audit_sovereignty.py` échoue si la frontière se refranchit. | `AD-25`, `FR-176`, `SM-15` | ✅ |
| `G-36` | La table des contrôles orchestrés d'`ARCHI-SOUVERAINE` §5 en recensait quatre ; le registre en publiait **cinq**. `M-14 / détection de fuite du prompt sur l'egress` était `Orchestré` sans que la question du substitut lui ait jamais été posée — une table tenue à la main perd une ligne sans que rien ne le signale. **Fermé** — le recensement est dérivé du registre (`AD-30`), et `FR-178` déclasse au parse toute ligne `Orchestré` sans substitut nommé. | `FR-178`, `AD-30` | ✅ |
| `G-37` | Le mode observation n'existait que sur le proxy LLM : un même tenant obtenait deux comportements selon la porte empruntée, et un client dont la policy n'est pas écrite ne pouvait pas se donner de fenêtre sur le gateway MCP — le chemin **obligatoire**. **Fermé** — `AD-27` s'applique aux deux ingestions. Quatre exclusions tenues et testées sur le chemin MCP : irréversible et envoi externe (`monitor.observes`), escalade de taint (signal d'attaque, pas immaturité de policy), RBAC et quarantaine d'intégrité (antérieurs à la policy), absence d'identité ou magasin injoignable (`AD-10`). Aucune revendication `Bloqué` publiée n'en devient conditionnelle : chacune repose sur une classe jamais observée ou sur une garde que l'observation n'atteint pas. | `AD-27`, `AD-28`, M-06, M-12 | ✅ |

### 8.2 Recoupement avec les 34 correctifs de PLAN-REVIEW

La strate absorbe les 34 correctifs contraignants (`QO-1`). Additionnés aux 21 écarts, cela ferait 55 items — mais le recoupement est réel, et surtout **trois correctifs entrent en conflit frontal avec la direction v2.5**. Ce sont eux qui comptent : le reste est de l'arithmétique.

**Recouvrements directs — cinq paires, un seul travail à faire :**

| Écart | Correctif | Sujet commun |
|---|---|---|
| `G-03` | `INV-4` | Le taint indexé sur un `session_id` déclaré par l'agent |
| `G-06` | `EXH-4` | Classification déterministe des outils exécuteurs |
| `G-07` | `INV-5` | L'approbation par canal, rejouable par tout lecteur du message |
| `G-11` | `EXH-2` | Fail-open sur clé de contrainte inconnue |
| `G-18` | `FR-144` | Carte de couverture publiée, lignes non couvertes incluses |

Périmètre net : **≈ 50 items distincts**, pas 55.

**Trois conflits à arbitrer — la revue contredit la direction produit :**

| Conflit | Ce que dit la revue | Ce que demande la strate v2.5 |
|---|---|---|
| **Référentiels** | `EXH-7` : ne livrer que le mapping EU AI Act, et différer ISO 42001 / NIST / SOC 2 / RGPD — « une correspondance qu'un auditeur rejette est pire que pas de correspondance », elle exige la revue d'un assesseur en exercice. | `G-16` ajoute **quatre familles** : OWASP LLM Top 10 + MITRE ATLAS, NIS2, DORA, ANSSI/SecNumCloud. |
| **Proxy LLM** | `EXH-6` : le rétrograder de chemin d'ingestion à simple sonde de télémétrie non bloquante, et le sortir du périmètre d'unification de `FR-1`. | C'est **là que tourne la DLP d'egress**, donc la couverture `Bloqué` de **M-10** (exfiltration / Shadow AI) — l'une des huit lignes bloquées natives. |
| **Découpage de release** | `PLAN-REVIEW.md:18-29` : v2.0-core = Epics 1-5 ; les Epics 6-13 partent en v2.1/v2.2. | **M-06** dépend de l'Epic 6 (arrêt d'urgence) et **G-03** de l'Epic 7 (plan agent, taint persisté). Deux lignes de couverture revendiquées reposent sur des epics repoussés. |

**Lecture.** Le conflit sur les référentiels est le plus simple à trancher : `EXH-7` vise les référentiels de *management* (ISO 42001, SOC 2), dont la correspondance engage un jugement d'auditeur. OWASP LLM Top 10 et MITRE ATLAS sont des taxonomies *techniques* — s'y aligner est descriptif, pas assertif, et ne présente pas le même risque. NIS2, DORA et ANSSI retombent en revanche dans la catégorie que la revue met en garde.

Le conflit sur le proxy LLM est le plus coûteux : suivre `EXH-6` sans compensation dégrade M-10 de `Bloqué` à `Détecté`, ce qui retire une ligne au compte de la démo. La sortie envisagée — séparer l'application DLP (enforcement) de la comptabilité de coûts (télémétrie) — **est validée par la lecture du code** ; voir §8.3.

### 8.3 `AR-2` / `QO-8` — tranché : le proxy est séparable, et l'inspection révèle deux défauts

**La séparation est acquise, parce que le couplage n'a jamais existé.** Dans `api/llm_proxy.py` `_forward`, la DLP d'egress est un filtre de la *requête* : elle s'exécute avant l'appel amont, sa sortie est un `403` ou un corps réécrit, et elle ne lit rien de ce que produit la télémétrie. La télémétrie (`_inspect` → `usage`, `billing`, `pricing`) s'exécute après coup, sur les seules réponses non-streamées en 200. Les deux ne partagent que la route, le `GatewayPrincipal` et l'URL de base. Abandonner la comptabilité de coûts ne touche à aucune ligne du chemin bloquant.

**Conséquence pour la carte : `M-10` conserve son `Bloqué` sur le chemin d'egress supervisé. La démo ne perd pas de ligne.** `QO-8` est close.

**Mais l'inspection trouve une troisième fonction, que `AR-2` ne nommait pas.** `_inspect` appelle `_process`, qui ré-exécute `evaluate()` sur les appels d'outils *demandés par le modèle* et retire de la réponse ceux qui ne sont pas autorisés. Ce n'est ni de la DLP ni de la télémétrie : c'est du contrôle d'action, le cœur du produit, sur un **troisième chemin d'ingestion** à côté de MCP et de `/v1/authorize`. Et il porte deux défauts, tous deux sans test :

| | Défaut | Effet |
|---|---|---|
| `G-25` | `enforce = request.headers.get("x-xsom-mode") == "enforce"` — **l'agent contrôlé décide s'il est contrôlé.** Sans l'en-tête, les verdicts sont calculés et journalisés, mais `kept` n'est jamais réassigné : tous les appels proposés repartent intacts. | Un en-tête omis — par compromission ou par simple erreur de configuration — dissout la garde. Même famille que `INV-4` (taint indexé sur un `session_id` déclaré par l'agent) : une décision de plan de contrôle prise dans le plan de données. |
| `G-26` | La branche `if streaming:` renvoie les octets amont bruts et retourne **avant** `_inspect`. | Avec `stream: true`, la garde d'appels d'outils n'existe pas. **Depuis l'option `B`, l'absence est inscrite** (`streamed_uninspected`), et la borne de l'angle mort est assertée plutôt que déduite : un test prouve que la DLP d'egress bloque bien une requête streamée. |

**Lecture de couverture, et c'est le point qui compte.** `M-10` tient parce que le blocage DLP est inconditionnel (`if scan.blocked: raise HTTPException`) et en amont du streaming : ni l'en-tête ni le mode flux ne l'atteignent. En revanche **le chemin proxy LLM ne doit être compté dans aucune revendication de contrôle d'appels d'outils** (`M-06`, `M-12`) tant que la couverture du streaming (`G-26` option `C`) n'existe pas : sur cette ingestion, la garde est absente en flux. `G-25` est fermé — l'enforcement n'est plus au choix de l'agent — et l'absence en streaming est désormais *inscrite* plutôt que silencieuse. Une revendication `Bloqué` vraie sur MCP se lirait comme vraie ici — c'est exactement ce que `AD-28` impose d'afficher, et pourquoi la carte porte le chemin d'ingestion et pas seulement le mode.

**Le correctif de `G-25` n'est pas d'inverser le défaut.** L'enforcement par défaut casserait tout agent dont la policy n'est pas encore écrite (outil inconnu → `deny` → tous les appels retirés), et c'est précisément l'écueil que l'en-tête contournait. La forme juste est celle que le blueprint spécifie déjà pour l'admin : enforcement par défaut, et **fenêtre d'observation bornée dans le temps, ouverte par le plan de contrôle**, jamais par l'appelant. `G-25` est donc un préalable au même travail que le mode observation, pas un patch isolé.

Ces trois arbitrages conditionnent le périmètre des `FR-153+` et doivent être tranchés avant l'écriture de la PRD.

---

## 9. Questions ouvertes

### Tranchées

- **QO-1 — Résolue.** La strate **absorbe les 34 correctifs contraignants** de `PLAN-REVIEW.md`, pas seulement `D-1`/`D-2`/`D-3`. La base v2 est assainie avant que la couverture ne s'y ajoute. Périmètre brut : 34 + 21 écarts, avant dédoublonnage — et le recoupement est réel : plusieurs correctifs (`INV-2`, `INV-3`, `INV-7`, `INV-12`) *sont* la crédibilité du démonstrateur, pas de l'hygiène séparée.
- **QO-2 — Résolue.** Asset générique grands comptes, réutilisable ensuite pour un dossier. Priorité aux écarts techniques ; correspondance réglementaire structurée mais non exhaustive.
- **QO-5 — Résolue.** *Produit ou mission ?* **Les deux, à dominante mission.** Certains déploiements sont autonomes, mais la majorité des clients exige une infrastructure et une compétence — donc une prestation. Le déploiement en autonomie devient la **preuve de substance** (« ce n'est pas une maquette »), pas le mouvement commercial principal.

### Ouvertes

- ~~**QO-3**~~ — **tranchée.** Le critère est la dépendance opérationnelle, pas la
  nationalité de l'éditeur (`ARCHI-SOUVERAINE` §1). Les substituts vivent dans
  `coverage/rows.yaml` et sont publiés dans la carte générée ; une ligne `Orchestré`
  sans substitut nommé est déclassée en `Hors périmètre` au parse du registre
  (`FR-178`).
- **QO-4** — La strate se démontre-t-elle sur les Epics 1-5 (v2.0-core) uniquement, ou suppose-t-elle des epics post-core (6-13) que `PLAN-REVIEW.md:18-29` a repoussés ? M-08 dépend de l'Epic 4 et M-06 de l'Epic 6.
- **QO-6** — *Conséquence de QO-5, à arbitrer.* La PRD v2 est bâtie autour de sa phrase de test de périmètre : « un inconnu s'auto-héberge en dix minutes ». Si la majorité des clients passe par une prestation, `SM-1` (médiane ≤ 10 min pour un inconnu) est une métrique de crédibilité, pas le métier. Cela ne condamne pas l'Epic 1 (26 stories) — le déploiement doit fonctionner, pour nous chez le client comme pour un évaluateur — mais cela change ce que « terminé » y signifie, et donc combien de ces 26 stories la strate doit porter.
- **QO-7 — Partiellement résolue, sans préjuger.** Le moteur (`core/profiles.py` + `core/triage.py`) est ce que les deux réponses appellent ; seule la surface diffère. `xsom triage` sert le livrable de mission aujourd'hui, sans rien fermer : un questionnaire de console appellerait le même `diagnose()`. La question qui reste est commerciale — faut-il exposer le diagnostic en autonomie pour générer des leads — et elle ne bloque plus aucun code.
