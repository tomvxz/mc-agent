"""A fake body for tests: answers like the bot's API, without Minecraft (httpx.MockTransport)."""

import json
from typing import Any, Callable

import httpx

from brain.body import Body

CATALOGUE = {
    "common_reasons": {"timeout": "the skill exceeded its time limit"},
    "skills": {
        "mine": {
            "kind": "shortcut",
            "description": "Get count blocks of a type.",
            "parameters": {
                "type": "object",
                "properties": {"block": {"type": "string"}, "count": {"type": "integer", "default": 1}},
                "required": ["block"],
            },
            "reasons": {"block_not_found": "no block of this type within 32 blocks: try explore"},
        },
        "craft": {
            "kind": "primitive",
            "description": "Craft an item.",
            "parameters": {
                "type": "object",
                "properties": {"item": {"type": "string"}, "count": {"type": "integer", "default": 1}},
                "required": ["item"],
            },
            "reasons": {"no_crafting_table": "the recipe needs a crafting_table and there is none within 32 blocks"},
        },
    },
}

STATE = {
    "position": [100.5, 64, -20.5],
    "health": 20,
    "food": 18,
    "time_of_day": 1000,
    "raining": False,
    "thunder": False,
    "inventory": {},
    "held_item": None,
    # A 3x3x3 grid (radius 1): grass under the feet, air above (order: dy, then dz, then dx)
    "blocks": {"origin": [100, 64, -21], "radius": 1, "palette": ["air", "grass_block[snowy=false]"], "cells": [1] * 9 + [0] * 18},
    "perception": "sight",
    "in_sight": {"oak_log": {"count": 2, "nearest": [3.5, 0, 1.5], "distance": 3.8}},
    "entities": [
        {"id": 3, "name": "cow", "type": "animal", "hostile": False, "offset": [0, 0, -9], "distance": 9, "visible": True},
        {"id": 4, "name": "zombie", "type": "hostile", "hostile": True, "offset": [0, -5, 2], "distance": 5.4, "visible": False},
    ],
}


class FakeBody:
    """execute(name, args) -> result is a function given by the test; requests are recorded."""

    def __init__(self, execute: Callable[[str, dict[str, Any]], dict[str, Any]], data_dir: str = "/tmp"):
        self.executed: list[dict[str, Any]] = []
        self.setups: list[dict[str, Any]] = []  # the POST /setup requests
        self.counted = 4  # how many of each watched block the setup reports within 32 blocks
        self.execute = execute
        self.data_dir = data_dir
        self.state = dict(STATE)

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/run":
            return httpx.Response(200, json={"run_id": "run-test", "purpose": "dev", "data_dir": self.data_dir})
        if path == "/skills":
            return httpx.Response(200, json=CATALOGUE)
        if path == "/state":
            return httpx.Response(200, json=self.state)
        if path == "/execute":
            req = json.loads(request.content)
            self.executed.append(req)
            return httpx.Response(200, json=self.execute(req["name"], req["args"]))
        if path == "/setup":
            req = json.loads(request.content)
            self.setups.append(req)
            self.state = {**self.state, "inventory": dict(req["inventory"])}
            counted = {name: self.counted for name in req.get("count_blocks", [])}
            return httpx.Response(
                200,
                json=ok(position=[req["x"] + 0.5, 64, req["z"] + 0.5], **({"blocks_within_32": counted} if counted else {})),
            )
        return httpx.Response(404, json={"error": "not_found"})

    def client(self) -> Body:
        return Body(url="http://body", transport=httpx.MockTransport(self.handler))


def ok(**details: Any) -> dict[str, Any]:
    return {"success": True, "reason": "ok", "details": details, "duration": 0.1}


def failed(reason: str, **details: Any) -> dict[str, Any]:
    return {"success": False, "reason": reason, "details": details, "duration": 0.1}
