"""The link between the brain (Python) and the body (the Node bot, see bot/src/api.js).

The body exposes 3 HTTP routes; this module turns them into 3 Python methods:
    state()                        -> the bot's observed state (position, health, inventory...)
    skills()                       -> the skill catalogue (descriptions, parameters, failure reasons)
    execute(name, args, ...)       -> runs ONE skill and returns {success, reason, details, duration}

Two kinds of failure, not to be confused:
- GAME failure: execute() returns a normal result with success=False (e.g. reason="no_path").
  It is information for the LLM.
- COMMUNICATION failure: a BodyError exception (bot not started, busy, disconnected, malformed
  request). The LLM does not handle it: the program must stop or retry.

Usage:
    with Body() as body:
        print(body.state())
        print(body.execute("find", {"target": "oak_log"}))
"""

import os
from typing import Any

import httpx

# A skill can last up to 60 s (runSkill's limit on the Node side): wait a little longer
EXECUTE_TIMEOUT = 70.0
SHORT_TIMEOUT = 5.0  # for /state and /skills, which answer immediately


def default_url() -> str:
    """URL of the body's API. The port comes from API_PORT (same setting as on the Node side)."""
    return f"http://127.0.0.1:{os.environ.get('API_PORT', '3000')}"


# --- Communication errors ---------------------------------------------------------------------


class BodyError(Exception):
    """Problem talking to the body (never a game failure)."""


class BodyUnreachable(BodyError):
    """The bot does not answer: not started (`node bot.js serve`), or too slow."""


class BodyBusy(BodyError):
    """A skill is already running (HTTP 409): the bot only has one body."""


class BodyDisconnected(BodyError):
    """The bot is dead or disconnected from the Minecraft server (HTTP 503)."""


class InvalidRequest(BodyError):
    """The body rejected the request (HTTP 400): a bug in the brain, not in the game."""


# --- The client --------------------------------------------------------------------------------


class Body:
    """A client for the body's API. Keeps a connection open between calls."""

    def __init__(
        self, url: str | None = None, transport: httpx.BaseTransport | None = None
    ):
        # transport is for tests: the real network can be replaced by a fake body.
        # trust_env=False: ignore HTTP_PROXY & co. The body is local; going through a proxy
        # would turn "bot not started" into a misleading 502 error (seen in tests).
        self._client = httpx.Client(
            base_url=url or default_url(),
            timeout=SHORT_TIMEOUT,
            transport=transport,
            trust_env=False,
        )

    def state(self) -> dict[str, Any]:
        """The bot's state, as observe() sees it on the Node side."""
        return self._request("GET", "/state")

    def skills(self) -> dict[str, Any]:
        """The catalogue: {catalogue_version, common_reasons, skills: {name: entry}}."""
        return self._request("GET", "/skills")

    def execute(
        self,
        name: str,
        args: dict[str, Any] | None = None,
        *,
        source: str = "brain",
        episode_id: str | None = None,
        step: int | None = None,
    ) -> dict[str, Any]:
        """Run a skill and return {success, reason, details, duration}.

        episode_id and step link the transition (in data/transitions.jsonl) to the brain's episode.
        An unknown skill name is not an exception: the result has reason="unknown_skill".
        """
        request: dict[str, Any] = {"name": name, "args": args or {}, "source": source}
        # Missing fields are not sent (the journal then leaves them out)
        if episode_id is not None:
            request["episode_id"] = episode_id
        if step is not None:
            request["step"] = step
        return self._request("POST", "/execute", json=request, timeout=EXECUTE_TIMEOUT)

    def close(self) -> None:
        self._client.close()

    # `with Body() as body:` closes the connection automatically at the end
    def __enter__(self) -> "Body":
        return self

    def __exit__(self, *error: object) -> None:
        self.close()

    def _request(self, method: str, path: str, **options: Any) -> dict[str, Any]:
        """Send the request and turn communication problems into clear exceptions."""
        try:
            response = self._client.request(method, path, **options)
        except httpx.ConnectError as e:
            raise BodyUnreachable(
                f"the bot does not answer on {self._client.base_url}: is it started (bot.js serve)?"
            ) from e
        except httpx.TimeoutException as e:
            raise BodyUnreachable(
                f"no answer from the bot in time ({method} {path})"
            ) from e

        if response.status_code == 200:
            return response.json()

        # The body's errors look like {"error": "...", "message": "..."}
        try:
            message = response.json().get("message", response.text)
        except ValueError:
            message = response.text
        if response.status_code == 409:
            raise BodyBusy(message)
        if response.status_code == 503:
            raise BodyDisconnected(message)
        if response.status_code == 400:
            raise InvalidRequest(message)
        raise BodyError(f"HTTP {response.status_code} on {method} {path}: {message}")


# Quick manual check, with the bot running: uv run python -m brain.body
if __name__ == "__main__":
    with Body() as body:
        catalogue = body.skills()
        print(
            "catalogue v%s:" % catalogue["catalogue_version"],
            ", ".join(catalogue["skills"]),
        )
        print("state:", body.state())
        print("scan:", body.execute("scan", {"radius": 16}, source="manual_check"))
