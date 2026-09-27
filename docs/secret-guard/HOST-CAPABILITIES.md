# Matrice de capacités des hôtes

État : implémentation locale du 22 septembre 2026. Une case `non vérifiée` ne doit pas être présentée comme une interception.

| Hôte | OS / environnement | Événements configurés | Décision locale | État |
|---|---|---|---|---|
| Claude Code | macOS / Windows / Linux local | `UserPromptSubmit`, `PreToolUse` pour `Read` | secret, ressource sensible et politique signée | test de contrat local ; session fournisseur à qualifier |
| Codex | macOS / Windows / Linux local | `UserPromptSubmit` | secret ; politique disponible seulement sur les événements réellement fournis | test de contrat local ; hooks d’actions réels à qualifier |
| GitHub Copilot / VS Code | VS Code >= 1.137 | prompt lorsque le contrat Preview est disponible | scanner Secret Guard | non vérifié comme contrôle d’actions |
| Remote SSH, WSL, Dev Containers, Codespaces | tous | dépend de l’installation côté exécution | aucun statut vert par héritage du poste hôte | non supporté dans ce lot |

Le runner refuse les actions sensibles si l’adaptateur ne déclare pas la capacité testée. Il ne change jamais un échec ou un timeout de hook en permission. L’installation utilisateur peut être retirée ; un profil renforcé réclame une gestion de poste et une isolation système distinctes.
