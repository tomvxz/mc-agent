"""Journal lines (transitions.jsonl) -> examples for the world model.

First, simple base: which lines are usable, and the state's simple variables as a fixed-size vector. How
each variable is encoded: variables.py (one table per transformation). The richer parts of the state
(block grid, inventory as tokens, in_sight, entities) and the skill call come next, one at a time.
Format of the lines: docs/journal.md.

Usage (prints what was kept, why lines were dropped, and the range of every feature):
    uv run python -m brain.world_model.inputs.data_processing data/collection/<run_id> [<run_id> ...]
"""

import json
import math
import sys
from collections import Counter
from collections.abc import Iterator
from pathlib import Path

from brain.world_model.inputs.biome import BiomeEncoder
from brain.world_model.inputs.variables import (
    BIOME_EMBEDDED,
    BOOLS,
    BOUNDED,
    CATEGORIES,
    CYCLES,
    DEFAULTS,
    FEATURE_NAMES,
    RAW,
    SCALED,
)

# Server health: below this many ticks per second (20 when healthy), the line is not trusted
VALID_TICK_FREQ = 15

# Journal versions this code knows how to read (docs/journal.md): refuse the others instead of guessing
SCHEMA_VERSIONS = {10, 11}

# A line with one of these events does not describe the effect of the skill alone (docs/journal.md)
BAD_EVENTS = {"death", "teleport", "kicked", "disconnected"}

# Below this duration the tick rate is not measurable (ticks are counted in whole numbers)
MIN_SECONDS_FOR_TICK_RATE = 2

# Player inventory slots of the backpack (9-35) and the hotbar (36-44): where picked-up items go
STORAGE_SLOTS = range(9, 45)

# Variables that are one component of a list field of the state: name -> (field, index)
COMPONENTS = {
    "vx": ("velocity", 0),
    "vy": ("velocity", 1),
    "vz": ("velocity", 2),
    "y": ("position", 1),
}

# The biome: 2 indexes (embedded by the model) + 2 yes/no facts. Reads the game data once
encode_biome = BiomeEncoder()


def read_transitions(path: Path) -> Iterator[dict]:
    """The lines of a transitions.jsonl file (or of the file inside a run folder), one by one."""
    path = Path(path)
    if path.is_dir():
        path = path / "transitions.jsonl"
    with path.open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                yield json.loads(line)


def ticks_per_second(line: dict) -> float | None:
    """Server ticks per second during the skill (about 20 when healthy); None if not measurable."""
    seconds = line.get("duration")
    start, end = line.get("tick_start"), line.get("tick_end")
    if (
        start is None
        or end is None
        or not seconds
        or seconds < MIN_SECONDS_FOR_TICK_RATE
    ):
        return None
    return (end - start) / seconds


def drop_reason(line: dict) -> str | None:
    """Why this line cannot be used as an example, or None if it can. Failed skills ARE kept."""
    if line.get("schema_version") not in SCHEMA_VERSIONS:
        return f"schema_version {line.get('schema_version')}"
    if line.get("error"):
        return "error"
    if not line.get("state") or not line.get("next_state"):
        return "no state"
    events = {e.get("type") for e in (line.get("trace") or {}).get("events", [])}
    if events & BAD_EVENTS:
        return sorted(events & BAD_EVENTS)[0]
    # A step has no trace (it is a slice of its top line's): its death shows in the death counter
    deaths = line["state"].get("deaths"), line["next_state"].get("deaths")
    if None not in deaths and deaths[1] > deaths[0]:
        return "death"
    tps = ticks_per_second(line)
    if tps is not None and tps < VALID_TICK_FREQ:
        return "slow server"
    return None


def _value(state: dict, key: str) -> float:
    """The raw value of one variable. REQUIRED (KeyError if missing: a bug to look at), except the fields
    of DEFAULTS, whose null has a known meaning: the default."""
    if key in COMPONENTS:
        field, index = COMPONENTS[key]
        return float(state[field][index])
    if key in DEFAULTS:
        v = state.get(key)
        return float(DEFAULTS[key] if v is None else v)
    return float(state[key])


def _cycle(value: float, period: float) -> tuple[float, float]:
    """A periodic value as (sin, cos): the end of the cycle is then close to its start."""
    angle = 2 * math.pi * value / period
    return math.sin(angle), math.cos(angle)


def state_features(state: dict) -> dict[str, float | str]:
    """The state's simple variables, encoded as variables.py says (names: FEATURE_NAMES).
    Numbers, except CATEGORIES (strings). Does not modify `state`.
    """
    f: dict[str, float | str] = {}

    def value(key):
        return _value(state, key)

    for key, maximum in SCALED.items():
        f[key] = value(key) / maximum

    for key, period in CYCLES.items():
        f[f"sin_{key}"], f[f"cos_{key}"] = _cycle(value(key), period)

    for key, (low, high) in BOUNDED.items():
        f[key] = (value(key) - (high + low) / 2) / ((high - low) / 2)

    for key in RAW:
        f[key] = value(key)
    f["fall_distance"] = max(0.0, f["fall_distance"])  # never negative in the game; rounding

    for key in BOOLS:
        f[key] = float(bool(state[key]))

    for key in CATEGORIES:
        f[key] = str(state[key])

    # Room left in the inventory: a full inventory cannot pick anything up (not_collected)
    used = {s["slot"] for s in state["inventory_slots"] if s["slot"] in STORAGE_SLOTS}
    f["free_slots"] = (len(STORAGE_SLOTS) - len(used)) / len(STORAGE_SLOTS)

    # Biome: biome_index, biome_category_index, biome_has_precipitation, biome_snows (biome.py)
    f.update({k: float(v) for k, v in encode_biome(state).items()})

    return f


def state_vector(state: dict) -> list[float | str]:
    """state_features as a list, in the order of FEATURE_NAMES."""
    f = state_features(state)
    return [f[name] for name in FEATURE_NAMES]


def main(paths: list[str]) -> None:
    kept, dropped = [], Counter()
    for path in paths:
        for line in read_transitions(Path(path)):
            reason = drop_reason(line)
            if reason:
                dropped[reason] += 1
            else:
                kept.append(state_vector(line["state"]))
    print(f"kept {len(kept)} lines, dropped {sum(dropped.values())}: {dict(dropped)}")
    if not kept:
        return
    print(f"{len(FEATURE_NAMES)} features:")
    for i, name in enumerate(FEATURE_NAMES):
        column = [row[i] for row in kept]
        if name in BIOME_EMBEDDED or name in CATEGORIES:
            # An index or a string is not a measure: how often each value appears
            if name == "biome_index":
                column = [encode_biome.names[int(v)] for v in column]
            elif name == "biome_category_index":
                column = [encode_biome.categories[int(v)] for v in column]
            counts = Counter(column)
            print(f"  {name:24s} {len(counts)} values: {dict(counts.most_common())}")
            continue
        mean = sum(column) / len(column)
        print(
            f"  {name:24s} min {min(column):7.3f}  mean {mean:7.3f}  max {max(column):7.3f}"
        )


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1:])
