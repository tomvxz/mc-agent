"""The ONLY door to the LLM. Changing provider (Ollama today, a local model on the 4090 later)
only changes this file.

The rest of the brain only sees:
    llm(messages, tools) -> LLMReply   (plan, missing_capability, done, or a parse_error)
    llm.model_info                     (what to record in the episode: provider, name, params)

Default provider: any server speaking the OpenAI-compatible chat API (Ollama, llama.cpp, vLLM...),
configured by environment variables:
    LLM_BASE_URL     default http://127.0.0.1:11434/v1  (Ollama)
    LLM_MODEL        default qwen2.5:3b                 (small, runs on a Mac M2)
    LLM_TEMPERATURE  default 0.2
    LLM_SEED         default 42
    LLM_MAX_TOKENS   default 600 (an answer is cut there: seen, qwen2.5:3b writing for over 5 min)

EACH SKILL IS A TOOL (render.skill_tools), plus two tools that are not skills: goal_reached and
missing_capability. The tool calls of one answer, in order, are the plan.
(Before: a single tool propose_plans holding a list of skills. qwen2.5:3b called the skills
directly instead, and Ollama dropped these calls to unknown tools: empty answers.)

Small models sometimes write their calls as text instead: a JSON object in the text is accepted
too (parse_mode "text_json"): a call {"name": ..., "arguments": {...}} or a plan
{"plan": [{"skill": ..., "args": {...}}], "missing_capability": ..., "done": ...}.
Anything else gives a parse_error, which the agent sends back to the LLM.

A number written as a string ("3" for an integer parameter: seen with llama3.1:8b, ten times in a
row) is converted, following the types the tools declare. Nothing else is: the body stays strict.
The raw answer is recorded unchanged.

The text/JSON exchange is a temporary interface: the agent loop only handles plans and results,
so a later world model (or a shared latent space) can replace this file and render.py without
touching the loop.
"""

import json
import os
import re
import sys
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

# The two tools that are not skills
GOAL_REACHED = "goal_reached"
MISSING_CAPABILITY = "missing_capability"
REQUEST_TIMEOUT = 300.0  # a small local model can be slow on a laptop
CONTEXT_WARNING = 0.9  # warn when the prompt fills this share of the LLM's context


class LLMError(Exception):
    """The LLM could not be reached or answered with an HTTP error (not a bad plan)."""


@dataclass
class LLMReply:
    raw: Any  # the provider's response, unmodified (recorded in the episode)
    plan: list[dict[str, Any]] | None = (
        None  # [{"skill": ..., "args": {...}}], None if unusable
    )
    missing_capability: str | None = None
    done: bool = False
    parse_error: str | None = None  # why the answer could not be used
    parse_mode: str | None = None  # "tool_calls" or "text_json"
    text: str | None = None  # the text part of the answer, if any
    latency: float | None = None  # seconds
    tokens: dict[str, int | None] | None = (
        None  # {"prompt": ..., "completion": ...}, None if unknown
    )
    # Every call of the answer, in order, skills and the two other tools: [{"id", "name", "args"}]
    calls: list[dict[str, Any]] = field(default_factory=list)

    def history_message(self) -> dict[str, Any]:
        """The assistant message to put back in the conversation for the next turn.

        A usable answer is put back as tool calls, even when it came as text: the LLM then sees
        its previous answers in the right format (it imitates what it sees). The raw answer stays
        in the episode (raw_response)."""
        if self.parse_error is not None:
            return {"role": "assistant", "content": self.text or ""}
        return {
            "role": "assistant",
            # Never the text next to the calls: Ollama's templates cannot show both. llama3.1 drops
            # the text, qwen2.5 drops the CALLS (`if .Content ... else if .ToolCalls`): the model
            # would then see past answers without calls and stop calling tools. The text stays in
            # raw_response.
            "content": "",
            "tool_calls": [
                {
                    "id": c["id"],
                    "type": "function",
                    "function": {"name": c["name"], "arguments": json.dumps(c["args"])},
                }
                for c in self.calls
            ],
        }


# --- Turning a raw answer into a plan --------------------------------------------------------


def param_types(tools: list[dict[str, Any]]) -> dict[str, dict[str, str]]:
    """{tool: {parameter: JSON type}} from the declared tools."""
    return {
        t["function"]["name"]: {
            name: p.get("type")
            for name, p in t["function"].get("parameters", {}).get("properties", {}).items()
        }
        for t in tools
    }


INTEGER = re.compile(r"[+-]?\d+")
NUMBER = re.compile(r"[+-]?(\d+(\.\d*)?|\.\d+)")


def as_declared(value: Any, kind: str | None) -> Any:
    """A string holding exactly a number, for an integer or number parameter, as that number."""
    if not isinstance(value, str):
        return value
    text = value.strip()
    if kind == "integer" and INTEGER.fullmatch(text):
        return int(text)
    if kind == "number" and NUMBER.fullmatch(text):
        return int(text) if INTEGER.fullmatch(text) else float(text)
    return value


def parse_calls(
    calls: list[tuple[str | None, str, Any]],
    tool_names: set[str] | None,
    types: dict[str, dict[str, str]] | None = None,
) -> tuple[list[dict[str, Any]] | None, str | None]:
    """Check (id, name, arguments) calls. Returns (clean calls, None) or (None, error message).

    tool_names: the declared tools (None: do not check the names).
    types: {tool: {parameter: JSON type}} (param_types): numbers written as strings are converted."""
    clean = []
    for i, (call_id, name, arguments) in enumerate(calls):
        if not isinstance(name, str) or not name:
            return None, f"call {i} has no tool name"
        if tool_names is not None and name not in tool_names:
            return None, f"{name} is not one of the tools"
        if isinstance(arguments, str):
            try:
                arguments = json.loads(arguments) if arguments.strip() else {}
            except json.JSONDecodeError as e:
                return None, f"the arguments of {name} are not valid JSON ({e.msg})"
        if arguments is None:
            arguments = {}
        if not isinstance(arguments, dict):
            return None, f"the arguments of {name} must be an object"
        declared = (types or {}).get(name, {})
        arguments = {k: as_declared(v, declared.get(k)) for k, v in arguments.items()}
        clean.append({"id": call_id or f"call_{i}", "name": name, "args": arguments})
    return clean, None


def calls_from_plan(arguments: Any) -> tuple[list[tuple[str | None, str, Any]] | None, str | None]:
    """The old answer format {"plan": [...], "missing_capability": ..., "done": ...} as calls."""
    plan = arguments.get("plan", [])
    if not isinstance(plan, list):
        return None, "plan must be a list"
    calls: list[tuple[str | None, str, Any]] = []
    for i, step in enumerate(plan):
        if not isinstance(step, dict) or not isinstance(step.get("skill"), str):
            return None, f"plan step {i} must be an object with a 'skill' name"
        calls.append((None, step["skill"], step.get("args", {})))
    missing = arguments.get("missing_capability")
    if isinstance(missing, str) and missing:
        calls.append((None, MISSING_CAPABILITY, {"description": missing}))
    if arguments.get("done"):
        calls.append((None, GOAL_REACHED, {}))
    return calls, None


def json_in_text(text: str) -> Any:
    """The first JSON object found in a text (small models wrap it in sentences or ``` fences)."""
    start = text.find("{")
    while start != -1:
        depth = 0
        for end in range(start, len(text)):
            if text[end] == "{":
                depth += 1
            elif text[end] == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start : end + 1])
                    except json.JSONDecodeError:
                        break
        start = text.find("{", start + 1)
    return None


def reply_from_openai(
    raw: dict[str, Any],
    latency: float | None = None,
    tool_names: set[str] | None = None,
    types: dict[str, dict[str, str]] | None = None,
) -> LLMReply:
    """Read an OpenAI-compatible chat completion: tool calls, or a JSON call or plan in the text.

    tool_names: the declared tools; a call to another name is a parse_error (None: not checked).
    types: the declared parameter types (param_types), to convert numbers written as strings."""
    usage = raw.get("usage") or {}
    tokens: dict[str, int | None] | None = (
        {
            "prompt": usage.get("prompt_tokens"),
            "completion": usage.get("completion_tokens"),
        }
        if usage
        else None
    )
    reply = LLMReply(raw=raw, latency=latency, tokens=tokens)
    try:
        message = raw["choices"][0]["message"]
    except (KeyError, IndexError, TypeError):
        reply.parse_error = "the response has no message"
        return reply
    reply.text = message.get("content") or None

    raw_calls: list[tuple[str | None, str, Any]] | None
    error: str | None = None
    if message.get("tool_calls"):
        raw_calls = [
            (c.get("id"), c.get("function", {}).get("name"), c.get("function", {}).get("arguments"))
            for c in message["tool_calls"]
        ]
        reply.parse_mode = "tool_calls"
    elif reply.text and isinstance(found := json_in_text(reply.text), dict):
        reply.parse_mode = "text_json"
        if "plan" in found:
            raw_calls, error = calls_from_plan(found)
        elif "name" in found:
            raw_calls = [(None, found["name"], found.get("arguments", {}))]
        else:
            raw_calls, error = None, "the JSON in the answer is neither a tool call nor a plan"
    else:
        raw_calls, error = None, "no tool call in the answer: call the skills as tools"

    calls = None
    if raw_calls is not None:
        calls, error = parse_calls(raw_calls, tool_names, types)
    if error or calls is None:
        reply.parse_error = error or "the answer could not be read"
        return reply

    reply.calls = calls
    reply.plan = [
        {"skill": c["name"], "args": c["args"]}
        for c in calls
        if c["name"] not in (GOAL_REACHED, MISSING_CAPABILITY)
    ]
    reply.done = any(c["name"] == GOAL_REACHED for c in calls)
    missing = [
        c["args"].get("description")
        for c in calls
        if c["name"] == MISSING_CAPABILITY
    ]
    reply.missing_capability = next((m for m in missing if isinstance(m, str) and m), None)
    return reply


# --- Providers -------------------------------------------------------------------------------


class OpenAICompatibleLLM:
    """A chat server with the OpenAI API: Ollama (default), llama.cpp server, vLLM, LM Studio..."""

    def __init__(
        self,
        model: str | None = None,
        base_url: str | None = None,
        temperature: float | None = None,
        seed: int | None = None,
    ):
        self.model = model or os.environ.get("LLM_MODEL", "qwen2.5:3b")
        self.base_url = base_url or os.environ.get(
            "LLM_BASE_URL", "http://127.0.0.1:11434/v1"
        )
        self.temperature = (
            temperature
            if temperature is not None
            else float(os.environ.get("LLM_TEMPERATURE", "0.2"))
        )
        self.seed = seed if seed is not None else int(os.environ.get("LLM_SEED", "42"))
        self.max_tokens = int(os.environ.get("LLM_MAX_TOKENS", "600"))
        # trust_env=False: the server is local, never go through a proxy (see brain/body.py)
        self._client = httpx.Client(
            base_url=self.base_url, timeout=REQUEST_TIMEOUT, trust_env=False
        )
        self._context_length: int | None = None

    def context_length(self) -> int | None:
        """The context size the server really loaded the model with, if it says so (Ollama:
        /api/ps, once the model is loaded). None if unknown.

        Seen with Ollama's default (4096 tokens): past it, the start of the conversation is cut
        without any error, and the model's answers fall apart."""
        if self._context_length is None:
            root = self.base_url.rstrip("/").removesuffix("/v1")
            try:
                models = self._client.get(f"{root}/api/ps").json().get("models", [])
                self._context_length = next(
                    (m.get("context_length") for m in models if self.model in (m.get("name"), m.get("model"))),
                    None,
                )
            except (httpx.HTTPError, ValueError, AttributeError):
                pass  # not Ollama, or not loaded yet: unknown
        return self._context_length

    @property
    def model_info(self) -> dict[str, Any]:
        return {
            "provider": "openai_compatible",
            "base_url": self.base_url,
            "name": self.model,
            "params": {
                "temperature": self.temperature,
                "seed": self.seed,
                "max_tokens": self.max_tokens,
                "context_length": self.context_length(),
            },
        }

    def __call__(
        self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]
    ) -> LLMReply:
        body = {
            "model": self.model,
            "messages": messages,
            "tools": tools,
            "temperature": self.temperature,
            "seed": self.seed,
            "max_tokens": self.max_tokens,
        }
        start = time.monotonic()
        try:
            response = self._client.post("/chat/completions", json=body)
        except httpx.HTTPError as e:
            raise LLMError(
                f"cannot reach the LLM at {self.base_url} ({e}): is the server started?"
            ) from e
        if response.status_code != 200:
            raise LLMError(
                f"LLM answered HTTP {response.status_code}: {response.text[:300]}"
            )
        reply = reply_from_openai(
            response.json(),
            latency=round(time.monotonic() - start, 3),
            tool_names={t["function"]["name"] for t in tools},
            types=param_types(tools),
        )
        context = self.context_length()
        prompt = (reply.tokens or {}).get("prompt")
        if context and prompt and prompt > CONTEXT_WARNING * context:
            print(
                f"WARNING: the prompt ({prompt} tokens) fills {prompt / context:.0%} of the LLM's "
                f"context ({context}): the server may cut the start of the conversation",
                file=sys.stderr,
            )
        return reply


class FakeLLM:
    """A scripted LLM for tests: returns the given answers in order. A dict
    {"plan": [{"skill", "args"}], "done", "missing_capability"} becomes tool calls (with "text":
    the text written next to them); a string is a text answer."""

    def __init__(self, answers: list[dict[str, Any] | str]):
        self.answers = list(answers)
        self.calls: list[
            list[dict[str, Any]]
        ] = []  # the messages received at each call

    model_info = {"provider": "fake", "name": "fake", "params": {}}

    def __call__(
        self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]
    ) -> LLMReply:
        self.calls.append([dict(m) for m in messages])
        if not self.answers:
            raise LLMError("the fake LLM has no more answers")
        answer = self.answers.pop(0)
        if isinstance(answer, str):
            message = {"role": "assistant", "content": answer}
        else:
            calls, _ = calls_from_plan(answer)
            message = {
                "role": "assistant",
                "content": answer.get("text"),
                "tool_calls": [
                    {
                        "id": f"call_{len(self.calls)}_{i}",
                        "type": "function",
                        "function": {"name": name, "arguments": json.dumps(args)},
                    }
                    for i, (_, name, args) in enumerate(calls or [])
                ],
            }
        return reply_from_openai({"choices": [{"message": message}]}, latency=0.0)
