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

Small models often answer with text instead of calling the tool: a plan written as JSON in the
text is accepted too (parse_mode "text_json"). Anything else gives a parse_error, which the agent
sends back to the LLM.

The text/JSON exchange is a temporary interface: the agent loop only handles plans and results,
so a later world model (or a shared latent space) can replace this file and render.py without
touching the loop.
"""

import json
import os
import time
from dataclasses import dataclass
from typing import Any

import httpx

TOOL_NAME = "propose_plans"
REQUEST_TIMEOUT = 300.0  # a small local model can be slow on a laptop


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
    parse_mode: str | None = None  # "tool_call" or "text_json"
    text: str | None = None  # the text part of the answer, if any
    latency: float | None = None  # seconds
    tokens: dict[str, int | None] | None = (
        None  # {"prompt": ..., "completion": ...}, None if unknown
    )

    def history_message(self) -> dict[str, Any]:
        """The assistant message to put back in the conversation for the next turn."""
        if self.plan is not None:
            content = json.dumps(
                {
                    "plan": self.plan,
                    "missing_capability": self.missing_capability,
                    "done": self.done,
                }
            )
        else:
            content = self.text or ""
        return {"role": "assistant", "content": content}


def propose_plans_tool(skill_names: list[str]) -> dict[str, Any]:
    """The tool the LLM must call (OpenAI "function" format). Skill names come from the catalogue."""
    return {
        "type": "function",
        "function": {
            "name": TOOL_NAME,
            "description": "Propose the next skills to run, in order. Use done=true when the goal is reached.",
            "parameters": {
                "type": "object",
                "properties": {
                    "plan": {
                        "type": "array",
                        "description": "Skill calls to run in order (they stop at the first failure).",
                        "items": {
                            "type": "object",
                            "properties": {
                                "skill": {"type": "string", "enum": skill_names},
                                "args": {
                                    "type": "object",
                                    "description": "The skill's arguments",
                                },
                            },
                            "required": ["skill", "args"],
                        },
                    },
                    "missing_capability": {
                        "type": "string",
                        "description": "What you would need that no skill can do (leave empty if nothing).",
                    },
                    "done": {
                        "type": "boolean",
                        "description": "true if the goal is already reached",
                    },
                },
                "required": ["plan", "done"],
            },
        },
    }


# --- Turning a raw answer into a plan --------------------------------------------------------


def parse_plan(arguments: Any) -> tuple[dict[str, Any] | None, str | None]:
    """Check the tool's arguments. Returns (clean arguments, None) or (None, error message)."""
    if isinstance(arguments, str):
        try:
            arguments = json.loads(arguments)
        except json.JSONDecodeError as e:
            return None, f"the tool arguments are not valid JSON ({e.msg})"
    if not isinstance(arguments, dict):
        return None, "the tool arguments must be an object"
    plan = arguments.get("plan", [])
    if not isinstance(plan, list):
        return None, "plan must be a list"
    clean = []
    for i, step in enumerate(plan):
        if not isinstance(step, dict) or not isinstance(step.get("skill"), str):
            return None, f"plan step {i} must be an object with a 'skill' name"
        args = step.get("args", {})
        if not isinstance(args, dict):
            return None, f"plan step {i}: args must be an object"
        clean.append({"skill": step["skill"], "args": args})
    missing = arguments.get("missing_capability") or None
    return {
        "plan": clean,
        "missing_capability": missing if isinstance(missing, str) else None,
        "done": bool(arguments.get("done", False)),
    }, None


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


def reply_from_openai(raw: dict[str, Any], latency: float | None = None) -> LLMReply:
    """Read an OpenAI-compatible chat completion: a tool call, or a JSON plan in the text."""
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

    calls = [
        c
        for c in (message.get("tool_calls") or [])
        if c.get("function", {}).get("name") == TOOL_NAME
    ]
    if calls:
        arguments, error = parse_plan(calls[0]["function"].get("arguments", {}))
        reply.parse_mode = "tool_call"
    elif reply.text and (found := json_in_text(reply.text)) is not None:
        arguments, error = parse_plan(found)
        reply.parse_mode = "text_json"
    else:
        arguments, error = (
            None,
            f"no {TOOL_NAME} tool call and no JSON plan in the answer",
        )

    if error or arguments is None:
        reply.parse_error = error or "the plan could not be read"
    else:
        reply.plan = arguments["plan"]
        reply.missing_capability = arguments["missing_capability"]
        reply.done = arguments["done"]
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
        # trust_env=False: the server is local, never go through a proxy (see brain/body.py)
        self._client = httpx.Client(
            base_url=self.base_url, timeout=REQUEST_TIMEOUT, trust_env=False
        )

    @property
    def model_info(self) -> dict[str, Any]:
        return {
            "provider": "openai_compatible",
            "base_url": self.base_url,
            "name": self.model,
            "params": {"temperature": self.temperature, "seed": self.seed},
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
        return reply_from_openai(
            response.json(), latency=round(time.monotonic() - start, 3)
        )


class FakeLLM:
    """A scripted LLM for tests: returns the given answers in order (dicts of tool arguments, or
    strings for a text answer)."""

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
            call = {
                "type": "function",
                "function": {"name": TOOL_NAME, "arguments": json.dumps(answer)},
            }
            message = {"role": "assistant", "content": None, "tool_calls": [call]}
        return reply_from_openai({"choices": [{"message": message}]}, latency=0.0)
