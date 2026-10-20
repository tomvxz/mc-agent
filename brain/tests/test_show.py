"""Tests of brain/show.py: an episode logged by the real loop, shown as text."""

import json

from brain.agent import run_episode
from brain.llm import FakeLLM
from brain.show import load_episodes, show
from brain.tests.fakes import FakeBody, failed, ok


def plan(*steps, done=False):
    return {"plan": [{"skill": s, "args": a} for s, a in steps], "done": done}


def test_an_episode_is_shown_turn_by_turn(tmp_path):
    body = FakeBody(lambda name, args: ok(dug=1) if name == "mine" else failed("no_crafting_table"))
    llm = FakeLLM([
        plan(("mine", {"block": "oak_log"}), ("craft", {"item": "wooden_pickaxe"}), ("mine", {"block": "stone"})),
        "goal_reached()",  # written as text: unusable
        plan(done=True),
    ])
    path = tmp_path / "episodes.jsonl"
    outcome = run_episode("pickaxe", body.client(), llm, episodes_file=path)

    # The transitions as the body would log them (the fake body does not write any)
    transitions = [
        {"episode_id": outcome["episode_id"], "turn": 0, "seq": 0, "success": True, "reason": "ok", "details": {"dug": 1}},
        {"episode_id": outcome["episode_id"], "turn": 0, "seq": 1, "success": False, "reason": "no_crafting_table", "details": {}},
    ]
    text = show(load_episodes(path)[outcome["episode_id"]], transitions)

    assert "goal: 'pickaxe'" in text
    assert "-> mine(block='oak_log')  ok" in text and '{"dug": 1}' in text
    assert "-> craft(item='wooden_pickaxe')  FAILED no_crafting_table" in text
    assert "-> mine(block='stone')  (not run)" in text  # after the failure
    assert "UNUSABLE: no tool call" in text and "the LLM wrote: goal_reached()" in text
    assert "\n  goal_reached\n" in text
    assert "END  SUCCESS (done)  3 turns, 2 skill calls" in text
    assert "| user: Goal: pickaxe" not in text
    assert "| user: Goal: pickaxe" in show(load_episodes(path)[outcome["episode_id"]], transitions, full=True)


def test_an_unfinished_episode_says_so(tmp_path):
    path = tmp_path / "episodes.jsonl"
    start = {"type": "episode_start", "episode_id": "ep-1", "goal": "wood", "model": {"name": "m"}}
    path.write_text(json.dumps(start) + "\n")
    assert "no episode_end" in show(load_episodes(path)["ep-1"], [])
