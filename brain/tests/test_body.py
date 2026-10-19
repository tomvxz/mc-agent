"""Tests of brain/body.py without a bot: a fake body answers instead of the real one (httpx.MockTransport)."""

import json

import httpx
import pytest

from brain.body import (
    Body,
    BodyBusy,
    BodyDisconnected,
    BodyError,
    BodyUnreachable,
    InvalidRequest,
)


def fake_body(answer):
    """A Body whose requests go to the function answer(request) instead of the network."""
    return Body(url="http://body", transport=httpx.MockTransport(answer))


def test_state_and_skills():
    def answer(request):
        if request.url.path == "/state":
            return httpx.Response(200, json={"health": 20, "inventory": {"bread": 2}})
        return httpx.Response(
            200, json={"catalogue_version": 1, "skills": {"scan": {}}}
        )

    with fake_body(answer) as body:
        assert body.state()["inventory"] == {"bread": 2}
        assert body.skills()["catalogue_version"] == 1


def test_execute_sends_the_full_request():
    received = {}

    def answer(request):
        received["method"] = request.method
        received["body"] = json.loads(request.content)
        return httpx.Response(
            200, json={"success": True, "reason": "ok", "details": {}, "duration": 1.2}
        )

    with fake_body(answer) as body:
        result = body.execute(
            "move_to", {"x": 1, "y": 2, "z": 3}, episode_id="ep-1", step=0
        )

    assert result["reason"] == "ok"
    assert received["method"] == "POST"
    assert received["body"] == {
        "name": "move_to",
        "args": {"x": 1, "y": 2, "z": 3},
        "source": "brain",
        "episode_id": "ep-1",
        "step": 0,
    }


def test_execute_without_episode_does_not_send_the_fields():
    received = {}

    def answer(request):
        received.update(json.loads(request.content))
        return httpx.Response(
            200, json={"success": True, "reason": "ok", "details": {}, "duration": 0}
        )

    with fake_body(answer) as body:
        body.execute("scan")
    assert received == {"name": "scan", "args": {}, "source": "brain"}


def test_a_game_failure_is_not_an_exception():
    def answer(request):
        return httpx.Response(
            200,
            json={
                "success": False,
                "reason": "no_path",
                "details": {},
                "duration": 0.5,
            },
        )

    with fake_body(answer) as body:
        assert body.execute("move_to", {"x": 0, "y": 0, "z": 0})["reason"] == "no_path"


@pytest.mark.parametrize(
    ("code", "exception"),
    [
        (409, BodyBusy),
        (503, BodyDisconnected),
        (400, InvalidRequest),
        (500, BodyError),
    ],
)
def test_communication_errors_become_exceptions(code, exception):
    def answer(request):
        return httpx.Response(code, json={"error": "x", "message": "explanation"})

    with fake_body(answer) as body, pytest.raises(exception, match="explanation"):
        body.execute("scan")


def test_bot_not_started():
    # Nobody listens on this port
    with (
        Body(url="http://127.0.0.1:9") as body,
        pytest.raises(BodyUnreachable, match="bot.js serve"),
    ):
        body.state()
