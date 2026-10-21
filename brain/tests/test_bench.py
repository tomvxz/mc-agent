"""Tests of brain/bench.py: one bench episode with a fake LLM and a fake body (no Minecraft)."""

import json

from brain import bench
from brain.llm import FakeLLM
from brain.tests.fakes import FakeBody, ok


def plan(*steps, done=False):
    return {"plan": [{"skill": s, "args": a} for s, a in steps], "done": done}


def test_the_places_are_the_same_for_a_seed():
    assert bench.draw_places(1, 3) == bench.draw_places(1, 3)
    assert bench.draw_places(1, 3) != bench.draw_places(2, 3)
    assert (
        bench.draw_places(1, 3) == bench.draw_places(1, 9)[:3]
    )  # replacements come after: places 0-2 unchanged
    assert all(
        abs(x) <= bench.SPREAD and abs(z) <= bench.SPREAD
        for x, z in bench.draw_places(1, 20)
    )


def test_one_place_is_set_up_run_and_checked_on_the_state(tmp_path):
    body = FakeBody(lambda name, args: ok(), data_dir=str(tmp_path))

    def collect(name, args):
        inventory = body.state["inventory"]
        body.state = {
            **body.state,
            "inventory": {**inventory, "oak_log": inventory.get("oak_log", 0) + 1},
        }
        return ok()

    body.execute = collect
    llm = FakeLLM(
        [
            plan(
                ("define_goal", {"item": "oak_log", "count": 3})
            ),  # the goal condition, before the loop
            plan(*[("collect_block", {"x": 1, "y": 64, "z": i}) for i in range(3)]),
        ]
    )
    task = bench.TASKS["oak_logs"]
    r = bench.run_place(
        task, body.client(), llm, place=4, x=10, z=-20, seed=1, max_turns=5
    )

    assert body.setups == [
        {"x": 10, "z": -20, "inventory": {}, "perception": "sight", "count_blocks": ["oak_log"]}
    ]
    # The code saw 3 oak_log and ended the episode: no turn for goal_reached, the definition not counted
    assert (r["verified"], r["claimed"], r["end"], r["turns"], r["skill_calls"]) == (
        True,
        True,
        "condition_met",
        1,
        3,
    )
    assert r["condition"] == {"have": {"oak_log": 3}}
    assert r["watched_near"] is True  # the fake setup counted oak_log around
    assert "[4] (10, -20): REACHED (claimed), 1 turns" in bench.format_record(r)


def test_the_crafting_table_task_is_checked_on_the_state(tmp_path):
    body = FakeBody(lambda name, args: ok(), data_dir=str(tmp_path))
    gives = {"mine": "birch_log", "craft": None}  # craft gives the item it was asked for

    def execute(name, args):
        item = gives[name] or args["item"]
        inventory = body.state["inventory"]
        body.state = {
            **body.state,
            "inventory": {**inventory, item: inventory.get(item, 0) + 1},
        }
        return ok()

    body.execute = execute
    llm = FakeLLM(
        [
            plan(("define_goal", {"item": "crafting_table"})),
            plan(
                ("mine", {"block": "birch_log", "count": 1}),
                ("craft", {"item": "birch_planks", "count": 4}),
                ("craft", {"item": "crafting_table"}),
            ),
        ]
    )
    task = bench.TASKS["crafting_table"]
    r = bench.run_place(
        task, body.client(), llm, place=0, x=0, z=0, seed=1, max_turns=5
    )

    assert (r["verified"], r["end"], r["turns"], r["skill_calls"]) == (
        True,
        "condition_met",
        1,
        3,
    )
    assert r["watched_near"] is True  # any wood counts (#logs, counted by the setup)
    assert r["failures"] == []  # no transitions.jsonl here: the fake body logs nothing


def test_claimed_and_verified_are_counted_apart():
    base = {"turns": 4, "unusable": 0, "end": "done"}
    records = [
        {**base, "verified": True, "claimed": True},
        {**base, "verified": False, "claimed": True, "failures": ["craft:no_crafting_table"]},  # the LLM said done, it was not
        {
            **base,
            "verified": True,
            "claimed": False,
            "end": "max_turns",
            "unusable": 2,
            "failures": ["craft:no_crafting_table", "mine:no_path"],
        },
        {"place": 3, "setup_failed": "not_moved"},
    ]
    s = bench.summarize(records)
    assert (s["episodes"], s["setup_failed"], s["verified"], s["rate"]) == (3, 1, 2, 67)
    assert (s["claimed"], s["claimed_but_false"], s["reached_not_claimed"]) == (2, 1, 1)
    assert s["unusable_answers"] == 2 and s["ends"] == {"done": 2, "max_turns": 1}
    assert s["skill_failures"] == {"craft:no_crafting_table": 2, "mine:no_path": 1}
    assert "skill failures: craft:no_crafting_table 2, mine:no_path 1" in bench.format_summary(
        bench.TASKS["oak_logs"], s
    )


def test_a_place_already_played_is_not_fresh(tmp_path):
    path = tmp_path / "episodes.jsonl"
    played = [
        {"type": "episode_start", "episode_id": f"ep-{i}", "scenario": s}
        for i, s in enumerate(["bench:oak_logs:seed1:place2", "arena:trees_3", None])
    ]
    path.write_text("".join(json.dumps(e) + "\n" for e in played))
    used = bench.used_places(path)
    assert used == [bench.draw_places(1, 3)[2]]  # only the bench scenario counts
    x, z = used[0]
    assert not bench.is_fresh(x + 50, z, used) and bench.is_fresh(
        x + bench.USED_RADIUS, z, used
    )
    assert bench.used_places(tmp_path / "missing.jsonl") == []
