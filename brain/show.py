"""Show an episode in a readable way: what the LLM called, what each skill gave, how it ended.

Read only: it never changes the journal (format: docs/journal.md).

Usage (from the repo root):
    uv run python -m brain.show              # the last episode
    uv run python -m brain.show fd51         # an episode by its id, or the end of it
    uv run python -m brain.show --full       # with the complete messages the LLM received

The skill results come from transitions.jsonl (next to episodes.jsonl): it has the results of
every turn, the last one too (the LLM never saw those).
"""

import argparse
import json
import pathlib
import sys
from typing import Any

from brain.journal import episodes_file

WIDTH = 150  # long details are cut to this many characters


def _short(value: Any, width: int = WIDTH) -> str:
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    return text if len(text) <= width else text[: width - 3] + "..."


def _call(skill: str, args: dict[str, Any]) -> str:
    return f"{skill}({', '.join(f'{k}={v!r}' for k, v in args.items())})"


def load_episodes(path: pathlib.Path) -> dict[str, list[dict[str, Any]]]:
    """Every episode of the file: {episode_id: [events in order]}, in the order they started."""
    episodes: dict[str, list[dict[str, Any]]] = {}
    for line in path.read_text().splitlines():
        if line.strip():
            event = json.loads(line)
            episodes.setdefault(event["episode_id"], []).append(event)
    return episodes


def load_transitions(path: pathlib.Path, episode_id: str) -> list[dict[str, Any]]:
    """The transitions of one episode, in order (the file is big: lines are checked as text first)."""
    if not path.exists():
        return []
    found = []
    with path.open() as f:
        for line in f:
            if episode_id in line:
                t = json.loads(line)
                if t.get("episode_id") == episode_id:
                    found.append(t)
    return sorted(found, key=lambda t: t["seq"])


def show(
    events: list[dict[str, Any]],
    transitions: list[dict[str, Any]],
    full: bool = False,
) -> str:
    """The text view of one episode (events from episodes.jsonl, its transitions)."""
    lines = []
    start = events[0]
    if start["type"] == "episode_start":
        params = start["model"].get("params", {})
        lines.append(f"EPISODE {start['episode_id']}  goal: {start['goal']!r}")
        lines.append(
            f"  model {start['model'].get('name')}, context {params.get('context_length')}, "
            f"code {start.get('code_version')}, max {start.get('max_turns')} turns"
        )

    for event in events:
        if event["type"] == "llm_turn":
            tokens = (event.get("tokens") or {}).get("prompt")
            lines.append("")
            lines.append(f"turn {event['turn']}  [{tokens} tokens, {event.get('latency')} s]")
            if full:
                for m in event["new_messages"]:
                    text = m.get("content") or json.dumps(m.get("tool_calls"))
                    lines.append(f"  | {m['role']}: " + text.replace("\n", "\n  |   "))
            if event.get("parse_error"):
                message = (event.get("raw_response") or {}).get("choices", [{}])[0].get("message", {})
                lines.append(f"  UNUSABLE: {event['parse_error']}")
                lines.append(f"  the LLM wrote: {_short(message.get('content') or '(nothing)')}")
                continue
            ran = [t for t in transitions if t.get("turn") == event["turn"]]
            for i, step in enumerate(event.get("plan") or []):
                if i < len(ran):
                    t = ran[i]
                    status = "ok" if t["success"] else f"FAILED {t['reason']}"
                    lines.append(f"  -> {_call(step['skill'], step['args'])}  {status}")
                    lines.append(f"       {_short(t.get('details'))}")
                else:
                    lines.append(f"  -> {_call(step['skill'], step['args'])}  (not run)")
            if event.get("missing_capability"):
                lines.append(f"  missing capability: {event['missing_capability']}")
            if event.get("done"):
                lines.append("  goal_reached")

        elif event["type"] == "episode_end":
            o = event["outcome"]
            inventory = (event.get("final_state") or {}).get("inventory")
            lines.append("")
            lines.append(
                f"END  {'SUCCESS' if o['success'] else 'FAILURE'} ({o['reason']})  {o['turns']} turns, "
                f"{o['skill_calls']} skill calls, {o['duration']} s"
                + (f"  error: {o['error']}" if o.get("error") else "")
            )
            lines.append(f"  final inventory: {inventory}")

    if events[-1]["type"] != "episode_end":
        lines.append("")
        lines.append("(no episode_end: still running, or the process was killed)")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Show an LLM episode in a readable way.")
    parser.add_argument("episode", nargs="?", help="episode id, or its end (default: the last one)")
    parser.add_argument("--full", action="store_true", help="also show the complete messages")
    parser.add_argument("--file", type=pathlib.Path, default=episodes_file(), help="episodes.jsonl to read")
    args = parser.parse_args()

    episodes = load_episodes(args.file)
    if not episodes:
        sys.exit(f"no episode in {args.file}")
    if args.episode:
        matching = [e for e in episodes if e.endswith(args.episode)]
        if not matching:
            sys.exit(f"no episode ending with {args.episode!r} in {args.file}")
        episode_id = matching[-1]
    else:
        episode_id = list(episodes)[-1]
    transitions = load_transitions(args.file.parent / "transitions.jsonl", episode_id)
    print(show(episodes[episode_id], transitions, full=args.full))


if __name__ == "__main__":
    main()
