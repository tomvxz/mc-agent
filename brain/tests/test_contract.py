"""The fake body of the Python tests (fakes.py) follows the same contract as the real API (docs/api_contract.json,
checked on the Node side by bot/tests/unit/contract.test.js): otherwise these tests would stay green while the
real body answers something else."""

import json
from pathlib import Path
from typing import Any

from brain.tests.fakes import FakeBody, failed, ok

CONTRACT = json.loads((Path(__file__).resolve().parents[2] / "docs" / "api_contract.json").read_text())


def type_of(v: Any) -> str:
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "boolean"
    if isinstance(v, (int, float)):
        return "number"
    return {str: "string", list: "array", dict: "object"}[type(v)]


def problems(value: Any, shape: Any, where: str = "") -> list[str]:
    """Same rules as the Node checker; a field ending with '?' may be absent here (the fake body)."""
    if isinstance(shape, str):
        return [] if type_of(value) in shape.split("|") else [f"{where}: {type_of(value)} instead of {shape}"]
    if isinstance(shape, list):
        if not isinstance(value, list):
            return [f"{where}: {type_of(value)} instead of a list"]
        return [p for i, item in enumerate(value) for p in problems(item, shape[0], f"{where}[{i}]")]
    if not isinstance(value, dict):
        return [f"{where}: {type_of(value)} instead of an object"]
    if "*" in shape:
        return [p for k, v in value.items() for p in problems(v, shape["*"], f"{where}.{k}")]
    found = []
    for key, sub in shape.items():
        name = key.rstrip("?")
        if name in value:
            found += problems(value[name], sub, f"{where}.{name}")
        elif not key.endswith("?"):
            found.append(f"{where}.{name}: missing")
    return found


def test_the_checker_itself():
    shape = {"a": "number|null", "list": [{"n": "string"}], "opt?": "boolean"}
    assert problems({"a": None, "list": [{"n": "x"}]}, shape) == []  # opt? may be absent from the fake
    assert problems({"a": "1", "list": [{}], "opt": 1}, shape) == [
        ".a: string instead of number|null",
        ".list[0].n: missing",
        ".opt: number instead of boolean",
    ]


def test_the_fake_body_follows_the_contract():
    body = FakeBody(lambda name, args: ok(found=1) if name == "mine" else failed("no_path")).client()
    answers = {
        "GET /run": body.run(),
        "GET /skills": body.skills(),
        "GET /state": body.state(),
        "POST /execute": body.execute("mine", {"block": "oak_log"}),
    }
    # The lists and maps checked must not be empty (an empty list would pass without checking anything)
    assert answers["GET /state"]["entities"] and answers["GET /state"]["in_sight"]
    routes = [k for k in CONTRACT if k != "about"]
    assert sorted(routes) == sorted(answers)  # every route of the contract is checked
    for route in routes:
        assert problems(answers[route], CONTRACT[route], route) == [], route
    assert problems(body.execute("craft", {}), CONTRACT["POST /execute"]) == []  # a failure too
