"""Tests of brain/journal.py: episodes are written to a temporary file, never to data/."""

import json
import re

import pytest

from brain.journal import SCHEMA_VERSION, EpisodeLog, new_episode_id


def read(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def start(log, **extra):
    log.start(
        goal="craft a wooden pickaxe",
        model={"provider": "fake", "name": "fake-1", "params": {"temperature": 0}},
        system_prompt="You are a Minecraft agent.",
        tools=[{"name": "propose_plans"}],
        max_turns=10,
        **extra,
    )


def test_episode_id_format():
    assert re.fullmatch(r"ep-\d{8}-\d{6}-[0-9a-f]{4}", new_episode_id())
    assert new_episode_id() != new_episode_id()


def test_a_full_episode_is_a_stream_of_numbered_events(tmp_path):
    path = tmp_path / "episodes.jsonl"
    with EpisodeLog(path=path) as log:
        start(log, run_id="run-x", scenario="arena:trees_3")
        first = log.turn(
            new_messages=[{"role": "user", "content": "goal..."}],
            raw_response={"choices": []},
            plan=[{"skill": "mine", "args": {"block": "oak_log", "count": 3}}],
            latency=1.5,
            tokens={"prompt": 100, "completion": 20},
        )
        second = log.turn(
            new_messages=[], raw_response="text", plan=None, parse_error="no tool call"
        )
        log.end(success=True, reason="done", skill_calls=4, final_state={"health": 20})

    events = read(path)
    assert [e["type"] for e in events] == [
        "episode_start",
        "llm_turn",
        "llm_turn",
        "episode_end",
    ]
    assert [e["seq"] for e in events] == [0, 1, 2, 3]
    assert (first, second) == (0, 1)
    assert {e["episode_id"] for e in events} == {log.episode_id}
    assert all(e["schema_version"] == SCHEMA_VERSION for e in events)
    assert all(
        re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z", e["ts"]) for e in events
    )

    begin, turn0, turn1, end = events
    assert begin["scenario"] == "arena:trees_3"
    assert begin["run_id"] == "run-x"
    assert begin["code_version"]  # a commit, possibly +dirty, or "unknown"
    assert turn0["plan"][0]["skill"] == "mine" and turn0["missing_capability"] is None
    assert turn1["parse_error"] == "no tool call" and turn1["plan"] is None
    assert end["outcome"]["turns"] == 2  # counted by EpisodeLog
    assert end["outcome"]["skill_calls"] == 4
    assert end["outcome"]["duration"] >= 0
    assert end["final_state"] == {"health": 20}


def test_scenario_is_absent_when_not_given(tmp_path):
    path = tmp_path / "episodes.jsonl"
    log = EpisodeLog(path=path)
    start(log)
    assert "scenario" not in read(path)[0]


def test_a_crash_still_writes_an_episode_end(tmp_path):
    path = tmp_path / "episodes.jsonl"
    with pytest.raises(ZeroDivisionError):  # the exception is not swallowed
        with EpisodeLog(path=path) as log:
            start(log)
            1 / 0  # type: ignore
    end = read(path)[-1]
    assert end["type"] == "episode_end"
    assert end["outcome"]["reason"] == "crash"
    assert end["outcome"]["skill_calls"] is None
    assert "ZeroDivisionError" in end["outcome"]["error"]


def test_ctrl_c_is_recorded_as_interrupted(tmp_path):
    path = tmp_path / "episodes.jsonl"
    with pytest.raises(KeyboardInterrupt):
        with EpisodeLog(path=path) as log:
            start(log)
            raise KeyboardInterrupt
    assert read(path)[-1]["outcome"]["reason"] == "interrupted"


def test_events_in_the_wrong_order_are_refused(tmp_path):
    log = EpisodeLog(path=tmp_path / "episodes.jsonl")
    with pytest.raises(RuntimeError):
        log.turn(new_messages=[], raw_response=None, plan=None)  # before start
    start(log)
    with pytest.raises(RuntimeError):
        start(log)  # twice
    with pytest.raises(ValueError):
        log.end(success=False, reason="tired", skill_calls=0)  # unknown reason
    log.end(success=False, reason="max_turns", skill_calls=0)
    with pytest.raises(RuntimeError):
        log.end(success=False, reason="done", skill_calls=0)  # already ended


def test_episodes_file_env_variable(tmp_path, monkeypatch):
    path = tmp_path / "elsewhere" / "episodes.jsonl"  # the folder does not exist yet
    monkeypatch.setenv("EPISODES_FILE", str(path))
    log = EpisodeLog()
    start(log)
    assert read(path)[0]["type"] == "episode_start"


def test_unusual_objects_in_the_raw_response_do_not_lose_the_line(tmp_path):
    path = tmp_path / "episodes.jsonl"
    log = EpisodeLog(path=path)
    start(log)
    log.turn(new_messages=[], raw_response={"when": object()}, plan=None)
    assert read(path)[1]["raw_response"]["when"].startswith("<object")
