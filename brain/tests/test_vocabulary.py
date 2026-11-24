"""Append-only vocabularies (brain/world_model/inputs/vocabulary.py)."""

import json

import pytest

from brain.world_model.inputs.variables import UNKNOWN
from brain.world_model.inputs.vocabulary import VOCAB_DIR, vocabulary


def test_first_time_unknown_then_sorted(tmp_path):
    assert vocabulary("v", {"plains", "desert"}, tmp_path) == [UNKNOWN, "desert", "plains"]
    assert json.loads((tmp_path / "v.json").read_text()) == [UNKNOWN, "desert", "plains"]


def test_a_new_name_goes_at_the_end_and_old_indexes_do_not_move(tmp_path):
    vocabulary("v", {"plains", "desert"}, tmp_path)
    # "beach" would come first alphabetically: it is added at the end instead
    assert vocabulary("v", {"plains", "desert", "beach"}, tmp_path) == [UNKNOWN, "desert", "plains", "beach"]


def test_a_name_the_game_no_longer_has_keeps_its_place(tmp_path):
    vocabulary("v", {"plains", "desert"}, tmp_path)
    assert vocabulary("v", {"plains"}, tmp_path) == [UNKNOWN, "desert", "plains"]


def test_the_file_is_not_rewritten_when_nothing_is_new(tmp_path):
    vocabulary("v", {"plains"}, tmp_path)
    path = tmp_path / "v.json"
    before = path.stat().st_mtime_ns
    vocabulary("v", {"plains"}, tmp_path)
    assert path.stat().st_mtime_ns == before


def test_a_broken_file_is_refused(tmp_path):
    (tmp_path / "a.json").write_text(json.dumps(["plains", UNKNOWN]))
    (tmp_path / "b.json").write_text(json.dumps([UNKNOWN, "plains", "plains"]))
    with pytest.raises(ValueError):
        vocabulary("a", set(), tmp_path)
    with pytest.raises(ValueError):
        vocabulary("b", set(), tmp_path)


def test_the_committed_vocabularies_start_with_unknown():
    for path in VOCAB_DIR.glob("*.json"):
        words = json.loads(path.read_text())
        assert words[0] == UNKNOWN and len(words) == len(set(words)), path.name
