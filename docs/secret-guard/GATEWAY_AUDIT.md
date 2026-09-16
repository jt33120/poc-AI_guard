# Secret Guard — passerelle et audit des postes

Périmètre accepté : conserver le chat de l’assistant, nettoyer avant transmission
au fournisseur, enregistrer le poste et synchroniser les événements sans attente
réseau sur les commandes locales. La modification du champ de saisie est différée.

## Contrat

- Un jeton de passerelle dédié par installation, conservé dans VS Code SecretStorage.
- Une installation UUID liée au jeton et au tenant côté serveur ; aucune identité
  tenant, provenance serveur ou preuve d’envoi acceptée du client.
- Premier adaptateur : Claude Code, API Anthropic Messages. Le relais conserve
  l’authentification de l’assistant, sans lire ses fichiers d’identifiants. Le format
  de transport API ne signifie pas une facturation API : seul ANTHROPIC_BASE_URL
  est modifié, aucun ANTHROPIC_AUTH_TOKEN/API_KEY/apiKeyHelper n’est installé.
  Une connexion claude.ai existante conserve donc son abonnement selon la
  [documentation Claude](https://code.claude.com/docs/en/llm-gateway#subscriptions-and-gateways).
  Authorization et anthropic-beta sont relayés en mémoire ; jamais persistés.
- Un relais local lié à 127.0.0.1 avec capacité aléatoire protège l’accès au jeton
  xSOM. Seules les routes Anthropic prévues sont relayées, vers une destination
  configurée en HTTPS (HTTP uniquement pour une passerelle de développement locale).
- Le chemin extension de la passerelle nettoie systématiquement secrets et valeurs
  ambiguës en XXX, puis rescane. Entrée invalide/incomplète : refus sans relais.
  La politique DLP du tenant peut imposer un refus supplémentaire.
- Les hooks continuent de protéger les sessions non raccordées. Un hook ne délègue
  au relais que si son environnement désigne exactement le relais local géré vivant.
- Les événements client sont des observations déclarées. Les événements passerelle
  attestent séparément le nettoyage et l’acceptation HTTP par le fournisseur.
- Journal append-only chaîné, métadonnées bornées uniquement : pas de prompt,
  secret, empreinte de secret, chemin de fichier ou clé fournisseur.
- File locale bornée, identifiants idempotents, retries, reconnexion ; les pertes par
  saturation sont comptées. Échec de synchronisation visible, sans bloquer les scans.

## Validation

Tests synthétiques du corps réellement reçu par un faux fournisseur, streaming,
authentification et révocation, isolation RLS, déduplication, intégrité du journal,
reprise hors ligne et absence de contenu dans les événements. Un test local de
passerelle ne prétend pas attester une session Claude réelle.

## Mise en service

1. Déployer la migration `0034_extension_devices.sql`, puis le backend actualisé :
   plan `llm` pour l’ingestion et le proxy, plan `console` pour la lecture, ou `all`.
   Le tenant doit disposer des capacités `llm_proxy` et `dlp` et d’un quota disponible.
2. Déployer le frontend actualisé : rubrique **Extension VS Code**, `/extensions`.
3. Administration → Accès : créer un jeton de passerelle dédié au poste, nommé
   avec un alias technique (pas besoin de nom d’utilisateur).
4. Installer le VSIX 0.3.0. Centre Secret Guard → **Raccorder ce poste** : fournir
   l’URL HTTPS du **plan LLM** xSOM et le jeton. Ce jeton n’est pas une clé Anthropic.
5. Ouvrir une nouvelle session Claude déjà connectée à l’abonnement. Tester avec
   `PASSWORD=synthetic-demo-only` puis un texte bénin. Vérifier dans `/extensions`
   les événements **passerelle** `redacted`, puis `upstream_accepted`. Cela consomme
   l’usage normal de l’abonnement : aucun test réel n’est lancé automatiquement.
6. Pour revenir en arrière : **Déconnecter la passerelle xSOM** puis nouvelle session.
   Aucun autre paramètre Claude n’est supprimé. Révoquer le jeton dans Administration
   coupe les futurs appels du poste ; les anciennes preuves restent conservées.

## Limites explicites

- Windows/local : première surface visée, pas de VS Code Remote dans ce lot.
- Pas de réécriture du champ de saisie ni du transcript local Claude.
- Pas de promesse pour Codex Responses, Copilot, Windsurf ou Claude web.
- L’audit local couvre les scans manuels, `@secretguard`, les changements de mode
  et tests locaux. Les hooks d’assistants non raccordés ne remontent pas tous leurs
  refus : ce lot ne constitue pas un inventaire exhaustif des prompts du poste.
- Fichiers/images non inspectables, corps > 1 MiB, JSON invalide, pensée signée
  nécessitant une modification : refus explicite. Aucun repli direct au fournisseur.
- L’audit local est borné à 1 000 événements et transmis par lots de 100 toutes
  les 30 secondes ; il ne contient ni contenu, ni hachage des valeurs détectées.
- Les déclarations du poste ne constituent pas une attestation matérielle du PC.
  Le chaînage est vérifiable dans la base, pas ancré chez un tiers de confiance.
- La validation locale ne remplace pas un essai sur la passerelle déployée avec
  une vraie session VS Code Claude. Les tests PostgreSQL exigent un serveur de test.

## Recherche de l’URL (16 septembre 2026)

Le checkout contient `railway.json` mais aucun domaine Railway effectif et aucun
fichier `.env` renseigné pour ce déploiement. La documentation ne donne que
`https://<your-backend-host>` ; `frontend/lib/config.ts` retombe sur
`http://localhost:8000` pour le **plan console**, qui n’est pas nécessairement le
plan LLM. Aucun service trouvé sur les ports locaux usuels 8000–8002/3000/5432.
Ne pas utiliser ce défaut comme preuve qu’une passerelle est active. Retrouver le
domaine du service LLM dans le déploiement Railway ou auprès de son opérateur.

## Résultats locaux (16 septembre 2026)

- 314 tests Vitest réussis ; compilation et contrôle TypeScript/ESLint réussis.
- 2 contrats réussis dans VS Code installé, sous profil de test isolé : activation,
  commandes (dont raccordement/déconnexion), manifeste. Ce n’est pas une session
  Claude réelle et aucun abonnement n’a été sollicité.
- 4 tests d’intégration réussis sur PostgreSQL 16.15 temporaire : inscription et
  liaison du jeton, RLS inter-tenants, déduplication, révocation, append-only,
  chaîne vérifiable, nettoyage avant faux fournisseur, OAuth/beta, streaming et refus.
- 17 tests de nettoyage/contrat d’événements et 6 du proxy console réussis.
- Les 20 tests du proxy existant et les 16 de correspondance des capacités passent.
  Le double de réponse SSE du premier essai était déjà consommé ; il a été remplacé
  par un vrai flux asynchrone simulé, puis les 4 tests d’intégration ont été rejoués.
- 2 tests navigateur de `/extensions` réussis avec Edge : séparation des sources,
  sélection du poste, vérification de chaîne et obligation de session.
  L’enveloppe `npm run test:e2e` reste bloquée par le contrôle **préexistant** de
  fraîcheur `design-system/tokens.css` ; les tests ciblés ont été exécutés directement.
- VSIX 0.3.0 construit et inspecté : 8 fichiers autorisés, 64 685 octets,
  SHA-256 `cd3a5f6b100b1ba4e54694cf7e0fa63b04677572b5b8a02cf346497efd0758b6`.
  Artefact : `secret-guard/packages/vscode/dist/xsom-secret-guard-vscode.vsix`.

La compilation backend utilise la confiance TLS du système pour le téléchargement
des outils de test ; aucune vérification de certificat n’a été désactivée.
Le harnais PostgreSQL est désormais portable Windows (pas de `pwd`, pas d’attente
sur un pipe hérité, options psql avant la connexion). Aucun serveur système installé.
La migration, le backend et la console n’ont pas été déployés sur un service réel,
et le VSIX n’a pas remplacé l’extension de la fenêtre habituelle.
