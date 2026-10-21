"""Tests of brain/agent.py: the loop, with a fake LLM and a fake body (no Minecraft, no LLM)."""

import json

from brain import render
from brain.agent import run_episode
from brain.llm import FakeLLM
from brain.tests.fakes import FakeBody, failed, ok


def events(path):
    return [json.loads(line) for line in path.read_text().splitlines()]


def since_last_answer(messages):
    """The messages the LLM got after its previous answer (tool answers, then the new state)."""
    last = max(i for i, m in enumerate(messages) if m["role"] == "assistant")
    return messages[last + 1:]


def plan(*steps, done=False, missing=None):
    return {"plan": [{"skill": s, "args": a} for s, a in steps], "done": done, "missing_capability": missing}


def test_a_plan_that_works_then_done(tmp_path):
    body = FakeBody(lambda name, args: ok())
    llm = FakeLLM([plan(("mine", {"block": "oak_log", "count": 3}), ("craft", {"item": "oak_planks"})), plan(done=True)])
    outcome = run_episode("get planks", body.client(), llm, episodes_file=tmp_path / "e.jsonl")

    assert (outcome["success"], outcome["reason"], outcome["skill_calls"]) == (True, "done", 2)
    assert [r["name"] for r in body.executed] == ["mine", "craft"]
    # Every call is linked to the episode and to the turn that planned it
    assert {r["episode_id"] for r in body.executed} == {outcome["episode_id"]}
    assert [r["turn"] for r in body.executed] == [0, 0]
    log = events(tmp_path / "e.jsonl")
    assert [e["type"] for e in log] == ["episode_start", "llm_turn", "llm_turn", "episode_end"]
    assert log[0]["run_id"] == "run-test" and "code_version" in log[0]
    # The second LLM call got one answer per call, linked by id, then the new state
    fed_back = since_last_answer(llm.calls[1])
    assert [m["role"] for m in fed_back] == ["tool", "tool", "user"]
    assert fed_back[0]["content"].startswith("mine(block='oak_log', count=3): ok")
    asked = llm.calls[1][-4]["tool_calls"]  # the first answer, put back in the conversation
    assert [m["tool_call_id"] for m in fed_back[:2]] == [c["id"] for c in asked]
    assert fed_back[2]["content"].startswith("New state:")


def test_a_failure_stops_the_plan_and_the_llm_gets_the_reason(tmp_path):
    def execute(name, args):
        return failed("no_crafting_table") if args.get("item") == "wooden_pickaxe" else ok()

    body = FakeBody(execute)
    llm = FakeLLM([
        plan(("craft", {"item": "wooden_pickaxe"}), ("mine", {"block": "stone"})),  # stops after the first
        plan(("craft", {"item": "crafting_table"}), done=True),
    ])
    outcome = run_episode("craft a pickaxe", body.client(), llm, episodes_file=tmp_path / "e.jsonl")

    assert [r["name"] for r in body.executed] == ["craft", "craft"]  # mine was never run
    fed_back = [m["content"] for m in since_last_answer(llm.calls[1])]
    assert "FAILED, reason no_crafting_table (the recipe needs a crafting_table" in fed_back[0]
    assert fed_back[1].startswith("not run")  # mine still gets an answer
    assert outcome["reason"] == "done"  # done=true with a plan that then succeeded


def test_an_unusable_answer_is_explained_and_asked_again(tmp_path):
    body = FakeBody(lambda name, args: ok())
    llm = FakeLLM(["I think I should mine some wood.", plan(done=True)])
    outcome = run_episode("anything", body.client(), llm, episodes_file=tmp_path / "e.jsonl")

    assert outcome["reason"] == "done"
    assert "could not be used" in llm.calls[1][-1]["content"]
    turns = [e for e in events(tmp_path / "e.jsonl") if e["type"] == "llm_turn"]
    assert "no tool call" in turns[0]["parse_error"]


def test_a_first_empty_answer_does_not_use_a_turn(tmp_path):
    body = FakeBody(lambda name, args: failed("block_not_found"))
    llm = FakeLLM(["", plan(("mine", {"block": "diamond_ore"})), "", "", plan(done=True)])
    outcome = run_episode("get diamonds", body.client(), llm, max_turns=3, episodes_file=tmp_path / "e.jsonl")

    # turns: empty (free), plan (1), empty (free), empty again (2), done (3)
    assert outcome["reason"] == "done"
    turns = [e for e in events(tmp_path / "e.jsonl") if e["type"] == "llm_turn"]
    assert len(turns) == 5  # every call is logged, the free ones too


def test_empty_answers_in_a_row_end_up_using_turns(tmp_path):
    body = FakeBody(lambda name, args: ok())
    llm = FakeLLM([""] * 6)
    outcome = run_episode("anything", body.client(), llm, max_turns=3, episodes_file=tmp_path / "e.jsonl")
    assert outcome["reason"] == "max_turns"
    assert len(llm.calls) == 6  # free, counted, free, counted, free, counted


def test_max_turns(tmp_path):
    body = FakeBody(lambda name, args: failed("block_not_found"))
    llm = FakeLLM([plan(("mine", {"block": "diamond_ore"}))] * 3)
    outcome = run_episode("get diamonds", body.client(), llm, max_turns=3, episodes_file=tmp_path / "e.jsonl")
    assert (outcome["success"], outcome["reason"], outcome["skill_calls"]) == (False, "max_turns", 3)


def test_missing_capability_is_logged(tmp_path):
    body = FakeBody(lambda name, args: ok())
    llm = FakeLLM([plan(done=False, missing="open a door"), plan(done=True)])
    run_episode("go inside", body.client(), llm, episodes_file=tmp_path / "e.jsonl")
    turns = [e for e in events(tmp_path / "e.jsonl") if e["type"] == "llm_turn"]
    assert turns[0]["missing_capability"] == "open a door"


def test_the_logged_messages_rebuild_the_exact_conversation(tmp_path):
    body = FakeBody(lambda name, args: ok())
    llm = FakeLLM([plan(("mine", {"block": "oak_log"})), plan(("craft", {"item": "stick"})), plan(done=True)])
    run_episode("sticks", body.client(), llm, episodes_file=tmp_path / "e.jsonl")
    log = events(tmp_path / "e.jsonl")
    start, turns = log[0], [e for e in log if e["type"] == "llm_turn"]
    rebuilt = [{"role": "system", "content": start["system_prompt"]}]
    for n, turn in enumerate(turns):
        rebuilt += turn["new_messages"]
        assert rebuilt == llm.calls[n]  # exactly what the LLM received at turn n


def test_an_llm_error_ends_the_episode(tmp_path):
    body = FakeBody(lambda name, args: ok())
    outcome = run_episode("anything", body.client(), FakeLLM([]), episodes_file=tmp_path / "e.jsonl")
    assert (outcome["success"], outcome["reason"]) == (False, "llm_error")
    assert events(tmp_path / "e.jsonl")[-1]["outcome"]["reason"] == "llm_error"


def test_only_missing_capability_is_answered_and_sent_back(tmp_path):
    body = FakeBody(lambda name, args: ok())
    llm = FakeLLM([plan(missing="fly"), plan(done=True)])  # turn 0: no skill, not done
    outcome = run_episode("anything", body.client(), llm, episodes_file=tmp_path / "e.jsonl")
    assert outcome["reason"] == "done" and body.executed == []
    fed_back = since_last_answer(llm.calls[1])
    assert (fed_back[0]["role"], fed_back[0]["content"]) == ("tool", "noted")
    assert "You called no skill" in fed_back[1]["content"]


def test_goal_reached_after_a_failure_is_not_accepted(tmp_path):
    body = FakeBody(lambda name, args: failed("no_tool"))
    llm = FakeLLM([plan(("mine", {"block": "stone"}), done=True), plan(done=True)])
    run_episode("stone", body.client(), llm, episodes_file=tmp_path / "e.jsonl")
    assert since_last_answer(llm.calls[1])[1]["content"].startswith("not accepted")


def test_a_repeated_failure_gets_a_warning(tmp_path):
    body = FakeBody(lambda name, args: failed("no_tool"))
    same = plan(("mine", {"block": "iron_ore"}))
    llm = FakeLLM([same, same, plan(done=True)])
    run_episode("iron", body.client(), llm, episodes_file=tmp_path / "e.jsonl")
    assert "already tried exactly this" not in llm.calls[1][-1]["content"]  # first failure: no warning
    assert "already tried exactly this" in llm.calls[2][-1]["content"]  # same failure again: warning


def test_a_death_between_turns_is_reported(tmp_path):
    body = FakeBody(lambda name, args: ok())
    body.state = {**body.state, "deaths": 0}

    def die_then_ok(name, args):
        body.state = {**body.state, "deaths": 1, "inventory": {}}  # killed while acting/thinking
        return ok()

    body.execute = die_then_ok
    llm = FakeLLM([plan(("mine", {"block": "oak_log"})), plan(done=True)])
    run_episode("wood", body.client(), llm, episodes_file=tmp_path / "e.jsonl")
    assert "WARNING: you died" in llm.calls[1][-1]["content"]


def test_text_next_to_the_calls_is_shown_but_not_put_back(tmp_path):
    from brain.show import load_episodes, show

    llm = FakeLLM([
        {**plan(("mine", {"block": "oak_log"})), "text": "No logs yet: I mine some."},
        plan(done=True),
    ])
    path = tmp_path / "e.jsonl"
    outcome = run_episode("wood", FakeBody(lambda n, a: ok()).client(), llm, episodes_file=path)

    answer = next(m for m in llm.calls[1] if m["role"] == "assistant")
    assert answer["content"] == "" and answer["tool_calls"]  # templates cannot show both (llm.py)
    assert "thinks: No logs yet: I mine some." in show(load_episodes(path)[outcome["episode_id"]], [])
