"""The episode journal: data/episodes.jsonl, one event per line (format: docs/journal.md).

An episode is a stream of events written as soon as they happen, so nothing is lost if the
program crashes mid-episode:
    episode_start -> llm_turn (one per LLM call) -> episode_end

Usage:
    with EpisodeLog() as log:
        log.start(goal="craft a wooden pickaxe", model={...},
                  system_prompt="...", tools=[...], max_turns=10)
        log.turn(new_messages=[...], raw_response={...}, plan=[...])
        log.end(success=True, reason="done", skill_calls=7)
If the block exits on an exception before end(), an episode_end with reason "crash" (or
"interrupted" for Ctrl+C) is written automatically.
"""

import json
import os
import secrets
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1

REPO = Path(__file__).resolve().parents[1]
# Development data by default; a collection run writes into its own folder (Body.run()["data_dir"])
DEFAULT_FILE = REPO / "data" / "dev" / "episodes.jsonl"

END_REASONS = {
    "done",
    "condition_met",
    "max_turns",
    "body_error",
    "llm_error",
    "interrupted",
    "crash",
}


def episodes_file() -> Path:
    """Where episodes are written. EPISODES_FILE lets tests write somewhere else."""
    return Path(os.environ.get("EPISODES_FILE", DEFAULT_FILE))


def utc_now() -> str:
    """ISO 8601 in UTC with milliseconds, same format as the Node side: 2026-10-19T10:45:12.345Z"""
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def new_episode_id() -> str:
    """e.g. ep-20261019-104512-a3f9: UTC date-time (sortable) + 4 random hex characters."""
    return f"ep-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}-{secrets.token_hex(2)}"


def code_version() -> str:
    """Git commit of the code, "+dirty" if bot/ or brain/ has uncommitted changes (like bot/src/version.js)."""

    def git(*args: str) -> str:
        return subprocess.run(
            ["git", *args], cwd=REPO, capture_output=True, text=True, check=True
        ).stdout.strip()

    try:
        commit = git("rev-parse", "--short", "HEAD")
        dirty = git("status", "--porcelain", "--", "bot", "brain") != ""
        return f"{commit}+dirty" if dirty else commit
    except (OSError, subprocess.CalledProcessError):
        return "unknown"  # not a git checkout, or git not installed


class EpisodeLog:
    """Writes the events of ONE episode, numbering them (seq) and timestamping them (ts)."""

    def __init__(self, episode_id: str | None = None, path: Path | None = None):
        self.episode_id = episode_id or new_episode_id()
        self.path = path or episodes_file()
        self._seq = 0
        self._turns = 0
        self._started_at: float | None = (
            None  # time.monotonic() at start, for the duration
        )
        self._ended = False

    def start(
        self,
        *,
        goal: str,
        model: dict[str, Any],
        system_prompt: str,
        tools: list[dict[str, Any]],
        max_turns: int,
        run_id: str | None = None,
        scenario: str | None = None,
    ) -> None:
        """First event: everything that does not change during the episode.

        run_id: the body's run (Body.run()["run_id"]), to join episodes and transitions.
        """
        if self._seq != 0:
            raise RuntimeError("start() must be the first event of the episode")
        self._started_at = time.monotonic()
        fields: dict[str, Any] = {"run_id": run_id, "goal": goal}
        if scenario is not None:
            fields["scenario"] = scenario
        fields.update(
            model=model,
            code_version=code_version(),  # the git commit: identifies the skills and texts exactly
            system_prompt=system_prompt,
            tools=tools,
            max_turns=max_turns,
        )
        self._write("episode_start", fields)

    def turn(
        self,
        *,
        new_messages: list[dict[str, Any]],
        raw_response: Any,
        plan: list[dict[str, Any]] | None,
        missing_capability: str | None = None,
        done: bool = False,
        parse_error: str | None = None,
        latency: float | None = None,
        tokens: dict[str, int | None] | None = None,
    ) -> int:
        """One call to the LLM. Returns the turn number (0, 1, 2...), to pass to Body.execute(turn=...)."""
        self._check_open()
        number = self._turns
        self._write(
            "llm_turn",
            {
                "turn": number,
                "new_messages": new_messages,
                "raw_response": raw_response,
                "plan": plan,
                "missing_capability": missing_capability,
                "done": done,
                "parse_error": parse_error,
                "latency": latency,
                "tokens": tokens,
            },
        )
        self._turns += 1
        return number

    def end(
        self,
        *,
        success: bool,
        reason: str,
        skill_calls: int | None,
        error: str | None = None,
        final_state: dict[str, Any] | None = None,
    ) -> None:
        """Last event. The number of turns and the duration are computed here."""
        started_at = self._check_open()
        if reason not in END_REASONS:
            raise ValueError(
                f"unknown end reason {reason!r}, expected one of {sorted(END_REASONS)}"
            )
        duration = round(time.monotonic() - started_at, 3)
        self._write(
            "episode_end",
            {
                "outcome": {
                    "success": success,
                    "reason": reason,
                    "turns": self._turns,
                    "skill_calls": skill_calls,
                    "duration": duration,
                    "error": error,
                },
                "final_state": final_state,
            },
        )
        self._ended = True

    # `with EpisodeLog() as log:` writes an episode_end even if the code crashes
    def __enter__(self) -> "EpisodeLog":
        return self

    def __exit__(
        self, exc_type: type | None, exc: BaseException | None, tb: object
    ) -> None:
        if exc_type is None or self._ended or self._started_at is None:
            return  # normal exit, already ended, or never started: nothing to add
        reason = "interrupted" if exc_type is KeyboardInterrupt else "crash"
        self.end(
            success=False,
            reason=reason,
            skill_calls=None,
            error=f"{exc_type.__name__}: {exc}",
        )
        # the exception is not swallowed: it keeps going up

    def _check_open(self) -> float:
        """Refuse events outside start()..end(); returns when the episode started."""
        if self._started_at is None:
            raise RuntimeError("start() must be called first")
        if self._ended:
            raise RuntimeError("the episode has already ended")
        return self._started_at

    def _write(self, event_type: str, fields: dict[str, Any]) -> None:
        line = {
            "schema_version": SCHEMA_VERSION,
            "type": event_type,
            "episode_id": self.episode_id,
            "seq": self._seq,
            "ts": utc_now(),
            **fields,
        }
        # default=str: an unexpected object (e.g. in a raw provider response) is written as text
        # rather than making the whole line fail
        text = json.dumps(line, ensure_ascii=False, default=str) + "\n"
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self.path.open("a", encoding="utf-8") as f:
                f.write(text)
        except OSError as e:
            # Like the Node side: writing the journal must never crash the agent
            print(f"[journal] cannot write {self.path}: {e}", file=sys.stderr)
        self._seq += 1
