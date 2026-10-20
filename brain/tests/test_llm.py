"""Tests of brain/llm.py: reading the LLM's answers, without any LLM."""

import json

import httpx
import pytest

from brain.llm import FakeLLM, LLMError, OpenAICompatibleLLM, json_in_text, param_types, reply_from_openai

TOOLS = {"mine", "craft", "scan", "goal_reached", "missing_capability"}


def completion(message):
    return {"choices": [{"message": message}], "usage": {"prompt_tokens": 100, "completion_tokens": 20}}


def tool_call(name, arguments, id="call_1"):
    return {"id": id, "type": "function", "function": {"name": name, "arguments": arguments}}


def read(message):
    return reply_from_openai(completion(message), tool_names=TOOLS)


def test_the_tool_calls_are_the_plan():
    r = read({"content": None, "tool_calls": [
        tool_call("mine", json.dumps({"block": "oak_log", "count": 3}), "a"),
        tool_call("craft", {"item": "stick"}, "b"),  # some servers send an object, not a string
    ]})
    assert r.parse_error is None and r.parse_mode == "tool_calls"
    assert r.plan == [{"skill": "mine", "args": {"block": "oak_log", "count": 3}},
                      {"skill": "craft", "args": {"item": "stick"}}]
    assert [c["id"] for c in r.calls] == ["a", "b"]
    assert (r.done, r.missing_capability, r.tokens) == (False, None, {"prompt": 100, "completion": 20})


def test_goal_reached_and_missing_capability_are_not_skills():
    r = read({"tool_calls": [
        tool_call("craft", "{}", "a"),
        tool_call("missing_capability", {"description": "open a door"}, "b"),
        tool_call("goal_reached", "", "c"),  # empty arguments are accepted
    ]})
    assert r.plan == [{"skill": "craft", "args": {}}]
    assert (r.missing_capability, r.done) == ("open a door", True)
    assert len(r.calls) == 3  # all answered by the agent


def test_a_call_written_as_text_is_accepted():
    text = '<tool_call>\n{"name": "mine", "arguments": {"block": "oak_log"}}\n</tool_call>'
    r = read({"content": text})
    assert r.parse_mode == "text_json"
    assert r.plan == [{"skill": "mine", "args": {"block": "oak_log"}}]


def test_the_old_plan_format_in_the_text_is_accepted():
    text = 'Sure! Here is my plan:\n```json\n{"plan": [{"skill": "craft", "args": {"item": "stick"}}], "done": true}\n```'
    r = read({"content": text})
    assert r.parse_mode == "text_json"
    assert r.plan == [{"skill": "craft", "args": {"item": "stick"}}] and r.done


@pytest.mark.parametrize(
    ("message", "error"),
    [
        ({"content": "I will mine some wood."}, "no tool call"),
        ({"content": ""}, "no tool call"),
        ({"content": '{"thoughts": "wood"}'}, "neither a tool call nor a plan"),
        ({"tool_calls": [tool_call("dance", "{}")]}, "dance is not one of the tools"),
        ({"tool_calls": [tool_call("mine", "{not json")]}, "not valid JSON"),
        ({"tool_calls": [tool_call("mine", "[1]")]}, "must be an object"),
        ({"content": '{"plan": "mine wood"}'}, "plan must be a list"),
        ({"content": '{"plan": [{"args": {}}]}'}, "step 0"),
    ],
)
def test_unusable_answers_give_a_parse_error(message, error):
    r = read(message)
    assert r.plan is None
    assert error in r.parse_error


def test_json_in_text_finds_the_first_object():
    assert json_in_text('blah {"a": {"b": 1}} and {"c": 2}') == {"a": {"b": 1}}
    assert json_in_text("no json here") is None


def test_the_history_message_replays_the_calls_as_tool_calls():
    r = read({"content": '{"name": "scan", "arguments": {}}'})  # came as text...
    message = r.history_message()  # ...put back as a tool call, the format the LLM should use
    assert message["tool_calls"][0]["function"] == {"name": "scan", "arguments": "{}"}
    assert message["tool_calls"][0]["id"] == "call_0"
    assert read({"content": "no idea"}).history_message() == {"role": "assistant", "content": "no idea"}


def test_the_fake_llm_turns_a_plan_into_tool_calls():
    r = FakeLLM([{"plan": [{"skill": "scan", "args": {}}], "done": True}])([], [])
    assert r.plan == [{"skill": "scan", "args": {}}] and r.done
    assert [c["name"] for c in r.calls] == ["scan", "goal_reached"]


def test_openai_compatible_request_and_errors():
    sent = {}

    def answer(request):
        sent.update(json.loads(request.content))
        return httpx.Response(200, json=completion({"tool_calls": [tool_call("goal_reached", "{}")]}))

    tools = [{"type": "function", "function": {"name": "goal_reached", "parameters": {}}}]
    llm = OpenAICompatibleLLM(model="tiny", base_url="http://llm/v1", temperature=0, seed=1)
    llm._client = httpx.Client(base_url="http://llm/v1", transport=httpx.MockTransport(answer))
    r = llm([{"role": "user", "content": "hi"}], tools)
    assert r.done and sent["model"] == "tiny" and sent["seed"] == 1 and sent["tools"] == tools
    assert llm.model_info["name"] == "tiny"

    llm._client = httpx.Client(base_url="http://llm/v1", transport=httpx.MockTransport(lambda r: httpx.Response(500, text="boom")))
    with pytest.raises(LLMError, match="HTTP 500"):
        llm([], [])

    nobody = OpenAICompatibleLLM(base_url="http://127.0.0.1:9/v1")
    assert nobody.context_length() is None  # unknown: no error
    with pytest.raises(LLMError, match="is the server started"):
        nobody([], [])


def test_a_prompt_near_the_context_limit_gives_a_warning(capsys):
    def server(context):
        def answer(request):
            if request.url.path == "/api/ps":
                return httpx.Response(200, json={"models": [{"name": "tiny", "context_length": context}]})
            return httpx.Response(200, json=completion({"tool_calls": [tool_call("goal_reached", "{}")]}))
        return httpx.Client(base_url="http://llm/v1", transport=httpx.MockTransport(answer))

    tools = [{"type": "function", "function": {"name": "goal_reached", "parameters": {}}}]
    for context, warned in [(1000, False), (105, True)]:  # the prompt has 100 tokens
        llm = OpenAICompatibleLLM(model="tiny", base_url="http://llm/v1")
        llm._client = server(context)
        llm([], tools)
        assert ("WARNING: the prompt (100 tokens)" in capsys.readouterr().err) == warned
        assert llm.model_info["params"]["context_length"] == context  # recorded in the episode


def test_numbers_written_as_strings_follow_the_declared_types():
    declared = [{"type": "function", "function": {"name": "find", "parameters": {"type": "object", "properties": {
        "target": {"type": "string"}, "count": {"type": "integer"}, "max_distance": {"type": "number"}}}}}]
    arguments = {"target": "64", "count": "3", "max_distance": " 32.5 "}
    r = reply_from_openai(completion({"tool_calls": [tool_call("find", arguments)]}), types=param_types(declared))
    assert r.plan == [{"skill": "find", "args": {"target": "64", "count": 3, "max_distance": 32.5}}]
    assert r.history_message()["tool_calls"][0]["function"]["arguments"] == json.dumps(r.calls[0]["args"])
    # Not exactly a number of the declared type: left as it is, the body refuses it honestly
    for wrong in ("three", "3.5", "3 logs", ""):
        r = reply_from_openai(completion({"tool_calls": [tool_call("find", {"count": wrong})]}),
                              types=param_types(declared))
        assert r.plan[0]["args"]["count"] == wrong
