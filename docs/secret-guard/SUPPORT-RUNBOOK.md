# Runbook de support

Collecter uniquement : version extension, OS, version de l’hôte, état des hooks, identifiant/version de politique, raisons de posture, taille/pertes de file et horodatage. Ne jamais demander de prompt, secret, token, contenu de fichier, argument brut, chemin personnel ou export brut de console. Vérifier l’intégrité du journal depuis la console ; un état `non vérifié` déclenche une réinstallation ou une revue MDM, pas une permission temporaire.

Ordre de diagnostic : vérifier l’expiration et la version minimale de politique ; comparer la clé publique épinglée ; contrôler l’intégrité et les canaris du hook ; confirmer une invocation récente ; examiner la file locale ; enfin vérifier l’administration du poste. Une réinitialisation de clé est une opération gérée explicite, jamais la réponse automatique à `unexpected_policy_key_rotation`.

Une approbation expirée, consommée, liée à un autre poste ou à une autre empreinte d’action reste refusée. Le support ne recrée pas une approbation plus large pour contourner une panne de console.
