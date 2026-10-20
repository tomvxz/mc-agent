"""Tests of brain/bench.py: one bench episode with a fake LLM and a fake body (no Minecraft)."""

from brain import bench
from brain.llm import FakeLLM
from brain.tests.fakes import FakeBody, ok


def plan(*steps, done=False):
    return {"plan": [{"skill": s, "args": a} for s, a in steps], "done": done}


def test_the_places_are_the_same_for_a_seed():
    assert bench.draw_places(1, 3) == bench.draw_places(1, 3)
    assert bench.draw_places(1, 3) != bench.draw_places(2, 3)
    assert all(abs(x) <= bench.SPREAD and abs(z) <= bench.SPREAD for x, z in bench.draw_places(1, 20))


def test_one_place_is_set_up_run_and_checked_on_the_state(tmp_path):
    body = FakeBody(lambda name, args: ok(), data_dir=str(tmp_path))

    def collect(name, args):
        inventory = body.state["inventory"]
        body.state = {**body.state, "inventory": {**inventory, "oak_log": inventory.get("oak_log", 0) + 1}}
        return ok()

    body.execute = collect
    llm = FakeLLM([plan(*[("collect_block", {"x": 1, "y": 64, "z": i}) for i in range(3)]), plan(done=True)])
    task = bench.TASKS["oak_logs"]
    r = bench.run_place(task, body.client(), llm, place=4, x=10, z=-20, seed=1, max_turns=5)

    assert body.setups == [{"x": 10, "z": -20, "inventory": {}}]
    assert (r["verified"], r["claimed"], r["end"], r["turns"], r["skill_calls"]) == (True, True, "done", 2, 3)
    assert r["watched_near"] is True  # the fake state has oak_log in notable_blocks
    assert "[4] (10, -20): REACHED (claimed), 2 turns" in bench.format_record(r)


def test_claimed_and_verified_are_counted_apart():
    base = {"turns": 4, "unusable": 0, "end": "done"}
    records = [
        {**base, "verified": True, "claimed": True},
        {**base, "verified": False, "claimed": True},  # the LLM said done, it was not
        {**base, "verified": True, "claimed": False, "end": "max_turns", "unusable": 2},
        {"place": 3, "setup_failed": "not_moved"},
    ]
    s = bench.summarize(records)
    assert (s["episodes"], s["setup_failed"], s["verified"], s["rate"]) == (3, 1, 2, 67)
    assert (s["claimed"], s["claimed_but_false"], s["reached_not_claimed"]) == (2, 1, 1)
    assert s["unusable_answers"] == 2 and s["ends"] == {"done": 2, "max_turns": 1}
