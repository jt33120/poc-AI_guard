# Gates de qualité et supply chain

`@xsom/developer-guard-runner/quality-gates` accepte un reçu SARIF seulement s’il porte le commit, la version du moteur et un verdict borné. Il n’exécute aucun script du dépôt analysé. Le gate local est informatif ; le merge gate doit être appliqué par le CI protégé du client, donc un `--no-verify` local ne le contourne pas.

Avant d’ajouter un moteur, documenter sa version, licence, maintenance, flux réseau et le corpus synthétique de validation. Les choix candidats restent dans `DEVELOPER-THREAT-MAPPING.md` et ne sont pas des intégrations.

## Contrat livré

- entrée SARIF `2.1.0` stricte, bornée et attribuée à un moteur ;
- refus d’un reçu mal formé, d’un commit différent ou d’un résultat de niveau `error` annoncé comme réussi ;
- génération par `scripts/create-quality-receipt.mjs` et contre-vérification indépendante par `scripts/verify-quality-receipt.mjs` ;
- fixtures `quality-pass.json`, `quality-fail.json` et `quality-malformed.json` ;
- job GitHub Actions créé après `npm run verify`, lié à `${GITHUB_SHA}`. Un hook Git contourné par `--no-verify` ne supprime pas ce job serveur.

La protection de branche qui rend ce job obligatoire reste un réglage GitHub externe au dépôt. Son existence doit être constatée avant de dire « merge impossible sans gate ».

## Choix d’un moteur

Le dépôt fournit l’interface SARIF et n’impose pas encore un SAST/SCA tiers. Pour le pilote, retenir au plus un moteur par fonction après validation de sa licence de redistribution, de son exécution hors ligne, de ses flux réseau, de sa maintenance et de son taux de faux refus sur un corpus synthétique. Exécuter le moteur dans une zone sans credentials de production et sans lancer les scripts du dépôt analysé.
