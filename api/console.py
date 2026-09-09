"""Le plan **console** : tout ce qu'un humain appelle depuis un écran.

Vingt-trois routeurs — politique, approbations, audit, conformité, clients,
jetons, triage… Le rythme est celui d'un opérateur : épisodique, tolérant à une
seconde de latence, et sans conséquence pour les agents en vol quand il
s'interrompt. C'est précisément ce qui permet de le déployer souvent.

C'est ce plan que sert `CONTROL_API_URL`, la variable que le proxy du frontend
lit — la console ne parle qu'ici.

Démarrage : `uvicorn api.console:app`.
"""

from __future__ import annotations

from api.main import Plane, create_app

app = create_app(plane=Plane.CONSOLE)
