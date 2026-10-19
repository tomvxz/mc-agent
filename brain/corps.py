"""Le lien entre le cerveau (Python) et le corps (le bot Node, voir bot/src/api.js).

Le corps expose 3 routes HTTP ; ce module les transforme en 3 fonctions Python :
    etat()                         -> l'état observé du bot (position, santé, inventaire...)
    competences()                  -> le catalogue des compétences (descriptions, paramètres, raisons d'échec)
    executer(nom, args, ...)       -> exécute UNE compétence et renvoie {success, reason, details, duration}

Deux sortes d'échec, à ne pas confondre :
- Échec DU JEU : executer() renvoie normalement un résultat avec success=False (ex. reason="no_path").
  C'est une information pour le LLM.
- Échec DE COMMUNICATION : une exception ErreurCorps (bot pas lancé, occupé, déconnecté, requête
  mal formée). Ce n'est pas au LLM de la gérer : le programme doit s'arrêter ou réessayer.

Utilisation :
    with Corps() as corps:
        print(corps.etat())
        print(corps.executer("find", {"target": "oak_log"}))
"""

import os
from typing import Any

import httpx

# Une compétence peut durer jusqu'à 60 s (limite de runSkill côté Node) : on attend un peu plus
DELAI_EXECUTION = 70.0
DELAI_COURT = 5.0  # pour /state et /skills, qui répondent tout de suite


def adresse_par_defaut() -> str:
    """Adresse de l'API du corps. Le port vient de API_PORT (le même réglage que côté Node)."""
    return f"http://127.0.0.1:{os.environ.get('API_PORT', '3000')}"


# --- Les erreurs de communication -------------------------------------------------------------


class ErreurCorps(Exception):
    """Problème pour parler au corps (jamais un échec du jeu)."""


class CorpsInjoignable(ErreurCorps):
    """Le bot ne répond pas : pas lancé (`node bot.js serve`), ou réponse trop lente."""


class CorpsOccupe(ErreurCorps):
    """Une compétence est déjà en cours (HTTP 409) : le bot n'a qu'un corps."""


class CorpsDeconnecte(ErreurCorps):
    """Le bot est mort ou déconnecté du serveur Minecraft (HTTP 503)."""


class RequeteInvalide(ErreurCorps):
    """Le corps a refusé la requête (HTTP 400) : c'est un bug du cerveau, pas du jeu."""


# --- Le client ---------------------------------------------------------------------------------


class Corps:
    """Un client pour l'API du corps. Garde une connexion ouverte entre les appels."""

    def __init__(
        self, adresse: str | None = None, transport: httpx.BaseTransport | None = None
    ):
        # transport sert aux tests : on peut remplacer le vrai réseau par un faux corps.
        # trust_env=False : ignorer HTTP_PROXY & co. Le corps est local ; passer par un proxy
        # transformerait "bot pas lancé" en une erreur 502 trompeuse (vu en test).
        self._client = httpx.Client(
            base_url=adresse or adresse_par_defaut(),
            timeout=DELAI_COURT,
            transport=transport,
            trust_env=False,
        )

    def etat(self) -> dict[str, Any]:
        """L'état du bot, tel que le voit observe() côté Node."""
        return self._requete("GET", "/state")

    def competences(self) -> dict[str, Any]:
        """Le catalogue : {catalogue_version, common_reasons, skills: {nom: fiche}}."""
        return self._requete("GET", "/skills")

    def executer(
        self,
        nom: str,
        args: dict[str, Any] | None = None,
        *,
        source: str = "brain",
        episode_id: str | None = None,
        step: int | None = None,
    ) -> dict[str, Any]:
        """Exécute une compétence et renvoie {success, reason, details, duration}.

        episode_id et step relient la transition (dans data/transitions.jsonl) à l'épisode du cerveau.
        Un nom de compétence inconnu n'est pas une exception : le résultat a reason="unknown_skill".
        """
        demande: dict[str, Any] = {"name": nom, "args": args or {}, "source": source}
        # Les champs absents ne sont pas envoyés (le journal les laisse alors de côté)
        if episode_id is not None:
            demande["episode_id"] = episode_id
        if step is not None:
            demande["step"] = step
        return self._requete("POST", "/execute", json=demande, timeout=DELAI_EXECUTION)

    def fermer(self) -> None:
        self._client.close()

    # `with Corps() as corps:` ferme la connexion tout seul à la fin
    def __enter__(self) -> "Corps":
        return self

    def __exit__(self, *erreur: object) -> None:
        self.fermer()

    def _requete(self, methode: str, chemin: str, **options: Any) -> dict[str, Any]:
        """Envoie la requête et traduit les problèmes de communication en exceptions claires."""
        try:
            reponse = self._client.request(methode, chemin, **options)
        except httpx.ConnectError as e:
            raise CorpsInjoignable(
                f"le bot ne répond pas sur {self._client.base_url} : est-il lancé (bot.js serve) ?"
            ) from e
        except httpx.TimeoutException as e:
            raise CorpsInjoignable(
                f"pas de réponse du bot à temps ({methode} {chemin})"
            ) from e

        if reponse.status_code == 200:
            return reponse.json()

        # Les erreurs du corps sont au format {"error": "...", "message": "..."}
        try:
            message = reponse.json().get("message", reponse.text)
        except ValueError:
            message = reponse.text
        if reponse.status_code == 409:
            raise CorpsOccupe(message)
        if reponse.status_code == 503:
            raise CorpsDeconnecte(message)
        if reponse.status_code == 400:
            raise RequeteInvalide(message)
        raise ErreurCorps(
            f"HTTP {reponse.status_code} sur {methode} {chemin} : {message}"
        )


# Petit essai à la main, bot lancé : uv run python -m brain.corps
if __name__ == "__main__":
    with Corps() as corps:
        catalogue = corps.competences()
        print(
            "catalogue v%s :" % catalogue["catalogue_version"],
            ", ".join(catalogue["skills"]),
        )
        print("état :", corps.etat())
        print("scan :", corps.executer("scan", {"radius": 16}, source="essai"))
