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

SYSTEM_PROMPT = """You control a Minecraft bot through skills. You reach goals by chaining skills.

Rules:
- Answer ONLY by calling the tool propose_plans (or, if you cannot call tools, with its JSON:
  {{"plan": [{{"skill": "...", "args": {{...}}}}], "missing_capability": "", "done": false}}).
- A plan is a list of skill calls run in order. It stops at the first failure, and you then get
  the results and the new state to fix your plan.
- Coordinates are absolute block coordinates (x, y, z). North is -z, south +z, east +x, west -x.
  y is the height.
- Before acting on something you have not located, use find. If find answers not_found,
  use explore, then search again.
- To get blocks (wood, stone...), use mine; for one block at a known position, collect_block.
- Do not repeat a call that just failed in the same way: read its reason and change the plan.
- When the goal is reached, answer with an empty plan and done=true.
- If no skill can do what you need, say what in missing_capability.

Skills:
{skills}"""


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


def _args_signature(entry: dict[str, Any]) -> str:
    """e.g. "block, count=1" from a skill's JSON Schema parameters.

    Allowed values are shown when the schema has them (seen with v1: the LLM wrote "southwest"
    because it did not know the directions were north_east, south_west...).
    """
    props = entry["parameters"]["properties"]
    required = entry["parameters"].get("required", [])
    parts = []
    for name, schema in props.items():
        if name in required:
            part = name
        elif "default" in schema:
            part = f"{name}={schema['default']}"
        else:
            part = f"{name}?"
        if "enum" in schema:
            part += f" (one of: {', '.join(map(str, schema['enum']))})"
        parts.append(part)
    return ", ".join(parts)


# --- What the LLM reads -----------------------------------------------------------------------


def render_skills(catalogue: dict[str, Any]) -> str:
    """The skill list for the system prompt: signature, description, failure reasons."""
    lines = []
    for name, entry in catalogue["skills"].items():
        lines.append(f"- {name}({_args_signature(entry)}): {entry['description']}")
        lines.append(f"  Can fail with: {', '.join(entry['reasons'])}.")
    return "\n".join(lines)


def system_prompt(catalogue: dict[str, Any]) -> str:
    return SYSTEM_PROMPT.format(skills=render_skills(catalogue))


def render_state(state: dict[str, Any] | None) -> str:
    """A short text view of the full state (the 11x11x11 block grid is left out on purpose)."""
    if state is None:
        return "State: unavailable (the bot may be dead or disconnected)."
    x, y, z = state["position"]
    bx, by, bz = int(x // 1), int(y // 1), int(z // 1)
    lines = [
        f"Position: ({bx}, {by}, {bz}), standing on {state.get('block_below') or 'unknown'}.",
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

    entities = state.get("entities") or []
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

    notable = state.get("notable_blocks") or {}
    if notable:
        described = []
        for name, info in sorted(notable.items(), key=lambda kv: kv[1]["distance"]):
            ox, oy, oz = info["nearest"]
            nx, ny, nz = (
                round(x + ox),
                round(y + oy),
                round(z + oz),
            )  # absolute block coordinates
            described.append(
                f"{name}: {info['r32']} within 32, nearest at ({nx}, {ny}, {nz})"
            )
        lines.append("Visible resources: " + "; ".join(described) + ".")
    else:
        lines.append("Visible resources: none within 32 blocks.")
    return "\n".join(lines)


def render_goal(goal: str, state: dict[str, Any] | None) -> str:
    """The first user message of an episode."""
    return f"Goal: {goal}\n\n{render_state(state)}"


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


def render_results(
    results: list[dict[str, Any]],
    catalogue: dict[str, Any],
    state: dict[str, Any] | None,
    previous_state: dict[str, Any] | None = None,
    repeated_failure: bool = False,
) -> str:
    """What happened when the plan ran, then the new state.

    results: [{"skill", "args", "result": {success, reason, details, body_events}}], in order.
    previous_state: the state shown at the previous turn (to report deaths and health changes).
    repeated_failure: the last failure is exactly the same as at the previous turn.
    """
    lines = ["Results of your plan:"]
    for i, step in enumerate(results, 1):
        r = step["result"]
        call = f"{step['skill']}({', '.join(f'{k}={v!r}' for k, v in step['args'].items())})"
        if r["success"]:
            lines.append(
                f"{i}. {call}: ok {r.get('details') or ''}".rstrip() + _body_events(r)
            )
        else:
            reasons = catalogue["skills"].get(step["skill"], {}).get("reasons", {})
            meaning = reasons.get(r["reason"]) or catalogue.get(
                "common_reasons", {}
            ).get(r["reason"], "")
            lines.append(
                f"{i}. {call}: FAILED, reason {r['reason']} ({meaning}). details: {r.get('details')}"
                + _body_events(r)
            )
    if repeated_failure:
        lines.append(
            "You already tried exactly this at the previous turn and it failed the same way. "
            "Do not repeat it: read the reason and the details, and change your plan."
        )
    lines += _what_changed(previous_state, state)
    lines.append("")
    lines.append(render_state(state))
    return "\n".join(lines)


def render_empty_plan() -> str:
    """Sent back when the plan is empty but the goal is not reached (done=false)."""
    return (
        "Your plan is empty but done is false: nothing was run. "
        "Propose at least one skill call, or set done=true if the goal is already reached."
    )


def render_parse_error(error: str) -> str:
    """Sent back when the answer could not be used."""
    return (
        f"Your answer could not be used: {error}. "
        "Answer only by calling the tool propose_plans with a plan (a list of skill calls)."
    )
