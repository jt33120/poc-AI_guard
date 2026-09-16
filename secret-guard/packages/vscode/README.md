# 🛡️ xSOM Secret Guard

**Vos idées à l’IA. Vos secrets restent à l’abri.**

Un mot de passe dans un extrait de configuration, une clé API dans un copier-coller…
Secret Guard analyse vos prompts localement et demande à votre assistant de bloquer
les contenus sensibles détectés, avant leur traitement par le modèle.

**Analyse locale · Passerelle xSOM optionnelle · Intégré à VS Code**

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

## Un poste de travail plus serein

- 🛡️ **Centre de protection** : cliquez sur Secret Guard dans la barre d’état
  pour retrouver vos assistants, leur configuration et vos actions rapides.
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

Survolez **Secret Guard** dans la barre d’état : le panneau de contrôle permet de
changer de niveau (1 Avertir, 2 Expurger, 3 Bloquer) sans ouvrir de page. Il
affiche aussi l’état de chaque assistant, les vérifications du presse-papiers et
du document, le dernier résultat (métadonnées seulement, jamais la valeur) et la
passerelle xSOM. Vous pouvez également cliquer sur **Secret Guard → Changer de
mode**, ou ouvrir les paramètres **Secret Guard: Mode**. Le choix est commun aux
assistants de cette installation.

| Mode                         | Comportement                                                                                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔒 Bloquer (défaut)          | Arrête l’envoi en cas de secret détecté, de contenu ambigu ou d’analyse incomplète.                                                          |
| 🧹 Expurger                  | Dans `@secretguard`, masque les secrets puis rescane avant l’envoi. Dans les autres chats, arrête l’envoi et guide vers un nettoyage manuel. |
| 👁️ Avertir et laisser passer | Signale les détections et transmet le texte original, secrets compris, sans nettoyage.                                                       |

**Vérifier le presse-papiers** est une commande VS Code, pas un skill : copiez
votre message, lancez la commande depuis Secret Guard, choisissez **Copier la
version expurgée** si elle est proposée, puis collez le résultat dans votre chat.
Les hooks natifs actuels ne remplacent pas le prompt original par une copie nettoyée.

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

## Integration details & coverage

Local-first prompt secret detection. The primary surface is automatic:

- native pre-submit hook installers for VS Code/Copilot, Claude Code, Codex, and
  Windsurf Cascade;
- the `@secretguard` chat participant, which owns and scans its request before using the selected model;
- explicit scan commands for the current selection, document, or clipboard.

The extension does not inject DOM or CSS into another assistant's Send button.
That would be fragile and keyboard-bypassable. The visible `$(lock)` status is an
indicator; the actual block runs in the host's native pre-submit lifecycle. It has
no network request for local detection. Connecting xSOM explicitly enables the
metadata-only audit and the gateway relay described above. Development requires
Node.js 22.13 or newer.

On first startup, the extension automatically verifies the copied runner with
clean and blocking canaries for both supported envelopes, then merges one owned
hook into the supported native host configurations. Existing settings and hooks
are preserved. VS Code 1.133–1.136 can protect Claude Code, Codex and Windsurf;
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
The deprecated `hook.warnMode=allow` still allows only WARN findings until an
explicit new mode is selected. Observe mode permits original text with findings
or an incomplete analysis; malformed hook envelopes remain refused.
