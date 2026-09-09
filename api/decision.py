"""Le plan **décision** : `POST /v1/authorize`, et rien d'autre.

C'est le chemin chaud. Un agent coopératif l'appelle avant **chaque** appel
d'outil, et attend un verdict pour continuer. Sa disponibilité est celle de la
flotte : quand il ne répond pas, plus aucun agent n'avance.

D'où son isolement. Ce service ne monte ni l'export de conformité, ni la file
d'approbation, ni la console — un déploiement raté sur l'un d'eux ne peut plus
l'emporter avec lui. Il n'a pas non plus besoin de la clé `service_role` de
Supabase ni des identifiants de fournisseurs LLM : ne pas les lui donner est le
plus simple des durcissements.

Démarrage : `uvicorn api.decision:app`.
"""

from __future__ import annotations

from api.main import Plane, create_app

app = create_app(plane=Plane.DECISION)
