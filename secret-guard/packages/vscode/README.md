# 🛡️ xSOM Secret Guard

**Vos idées à l’IA. Vos secrets restent à l’abri.**

Un mot de passe dans un extrait de configuration, une clé API dans un copier-coller…
Secret Guard analyse vos prompts localement et demande à votre assistant de bloquer
les contenus sensibles détectés, avant leur traitement par le modèle.

**Analyse locale · Passerelle xSOM optionnelle · Intégré à VS Code**

### Purge transparente pour Claude Code (0.8.0, Basic, sans compte)

En mode **Expurger**, Secret Guard propose une fois d'activer la purge transparente
(aussi : palette › « Secret Guard: Activer la purge transparente (Claude Code) »).
Un relais démarre sur ce PC, sur `127.0.0.1` derrière une adresse aléatoire, et
Claude Code y envoie ses requêtes. Le relais retire les secrets détectés, revérifie,
puis transmet à Anthropic ; Claude affiche « Prompt purgé avant envoi » et la session
continue. Rien ne part chez xSOM. Ouvrez une nouvelle session Claude après
l'activation.

Ce que le relais ne sait pas nettoyer reste bloqué par le hook : caractères
invisibles, analyse incomplète, et images ou captures d'écran, sauf si vous avez
choisi **Activer et laisser passer les captures d'écran** (elles partent alors sans
analyse, avec un message à chaque fois). Copilot et Codex ne permettent pas de
changer leur adresse d'envoi : pour eux, Secret Guard bloque.

### Réglage sur mesure xSOM (0.7.0, édition Entreprise)

En plus des règles intégrées, Secret Guard applique le **réglage de votre
organisation** : des règles calibrées et signées par xSOM pour vos propres données
(identifiants clients, noms de code de projets, serveurs internes). Ce n’est pas une
option à cocher : le réglage se fait avec xSOM, puis arrive sur le poste raccordé.

- Il est vérifié hors ligne avec la clé d’autorité xSOM intégrée à l’extension :
  un réglage modifié, destiné à une autre organisation ou plus ancien est refusé.
- Il n’ajoute que des détections : les règles intégrées restent actives, refus ou
  panne compris. Un réglage expiré reste appliqué et l’état le signale.
- L’analyse reste locale, déterministe, sans LLM ni réseau, et bornée : si un
  texte dépasse le budget d’analyse, l’envoi est bloqué (« analyse incomplète »).
- Expurger masque aussi ces détections dans `@secretguard` et le presse-papiers,
  sous le nom de la règle, par exemple `<REDACTED_Identifiant_client_ACME>`. Le relais
  Claude ne connaît pas ce réglage : un message concerné est alors arrêté, pas
  délégué. La valeur n’est jamais affichée ni journalisée.

Poste sans accès à la plateforme (édition Renforcé) : **Secret Guard: Importer un
réglage xSOM (poste hors ligne)** vérifie et applique un fichier de réglage remis par
xSOM, avec exactement les mêmes contrôles.

L’infobulle et le centre de protection indiquent l’état en quelques mots :
« Réglage xSOM · v3 · 12 règles · jusqu’au 01/09/2027 », « Réglage refusé :
signature invalide », ou « Aucun réglage sur mesure » avec un lien pour en
demander un.

### Raccordement xSOM (0.3.0)

Le centre de protection propose **Raccorder ce poste à xSOM**. Un jeton de passerelle
dédié est conservé dans le coffre VS Code. Seul `ANTHROPIC_BASE_URL` est configuré :
la connexion Claude existante reste utilisée, y compris l’abonnement claude.ai.
Le format API du relais n’impose pas une facturation API. Nouvelle session requise.

La passerelle remplace les secrets détectés par `XXX` avant le fournisseur. Le texte
original reste dans votre champ et transite par votre passerelle de confiance.
L’audit asynchrone est limité aux métadonnées : poste, date, résultat, compteurs.
Aucun prompt, secret ni empreinte de secret dans ces événements. Consultation dans
la console xSOM → **Extension VS Code**. L’audit de l’extension ne remplace pas une
observation de la passerelle. Pièces jointes non inspectables : refus sans repli.

Le backend du relais prend désormais en charge Markdown, PNG statiques (OCR) et
PDF texte/scannés. Seul le texte extrait puis nettoyé est transmis au fournisseur :
pas le fichier original ni son rendu visuel. L'extraction se fait sur le backend
xSOM, pas nécessairement sur ce poste. Cette capacité nécessite son redéploiement
et ne couvre pas les pièces des conversations natives Codex/Copilot.

### Relier ce poste à l’entreprise (0.8.1)

1. Lancez **Secret Guard: Relier à mon entreprise** depuis la palette de commandes
   ou le centre de protection.
2. Indiquez l’adresse de votre console xSOM. Un code valable dix minutes ouvre
   **Dev Guard → Relier un poste** dans votre navigateur.
3. Connectez-vous avec un compte administrateur de l’entreprise, vérifiez le code
   et renseignez le nom du poste, le membre et l’équipe, puis confirmez.

Le poste apparaît dans **Dev Guard → Postes de l’équipe**. L’extension envoie son
état toutes les trente secondes pendant que VS Code est ouvert. Le tableau montre
l’OS, la version, le mode de protection et le dernier contact. « Contact récent »
signifie moins de deux minutes ; il ne certifie pas l’activité de chaque assistant.
Le rattachement fonctionne sans Claude et conserve le mode de protection choisi.

L’identifiant est propre à cette installation/profil VS Code, pas une empreinte
matérielle du Mac. Aucun nom de machine, chemin de projet, prompt ou secret n’est
collecté automatiquement. Le nom, le membre et l’équipe sont déclarés lors de la
confirmation. La clé du poste est générée localement et conservée dans le coffre
VS Code ; seul le code de confirmation apparaît dans le navigateur.

**Déconnecter ce poste de l’entreprise** révoque sa clé, libère sa place et garde
son historique. La connexion réseau est nécessaire pour confirmer cette révocation.
Un nouveau rattachement à la même entreprise retrouve le poste ; il ne le déplace
pas automatiquement vers une autre entreprise. La détection locale reste active.

La console et les API doivent être à jour (migration `0040_extension_pairing.sql`
et `EXTENSION_API_PUBLIC_URL` côté console). L’aperçu local sans backend affiche
explicitement un inventaire non connecté et ne permet pas de rattachement réel.

## Un poste de travail plus serein

- 🛡️ **Contrôles rapides** : cliquez sur Secret Guard dans la barre d’état,
  puis sur **Ouvrir** pour afficher le centre de protection.
- 🔎 **Vérification à la demande** : scannez une sélection, le document ouvert
  ou le presse-papiers. Retrouvez aussi les scans dans le clic droit de l’éditeur.
- 📋 **Copie expurgée** : lorsqu’elle est disponible, récupérez une version dont
  les valeurs sensibles ont été retirées, puis analysée à nouveau.
- 🔒 **Mode prudent par défaut** : les secrets reconnus et les détections ambiguës
  sont bloqués par les hooks automatiques.
- 🎨 **À votre image** : interface adaptée aux thèmes clairs, sombres et à fort
  contraste de VS Code, avec navigation au clavier.

## Installer, ouvrir, vérifier

### Choisir le comportement

Survolez **Secret Guard** dans la barre d’état : le panneau de contrôle permet
de changer de niveau (1 Avertir, 2 Expurger, 3 Bloquer), de vérifier le
presse-papiers ou le document, de voir le dernier résultat (métadonnées
seulement, jamais la valeur) et de raccorder la passerelle xSOM. Le bouton
**Ouvrir**, en haut à droite, affiche la page complète de configuration. Vous
pouvez également lancer **Secret Guard → Changer de mode**, ou ouvrir les
paramètres **Secret Guard: Mode**. Le choix est commun aux assistants de cette
installation.

| Mode                         | Comportement                                                                                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔒 Bloquer (défaut)          | Arrête l’envoi en cas de secret détecté, de contenu ambigu ou d’analyse incomplète.                                                                               |
| 🧹 Expurger                  | Dans `@secretguard`, masque les secrets puis rescane avant l’envoi. Dans les autres chats, arrête l’envoi ; un clic sur Secret Guard expurge le presse-papiers.   |
| 👁️ Avertir et laisser passer | Signale les détections et transmet le texte original, secrets compris, sans nettoyage. Dure 15 min, 1 h, 4 h ou 8 h au choix, puis retour automatique à Expurger. |

En mode **Expurger**, un clic sur **Secret Guard** dans la barre d’état expurge
le presse-papiers : copiez votre message, cliquez, puis collez directement dans
votre chat. La barre d’état confirme le résultat pendant quelques secondes
(« Presse-papiers expurgé · 2 secrets masqués », « aucun secret » ou, en rouge,
« non expurgé »). Le presse-papiers n’est remplacé que si la version expurgée
est rescannée sans détection ; sinon il reste intact et une alerte explique
pourquoi. Dans les modes Bloquer et Avertir, le même clic vérifie le
presse-papiers sans le modifier ; si un secret s’y trouve, l’alerte propose
**Expurger**. Le survol ouvre toujours le panneau de contrôle.
Les hooks natifs actuels ne remplacent pas le prompt original par une copie nettoyée.

**Avertir** dure 15 minutes, 1 heure, 4 heures ou 8 heures (le travail d’une nuit, par
exemple) : VS Code demande la durée à l’activation,
le panneau de contrôle permet d’en changer pendant qu’il tourne,
affiche l’heure de fin dans la barre d’état, puis repasse en Expurger. Le hook
applique lui-même cette limite, même si VS Code est fermé entre-temps.

Sur un poste de l’édition Équipe, votre organisation peut plafonner Avertir
(4 heures, 1 heure ou 15 minutes) ou l’interdire, dans sa politique signée.
Seules les durées permises sont proposées ; le panneau l’indique (« plafonné à
1 h par votre organisation ») et, si Avertir est interdit, sa tuile reste
visible mais inactive. Le hook applique ce plafond lui-même, à partir de la
politique vérifiée avec la clé épinglée ; une politique absente ou altérée
n’élargit rien.

Après un changement de mode, ouvrez une nouvelle session de votre assistant.
Codex peut demander de valider le hook actualisé. Le mode Avertir ne bloque pas
les erreurs d’analyse, mais un appel de hook invalide reste refusé. Les pièces
jointes ne sont pas prises en charge dans `@secretguard`.

### Installation

1. Installez l’extension : elle configure les hooks locaux des assistants compatibles.
2. Cliquez sur **Secret Guard** dans la barre d’état, ou lancez
   **Secret Guard: Ouvrir le centre de protection**.
3. Pour Codex, utilisez **Finaliser Codex** et approuvez le hook xSOM dans `/hooks`.
4. Confirmez le blocage dans chaque assistant avec une valeur fictive, puis vérifiez
   qu’un message ordinaire passe normalement.

```text
Analyse cette configuration : PASSWORD=XXX
```

Le centre de protection n’affiche ni prompts ni valeurs détectées. Il ne charge
aucune ressource distante et n’exécute aucun JavaScript dans sa vue.

### Désinstallation

Désinstaller l’extension retire aussi ses hooks de Claude Code, Codex et GitHub
Copilot : dès le message suivant, le hook constate que VS Code ne liste plus
l’extension, retire ses propres entrées des réglages des assistants (les hooks
des autres outils restent), supprime son script et laisse passer le message. Au
redémarrage suivant de VS Code, le script de désinstallation retire les entrées
qu’aucun assistant n’a déclenchées entre-temps. Tant que la désinstallation
n’est pas prouvée (index de VS Code illisible, installation de développement),
la protection reste active.

## Integration details & coverage

Local-first prompt secret detection. The primary surface is automatic:

- native pre-submit hook installers for GitHub Copilot, Claude Code, and Codex;
- the `@secretguard` chat participant, which owns and scans its request before using the selected model;
- explicit scan commands for the current selection, document, or clipboard.

The extension does not inject DOM or CSS into another assistant's Send button.
That would be fragile and keyboard-bypassable. The visible `$(lock)` status is an
indicator; the actual block runs in the host's native pre-submit lifecycle. It has
no network request for local detection. Connecting xSOM explicitly enables the
metadata-only audit and the gateway relay described above. Development requires
Node.js 22.13 or newer.

On first startup, the extension automatically verifies the copied runner with
clean and blocking canaries, then merges one owned
hook into the supported native host configurations. Existing settings and hooks
are preserved. VS Code 1.133–1.136 can protect Claude Code and Codex;
native VS Code/Copilot prompt hooks are added only on VS Code 1.137 or newer.
The dashboard's Finaliser Codex action opens Codex CLI to review and trust only the xSOM hook, then
the user starts a new Codex chat. Codex deliberately requires this one explicit
approval because user hooks execute outside its sandbox; the extension never
bypasses that control. Set `secretGuard.hook.autoEnable` to `false` for manual
installation.

`Secret Guard · Prêt` means that the supported user configurations, runner
bytes, and local canaries match. It does not attest Codex trust, remote execution,
or MDM policy. Clicking the status opens the protection dashboard, including
the Codex finalization action. User-level
hooks remain removable, VS Code hooks are Preview, and Remote/WSL/Container
topologies can execute on a different filesystem. Zero-touch enterprise
enforcement requires managed/system configuration.

`secretGuard.mode` controls blocking, redaction, or observation. A redacted send
is valid only when the exact redacted content rescans to ALLOW. Native hooks
cannot replace the prompt and therefore block sensitive content in redact mode.
The former `hook.warnMode=allow` setting was removed in 0.6: hooks written with
it now block like `block`. Observe mode permits original text with findings or
an incomplete analysis for one hour, after which the hook itself applies redact
mode; malformed hook envelopes remain refused.
