"""Tests of brain/llm.py: reading the LLM's answers, without any LLM."""

import json

import httpx
import pytest

from brain.llm import FakeLLM, LLMError, OpenAICompatibleLLM, json_in_text, propose_plans_tool, reply_from_openai


def completion(message):
    return {"choices": [{"message": message}], "usage": {"prompt_tokens": 100, "completion_tokens": 20}}


def tool_call(arguments):
    return {"function": {"name": "propose_plans", "arguments": arguments}}


def test_a_tool_call_is_read():
    args = {"plan": [{"skill": "mine", "args": {"block": "oak_log"}}], "done": False}
    r = reply_from_openai(completion({"content": None, "tool_calls": [tool_call(json.dumps(args))]}))
    assert r.parse_error is None and r.parse_mode == "tool_call"
    assert r.plan == [{"skill": "mine", "args": {"block": "oak_log"}}]
    assert (r.done, r.missing_capability, r.tokens) == (False, None, {"prompt": 100, "completion": 20})


def test_a_json_plan_in_the_text_is_accepted():
    text = 'Sure! Here is my plan:\n```json\n{"plan": [{"skill": "craft", "args": {"item": "stick"}}], "done": false}\n```'
    r = reply_from_openai(completion({"content": text}))
    assert r.parse_mode == "text_json"
    assert r.plan == [{"skill": "craft", "args": {"item": "stick"}}]


def test_missing_args_default_to_an_empty_object():
    r = reply_from_openai(completion({"tool_calls": [tool_call({"plan": [{"skill": "scan"}], "done": False})]}))
    assert r.plan == [{"skill": "scan", "args": {}}]


@pytest.mark.parametrize(
    ("message", "error"),
    [
        ({"content": "I will mine some wood."}, "no propose_plans tool call"),
        ({"tool_calls": [tool_call("{not json")]}, "not valid JSON"),
        ({"tool_calls": [tool_call({"plan": "mine wood"})]}, "plan must be a list"),
        ({"tool_calls": [tool_call({"plan": [{"args": {}}]})]}, "step 0"),
        ({"tool_calls": [tool_call({"plan": [{"skill": "mine", "args": [1]}]})]}, "args must be an object"),
    ],
)
def test_unusable_answers_give_a_parse_error(message, error):
    r = reply_from_openai(completion(message))
    assert r.plan is None
    assert error in r.parse_error


def test_missing_capability_and_done():
    args = {"plan": [], "missing_capability": "open a door", "done": True}
    r = reply_from_openai(completion({"tool_calls": [tool_call(args)]}))
    assert (r.plan, r.missing_capability, r.done) == ([], "open a door", True)


def test_json_in_text_finds_the_first_object():
    assert json_in_text('blah {"a": {"b": 1}} and {"c": 2}') == {"a": {"b": 1}}
    assert json_in_text("no json here") is None


def test_the_tool_lists_the_skills():
    tool = propose_plans_tool(["mine", "craft"])
    items = tool["function"]["parameters"]["properties"]["plan"]["items"]
    assert items["properties"]["skill"]["enum"] == ["mine", "craft"]


def test_the_history_message_replays_the_plan():
    r = FakeLLM([{"plan": [{"skill": "scan", "args": {}}], "done": False}])([], [])
    assert json.loads(r.history_message()["content"])["plan"] == [{"skill": "scan", "args": {}}]


def test_openai_compatible_request_and_errors():
    sent = {}

    def answer(request):
        sent.update(json.loads(request.content))
        return httpx.Response(200, json=completion({"tool_calls": [tool_call({"plan": [], "done": True})]}))

    llm = OpenAICompatibleLLM(model="tiny", base_url="http://llm/v1", temperature=0, seed=1)
    llm._client = httpx.Client(base_url="http://llm/v1", transport=httpx.MockTransport(answer))
    r = llm([{"role": "user", "content": "hi"}], [propose_plans_tool(["scan"])])
    assert r.done and sent["model"] == "tiny" and sent["seed"] == 1 and sent["tools"]
    assert llm.model_info["name"] == "tiny"

    llm._client = httpx.Client(base_url="http://llm/v1", transport=httpx.MockTransport(lambda r: httpx.Response(500, text="boom")))
    with pytest.raises(LLMError, match="HTTP 500"):
        llm([], [])

    nobody = OpenAICompatibleLLM(base_url="http://127.0.0.1:9/v1")
    with pytest.raises(LLMError, match="is the server started"):
        nobody([], [])
