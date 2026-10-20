"""The goal condition: the goal turned into DATA once by the LLM, then checked by the code.

Whether a goal is reached is a fact that can be computed, not a decision: a small model compares
"collect 3 oak logs" with "Inventory: oak_log x4" badly (seen: qwen2.5:3b had 4 oak_log and kept
collecting until max_turns). So, before the loop, the LLM translates the goal with one tool,
define_goal; then the code checks the condition on every new state and ends the episode itself.

Condition format (version 1, kept small on purpose; add keys when a bench task needs them):
    {"have": {"oak_log": 3}}    the inventory contains at least 3 oak_log
The LLM gives it as flat calls, one per item: define_goal(item="oak_log", count=3).
A goal that is not about items ("build a shelter") gives no condition: goal_reached is used then.
Item names are not checked against the game's list: a wrong name (oak_logs) is never met.
"""

from typing import Any

DEFINE_GOAL = "define_goal"

Condition = dict[str, Any]


def parse_condition(
    reply_calls: list[dict[str, Any]],
) -> tuple[Condition | None, str | None]:
    """The condition from the define_goal calls of the answer (one per item). Returns
    (condition, None), (None, None) when the goal is not about items, or (None, error message)."""
    calls = [c for c in reply_calls if c["name"] == DEFINE_GOAL]
    if not calls:
        return None, f"no {DEFINE_GOAL} call in the answer"
    have: dict[str, int] = {}
    for call in calls:
        item, count = call["args"].get("item"), call["args"].get("count", 1)
        if item in (None, ""):
            continue  # not about items
        if (
            not isinstance(item, str)
            or not isinstance(count, int)
            or isinstance(count, bool)
            or count < 1
        ):
            return None, f"{item!r} x {count!r}: not an item name with a count >= 1"
        have[item] = have.get(item, 0) + count
    return ({"have": have}, None) if have else (None, None)


def progress(
    condition: Condition, state: dict[str, Any] | None
) -> dict[str, tuple[int, int]]:
    """{item: (in the inventory, wanted)}."""
    inventory = (state or {}).get("inventory") or {}
    return {
        item: (inventory.get(item, 0), wanted)
        for item, wanted in condition["have"].items()
    }


def is_met(condition: Condition, state: dict[str, Any] | None) -> bool:
    return all(have >= wanted for have, wanted in progress(condition, state).values())


def is_definition_turn(event: dict[str, Any]) -> bool:
    """The llm_turn of the define_goal call: a separate conversation, so its new_messages start
    with its own system message (docs/journal.md)."""
    messages = event.get("new_messages") or []
    return (
        event.get("type") == "llm_turn"
        and bool(messages)
        and messages[0].get("role") == "system"
    )
