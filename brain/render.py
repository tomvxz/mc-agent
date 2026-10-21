"""EVERYTHING the LLM reads is written here: the system prompt, the state, the skills, the results.

This text is our request to the LLM: small wording changes can change the results a lot. So:
- it lives in this single file;
- every episode records the git commit (code_version), which identifies these texts exactly:
  results obtained with different prompts can be compared (commit them before comparing);
- the exact prompt of every turn is also recorded (episodes.jsonl).

Rendering is a VIEW of the state, not a second data format: the state itself is observe() on the
Node side (see docs/journal.md). This text interface is temporary: a world model or a shared
latent space can replace it later without changing the agent loop.
"""

from typing import Any

from brain.goal import DEFINE_GOAL
from brain.llm import GOAL_REACHED, MISSING_CAPABILITY

SYSTEM_PROMPT = """You control a Minecraft bot. Each skill is a tool: you reach goals by chaining skills.

Rules:
- Answer by calling skills. You can call several in one answer: they run in that order and stop
  at the first failure. You then get the result of each call and the new state. For example,
  after find gave three positions, call collect_block three times in the same answer.
- The result of a skill only arrives after your answer has run: never write coordinates you have
  not seen yet. For example, call find, and use the positions it gives at your next answer.
- Coordinates are absolute block coordinates (x, y, z). North is -z, south +z, east +x, west -x.
  y is the height.
- To get blocks of a type (wood, stone...), use mine(block, count): it finds them itself (no find
  needed before), walks there, breaks them and picks up the items on its own. collect_block is only
  for one block whose exact position you have already seen.
- To know how to craft an item and what it needs, use recipe (ask again for an ingredient).
- For anything else you have not located yet, use find. If find answers not_found (or mine
  answers block_not_found), use explore, then try again.
- Do not repeat a call that just failed in the same way: read its reason and change your calls.
- When the goal is reached, call goal_reached.
- If no skill can do what you need, call missing_capability and say what you would need."""

# Ends every goal and state message. A small model follows the LAST message much more than the
# system prompt: without this line it called one skill per answer, even with three positions to
# collect (measured: 1 call in 3/3 tries; with it, 3 calls in 10/10, and still find alone at the
# first turn, no invented coordinates). "call the tool goal_reached": with "or goal_reached." it
# wrote "goal_reached()" as text instead of calling the tool (5/5 on a real episode's turn).
NEXT_STEP = (
    "Next: call all the skills you can already decide (several calls in one answer). "
    "If the goal is reached, call the tool goal_reached."
)

# Tried then removed: asking for one or two sentences of reasoning before the calls. It did not help
# llama3.1:8b (crafting_table 0/1, it stopped writing after the first turn), and qwen2.5:14b then wrote
# its calls as text ('recipe({"item": ...})'), 0 skill run in 10 turns; without it, 3/3 (2026-10-21).


# The separate call before the loop that turns the goal into a condition (brain/goal.py).
# Flat arguments (item, count), not an object {item: count}: qwen2.5:3b closed the nested object
# wrongly ('{"have": {"oak_log": 3}})'), Ollama could not read the call and dropped it (empty answer).
DEFINE_GOAL_PROMPT = """You turn a Minecraft goal into a condition that a program checks on the bot's inventory.
Answer only by calling the tool define_goal, with the item the goal asks for, that the inventory
must contain at the end, and its count. Only what the goal asks for: never the ingredients or
tools needed to make it. Use Minecraft item names: lowercase, underscores, singular.
Examples:
- "collect 3 oak logs": define_goal(item="oak_log", count=3)
- "craft a wooden pickaxe": define_goal(item="wooden_pickaxe", count=1)
If the goal asks for several items, call define_goal once per item.
If the goal is not about having items (for example "build a shelter"), call define_goal without item."""


# --- Small helpers ----------------------------------------------------------------------------


def _compass(dx: float, dz: float) -> str:
    """Direction of an offset, in words (north = -z, east = +x)."""
    if abs(dx) < 0.5 and abs(dz) < 0.5:
        return "here"
    ns = "north" if dz < 0 else "south"
    ew = "east" if dx > 0 else "west"
    if abs(dz) > 2 * abs(dx):
        return ns
    if abs(dx) > 2 * abs(dz):
        return ew
    return f"{ns}-{ew}"


def _time_of_day(ticks: int | None) -> str:
    if ticks is None:
        return "unknown time"
    if ticks < 12000:
        return "day"
    if ticks < 13000:
        return "dusk"
    if ticks < 23000:
        return "night"
    return "dawn"


# --- What the LLM reads -----------------------------------------------------------------------


def _tool(name: str, description: str, parameters: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {"name": name, "description": description, "parameters": parameters},
    }


def _with_defaults(parameters: dict[str, Any]) -> dict[str, Any]:
    """Defaults written into the descriptions: Ollama only passes type, description and enum of
    each parameter to the model, so a "default" field would never be seen."""
    properties = {}
    for name, schema in parameters.get("properties", {}).items():
        schema = dict(schema)
        if "default" in schema:
            text = schema.get("description", "")
            schema["description"] = f"{text} (default {schema.pop('default')})".strip()
        properties[name] = schema
    return {**parameters, "properties": properties}


def skill_tools(catalogue: dict[str, Any]) -> list[dict[str, Any]]:
    """The tools declared to the LLM: one per skill, then goal_reached and missing_capability."""
    tools = [
        _tool(
            name,
            f"{entry['description']} Can fail with: {', '.join(entry['reasons'])}.",
            _with_defaults(entry["parameters"]),
        )
        for name, entry in catalogue["skills"].items()
    ]
    tools.append(
        _tool(
            GOAL_REACHED,
            "Call it when the goal is reached (alone, or after the skills that finish the goal).",
            {"type": "object", "properties": {}},
        )
    )
    tools.append(
        _tool(
            MISSING_CAPABILITY,
            "Call it when no skill can do what you need, to say what skill would have helped.",
            {
                "type": "object",
                "properties": {
                    "description": {
                        "type": "string",
                        "description": "the capability you would need",
                    }
                },
                "required": ["description"],
            },
        )
    )
    return tools


def system_prompt() -> str:
    return SYSTEM_PROMPT


def goal_definition_tools() -> list[dict[str, Any]]:
    """The only tool of the goal definition call."""
    return [
        _tool(
            DEFINE_GOAL,
            "Define the condition that tells when the goal is reached: an item the inventory must contain.",
            {
                "type": "object",
                "properties": {
                    "item": {
                        "type": "string",
                        "description": "item name, e.g. 'oak_log'; leave it out if the goal is not about items",
                    },
                    "count": {"type": "integer", "description": "how many (default 1)"},
                },
            },
        )
    ]


def render_goal_definition(goal: str) -> list[dict[str, Any]]:
    """The messages of the goal definition call: its own system message, then the goal."""
    return [
        {"role": "system", "content": DEFINE_GOAL_PROMPT},
        {"role": "user", "content": f"Goal: {goal}"},
    ]


def render_progress(progress: dict[str, tuple[int, int]] | None) -> str | None:
    """ "Goal progress: oak_log 2/3." (computed by the code, see brain/goal.py), None if no condition."""
    if not progress:
        return None
    parts = ", ".join(f"{item} {have}/{wanted}" for item, (have, wanted) in progress.items())
    return f"Goal progress: {parts}."


def _block_below(state: dict[str, Any]) -> str | None:
    """The block under the feet, read from the grid (cell dx=0, dy=-1, dz=0), without its state
    ("grass_block[snowy=false]" -> "grass_block"). The state has no such field: it is recomputed."""
    grid = state.get("blocks")
    if not grid:
        return None
    r = grid["radius"]
    side = 2 * r + 1
    cell = grid["cells"][(r - 1) * side * side + r * side + r]
    return None if cell is None else grid["palette"][cell].split("[")[0]


def render_state(state: dict[str, Any] | None) -> str:
    """A short text view of the state (the block grid is left out on purpose). What it lists is what
    the bot perceives (bot/src/perception.js): by default, what is in line of sight."""
    if state is None:
        return "State: unavailable (the bot may be dead or disconnected)."
    x, y, z = state["position"]
    bx, by, bz = int(x // 1), int(y // 1), int(z // 1)
    lines = [
        f"Position: ({bx}, {by}, {bz}), standing on {_block_below(state) or 'unknown'}.",
        f"Health {state['health']:g}/20, food {state['food']}/20.",
        f"Time: {_time_of_day(state.get('time_of_day'))}"
        + (", raining" if state.get("raining") else "")
        + (", thunderstorm" if state.get("thunder") else "")
        + ".",
    ]
    inventory = state.get("inventory") or {}
    lines.append(
        "Inventory: "
        + (", ".join(f"{n} x{c}" for n, c in inventory.items()) or "empty")
        + "."
    )
    held = state.get("held_item")
    lines.append(f"Holding: {held['name'] if held else 'nothing'}.")

    # Only what the bot perceives: with perception "sight", the entities it sees (bot/src/perception.js)
    entities = [
        e for e in state.get("entities") or [] if state.get("perception") != "sight" or e.get("visible") is not False
    ]
    if entities:
        described = []
        for e in entities[:6]:
            dx, _, dz = e["offset"]
            tag = " (hostile)" if e["hostile"] else ""
            described.append(
                f"{e['name']}{tag} {e['distance']:g} blocks {_compass(dx, dz)}"
            )
        lines.append("Nearby: " + "; ".join(described) + ".")
    else:
        lines.append("Nearby: nothing.")

    # Every kind of block in sight (within 32 blocks), nearest first, absolute coordinates. No limit:
    # sorted by distance, the ground comes first and a limit cut the trees off (15 to 25 kinds seen)
    in_sight = state.get("in_sight") or {}
    if in_sight:
        described = []
        for name, info in sorted(in_sight.items(), key=lambda kv: kv[1]["distance"]):
            ox, oy, oz = info["nearest"]
            described.append(f"{name} x{info['count']}, nearest at ({round(x + ox)}, {round(y + oy)}, {round(z + oz)})")
        lines.append("In sight: " + "; ".join(described) + ".")
    else:
        lines.append("In sight: nothing within 32 blocks.")
    return "\n".join(lines)


def render_goal(
    goal: str,
    state: dict[str, Any] | None,
    progress: dict[str, tuple[int, int]] | None = None,
) -> str:
    """The first user message of an episode."""
    line = render_progress(progress)
    return f"Goal: {goal}\n\n{render_state(state)}\n\n" + (f"{line}\n" if line else "") + NEXT_STEP


def _body_events(result: dict[str, Any]) -> str:
    """ " (you took 8 damage)" etc., from the summary the body sends with each result."""
    events = result.get("body_events") or {}
    notes = []
    if events.get("damage_taken"):
        notes.append(f"you took {events['damage_taken']:g} damage")
    if events.get("died"):
        notes.append("YOU DIED during this skill")
    return f" ({'; '.join(notes)})" if notes else ""


def _what_changed(
    previous: dict[str, Any] | None, state: dict[str, Any] | None
) -> list[str]:
    """Deaths and health changes since the previous turn (a death can also happen BETWEEN skills,
    e.g. while you were thinking: the state's death counter tells it)."""
    if not previous or not state:
        return []
    lines = []
    died = (state.get("deaths") or 0) - (previous.get("deaths") or 0)
    if died > 0:
        x, y, z = state["position"]
        lines.append(
            f"WARNING: you died{'' if died == 1 else f' {died} times'} since your last plan. "
            f"You respawned at ({int(x // 1)}, {int(y // 1)}, {int(z // 1)}) and lost your inventory."
        )
    if state["health"] < previous["health"] and died <= 0:
        lines.append(
            f"Health went down: {previous['health']:g} -> {state['health']:g}."
        )
    return lines


def render_result(step: dict[str, Any], catalogue: dict[str, Any]) -> str:
    """What one skill call gave (the answer to its tool call).

    step: {"skill", "args", "result": {success, reason, details, body_events}}."""
    r = step["result"]
    call = f"{step['skill']}({', '.join(f'{k}={v!r}' for k, v in step['args'].items())})"
    if r["success"]:
        return f"{call}: ok {r.get('details') or ''}".rstrip() + _body_events(r)
    reasons = catalogue["skills"].get(step["skill"], {}).get("reasons", {})
    meaning = reasons.get(r["reason"]) or catalogue.get("common_reasons", {}).get(
        r["reason"], ""
    )
    return (
        f"{call}: FAILED, reason {r['reason']} ({meaning}). details: {r.get('details')}"
        + _body_events(r)
    )


def render_not_run() -> str:
    """The answer to a skill call that was not run."""
    return "not run: an earlier call failed (or too many calls in one answer)"


def render_noted(
    name: str, plan_succeeded: bool, progress: dict[str, tuple[int, int]] | None = None
) -> str:
    """The answer to a goal_reached or missing_capability call. progress: the goal condition's,
    when there is one (goal_reached is then only noted if the condition is met)."""
    if name == GOAL_REACHED and not plan_succeeded:
        return "not accepted: a skill failed, so the goal is not reached yet"
    if name == GOAL_REACHED and progress and any(have < wanted for have, wanted in progress.values()):
        missing = ", ".join(f"{item} {have}/{wanted}" for item, (have, wanted) in progress.items())
        return f"not accepted: the goal is not reached yet ({missing})"
    return "noted"


def render_new_state(
    state: dict[str, Any] | None,
    previous_state: dict[str, Any] | None = None,
    repeated_failure: bool = False,
    progress: dict[str, tuple[int, int]] | None = None,
) -> str:
    """After the answers to the calls: warnings, then the new state, the goal progress if any.

    previous_state: the state shown at the previous turn (to report deaths and health changes).
    repeated_failure: the last failure is exactly the same as at the previous turn.
    progress: the goal condition's progress (brain/goal.py), None without a condition.
    """
    lines = []
    if repeated_failure:
        lines.append(
            "You already tried exactly this at the previous turn and it failed the same way. "
            "Do not repeat it: read the reason and the details, and change your calls."
        )
    lines += _what_changed(previous_state, state)
    lines.append("New state:")
    lines.append(render_state(state))
    lines.append("")
    if line := render_progress(progress):
        lines.append(line)
    lines.append(NEXT_STEP)
    return "\n".join(lines)


def render_empty_plan() -> str:
    """Sent back when the answer called no skill and not goal_reached: nothing was run."""
    return (
        "You called no skill: nothing was run. Call at least one skill, "
        "or goal_reached if the goal is already reached."
    )


def render_parse_error(error: str) -> str:
    """Sent back when the answer could not be used."""
    return (
        f"Your answer could not be used: {error}. "
        "Answer by calling the skills as tools. If the goal is reached, call the tool goal_reached."
    )
