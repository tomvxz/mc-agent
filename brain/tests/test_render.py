"""Tests of brain/render.py: what the LLM reads."""

from brain import render
from brain.tests.fakes import CATALOGUE, STATE


def test_the_state_view_gives_absolute_coordinates_and_skips_the_grid():
    text = render.render_state({**STATE, "blocks": {"cells": [0] * 1331}})
    assert "Position: (100, 64, -21)" in text
    assert "food 18/20" in text
    assert "Inventory: empty." in text
    assert "cow 9 blocks north" in text
    assert "oak_log: 9 within 32, nearest at (104, 64, -19)" in text  # 100.5+3.5, -20.5+1.5
    assert "cells" not in text


def test_unavailable_state():
    assert "unavailable" in render.render_state(None)


def test_skills_in_the_system_prompt():
    prompt = render.system_prompt(CATALOGUE)
    assert "- mine(block, count=1): Get count blocks of a type." in prompt
    assert "Can fail with: block_not_found." in prompt
    assert '{"plan": [{"skill"' in prompt  # the literal JSON example survived str.format


def test_results_explain_failures_with_the_catalogue():
    results = [
        {"skill": "mine", "args": {"block": "oak_log", "count": 3}, "result": {"success": True, "reason": "ok", "details": {"dug": 3}}},
        {"skill": "craft", "args": {"item": "wooden_pickaxe"}, "result": {"success": False, "reason": "no_crafting_table", "details": {}}},
    ]
    text = render.render_results(results, CATALOGUE, STATE)
    assert "1. mine(block='oak_log', count=3): ok {'dug': 3}" in text
    assert "2. craft(item='wooden_pickaxe'): FAILED, reason no_crafting_table (the recipe needs a crafting_table" in text
    assert "Position:" in text  # followed by the new state


def test_enum_values_are_shown():
    catalogue = {"skills": {"explore": {"description": "Head in a direction.", "reasons": {"invalid_args": "x"},
        "parameters": {"type": "object", "properties": {"direction": {"type": "string", "enum": ["north", "south_west"]},
                                                        "distance": {"type": "number", "default": 32}},
                       "required": ["direction"]}}}}
    assert "explore(direction (one of: north, south_west), distance=32)" in render.render_skills(catalogue)


def test_damage_death_and_repeated_failure_are_reported():
    results = [{"skill": "mine", "args": {"block": "oak_log"},
                "result": {"success": True, "reason": "ok", "details": {}, "body_events": {"damage_taken": 8, "died": False}}}]
    after = {**STATE, "deaths": 1, "position": [-63.5, 33, 91.5]}
    text = render.render_results(results, CATALOGUE, after, previous_state={**STATE, "deaths": 0}, repeated_failure=True)
    assert "(you took 8 damage)" in text
    assert "WARNING: you died since your last plan. You respawned at (-64, 33, 91) and lost your inventory." in text
    assert "already tried exactly this" in text


def test_health_change_without_death():
    text = render.render_results([], CATALOGUE, {**STATE, "health": 12}, previous_state=STATE)
    assert "Health went down: 20 -> 12." in text
