"""The episode bench: the LLM agent on fixed tasks, in random natural places (the same places for a
given seed), like the field bench does for the skills (bot/tests/field).

It measures the baseline of step 6 (the LLM alone, before the world model):
- success VERIFIED on the state (e.g. 3 more oak_log in the inventory), not only the LLM saying
  goal_reached: both are reported, and when they disagree;
- turns, skill calls, unusable answers, how the episodes ended.
Each episode is logged as usual (episodes.jsonl, scenario "bench:<task>:seed<s>:place<i>"); the
verified success is not stored: it is recomputed from the episode's states (docs/journal.md).

Usage (bot running in API mode, LLM server running), from the repo root:
    uv run python -m brain.bench                    # 5 places, seed 1
    uv run python -m brain.bench --places 3 --seed 2 --only 1
    uv run python -m brain.bench --task oak_logs
"""

import argparse
import pathlib
import random
import statistics
from dataclasses import dataclass, field
from typing import Any, Callable

from brain.agent import run_episode
from brain.body import Body
from brain.llm import OpenAICompatibleLLM
from brain.show import load_episodes

SPREAD = 2000  # places are drawn in [-SPREAD, SPREAD] on x and z (like the field bench)

State = dict[str, Any]


def gained(start: State, final: State, item: str) -> int:
    """How many of an item the inventory gained between two states."""
    def count(state: State) -> int:
        return (state.get("inventory") or {}).get(item, 0)

    return count(final) - count(start)


@dataclass
class Task:
    name: str
    goal: str  # what the LLM is asked
    check: Callable[[State, State], bool]  # (start state, final state) -> goal really reached?
    inventory: dict[str, int] = field(default_factory=dict)  # given at the start
    watch: str | None = None  # a block worth knowing about at the start (is it within 32 blocks?)


TASKS = {
    "oak_logs": Task(
        name="oak_logs",
        goal="collect 3 oak logs",
        check=lambda start, final: gained(start, final, "oak_log") >= 3,
        watch="oak_log",
    ),
}


def draw_places(seed: int, n: int) -> list[tuple[int, int]]:
    """n places (x, z), always the same for a given seed."""
    rng = random.Random(seed)
    return [(rng.randint(-SPREAD, SPREAD), rng.randint(-SPREAD, SPREAD)) for _ in range(n)]


def run_place(
    task: Task, body: Body, llm: Any, place: int, x: int, z: int, seed: int, max_turns: int
) -> dict[str, Any]:
    """Set the place up, run one episode, and check the result. Returns one record."""
    record: dict[str, Any] = {"place": place, "x": x, "z": z}
    setup = body.setup(x, z, task.inventory)
    if not setup["success"]:
        return {**record, "setup_failed": setup["reason"]}
    start = body.state()
    record["watched_near"] = task.watch in (start.get("notable_blocks") or {}) if task.watch else None

    outcome = run_episode(
        task.goal, body, llm, max_turns=max_turns, scenario=f"bench:{task.name}:seed{seed}:place{place}"
    )
    events = load_episodes_of(body, outcome["episode_id"])
    end = events[-1] if events[-1]["type"] == "episode_end" else {}
    final = end.get("final_state") or body.state()
    turns = [e for e in events if e["type"] == "llm_turn"]
    return {
        **record,
        "episode_id": outcome["episode_id"],
        "verified": task.check(start, final),
        "claimed": outcome["success"],
        "end": outcome["reason"],
        "turns": len(turns),
        "unusable": sum(1 for t in turns if t.get("parse_error")),
        "skill_calls": outcome["skill_calls"],
        "duration": (end.get("outcome") or {}).get("duration"),
    }


def load_episodes_of(body: Body, episode_id: str) -> list[dict[str, Any]]:
    """The events of one episode, from the run's episodes.jsonl (where run_episode wrote them)."""
    path = pathlib.Path(body.run()["data_dir"]) / "episodes.jsonl"
    return load_episodes(path)[episode_id]


def summarize(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Rates and counts over the episodes that could be set up."""
    ran = [r for r in records if "setup_failed" not in r]
    ends: dict[str, int] = {}
    for r in ran:
        ends[r["end"]] = ends.get(r["end"], 0) + 1
    verified = sum(r["verified"] for r in ran)
    return {
        "episodes": len(ran),
        "setup_failed": len(records) - len(ran),
        "verified": verified,
        "rate": round(100 * verified / len(ran)) if ran else None,
        "claimed": sum(r["claimed"] for r in ran),
        "claimed_but_false": sum(r["claimed"] and not r["verified"] for r in ran),
        "reached_not_claimed": sum(r["verified"] and not r["claimed"] for r in ran),
        "median_turns": statistics.median(r["turns"] for r in ran) if ran else None,
        "unusable_answers": sum(r["unusable"] for r in ran),
        "ends": ends,
    }


def format_record(r: dict[str, Any]) -> str:
    where = f"[{r['place']}] ({r['x']}, {r['z']})"
    if "setup_failed" in r:
        return f"{where}: setup failed ({r['setup_failed']}), skipped"
    verdict = "REACHED" if r["verified"] else "NOT REACHED"
    claim = "claimed" if r["claimed"] else f"not claimed, ended by {r['end']}"
    near = "" if r["watched_near"] is None else f", watched block within 32: {'yes' if r['watched_near'] else 'no'}"
    return (
        f"{where}: {verdict} ({claim}), {r['turns']} turns, {r['skill_calls']} skill calls, "
        f"{r['unusable']} unusable, {r['duration']} s{near}  {r['episode_id']}"
    )


def format_summary(task: Task, s: dict[str, Any]) -> str:
    ends = ", ".join(f"{k} {v}" for k, v in sorted(s["ends"].items(), key=lambda kv: -kv[1]))
    return (
        f"{task.name}: reached {s['verified']}/{s['episodes']} ({s['rate']} %), median {s['median_turns']} turns, "
        f"{s['unusable_answers']} unusable answers | LLM claimed {s['claimed']} "
        f"(wrongly {s['claimed_but_false']}), reached but not claimed {s['reached_not_claimed']} | "
        f"endings: {ends} | setup failed {s['setup_failed']}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the LLM agent on a task in random places.")
    parser.add_argument("--task", default="oak_logs", choices=list(TASKS))
    parser.add_argument("--places", type=int, default=5)
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--only", type=int, default=None, help="run only this place index")
    parser.add_argument("--max-turns", type=int, default=10)
    args = parser.parse_args()

    task = TASKS[args.task]
    llm = OpenAICompatibleLLM()
    places = list(enumerate(draw_places(args.seed, args.places)))
    if args.only is not None:
        places = [p for p in places if p[0] == args.only]
    print(f"=== Bench {task.name} ({task.goal!r}): {len(places)} place(s), seed {args.seed}, LLM {llm.model} ===")
    records = []
    with Body() as body:
        for place, (x, z) in places:
            records.append(run_place(task, body, llm, place, x, z, args.seed, args.max_turns))
            print(format_record(records[-1]), flush=True)
    print("\n=== Summary ===")
    print(format_summary(task, summarize(records)))


if __name__ == "__main__":
    main()
