"""The first features of the world model (brain/world_model/inputs/data_processing.py)."""

import copy
import math

import pytest

from brain.world_model.inputs.data_processing import (
    drop_reason,
    state_features,
    state_vector,
)
from brain.world_model.inputs.variables import FEATURE_NAMES


def a_state(**changes):
    """A state with the fields and types of a real journal line (v11), only the ones used here."""
    state = {
        "position": [-698.5, 76, -946.6],
        "yaw": math.pi,
        "pitch": 0,
        "velocity": [0, -0.078, 0],
        "on_ground": True,
        "in_water": False,
        "in_lava": False,
        "on_fire": False,
        "sneaking": False,
        "sprinting": False,
        "sleeping": False,
        "fall_distance": 0,
        "health": 20,
        "food": 10,
        "food_saturation": 5,
        "oxygen": None,
        "xp_level": 0,
        "xp_points": 0,
        "xp_progress": 0,
        "light": 15,
        "sky_light": 15,
        "time_of_day": 6000,
        "moon_phase": 0,
        "raining": False,
        "thunder": False,
        "difficulty": "easy",
        "biome": "plains",
        "deaths": 0,
        "inventory_slots": [{"slot": 36, "name": "oak_log", "count": 3}, {"slot": 5, "name": "iron_helmet", "count": 1}],
    }
    state.update(changes)
    return state


def a_line(**changes):
    line = {
        "schema_version": 11,
        "state": a_state(),
        "next_state": a_state(),
        "trace": {"events": []},
        "duration": 10,
        "tick_start": 1000,
        "tick_end": 1200,
        "error": None,
        "success": False,  # failures are data: kept
    }
    line.update(changes)
    return line


def test_scaled_values():
    f = state_features(a_state())
    assert (f["health"], f["food"], f["food_saturation"]) == (1, 0.5, 0.25)
    assert f["y"] == (76 - (319 - 64) / 2) / ((319 + 64) / 2)
    assert f["difficulty"] == "easy"  # kept as a string for now
    assert (f["on_ground"], f["in_water"]) == (1, 0)


def test_angles():
    f = state_features(a_state(yaw=math.pi, pitch=-math.pi / 2, time_of_day=6000, moon_phase=4))
    # yaw and pitch are in radians in the journal
    assert math.isclose(f["sin_yaw"], 0, abs_tol=1e-9) and math.isclose(f["cos_yaw"], -1)
    assert f["pitch"] == -1
    # noon = a quarter of the day after sunrise; phase 4 = new moon, opposite to the full moon
    assert math.isclose(f["sin_time_of_day"], 1) and math.isclose(f["cos_time_of_day"], 0, abs_tol=1e-9)
    assert math.isclose(f["cos_moon_phase"], -1)
    # the end of a cycle is close to its start
    late, early = state_features(a_state(time_of_day=23990)), state_features(a_state(time_of_day=10))
    assert abs(late["sin_time_of_day"] - early["sin_time_of_day"]) < 0.01
    assert abs(late["cos_time_of_day"] - early["cos_time_of_day"]) < 0.01


def test_null_oxygen_means_full_air():
    assert state_features(a_state(oxygen=None))["oxygen"] == 1
    assert state_features(a_state(oxygen=10))["oxygen"] == 0.5


def test_a_missing_required_field_is_an_error():
    state = a_state()
    del state["health"]
    with pytest.raises(KeyError):
        state_features(state)


def test_free_slots_count_only_the_storage():
    # slot 5 is the helmet: it does not take room in the backpack
    assert state_features(a_state())["free_slots"] == 35 / 36
    full = [{"slot": i, "name": "dirt", "count": 64} for i in range(9, 45)]
    assert state_features(a_state(inventory_slots=full))["free_slots"] == 0


def test_biome():
    f = state_features(a_state(biome="snowy_plains"))
    assert (f["biome_snows"], f["biome_has_precipitation"]) == (1, 1)
    assert f["biome_index"] > 0 and f["biome_category_index"] > 0
    assert state_features(a_state(biome=None))["biome_index"] == 0  # unknown


def test_the_vector_follows_feature_names():
    assert list(state_features(a_state())) == FEATURE_NAMES
    vector = state_vector(a_state())
    assert len(vector) == len(FEATURE_NAMES)
    assert all(isinstance(v, str) if name == "difficulty" else isinstance(v, float) for name, v in zip(FEATURE_NAMES, vector))


def test_the_state_is_not_modified():
    state = a_state()
    before = copy.deepcopy(state)
    state_features(state)
    assert state == before


def test_which_lines_are_dropped():
    assert drop_reason(a_line()) is None  # a failure is kept
    assert drop_reason(a_line(schema_version=9)) == "schema_version 9"
    assert drop_reason(a_line(error="TypeError: ...")) == "error"
    assert drop_reason(a_line(trace={"events": [{"type": "pickup"}, {"type": "death"}]})) == "death"
    # a step has no trace: its death is seen in the death counter
    assert drop_reason(a_line(trace=None, next_state=a_state(deaths=1))) == "death"
    # 200 ticks in 20 s = 10 ticks/s: the server was too slow
    assert drop_reason(a_line(duration=20)) == "slow server"
    # too short to measure the tick rate: kept
    assert drop_reason(a_line(duration=0.5, tick_end=1001)) is None
