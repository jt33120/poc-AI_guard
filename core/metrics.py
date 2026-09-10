"""Le registre de mesure du processus — ce que la garde fait, chiffré, sans PII.

**Pourquoi un registre à la main plutôt qu'une dépendance.** `CLAUDE.md` §3 fixe la
pile et demande de justifier tout ajout. `prometheus_client` apporterait un registre
global implicite, un collecteur de métriques du processus qu'on ne veut pas exposer,
et un mode multiprocessus qui écrit des fichiers ; ce qu'il faut ici tient en soixante
lignes de bibliothèque standard, et le format d'exposition est un texte figé depuis
dix ans. La dépendance coûterait plus à défendre qu'à écrire.

**Ce que ce module mesure, et ce qu'il ne mesure pas.** Il compte des **verdicts**, pas
des appelants. Aucune étiquette ne porte d'identifiant de tenant, d'agent, d'outil ni
d'utilisateur, et ce n'est pas une politesse : une étiquette `tenant_id` sur un point
de scrutation est à la fois une fuite commerciale — le nombre de clients et leur
volume, lisible par qui atteint la route — et une cardinalité non bornée, c'est-à-dire
une fuite de mémoire qu'un tiers choisit. Les seules étiquettes admises viennent de
vocabulaires **fermés** : le verdict (que `core/export.is_summarised` tient déjà), la
porte d'entrée, le mode d'application.

**Un compteur ne remplace jamais le journal.** Ces chiffres vivent en mémoire, ils
partent au redémarrage, et chaque réplique a les siens. Ils servent à voir la forme
du trafic ; la preuve, elle, est dans `audit_log` et nulle part ailleurs (§4.2). C'est
la raison pour laquelle rien ici n'est jamais lu en retour par le produit : aucune
décision ne dépend d'un compteur.

**Les noms sont déclarés.** `compter` et `observer` refusent un nom absent de
:data:`_MESURES`. Un registre qui accepte n'importe quel nom laisse une faute de frappe
créer une seconde série silencieuse — celle qu'un tableau de bord n'affiche jamais et
que personne ne cherche, puisque la première continue de bouger.
"""

from __future__ import annotations

import logging
import re
import threading
from dataclasses import dataclass, field

logger = logging.getLogger("xsom.metrics")

#: Le plafond de séries distinctes que le registre garde. Au-delà, une série neuve
#: est refusée et le refus se compte.
#:
#: Toutes les étiquettes de ce module viennent de vocabulaires fermés, donc ce
#: plafond ne devrait jamais être atteint. Il existe pour le jour où quelqu'un
#: ajoutera une étiquette qui ne l'est pas : la panne devient alors un compteur
#: visible plutôt qu'une mémoire qui monte jusqu'à l'OOM du processus qui décide.
_MAX_SERIES = 512

#: Les bornes du temps de décision, en millisecondes. Choisies autour de ce que
#: `perf/overhead.json` publie déjà en allers-retours SQL : l'essentiel de la
#: distribution doit tomber dans les premières bornes, et une queue au-delà de 250 ms
#: est le signal qu'on cherche.
_BORNES_MS: tuple[float, ...] = (1, 2, 5, 10, 25, 50, 100, 250, 500, 1000)

#: Ce qu'un caractère d'étiquette a le droit d'être. Tout le reste devient `_`.
_CARACTERE_INTERDIT = re.compile(r"[^a-zA-Z0-9_:.\-]")

#: Longueur maximale d'une valeur d'étiquette, pour la même raison que
#: `core/audit.MAX_FIELD` : ce qui entre dans une série y reste jusqu'au redémarrage.
_MAX_ETIQUETTE = 64


@dataclass(frozen=True, slots=True)
class _Mesure:
    """Une mesure déclarée : son type, et la phrase que l'exposition publie."""

    type: str  # "counter" | "histogram"
    aide: str


#: Le catalogue. Ajouter une mesure, c'est ajouter une ligne ici — et la phrase
#: d'aide est celle que lira l'opérateur à trois heures du matin, pas un rappel du nom.
_MESURES: dict[str, _Mesure] = {
    "xsom_decisions_total": _Mesure(
        "counter",
        "Verdicts écrits au journal, par décision, porte d'entrée et mode d'application.",
    ),
    "xsom_decision_ms": _Mesure(
        "histogram",
        "Millisecondes passées dans la garde avant le verdict, hors outil aval et "
        "hors appel de fournisseur.",
    ),
    "xsom_judge_calls_total": _Mesure(
        "counter", "Consultations du juge LLM sur les cas ambigus, par issue."
    ),
    "xsom_quota_total": _Mesure(
        "counter", "États de quota rendus par la gamme, par métrique et par état."
    ),
    "xsom_ratelimit_total": _Mesure(
        "counter",
        "Limites de débit résolues, par métrique et selon qu'elles viennent du palier "
        "du tenant ou du repli de configuration.",
    ),
    "xsom_audit_failures_total": _Mesure(
        "counter",
        "Écritures d'audit qui n'ont PAS abouti, par porte et par étape. La perte de "
        "preuve ne laissait jusqu'ici qu'une ligne de journal applicatif.",
    ),
    "xsom_series_dropped_total": _Mesure(
        "counter", "Séries refusées parce que le registre a atteint son plafond."
    ),
}


@dataclass
class _Histogramme:
    """Un histogramme cumulatif au format Prometheus."""

    seaux: list[int] = field(default_factory=lambda: [0] * (len(_BORNES_MS) + 1))
    somme: float = 0.0
    compte: int = 0

    def observer(self, valeur: float) -> None:
        self.somme += valeur
        self.compte += 1
        for index, borne in enumerate(_BORNES_MS):
            if valeur <= borne:
                self.seaux[index] += 1
                break
        else:
            self.seaux[-1] += 1


def _propre(valeur: object) -> str:
    """Une valeur d'étiquette bornée et sans caractère qui casserait l'exposition."""
    texte = str(valeur)[:_MAX_ETIQUETTE]
    return _CARACTERE_INTERDIT.sub("_", texte) or "unknown"


def _cle(nom: str, etiquettes: dict[str, str]) -> tuple[str, tuple[tuple[str, str], ...]]:
    return nom, tuple(sorted((k, _propre(v)) for k, v in etiquettes.items()))


class Registre:
    """Les compteurs d'un processus. Un verrou, parce qu'uvicorn sert en threads.

    `dict[...] += 1` n'est pas atomique en Python quand la clé est absente — deux
    threads peuvent lire la même absence et écrire chacun `1`. Le verrou est pris sur
    une opération qui ne fait aucune entrée-sortie, donc il ne peut pas devenir un
    point de contention sur le chemin chaud.
    """

    def __init__(self) -> None:
        self._verrou = threading.Lock()
        self._compteurs: dict[tuple[str, tuple[tuple[str, str], ...]], int] = {}
        self._histogrammes: dict[tuple[str, tuple[tuple[str, str], ...]], _Histogramme] = {}

    # -- écriture ------------------------------------------------------------

    def compter(self, nom: str, n: int = 1, **etiquettes: object) -> None:
        """Incrémenter un compteur déclaré. Ne lève jamais : la mesure n'est pas la preuve.

        C'est appelé depuis `core/audit.log_event`, à l'intérieur de la transaction
        qui écrit une entrée de journal. Une exception ici ferait perdre la ligne de
        **preuve** pour un chiffre de tableau de bord — le même arbitrage que celui
        déjà tranché pour `plan_usage_counters` (§4.2, `0030` §4).
        """
        try:
            self._ajouter(nom, n, etiquettes)
        except Exception:  # pragma: no cover - _ajouter n'a pas de chemin qui lève
            logger.warning("metric_failed", extra={"metric": nom})

    def observer(self, nom: str, valeur: float, **etiquettes: object) -> None:
        """Ajouter une observation à un histogramme déclaré. Ne lève jamais non plus."""
        try:
            if _MESURES.get(nom, _Mesure("", "")).type != "histogram":
                logger.warning("metric_undeclared", extra={"metric": nom})
                return
            cle = _cle(nom, {k: str(v) for k, v in etiquettes.items()})
            with self._verrou:
                histo = self._histogrammes.get(cle)
                if histo is None:
                    if not self._place_libre():
                        return
                    histo = self._histogrammes.setdefault(cle, _Histogramme())
                histo.observer(valeur)
        except Exception:  # pragma: no cover
            logger.warning("metric_failed", extra={"metric": nom})

    def _ajouter(self, nom: str, n: int, etiquettes: dict[str, object]) -> None:
        if _MESURES.get(nom, _Mesure("", "")).type != "counter":
            logger.warning("metric_undeclared", extra={"metric": nom})
            return
        cle = _cle(nom, {k: str(v) for k, v in etiquettes.items()})
        with self._verrou:
            if cle not in self._compteurs and not self._place_libre():
                return
            self._compteurs[cle] = self._compteurs.get(cle, 0) + n

    def _place_libre(self) -> bool:
        """Reste-t-il de la place pour une série neuve ? Le refus se compte lui-même."""
        if len(self._compteurs) + len(self._histogrammes) < _MAX_SERIES:
            return True
        refus = ("xsom_series_dropped_total", ())
        self._compteurs[refus] = self._compteurs.get(refus, 0) + 1
        return False

    # -- lecture -------------------------------------------------------------

    def rendre(self) -> str:
        """L'exposition texte Prometheus, triée pour être stable d'un appel à l'autre.

        Le tri n'est pas cosmétique : un `diff` entre deux relevés est le premier
        geste d'un opérateur, et un ordre de dictionnaire le rend illisible.
        """
        with self._verrou:
            compteurs = dict(self._compteurs)
            histogrammes = {
                k: (list(v.seaux), v.somme, v.compte) for k, v in self._histogrammes.items()
            }

        lignes: list[str] = []
        for nom, mesure in sorted(_MESURES.items()):
            series = sorted(k for k in compteurs if k[0] == nom)
            histos = sorted(k for k in histogrammes if k[0] == nom)
            if not series and not histos:
                continue
            lignes.append(f"# HELP {nom} {mesure.aide}")
            lignes.append(f"# TYPE {nom} {mesure.type}")
            for cle in series:
                lignes.append(f"{nom}{_rendre_etiquettes(cle[1])} {compteurs[cle]}")
            for cle in histos:
                seaux, somme, compte = histogrammes[cle]
                cumul = 0
                for index, borne in enumerate(_BORNES_MS):
                    cumul += seaux[index]
                    lignes.append(
                        f"{nom}_bucket{_rendre_etiquettes(cle[1], le=_nombre(borne))} {cumul}"
                    )
                cumul += seaux[-1]
                lignes.append(f"{nom}_bucket{_rendre_etiquettes(cle[1], le='+Inf')} {cumul}")
                lignes.append(f"{nom}_sum{_rendre_etiquettes(cle[1])} {_nombre(somme)}")
                lignes.append(f"{nom}_count{_rendre_etiquettes(cle[1])} {compte}")
        return "\n".join(lignes) + "\n" if lignes else ""

    def remise_a_zero(self) -> None:
        """Vider le registre. **Réservé aux tests** : le produit ne l'appelle jamais.

        Un compteur remis à zéro en production ferait décrocher tout calcul de taux
        côté scrutateur sans qu'aucun redémarrage ne l'explique.
        """
        with self._verrou:
            self._compteurs.clear()
            self._histogrammes.clear()


def _nombre(valeur: float) -> str:
    """Un flottant tel que Prometheus l'attend : `5` et non `5.0` quand c'est entier."""
    return str(int(valeur)) if float(valeur).is_integer() else repr(float(valeur))


def _rendre_etiquettes(paires: tuple[tuple[str, str], ...], **extra: str) -> str:
    toutes = list(paires) + sorted(extra.items())
    if not toutes:
        return ""
    return "{" + ",".join(f'{k}="{v}"' for k, v in toutes) + "}"


#: Le registre du processus. Un seul, parce qu'il n'y a qu'un processus par service.
#:
#: Volontairement un module-level et non un état d'application : `core/audit.log_event`
#: est appelé aussi bien par la passerelle MCP — qui n'a **pas** d'application FastAPI
#: — que par les deux plans HTTP. Un registre porté par `app.state` ne compterait rien
#: sur la porte obligatoire, c'est-à-dire sur la seule que le déploiement recommandé
#: emprunte.
registre = Registre()
