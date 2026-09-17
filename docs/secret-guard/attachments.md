# Pièces jointes : lecture contrôlée, livraison texte

Cette évolution étend explicitement le périmètre V0 (auparavant sans OCR/PDF).
Elle s'applique aux requêtes du **relais Claude raccordé** :
`POST /proxy/extension/anthropic/v1/messages` et `/v1/messages/count_tokens`.
Le panneau n'est pas refondu ici. L'analyse des pièces est obligatoire sur ce chemin
de nettoyage : aucun bouton client ne permet d'envoyer un original non inspecté.

## Ce qui fonctionne

- Markdown / texte UTF-8 : blocs `document`, source `text` ou `base64`, MIME
  `text/markdown` ou `text/plain`. Le contenu Markdown n'est ni exécuté ni rendu.
- PNG statique : bloc `image`, source `base64`, MIME `image/png` ; OCR local au backend.
- PDF : bloc `document`, source `base64`, MIME `application/pdf` ; extraction du texte
  et OCR de chaque page, y compris les PDF scannés ou mêlant texte et captures.
- Parcours des messages, de leur historique et des pièces imbriquées dans les
  résultats d'outils. Les chaînes de contexte déjà incluses restent inspectées.

L'extraction est suivie du détecteur de secrets existant, de leur remplacement par
`XXX` et d'une nouvelle inspection. Le titre et le contexte textuels sont également
nettoyés. Le bloc est remplacé par un bloc `text` : **le fournisseur ne reçoit jamais
le PNG/PDF original**, même sans secret détecté. Les pixels, la mise en page, les
objets intégrés et les métadonnées binaires ne sont donc pas transmis. Ce n'est pas
une édition visuelle de l'image/PDF ; les tâches de compréhension graphique perdent
ce contenu. Un écran vide ou sans texte lisible est refusé, pas annoncé « protégé ».

Les pièces originales transitent jusqu'au backend xSOM raccordé pour l'extraction.
« OCR local » signifie local **à ce backend**, pas nécessairement au poste de travail.
Pas d'API vision/LLM, téléchargement de modèle, écriture de pièce temporaire ni
journalisation du contenu. ONNX Runtime a sa télémétrie désactivée avant les sessions.
L'audit conserve seulement compteurs, formats, livraison `text_only` et codes d'erreur.

## Limites explicites

| Ressource | Plafond |
| --- | --- |
| Enveloppe HTTP, base64 compris | 16 Mio (pont local et API) |
| Nombre de pièces, historique compris | 4 |
| Pièce décodée / total décodé | 6 Mio / 10 Mio |
| Texte extrait par pièce | 256 Kio |
| Texte inspecté / requête nettoyée | 1 Mio |
| Pages par PDF | 12 |
| Pixels par PNG / page PDF rendue | 12 millions |
| Rendu PDF | 144 dpi, sans recadrage |
| Budget d'extraction par requête | 45 secondes |
| Workers concurrents par processus API | 2 ; surcharge refusée |

Le worker est un processus distinct tué et récolté à l'expiration, sans shell ni
identifiants fournisseur hérités. Sous Linux : plafonds OS de 3 Gio et 40 secondes
CPU par worker. Sous Windows : bornes de temps, taille, pages et pixels, mais pas de
plafond mémoire OS. Ce processus séparé **n'est pas une sandbox de sécurité** ; les
parseurs natifs nécessitent mises à jour et isolation du conteneur de production.

Toute erreur/refus d'extraction bloque la requête entière avant le fournisseur
(HTTP 422, `detail.code=attachment_*`). Une enveloppe trop grande donne HTTP 413.
PDF chiffrés, PNG animés, données corrompues, format différent, OCR de confiance
inférieure à 0,80 et contenu illisible sont refusés. Aucun suffixe n'est tronqué
pour faire passer une pièce. Le score OCR n'est **pas une garantie d'exhaustivité** :
des caractères peuvent être omis/mal reconnus, et les images ne sont jamais
qualifiées de nettoyées. C'est le texte livré qui a été inspecté.

Les URL, identifiants de fichiers distants et chemins locaux ne sont pas résolus.
Les liens Markdown ne sont pas téléchargés. Les pièces cachées au relais ne sont
pas inspectables : **pas de couverture automatique des pièces natives Codex/Copilot**,
ni de nouveau support des références dans `@secretguard` dans ce lot. Un assistant
qui n'envoie que le nom d'un fichier ne fournit pas son contenu au scanner.

## Dépendances et activation

`pypdfium2` rend et lit les PDF ; Pillow valide et décode les PNG ;
`rapidocr-onnxruntime==1.4.4` embarque ses trois modèles ONNX dans la wheel.
Le verrou `uv.lock` fixe aussi leurs dépendances. Cela évite une installation globale
de Tesseract et tout téléchargement au premier prompt. La détection des secrets
reste déterministe ; l'OCR, lui, utilise des modèles de reconnaissance de texte.
Le core TypeScript local reste sans dépendance runtime supplémentaire.

Références de maintenance : [API PDFium](https://pypdfium2.readthedocs.io/en/stable/python_api.html)
et [paquet RapidOCR embarqué](https://pypi.org/project/rapidocr-onnxruntime/1.4.4/).

Depuis la racine `poc-AI_guard` :

```powershell
uv sync --frozen
uv run pytest tests/test_attachments.py tests/test_attachment_proxy.py tests/test_extension_redaction.py --no-cov
```

Sur un poste derrière un proxy TLS, utiliser `uv --system-certs sync --frozen`
(certificats système approuvés, sans désactiver la vérification TLS).
Redémarrer ensuite le backend ou reconstruire/redéployer son image Docker. Le
Dockerfile ajoute les bibliothèques système OpenCV/ONNX requises sur Debian slim.
Reconstruire/réinstaller l'extension pour relever aussi la limite de son pont local.
Un ancien backend continue à refuser les pièces ; un ancien pont refuse > 1 Mio.
Une nouvelle version du VSIX seule ne déploie pas le backend distant.

## Preuves de test

`tests/test_attachments.py` fabrique en mémoire de vrais PNG, PDF texte, scannés et
mixtes, avec uniquement des secrets synthétiques. Il vérifie lecture, nettoyage,
idempotence, absence de l'original et refus sur limites/erreurs/OCR incertain.
`tests/test_attachment_proxy.py` exerce les routes HTTP réelles et l'extraction,
avec authentification, persistance et fournisseur simulés : aucun secret synthétique
dans l'audit, aucun appel fournisseur sur refus. Les tests PostgreSQL/RLS existants
restent séparés (`tests/test_extension_devices.py`). Ces tests ne remplacent pas
une qualification manuelle d'une nouvelle session dans l'IDE ou du conteneur Linux.

Validation de ce lot sur Windows : 56 tests backend ciblés et 321 tests de
l'extension réussis ; Ruff, mypy strict, ESLint, TypeScript et compilation réussis.
Les quatre tests PostgreSQL existants ont été ignorés faute de moteur disponible.
Le conteneur Linux et une session IDE raccordée ne sont pas validés dans ce lot.
L'audit des dépendances installées signale `PYSEC-2026-1325` sur `ecdsa==0.19.2`,
déjà présent dans le verrou avant ce changement ; aucune version corrective n'est
indiquée par l'outil. Ce point reste à traiter séparément. Rien n'a été déployé.
