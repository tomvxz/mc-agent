"""The episode bench: the LLM agent on fixed tasks, in random natural places (the same places for a
given seed), like the field bench does for the skills (bot/tests/field).

It measures the baseline of step 6 (the LLM alone, before the world model):
- success VERIFIED on the state (e.g. 3 more oak_log in the inventory), not only the LLM saying
  goal_reached: both are reported, and when they disagree;
- turns, skill calls, unusable answers, how the episodes ended.
Each episode is logged as usual (episodes.jsonl, scenario "bench:<task>:seed<s>:place<i>"); the
verified success is not stored: it is recomputed from the episode's states (docs/journal.md).

The world is persistent: an episode cuts trees, so a place is NEVER played twice (every bench
episode logged in episodes.jsonl marks its place as used, any task, any seed). Comparing two variants
on the same places would put the second one in a poorer world: --compare alternates them instead,
place after place, on fresh places.

Usage (bot running in API mode, LLM server running), from the repo root:
    uv run python -m brain.bench                    # 5 fresh places of seed 1
    uv run python -m brain.bench --places 3 --seed 2
    uv run python -m brain.bench --no-condition     # without the goal condition (brain/goal.py)
    uv run python -m brain.bench --compare condition --places 10   # with / without one component, alternated
    uv run python -m brain.bench --only 4           # replay place 4 (even if used: to debug only)
"""

import argparse
import math
import pathlib
import random
import re
import statistics
from dataclasses import dataclass, field
from typing import Any, Callable

from brain import goal as goals
from brain.agent import run_episode
from brain.body import Body
from brain.llm import OpenAICompatibleLLM
from brain.show import load_episodes, load_transitions

SPREAD = 5000  # places are drawn in [-SPREAD, SPREAD] on x and z (far: more fresh places per seed)
# A place without safe ground (ocean, lava) is replaced by the next one, among the first MAX_DRAWS draws.
# Not a budget per wanted place: the used places are skipped, so the ones left first in a seed are the
# oceans that failed in every run before (seed 1, 2026-10-21: 10 candidates, all oceans).
# Cheap: the server refuses an ocean at once (src/setup.js).
MAX_DRAWS = 100
USED_RADIUS = 100  # a place closer than this to a place already played is not fresh
SCENARIO = re.compile(r"bench:[^:]+:seed(-?\d+):place(\d+)")

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
    check: Callable[
        [State, State], bool
    ]  # (start state, final state) -> goal really reached?
    inventory: dict[str, int] = field(default_factory=dict)  # given at the start
    # Blocks worth knowing about at the start: is one of them within 32 blocks? (a failure without
    # any tree around does not measure the same thing). Block names or game groups ("#logs"), counted
    # by the body over everything it knows, not only what the bot sees.
    watch: tuple[str, ...] = ()

TASKS = {
    "oak_logs": Task(
        name="oak_logs",
        goal="collect 3 oak logs",
        check=lambda start, final: gained(start, final, "oak_log") >= 3,
        watch=("oak_log",),
    ),
    # A chain: logs (any wood) -> planks -> crafting table (4 planks, no table needed)
    "crafting_table": Task(
        name="crafting_table",
        goal="craft a crafting table",
        check=lambda start, final: gained(start, final, "crafting_table") >= 1,
        watch=("#logs",),  # every wood: the biome decides the trees
    ),
}


def draw_places(seed: int, n: int) -> list[tuple[int, int]]:
    """n places (x, z), always the same for a given seed (and the first ones do not depend on n)."""
    rng = random.Random(seed)
    return [
        (rng.randint(-SPREAD, SPREAD), rng.randint(-SPREAD, SPREAD)) for _ in range(n)
    ]


def used_places(path: pathlib.Path) -> list[tuple[int, int]]:
    """The places (x, z) of every bench episode in an episodes.jsonl, from their scenario."""
    if not path.exists():
        return []
    used = set()
    for events in load_episodes(path).values():
        match = SCENARIO.fullmatch(events[0].get("scenario") or "")
        if match:
            seed, index = int(match[1]), int(match[2])
            used.add(draw_places(seed, index + 1)[index])
    return sorted(used)


def is_fresh(x: int, z: int, used: list[tuple[int, int]]) -> bool:
    return all(math.hypot(x - ux, z - uz) >= USED_RADIUS for ux, uz in used)


def run_place(
    task: Task,
    body: Body,
    llm: Any,
    place: int,
    x: int,
    z: int,
    seed: int,
    max_turns: int,
    goal_condition: bool = True,
    sight: bool = True,
) -> dict[str, Any]:
    """Set the place up, run one episode, and check the result. Returns one record.
    sight: the bot perceives only what is in line of sight (False: everything the client knows)."""
    record: dict[str, Any] = {"place": place, "x": x, "z": z}
    setup = body.setup(
        x, z, task.inventory, perception="sight" if sight else "all", count_blocks=list(task.watch)
    )
    if not setup["success"]:
        return {
            **record,
            "setup_failed": setup["reason"],
            "setup_details": setup.get("details"),
        }
    start = body.state()
    counted = (setup.get("details") or {}).get("blocks_within_32") or {}
    record["watched_near"] = any(n > 0 for n in counted.values()) if task.watch else None

    outcome = run_episode(
        task.goal,
        body,
        llm,
        max_turns=max_turns,
        scenario=f"bench:{task.name}:seed{seed}:place{place}",
        goal_condition=goal_condition,
    )
    events = load_episodes_of(body, outcome["episode_id"])
    transitions = load_transitions(
        pathlib.Path(body.run()["data_dir"]) / "transitions.jsonl",
        outcome["episode_id"],
    )
    end = events[-1] if events[-1]["type"] == "episode_end" else {}
    final = end.get("final_state") or body.state()
    turns = [
        e for e in events if e["type"] == "llm_turn" and not goals.is_definition_turn(e)
    ]
    return {
        **record,
        "episode_id": outcome["episode_id"],
        "verified": task.check(start, final),
        "claimed": outcome[
            "success"
        ],  # the agent said reached: the LLM, or the code (condition_met)
        "condition": outcome.get("condition"),
        "end": outcome["reason"],
        "turns": len(turns),
        "unusable": sum(1 for t in turns if t.get("parse_error")),
        "skill_calls": outcome["skill_calls"],
        # Which skills failed and why: a skill to fix in the body, not the LLM's fault
        "failures": [
            f"{t['skill']['name']}:{t['reason']}"
            for t in transitions
            if not t["success"]
        ],
        "duration": (end.get("outcome") or {}).get("duration"),
    }


def load_episodes_of(body: Body, episode_id: str) -> list[dict[str, Any]]:
    """The events of one episode, from the run's episodes.jsonl (where run_episode wrote them)."""
    path = pathlib.Path(body.run()["data_dir"]) / "episodes.jsonl"
    return load_episodes(path)[episode_id]


# The components that can be switched on and off, as run_place's arguments: (name on, name off)
COMPONENTS = {"goal_condition": ("condition", "no condition"), "sight": ("sight", "x-ray")}


def variant_name(options: dict[str, bool]) -> str:
    """e.g. "condition, sight" or "no condition, x-ray"."""
    return ", ".join(on if options[c] else off for c, (on, off) in COMPONENTS.items())


def summarize(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Rates and counts over the episodes that could be set up."""
    ran = [r for r in records if "setup_failed" not in r]
    ends: dict[str, int] = {}
    failures: dict[str, int] = {}
    for r in ran:
        ends[r["end"]] = ends.get(r["end"], 0) + 1
        for f in r.get("failures", []):
            failures[f] = failures.get(f, 0) + 1
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
        "skill_failures": failures,  # "skill:reason" -> how many, over all episodes
    }


def format_record(r: dict[str, Any]) -> str:
    where = f"[{r['place']}] ({r['x']}, {r['z']})"
    if "setup_failed" in r:
        return f"{where}: setup failed ({r['setup_failed']}), replaced by the next place  {r.get('setup_details')}"
    verdict = "REACHED" if r["verified"] else "NOT REACHED"
    claim = "claimed" if r["claimed"] else f"not claimed, ended by {r['end']}"
    near = (
        ""
        if r["watched_near"] is None
        else f", watched block within 32: {'yes' if r['watched_near'] else 'no'}"
    )
    condition = f", condition {r['condition']['have']}" if r.get("condition") else ""
    # Skills that failed ON THE WAY (the episode may still reach its goal): what to fix in the body
    failures = f", skill failures on the way: {', '.join(r['failures'])}" if r.get("failures") else ""
    return (
        f"{where}: {verdict} ({claim}), {r['turns']} turns, {r['skill_calls']} skill calls, "
        f"{r['unusable']} unusable, {r['duration']} s{near}{condition}{failures}  {r['episode_id']}"
    )


def _counts(counts: dict[str, int]) -> str:
    return (
        ", ".join(f"{k} {v}" for k, v in sorted(counts.items(), key=lambda kv: -kv[1]))
        or "none"
    )


def format_summary(task: Task, s: dict[str, Any], variant: str = "") -> str:
    return (
        f"{task.name}{f' ({variant})' if variant else ''}: reached {s['verified']}/{s['episodes']} ({s['rate']} %), median {s['median_turns']} turns, "
        f"{s['unusable_answers']} unusable answers | agent claimed {s['claimed']} "
        f"(wrongly {s['claimed_but_false']}), reached but not claimed {s['reached_not_claimed']} | "
        f"endings: {_counts(s['ends'])} | skill failures: {_counts(s['skill_failures'])} | setup failed {s['setup_failed']}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run the LLM agent on a task in random places."
    )
    parser.add_argument("--task", default="oak_logs", choices=list(TASKS))
    parser.add_argument("--places", type=int, default=5)
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument(
        "--only", type=int, default=None, help="run only this place index"
    )
    parser.add_argument("--max-turns", type=int, default=10)
    parser.add_argument(
        "--no-condition",
        action="store_true",
        help="no goal condition: only goal_reached",
    )
    parser.add_argument(
        "--xray",
        action="store_true",
        help="the bot perceives everything the client knows, walls or not (default: line of sight)",
    )
    parser.add_argument(
        "--compare",
        choices=["condition", "sight"],
        default=None,
        help="alternate with / without ONE component, place after place (the others as given)",
    )
    args = parser.parse_args()

    task = TASKS[args.task]
    llm = OpenAICompatibleLLM()
    base = {"goal_condition": not args.no_condition, "sight": not args.xray}
    if args.compare:
        key = "goal_condition" if args.compare == "condition" else args.compare
        variants = [{**base, key: True}, {**base, key: False}]
    else:
        variants = [base]
    with Body() as body:
        used = used_places(pathlib.Path(body.run()["data_dir"]) / "episodes.jsonl")
        # Candidates in a fixed order: used places are skipped, then the places that cannot be set up
        if args.only is not None:
            candidates, wanted = (
                [(args.only, draw_places(args.seed, args.only + 1)[args.only])],
                1,
            )
            if not is_fresh(*candidates[0][1], used):
                print(
                    f"WARNING: place {args.only} was already played: the world there has changed"
                )
        else:
            wanted = args.places
            candidates = [
                (i, p)
                for i, p in enumerate(draw_places(args.seed, MAX_DRAWS))
                if is_fresh(*p, used)
            ]
        print(
            f"=== Bench {task.name} ({task.goal!r}): {wanted} place(s), seed {args.seed}, LLM {llm.model}, "
            f"{' / '.join(variant_name(v) for v in variants)}, {len(used)} place(s) already used ==="
        )
        records = []
        for place, (x, z) in candidates:
            options = variants[
                sum("setup_failed" not in r for r in records) % len(variants)
            ]
            records.append(
                {
                    **run_place(
                        task,
                        body,
                        llm,
                        place,
                        x,
                        z,
                        args.seed,
                        args.max_turns,
                        **options,
                    ),
                    "variant": variant_name(options),
                }
            )
            print(
                f"{format_record(records[-1])}  [{records[-1]['variant']}]", flush=True
            )
            if sum("setup_failed" not in r for r in records) == wanted:
                break
        else:
            print(
                f"only {sum('setup_failed' not in r for r in records)} of {wanted} places could be set up"
            )
    print("\n=== Summary ===")
    for v in variants:
        name = variant_name(v)
        group = [r for r in records if r["variant"] == name]
        print(format_summary(task, summarize(group), name if len(variants) > 1 else ""))


if __name__ == "__main__":
    main()
