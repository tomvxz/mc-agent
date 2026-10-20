# Journal format

The journal is the raw material of the world model and of the future shared latent space.
JSONL files (one JSON object per line), **append-only, never rewritten**.

## Where the data goes
One **run** = one launch of the bot process (`bot.js`). Its purpose comes from `MC_DATA_PURPOSE`:

| Purpose | Folder | Meaning |
|---|---|---|
| `dev` (default) | `data/dev/` | everything produced while building the bot: **disposable**, never used for training |
| `collection` | `data/collection/<run_id>/` | a real collection run; one folder per run (a failed run is deleted as a whole) |

Each folder holds:

| File | Written by | One line = |
|---|---|---|
| `runs.jsonl` | Node (`bot/src/run.js`) | one run (launch of the bot): its fixed facts |
| `transitions.jsonl` | Node (`bot/src/execute.js`) | one skill execution, complete (state, trace, next state, result) |
| `episodes.jsonl` | Python (`brain/journal.py`) | one event of an LLM episode |

Joins: transition -> run on `run_id` (versions, seed, server settings); transition -> episode on
`episode_id` + `turn`; transitions of a run are ordered by `seq` (previous = `seq - 1`).
`MC_DATA_DIR` changes the `data/` root. Older lines (schemas 1-3) are development data: ignore them.

## Rules
- **One state format.** `observe(bot)` (bot/src/state.js) is the single definition of the state:
  `GET /state`, `state` and `next_state` all use it. The LLM does not read it raw: the brain renders
  a short text from it for the prompt (a view, not a second format; the exact prompt is in episodes).
- **One line = one complete transition**, including its trace. Heavy parts are grouped under `trace`
  so they are easy to skip. Before training, the JSONL is converted once to columnar arrays; the
  JSONL stays the untouched raw source.
- Every line carries `schema_version`. Changing the shape of a line = bump the version; old lines
  stay as they are and readers must handle every version.
- Record what cannot be recomputed later; **never store what can be recomputed exactly** from other
  fields (two copies of one fact end up disagreeing). See "Derived at load time" below. The one
  deliberate exception: `next_state` (its grid could almost be rebuilt from `state` + `trace.blocks`)
  is kept because (`state`, `next_state`) in one format is exactly what the world model learns,
  and block-change capture can be incomplete.
- Never filter failures: failed skills, malformed LLM answers and crashes are data.
- A line whose trace has a `death`, `teleport`, `kicked` or `disconnected` event does not describe
  the effect of the skill alone: filter or weight it.
- **Format frozen until step 7** (world model): no new field until then. The data is for
  development only; the format for training will be fixed before the real collection run.
- Timestamps are ISO 8601 in UTC (`2026-10-19T10:45:12.345Z`); durations are in seconds; game
  times are in ticks (`bot.time.age`, 20 ticks = 1 s at the normal tick rate); trace times are in
  milliseconds since the start of the skill (`ms`).
- Optional fields are **absent** (not `null`) when they do not apply, unless stated otherwise.
- **Tick rate must stay 20** for collection: Mineflayer's physics, dig and eat timings run on
  wall-clock time and ignore the server's tick rate, so a faster server distorts the data.

## `runs.jsonl` (schema 1)
Written once per run, right after the bot spawns: the run's fixed facts, not repeated on every line.
```jsonc
{ "schema_version": 1, "type": "run_start", "run_id": "run-20261019-104512-a3f9", "ts": "…",
  "purpose": "dev",                         // dev | collection
  "data_dir": "/…/data/dev",
  "bot": "Agent",                           // one bot per run
  "world_id": "localhost:25565",            // MC_WORLD_ID, or host:port of the server
  "world_seed": "-1234567890",              // from /seed (null if unavailable)
  "versions": {
    "code": "6fc30a3+dirty",                // git commit; "+dirty" = uncommitted changes in bot/ or brain/
    "minecraft": "1.21.11", "server": "This server is running Paper version …",
    "mineflayer": "4.39.0", "pathfinder": "2.4.5", "node": "v26.5.0" },
  "game": { "difficulty": "hard",            // the WORLD's difficulty (can differ from server.properties)
            "game_mode": "survival", "dimension": "overworld",
            "tick_rate": 20,                  // at start; changes appear as trace events
            "view_distance": 3, "simulation_distance": 3 },   // as announced by the server at login
  "host": "machine-name" }
```

## `transitions.jsonl`

### Version 6 (current)
```jsonc
{
  "schema_version": 6,
  // --- Identity (everything else about the run is in runs.jsonl)
  "run_id": "run-…",                    // null when no run was started (unit tests)
  "seq": 17,                            // 0, 1, 2... within the run; the previous transition is seq - 1
  "source": "brain",                    // who asked: brain, test:<skill>, test:field, manual, api...
  "episode_id": "ep-…", "turn": 0,      // only when the call comes from an LLM episode (which plan asked)
  // --- Time
  "wall_start": "…", "wall_end": "…",   // wall_end is after the 300 ms settle wait
  "tick_start": 1203345, "tick_end": 1203512,   // world age in ticks (null if unavailable)
  // --- Action
  "skill": {
    "name": "mine",
    "args": { "block": "oak_log" },                         // as requested
    "args_resolved": { "count": 1, "block": "oak_log" } },  // + the catalogue's defaults
  // --- Before, during, after
  "state": { … },                       // observe() before (see below), or null if unavailable
  "trace": { … },                       // what happened during the skill (see below), null for an unknown skill
  "next_state": { … },                  // observe() after (+300 ms)
  // --- Result
  "success": true,
  "reason": "ok",                       // stable list per skill: see the catalogue (GET /skills)
  "details": { … },                     // the skill's details (found, collected, placed...)
  "duration": 9.47,                     // seconds, as measured by runSkill
  "timed_out": false,
  "error": null                         // { type, message, stack (2000 chars max) } on an exception
}
```

#### `state` / `next_state`: the state (from `observe`)
Every field may be `null` if it could not be read.
```jsonc
{
  // Body
  "position": [1000.5, 202.0, 1000.5], "yaw": 3.142, "pitch": 0, "velocity": [0, -0.078, 0],
  "on_ground": true, "in_water": false, "in_lava": false, "on_fire": false,
  "health": 20, "food": 20, "food_saturation": 5, "oxygen": null, "xp_level": 0,
  "deaths": 0,                          // deaths since the bot process started (v5)
  "effects": [{ "name": "Speed", "amplifier": 0, "duration": 600 }],
  // Inventory and equipment
  "inventory": { "oak_log": 2 },                        // counts (main + hotbar)
  "inventory_slots": [ { "slot": 36, "name": "wooden_pickaxe", "count": 1, "durability_left": 58 } ],
  "held_slot": 0,                                       // selected hotbar slot (0-8)
  "held_item": { "name": "wooden_pickaxe", "count": 1, "durability_left": 58 },
  "armor": { "head": null, "chest": null, "legs": null, "feet": null },
  "off_hand": null,                                     // slots: null = empty
  // World
  "game_mode": "survival", "difficulty": "hard", "dimension": "overworld",
  "biome": null, "biome_id": 28,
  "light": 0, "sky_light": 15, "time_of_day": 1248, "day": 3, "moon_phase": 3,   // 0 = full moon
  "raining": false, "thunder": false,
  // Surroundings
  "entities": [                         // within 16 blocks, nearest first, at most 20; ids are stable in a run
    { "id": 312, "name": "husk", "type": "hostile", "hostile": true, "offset": [4.0, 0, 0.5], "distance": 4.0 } ],
  "block_below": "stone", "block_front": "air",
  "notable_blocks": {                   // logs, ores, water, lava, crafting_table, furnace, chest, sand, gravel, clay
    "oak_log": { "nearest": [3, 0, 1], "distance": 3.2, "r8": 2, "r16": 5, "r32": 9 } },
  "notable_truncated": false,           // true if more than 5000 notable blocks were found
  "blocks": {                           // 11x11x11 grid around the feet
    "origin": [1000, 202, 1000],        // the block the feet are in
    "radius": 5,
    "palette": ["air", "stone"],
    "cells": [1, 1, …] }                // 1331 palette indexes (null = not loaded)
}
```
Grid order: `for dy in -R..R, for dz in -R..R, for dx in -R..R`, i.e.
`index = (dy+R)*S*S + (dz+R)*S + (dx+R)` with `S = 2R+1`. Cell `(dx, dy, dz)` is the block at
`origin + (dx, dy, dz)`; `dy = -1` is the block under the feet.

Known gaps: `oxygen` is `null` until the server first reports it (it only sends it when it
changes, usually underwater). `biome` is `null` when Mineflayer has no name for the biome id;
`biome_id` is the raw id then (its mapping to names is not verified for this server).
Only loaded chunks are seen (view distance 3: about 48 blocks around the bot).

#### `trace`: what happened during the skill
Time series are stored as columns: `{ "fields": [...], "rows": [[...], ...] }`. `ms` = milliseconds
since the start of the skill.
```jsonc
{
  "events": [ { "ms": 120, "tick": 1203347, "type": "damage", … } ],
  "body": { "fields": ["ms","x","y","z","yaw","pitch","vx","vy","vz","on_ground","controls"],
            "rows": [[0, 1000.5, 202, 1000.5, 3.142, 0, 0, -0.078, 0, 1, 17], …] },   // every physics tick (20/s)
  "actions": [ { "ms": 850, "packet": "block_dig", "status": 0, "location": [1003, 202, 1000], "face": 1 } ],
  "blocks": { "fields": ["ms","x","y","z","from","to"], "rows": [[2100, 1003, 202, 1000, "oak_log", "air"]] },
  "entities": { "fields": ["ms","id","name","x","y","z"], "rows": [[0, 312, "husk", 1004.5, 202, 1000.5]] },
  "truncated": []                       // names of the parts that hit their cap (events 500, body 2400,
}                                       //   actions 1000, blocks 2000, entities 6000)
```
- **`body.controls`**: the control keys held at that tick, as bits: forward 1, back 2, left 4,
  right 8, jump 16, sprint 32, sneak 64 (17 = forward + jump). Movement is computed by the client
  and only positions reach the server, so the keys are read from the bot itself.
- **`actions`**: the action packets the bot sent (what the server received): `block_dig` (status
  0 start, 1 cancel, 2 finish), `block_place`, `use_item`, `held_item_slot`, `window_click`,
  `close_window`, `use_entity` (mouse 1 = attack), `arm_animation`, `entity_action` (sprint...),
  `player_input` (sneak).
- **`blocks`**: every block change within 16 blocks (the skill's digging and placing, the
  pathfinder's, and the world's: lava flow, falling sand...).
- **`entities`**: entities within 16 blocks every 5 ticks (about 4 times a second), at most 20.
- **`events`**:

| type | fields | meaning |
|---|---|---|
| `damage` | `damage_type_id`, `source` | the bot was hurt (cause from the damage_event packet; source = entity name or null) |
| `health_loss` / `heal` | `amount`, `health` | health went down / up |
| `death`, `respawn` | | |
| `teleport` | `distance` | the server moved the bot more than 5 blocks (/tp, respawn...) |
| `correction` | `distance` | the server refused a move and put the bot back (less than 5 blocks). A few are normal; many in a row = the bot is stuck (cause found and fixed: `fixWallContact` in bot/src/fixes.js) |
| `weather` | `raining`, `rain_level`, `thunder` | the weather changed during the skill |
| `pickup` | `item`, `count` | the bot picked up an item |
| `path_update` | `status`, `length`, `visited` | the pathfinder (re)planned |
| `path_reset` | `reason` | the pathfinder dropped its path (stuck, block_updated...) |
| `goal_reached` | | |
| `tick_rate` | `tick_rate`, `frozen` | the server changed its tick rate (the data is then unreliable) |
| `kicked`, `disconnected` | `reason` | |

### Derived at load time (do NOT add these to the journal)
| Field | Computed from |
|---|---|
| transition id, previous transition | `run_id` + `seq` |
| code version (git commit), world, bot, seed, tick rate at start | `runs.jsonl` via `run_id` |
| step within an episode | order of `seq` among lines with the same `episode_id` |
| items gained / lost, health / food change | `next_state` - `state` |
| ticks used | `tick_end - tick_start` |
| server health (ticks per second) | `(tick_end - tick_start) / (wall_end - wall_start)`: about 20 when healthy; far below = server lag or the machine slept (seen in a pilot: 0 ticks over 640 s) -> discard |
| distance / height to a target, tools needed, recipe ingredients, preconditions | `state` + `skill.args_resolved` + game data |
| died, death cause, damage taken, hits | `trace.events` |
| replans, explored nodes, time stuck | `trace.events` (`path_update`), `trace.body` |
| hostiles nearby (count) | `state.entities` |
| what the brain was told about damage / death (`body_events` in the API answer) | `trace.events` |
| last n results, ticks since last damage/meal, deaths so far | previous lines (`seq`) + their traces |

(`timed_out` is the one exception kept on purpose: it equals `reason == "timeout"` but makes filters readable.)

### Earlier versions (October 2026, development data only)
v5: v6 + `context` (path probes measured before acting), `continuous`, `discontinuities`,
`interventions`, `interventions_before`, `discontinuities_before`, `trace_before` (what happened
between two skills). Removed in v6 to keep only what helps to understand a skill now.
v4: v5 without `trace_before`, `discontinuities_before` and `state.deaths`.
v3: `state`/`next_state` were a small observe + `state_raw`/`next_state_raw`, plus `id`, `prev_id`,
run-level fields on every line, `events` instead of `trace`. v2: no trace, context, times or
reliability fields. v1: the first format. All are development data: ignore them for training.

## Which code produced the data
The git commit (`versions.code` in runs.jsonl, `code_version` in episodes) identifies the skills, the
catalogue texts and everything else exactly; `git diff` between two commits tells what changed.
There are no hand-written version numbers per skill or for the catalogue (they could lie: a fix in
a shared file changes every skill). Hence: a **collection** run refuses to start if the code is not
committed (`+dirty`). Development runs accept anything (their data is never used for training).
Before October 20, 2026, lines also had `versions.catalogue`, `versions.skills` and
`catalogue_version` (development data only).

## `episodes.jsonl`

### Version 1 (current)
An episode is a stream of events, each written as soon as it happens (nothing is lost if the
program crashes mid-episode). Every event has:

| Field | Meaning |
|---|---|
| `schema_version` | 1 |
| `type` | `episode_start`, `llm_turn` or `episode_end` |
| `episode_id` | e.g. `ep-20261019-104512-a3f9` (UTC date-time + 4 random hex characters) |
| `seq` | 0, 1, 2... order of the events within the episode |
| `ts` | when the event was written |

`episode_start`, written once, before the first LLM call:
```jsonc
{ "schema_version": 1, "type": "episode_start", "episode_id": "ep-…", "seq": 0, "ts": "…",
  "run_id": "run-…",                          // the body's run (null if unknown)
  "goal": "craft a wooden pickaxe",
  "scenario": "arena:trees_3",                // optional: the task setting
  "model": { "provider": "ollama", "name": "qwen3:8b", "params": { "temperature": 0.2, "seed": 42 } },
  "code_version": "6fc30a3",                  // the git commit (+dirty if uncommitted changes)
  "prompt_version": 1,                        // version of brain/render.py (the texts the LLM reads)
  "system_prompt": "…",                       // sent once: it does not change during the episode
  "tools": [ … ],                             // tool definitions sent to the LLM (propose_plans)
  "max_turns": 10 }
```

`llm_turn`, one per call to the LLM:
```jsonc
{ "schema_version": 1, "type": "llm_turn", "episode_id": "ep-…", "seq": 1, "ts": "…",
  "turn": 0,
  "new_messages": [ … ],        // only the messages ADDED to the conversation since the previous turn
                                //   (includes the rendering of the state the LLM was shown)
  "raw_response": { … },        // the provider's response, unmodified
  "plan": [ { "skill": "mine", "args": { "block": "oak_log", "count": 3 } } ],   // null if unparseable
  "missing_capability": null,   // what the LLM said it lacked, if anything
  "done": false,                // the LLM thinks the goal is reached
  "parse_error": null,          // why the answer could not be used (text instead of a tool call...)
  "latency": 2.4,               // seconds spent waiting for the LLM
  "tokens": { "prompt": 1830, "completion": 95 } }   // null if the provider does not say
```
The exact conversation of turn `n` is: `system_prompt` + `tools` + the `new_messages` of turns
`0..n`, concatenated. The skill calls of the plan are the transitions with the same `episode_id`
and `turn`.

`episode_end`, written once, also after a crash when possible:
```jsonc
{ "schema_version": 1, "type": "episode_end", "episode_id": "ep-…", "seq": 9, "ts": "…",
  "outcome": {
    "success": true,              // goal reached (LLM's done for now; a state check later)
    "reason": "done",             // done | max_turns | body_error | llm_error | interrupted (Ctrl+C) | crash
    "turns": 3,                   // number of llm_turn events (counted by brain/journal.py)
    "skill_calls": 7,             // null when unknown (after a crash)
    "duration": 84.2,             // seconds since episode_start (measured by brain/journal.py)
    "error": null                 // message when reason is an error
  },
  "final_state": { … } }          // observe() at the end, or null
```
`brain/journal.py` writes an `episode_end` automatically (reason `crash` or `interrupted`) when
the code exits on an exception. An episode without `episode_end` was killed hard (process killed).

Planned for later (step 6d / 8): model quantization, `why` per planned call,
the world model's predictions per candidate and the final choice, surprise after execution.
