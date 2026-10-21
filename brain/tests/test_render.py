"""Tests of brain/render.py: what the LLM reads."""

from brain import render
from brain.tests.fakes import CATALOGUE, STATE


def test_the_state_view_gives_absolute_coordinates_and_skips_the_grid():
    text = render.render_state(STATE)
    assert "Position: (100, 64, -21), standing on grass_block." in text  # read from the grid
    assert "food 18/20" in text
    assert "Inventory: empty." in text
    assert "cow 9 blocks north" in text
    assert "zombie" not in text  # behind a wall: not perceived (perception "sight")
    assert "zombie" in render.render_state({**STATE, "perception": "all"})
    assert "In sight: oak_log x2, nearest at (104, 64, -19)." in text  # 100.5+3.5, -20.5+1.5
    assert "cells" not in text


def test_unavailable_state():
    assert "unavailable" in render.render_state(None)


def test_each_skill_is_a_tool_plus_the_two_others():
    tools = render.skill_tools(CATALOGUE)
    assert [t["function"]["name"] for t in tools] == ["mine", "craft", "goal_reached", "missing_capability"]
    mine = tools[0]["function"]
    assert mine["description"] == "Get count blocks of a type. Can fail with: block_not_found."
    # Ollama does not pass "default" to the model: it is written in the description
    assert mine["parameters"]["properties"]["count"] == {"type": "integer", "description": "(default 1)"}
    assert "default" in CATALOGUE["skills"]["mine"]["parameters"]["properties"]["count"]  # not changed


def test_results_explain_failures_with_the_catalogue():
    ok_step = {"skill": "mine", "args": {"block": "oak_log", "count": 3}, "result": {"success": True, "reason": "ok", "details": {"dug": 3}}}
    failed_step = {"skill": "craft", "args": {"item": "wooden_pickaxe"}, "result": {"success": False, "reason": "no_crafting_table", "details": {}}}
    assert render.render_result(ok_step, CATALOGUE) == "mine(block='oak_log', count=3): ok {'dug': 3}"
    assert render.render_result(failed_step, CATALOGUE).startswith(
        "craft(item='wooden_pickaxe'): FAILED, reason no_crafting_table (the recipe needs a crafting_table")


def test_damage_death_and_repeated_failure_are_reported():
    step = {"skill": "mine", "args": {"block": "oak_log"},
            "result": {"success": True, "reason": "ok", "details": {}, "body_events": {"damage_taken": 8, "died": False}}}
    assert "(you took 8 damage)" in render.render_result(step, CATALOGUE)
    after = {**STATE, "deaths": 1, "position": [-63.5, 33, 91.5]}
    text = render.render_new_state(after, previous_state={**STATE, "deaths": 0}, repeated_failure=True)
    assert "WARNING: you died since your last plan. You respawned at (-64, 33, 91) and lost your inventory." in text
    assert "already tried exactly this" in text


def test_health_change_without_death():
    text = render.render_new_state({**STATE, "health": 12}, previous_state=STATE)
    assert "Health went down: 20 -> 12." in text


def test_goal_and_state_messages_end_with_the_next_step_reminder():
    assert render.render_goal("wood", STATE).endswith(render.NEXT_STEP)
    assert render.render_new_state(STATE).endswith(render.NEXT_STEP)

