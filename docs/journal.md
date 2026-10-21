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
`episode_id` + `turn`; transitions of a run are ordered by `seq` (start order; the steps inside a skill carry `parent_seq`).
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

### Version 8 (current)
```jsonc
{
  "schema_version": 8,
  // --- Identity (everything else about the run is in runs.jsonl)
  "run_id": "run-…",                    // null when no run was started (unit tests)
  "seq": 17,                            // 0, 1, 2... within the run, given when the skill STARTS
  "parent_seq": 12,                     // only for a STEP: a skill called inside another one (mine ->
                                        //   find, collect_block -> break_block, pick_up), see below
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
  "trace": { … },                       // what happened during the skill (see below), null for an unknown
                                        //   skill and for a step (the slice of its top line's trace)
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

#### Steps: the skills called inside a skill
A shortcut is an assembly of primitives: each primitive it calls gets its own line (`bot/src/steps.js`),
so the world model also learns from short actions when the brain asked for `mine` 10. A step line has
`parent_seq` (the seq of the skill that called it, which may itself be a step), the same `source`,
`episode_id` and `turn`, its own `state`, `next_state`, result and times, and `trace: null`: its trace is
the part of the top line's trace between its `tick_start` and `tick_end`. No 300 ms wait after a step.
A step whose top skill was stopped ends with reason `stopped` (its next action was refused).
Lines are written when a skill ENDS: a step's line comes before its parent's, and seq order = start order.
The brain's tools (`brain/show.py`, `brain/bench.py`) read only the top lines (no `parent_seq`).

#### `state` / `next_state`: the state (from `observe`)
Every field may be `null` if it could not be read. The state holds everything the CLIENT knows: the
server sends every block of the loaded chunks and every entity around, walls or not. What the bot
could SEE is marked (`blocks.visible`, `visible` of entities): a perception that sees only that is a
mask over the same line, not a second format (`bot/src/perception.js`).
```jsonc
{
  "perception": "sight",                // how find, scan and the brain's view filter what is known:
                                        //   "sight" = line of sight only, "all" = everything (x-ray)
  // Body
  "position": [1000.5, 202.0, 1000.5], "yaw": 3.142, "pitch": 0, "velocity": [0, -0.078, 0],
  "on_ground": true, "in_water": false, "in_lava": false, "on_fire": false,
  "sneaking": false, "sprinting": false, "sleeping": false,   // from the keys held (the client decides)
  "fall_distance": 0,                   // blocks fallen since last on the ground or in a liquid (> 3: damage)
  "health": 20, "food": 20, "food_saturation": 5, "oxygen": null,
  "xp_level": 0, "xp_points": 0, "xp_progress": 0,    // points: total; progress: 0-1 to the next level
  "deaths": 0,                          // deaths since the bot process started
  "effects": [{ "name": "Speed", "amplifier": 0, "duration": 600 }],
  // Inventory and equipment
  "inventory": { "oak_log": 2 },        // counts (main + hotbar): recomputable from inventory_slots,
                                        //   kept on purpose (what the brain and the goal condition read)
  "inventory_slots": [ { "slot": 36, "name": "wooden_pickaxe", "count": 1, "durability_left": 58,
                         "enchantments": [{ "name": "efficiency", "level": 1 }] } ],   // every slot
  "held_slot": 0,                                       // selected hotbar slot (0-8)
  "held_item": { "name": "wooden_pickaxe", "count": 1, "durability_left": 58 },
  "armor": { "head": null, "chest": null, "legs": null, "feet": null },
  "off_hand": null,                                     // slots: null = empty
  // World
  "game_mode": "survival", "difficulty": "hard", "dimension": "overworld",
  "biome": "desert", "biome_id": 14,    // name from the registry (the server's list)
  "light": 0, "sky_light": 15, "time_of_day": 1248, "day": 3, "moon_phase": 3,   // 0 = full moon
  "raining": false, "thunder": false,
  // What the bot looks at: the crosshair within reach (4.5 blocks), and the entity within 3.5
  "looking_at": { "block": "oak_log[axis=y]", "position": [1003, 202, 1000], "face": 4, "distance": 2.6 },
  "looking_at_entity": null,            // an entity id, or null
  // Surroundings
  "entities": [                         // within 16 blocks, nearest first, at most 20; ids are stable in a run
    { "id": 312, "name": "husk", "type": "hostile",
      "hostile": true,                  // the game data's category "Hostile mobs" (neutral mobs included)
      "offset": [4.0, 0, 0.5], "distance": 4.0, "velocity": [0, -0.078, 0], "yaw": 1.2,
      "visible": true,                  // in line of sight from the eyes (its middle)
      "held_item": { "name": "iron_shovel", "count": 1 },   // only if it holds something
      "username": "Steve",              // only for players
      "item": { "name": "oak_log", "count": 3 } } ],        // only for an item lying on the ground
                                        // no health: a player does not see it
  "in_sight": {                         // EVERY kind of block in sight within 32 blocks (no list): the cells a
                                        //   fan of ~18,000 rays from the eyes crosses (1.5 degrees apart, every
                                        //   direction), each ray stopping at the first opaque block; perception
                                        //   "all": the same rays not stopping (x-ray). count = cells seen.
    "spruce_log": { "count": 12, "nearest": [3.5, 0, 1.5], "distance": 3.8 } },
  "blocks": {                           // 17x17x17 grid around the feet (radius 8)
    "origin": [1000, 202, 1000],        // the block the feet are in
    "radius": 8,
    "palette": ["air", "stone", "oak_log[axis=y]"],   // block STATES, in the game's notation
    "cells": [1, 1, …],                 // 4913 palette indexes (null = not loaded)
    "visible": "AAAA…" }                // base64, one bit per cell: cell i is byte i >> 3, bit i & 7 (1 = seen)
}
```
Grid order: `for dy in -R..R, for dz in -R..R, for dx in -R..R`, i.e.
`index = (dy+R)*S*S + (dz+R)*S + (dx+R)` with `S = 2R+1`. Cell `(dx, dy, dz)` is the block at
`origin + (dx, dy, dz)`; `dy = -1` is the block under the feet (the block below and the one in front
are read there: not stored).

Visibility (360 degrees, as if the bot looked around): a block hides what is behind it when the game
data says it is not `transparent` and it is a full block (stone yes; leaves, glass, water, grass no).
`blocks.visible` and `in_sight` come from the same fan of rays (`bot/src/perception.js`): a cell is
seen if a ray crosses it (empty cells too: seen empty space is known). `find`, which looks for one kind
up to 64 blocks, checks each candidate with its own rays (faces turned to the eyes).

Known gaps: `oxygen` is `null` until the server first reports it (it only sends it when it
changes, usually underwater). Only loaded chunks are known (view distance 3: about 48 blocks around
the bot).

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
  "truncated": []                       // names of the parts that hit their cap (events 500, body 6000,
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
| transition id, previous transition | `run_id` + `seq` (previous at the same level: the nearest smaller `seq` with the same `parent_seq`) |
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
v7: the state had `notable_blocks` (logs, ores... within 32 blocks, seen through walls), `block_below`, `block_front`, block names without their state in the grid, no
visibility, no `looking_at`, fewer body and entity fields, a hand-made hostile list; `biome` always null.
v6: v7 without step lines and `parent_seq`; `seq` was given when the line was written (at the end).
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
  "model": { "provider": "openai_compatible", "base_url": "http://127.0.0.1:11434/v1", "name": "qwen2.5:3b",
             "params": { "temperature": 0.2, "seed": 42, "max_tokens": 600,
                         "context_length": 16384 } },   // as loaded by the server (null if unknown);
                                                        //   past it the server cuts the conversation
  "code_version": "6fc30a3",                  // the git commit (+dirty if uncommitted changes)
  "system_prompt": "…",                       // sent once: it does not change during the episode
  "tools": [ … ],                             // tool definitions sent to the LLM: one per skill + goal_reached, missing_capability
  "max_turns": 10 }
```

`llm_turn`, one per call to the LLM:
```jsonc
{ "schema_version": 1, "type": "llm_turn", "episode_id": "ep-…", "seq": 1, "ts": "…",
  "turn": 0,
  "new_messages": [ … ],        // only the messages ADDED to the conversation since the previous turn
                                //   (the answer of the previous turn, one "tool" message per call
                                //   with its result, then the new state)
  "raw_response": { … },        // the provider's response, unmodified
  "plan": [ { "skill": "mine", "args": { "block": "oak_log", "count": 3 } } ],   // the skill calls of the
                                //   answer, in order; null if unparseable
  "missing_capability": null,   // what the LLM said it lacked (its missing_capability call), if anything
  "done": false,                // the LLM called goal_reached
  "parse_error": null,          // why the answer could not be used (text instead of a tool call...)
  "latency": 2.4,               // seconds spent waiting for the LLM
  "tokens": { "prompt": 1830, "completion": 95 } }   // null if the provider does not say
```
The exact conversation of turn `n` is: `system_prompt` + `tools` + the `new_messages` of turns
`0..n`, concatenated. The skill calls of the plan are the transitions with the same `episode_id`
and `turn`.

**Goal definition turn** (brain/goal.py, when the goal condition is on): turn 0 can be a SEPARATE
conversation, before the loop, where the LLM turns the goal into a condition with the tool
`define_goal(item, count)` (one call per item). Its `new_messages` start with its own system
message (that is how it is recognized), `plan` is `[]`, and the condition is in its
`raw_response` (recomputed, not stored: `goal.parse_condition`). The tool definition is in
`brain/render.py`, identified by `code_version`. The loop's turns then start at 1, and the
conversation of turn `n` is `system_prompt` + `tools` + the `new_messages` of turns `1..n`.
An unusable definition is not asked again: `parse_error` says why, and the episode goes on without
a condition (the LLM's goal_reached).

Messages use the OpenAI chat format:
```jsonc
{ "role": "user", "content": "Goal: …\n\nPosition: …" }                    // goal, new state, error feedback
{ "role": "assistant", "content": "",                                       // the LLM's previous answer,
  "tool_calls": [ { "id": "call_ab12", "type": "function",                  //   put back as tool calls
                    "function": { "name": "find", "arguments": "{\"target\": \"oak_log\"}" } } ] }
{ "role": "tool", "tool_call_id": "call_ab12", "content": "find(target='oak_log'): ok {…}" }  // one per call
```
An unusable answer is put back as `{ "role": "assistant", "content": "<its text>" }`.
Text written next to the calls (some models write some, unasked) is not put back: `content` is `""`
when there are `tool_calls` (Ollama's templates cannot show both). It stays in `raw_response` only,
like a thinking model's own reasoning field.

`episode_end`, written once, also after a crash when possible:
```jsonc
{ "schema_version": 1, "type": "episode_end", "episode_id": "ep-…", "seq": 9, "ts": "…",
  "outcome": {
    "success": true,              // goal reached: the goal condition met (checked by the code), or the LLM's goal_reached
    "reason": "done",             // condition_met | done | max_turns | body_error | llm_error | interrupted (Ctrl+C) | crash
    "turns": 3,                   // number of llm_turn events, the goal definition included (counted by brain/journal.py)
    "skill_calls": 7,             // null when unknown (after a crash)
    "duration": 84.2,             // seconds since episode_start (measured by brain/journal.py)
    "error": null                 // message when reason is an error
  },
  "final_state": { … } }          // observe() at the end, or null
```
`brain/journal.py` writes an `episode_end` automatically (reason `crash` or `interrupted`) when
the code exits on an exception. An episode without `episode_end` was killed hard (process killed).

Before commit `eb6a997` (October 20, 2026, development data only): a single tool `propose_plans`
whose arguments held the plan, the results of a plan sent back as ONE user message, and the
state shown with a context of 4096 tokens (conversations cut after about 6 turns).

Planned for later (step 6d / 8): model quantization, `why` per planned call,
the world model's predictions per candidate and the final choice, surprise after execution.
