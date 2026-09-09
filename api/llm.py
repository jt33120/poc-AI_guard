"""Le plan **proxy LLM** : `/proxy/*`, et rien d'autre.

Chaque appel de modèle d'un client passe par ici. Deux raisons de le séparer, et
la seconde compte plus que la première :

* le débit n'a rien à voir avec celui d'une console, et une rafale de jetons ne
  doit pas affamer le processus qui sert les écrans ;
* **c'est le seul plan qui détient les identifiants des fournisseurs.** Les
  garder hors du processus qui expose vingt-trois routeurs de console réduit ce
  qu'une faille sur l'un d'eux met à portée.

Démarrage : `uvicorn api.llm:app`.
"""

from __future__ import annotations

from api.main import Plane, create_app

app = create_app(plane=Plane.LLM)
