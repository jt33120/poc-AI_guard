# Déploiement administré

Le VSIX seul est un profil Local : son hook est visible et retirable par l’utilisateur. Le profil Équipe requiert la distribution MDM des scripts, la configuration administrée de Codex ou Claude lorsqu’elle existe, et l’écriture protégée du dossier de politiques.

Le profil Renforcé est livré pour pilote Linux uniquement. Il utilise un compte sans privilège, un montage de projet explicite, aucun montage du home ni socket Docker, et une liste de sorties réseau appliquée par l’environnement. Le script de lancement refuse de démarrer si `bwrap` n’est pas présent ; il ne simule jamais une isolation avec une liste de commandes.

Windows et macOS peuvent recevoir des scripts et politiques administrés, mais ne sont pas qualifiés Renforcé par ce dépôt. WSL, Remote SSH et Dev Containers constituent des environnements d’exécution séparés.

## Artefacts

| Plateforme | Artefact | Effet vérifiable localement | État |
|---|---|---|---|
| Linux | `deploy/developer-guard/linux/install-managed-policy.sh`, `requirements.toml`, `run-isolated.sh`, `policy.json` | politique Codex gérée, fichiers en lecture seule, lancement Bubblewrap sans home ni socket Docker | référence pilote ; essai réseau physique requis |
| Windows | `deploy/developer-guard/windows/install-managed.ps1` | stratégie VS Code machine, VSIX bootstrap, exigences Codex sous ProgramData et ACL administrateur | profil Équipe ; isolation système non qualifiée |
| macOS | `deploy/developer-guard/macos/com.microsoft.VSCode.mobileconfig`, `install-managed.sh`, `requirements.toml` | extension autorisée/imposée par profil, exigences Codex installées en emplacement géré | profil Équipe ; application MDM et isolation non qualifiées |

Les politiques VS Code d’entreprise et `AllowedExtensions` doivent être appliquées par l’administrateur du poste ; le VSIX ne s’accorde pas lui-même ces privilèges. De même, les exigences Codex sont un mécanisme de configuration gérée : leur présence dans le dépôt ne prouve pas leur application sur un poste.

## Validation avant pilote

1. Installer sur un poste de test administré, sans données réelles, puis vérifier le propriétaire et les permissions de chaque fichier.
2. Ouvrir un profil VS Code neuf et confirmer la version exacte de l’extension et de l’hôte.
3. Exécuter les trois observations de `EVIDENCE-PROTOCOL.md` avec un secret et un récepteur synthétiques.
4. Pour Linux Renforcé, tenter séparément la lecture d’un fichier exclu, l’accès au socket Docker, un envoi direct, un envoi depuis Python/Node et un processus enfant.
5. Couper le runner : les restrictions système doivent rester fermées. Si elles s’ouvrent, le profil n’est pas Renforcé.
6. Enregistrer OS, version, SHA de l’artefact et résultat. Une cellule non testée reste « non vérifiée ».

Tests structurels locaux : `uv run pytest tests/test_managed_environment.py --no-cov -q`, `bash -n deploy/developer-guard/linux/*.sh` et `plutil -lint deploy/developer-guard/macos/com.microsoft.VSCode.mobileconfig` sur macOS.
