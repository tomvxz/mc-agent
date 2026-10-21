"""Tests of brain/goal.py and of the goal condition in the loop (fake LLM, fake body)."""

from brain import goal as goals
from brain.agent import run_episode
from brain.llm import FakeLLM
from brain.show import load_episodes, show
from brain.tests.fakes import FakeBody, ok


def plan(*steps, done=False):
    return {"plan": [{"skill": s, "args": a} for s, a in steps], "done": done}


def define(have):
    return plan(*[("define_goal", {"item": item, "count": count}) for item, count in have.items()])


def call(**args):
    return {"id": "c", "name": "define_goal", "args": args}


def test_the_condition_is_read_from_the_define_goal_calls():
    assert goals.parse_condition([call(item="oak_log", count=3)]) == ({"have": {"oak_log": 3}}, None)
    assert goals.parse_condition([call(item="crafting_table")]) == ({"have": {"crafting_table": 1}}, None)
    assert goals.parse_condition([call(item="oak_log", count="3")]) == ({"have": {"oak_log": 3}}, None)  # llama3.1
    both = [call(item="oak_log", count=3), call(item="stick", count=2)]  # one call per item
    assert goals.parse_condition(both) == ({"have": {"oak_log": 3, "stick": 2}}, None)
    assert goals.parse_condition([call()]) == (None, None)  # not about items: no condition, no error
    for wrong in (call(item="oak_log", count=0), call(item="oak_log", count="three"), call(item=["oak_log"])):
        condition, error = goals.parse_condition([wrong])
        assert condition is None and error
    assert goals.parse_condition([{"id": "c", "name": "mine", "args": {}}])[1] == "no define_goal call in the answer"


def test_progress_and_met():
    condition = {"have": {"oak_log": 3, "stick": 1}}
    state = {"inventory": {"oak_log": 4}}
    assert goals.progress(condition, state) == {"oak_log": (4, 3), "stick": (0, 1)}
    assert not goals.is_met(condition, state)
    assert goals.is_met(condition, {"inventory": {"oak_log": 3, "stick": 2}})


def collecting_body():
    body = FakeBody(lambda name, args: ok())

    def collect(name, args):
        inventory = body.state["inventory"]
        body.state = {**body.state, "inventory": {**inventory, "oak_log": inventory.get("oak_log", 0) + 1}}
        return ok()

    body.execute = collect
    return body


def test_the_code_ends_the_episode_when_the_condition_is_met(tmp_path):
    body = collecting_body()
    llm = FakeLLM([
        define({"oak_log": 2}),
        plan(("collect_block", {"x": 0, "y": 64, "z": 0})),
        plan(("collect_block", {"x": 0, "y": 64, "z": 1})),
    ])
    path = tmp_path / "e.jsonl"
    outcome = run_episode("collect 2 oak logs", body.client(), llm, episodes_file=path, goal_condition=True)

    assert (outcome["success"], outcome["reason"], outcome["condition"]) == (True, "condition_met", {"have": {"oak_log": 2}})
    # The definition is a separate conversation with its own system message and one tool
    assert llm.calls[0][0]["role"] == "system" and llm.calls[0][-1]["content"] == "Goal: collect 2 oak logs"
    # The loop shows the progress computed by the code
    assert "Goal progress: oak_log 0/2." in llm.calls[1][1]["content"]
    assert "Goal progress: oak_log 1/2." in llm.calls[2][-1]["content"]
    # Turn 0 is the definition: the skills of the first loop turn are linked to turn 1
    assert [r["turn"] for r in body.executed] == [1, 2]
    text = show(load_episodes(path)[outcome["episode_id"]], [])
    assert "goal condition: {'oak_log': 2}" in text and "END  SUCCESS (condition_met)" in text


def test_goal_reached_is_refused_while_the_condition_is_not_met(tmp_path):
    body = collecting_body()
    llm = FakeLLM([
        define({"oak_log": 3}),
        plan(("collect_block", {"x": 0, "y": 64, "z": 0}), done=True),  # 1 of 3: too early
        plan(done=True),  # still too early
    ])
    outcome = run_episode("collect 3 oak logs", body.client(), llm, max_turns=2,
                          episodes_file=tmp_path / "e.jsonl", goal_condition=True)

    assert (outcome["success"], outcome["reason"]) == (False, "max_turns")
    assert llm.calls[2][-2]["content"] == "not accepted: the goal is not reached yet (oak_log 1/3)"
    assert "Goal progress: oak_log 1/3." in llm.calls[2][-1]["content"]


def test_an_unusable_definition_falls_back_to_goal_reached(tmp_path):
    llm = FakeLLM(["I will collect logs", plan(done=True)])
    outcome = run_episode("collect 3 oak logs", FakeBody(lambda n, a: ok()).client(), llm,
                          episodes_file=tmp_path / "e.jsonl", goal_condition=True)
    assert (outcome["success"], outcome["reason"], outcome["condition"]) == (True, "done", None)
    assert "Goal progress" not in llm.calls[1][1]["content"]
