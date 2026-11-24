# Status, measurements and decisions

Where the project stands, what was measured, what was decided or tried. Everything here is DATED: a
measurement is a snapshot of one code version in one world, not a fact about the project. Before relying
on a number, check its date and measure again if the code or the world changed since.

Rules and principles: `CLAUDE.md`. Target architecture and stages: `docs/architecture.md`.
Update this file at the end of a work session (newest first in each section).

## 1. Current state and next steps (2026-11-13)

### Done
- Skills: move_to, break_block, pick_up, place_block, craft, eat, find, scan, explore, collect_block, mine;
  questions recipe, craftable; underground dig, strip_mine; low level walk, look, press.
  Shown to the LLM: see `SHOWN_TO_LLM` (`bot/src/skills/catalogue.js`).
- Agent loop with a goal condition, episode bench (`brain/bench.py`), field bench, arena.
- World model, first base (2026-11-16): `brain/world_model/inputs/data_processing.py` (encoding of each variable: `inputs/variables.py`) (usable lines, 39 simple
  features). Next: inventory tokens, in_sight, grid, the skill call, the targets.
- Journal format v11 (`docs/journal.md`); it evolves by versions, it is never frozen (decided 2026-11-13).
- `bot/src/` organized by role (2026-11-12): `api/`, `execution/`, `journal/`, `observation/`, `game/`, `skills/`.
- Tests (2026-11-12): API contract shared by Node and Python (`docs/api_contract.json`); trace events;
  stop rules and perception in the arena (`too_long`, `timeout`, `alert`, a log behind a wall).

### Not written yet
- Batch 2 of primitives: attack, equip, use_item, container, smelt, wait (checked in the code and the git
  history on 2026-11-12: never written). Without it the expressiveness check fails (kill and cook a cow,
  store in a chest) and collected data will have none of these actions.

### To check in the arena (fixed 2026-11-12, unit tests pass, never run in the game)
- `dig` stepping controlled at every physics tick (`stepInto`), `mine` counting `not_picked_up`, `craft`
  resync waiting for the server to be quiet (`resyncWindow`), arena case "planks x8 right after a craft
  at a table", and the new edge cases above.

### Next steps, in order
1. Trial collection done (2026-11-13, see measurements): the chain works end to end. To fix before the
   real collection: the LLM looks only for `oak_log` in a spruce biome (goal = any planks). Fixed the same
   day (unit tests, not run in the game): `mine`, `collect_block` and `break_block` now report
   `details.blocks_placed` (scaffolding placed by the pathfinder), counted net of the scaffolding picked up.
2. Prepare the collection for the world model (step 7): `MC_DATA_PURPOSE=collection`, benches in series
   (qwen2.5:14b for varied successes, small models for failures), then the first heads.
3. Field bench: a free cell for place_block, then 50 places on a new seed. Longer tasks on the episode
   bench (wooden_pickaxe), ~10 places per variant.
4. Strategy options for `move_to` / `explore` (`dig`, `build`, `max_drop`, `avoid_water`), a short
   primitive `step(direction, count)`, a generic unblocking reflex.
5. `brain/recovery.py` (rules), measured on the bench with / without.

### Small things waiting
- `mine` checks what it collected on the NET inventory: mining dirt while the pathfinder bridges with dirt
  can end in a false `not_collected` (found by a unit test 2026-11-13, not seen in the game). Count the
  pickups instead.
- `context_length` not recorded when Ollama has not loaded the model yet.
- An unusable answer replayed identically (low temperature, fixed seed: the correction message changes nothing).
- An `llm_error` (e.g. unknown model) counts as a place played on the bench.
- `craft` finds the crafting table through walls (`findBlock`), against the perception rule.
- Two definitions of "seen": Mineflayer's raycast in `break_block`, our DDA in `perception.js`.
- To decide: `explore` maximum distance (256 -> 64?).
- The script that replays one decision moment (several seeds, without the game) lived in a session
  scratchpad, now lost: rewrite it in `brain/` if needed again.

## 2. Measurements (snapshots)

| Date | Code | What | Result |
|---|---|---|---|
| 2026-11-13 | 940419b | trial collection, field bench (41 min, `run-20261113-030804-0746`) | 839 lines (196 top), 0.24 GB/h, ~190 KB per line; bursts 4.2 %; no exception, no slow tick rate; 11 of 55 `mine` used dirt as scaffolding without reporting it |
| 2026-11-13 | 940419b | trial collection, episode bench qwen2.5:14b (`run-20261113-035536-0ad5`) | crafting_table 9/10 (failure: max_turns, explored a snowy spruce biome looking only for oak_log), oak_logs 5/5; LLM latency median 29 s per turn (0.5 h of 0.6 h of episodes); every plan linked to its transitions; bursts 4.7 % |
| 2026-11-13 | v10 | `observe` on a test world (open air, no server) | line of sight 133 -> 23 ms, grid radius 16: 25 -> 3 ms; outputs identical at 5 places, both perceptions |
| 2026-11-13 | 0f40b16+dirty | arena craft, dig, mine, move_to, find | all nominal cases and edge cases pass (stop rules, a log behind a wall); bursts still 14 % (before the speed-up) |
| 2026-11-12 | v10, uncommitted | arena, all suites | all pass except 3 bugs (dig fall, mine partial, craft after a table), fixed since, not re-run |
| 2026-11-12 | v10 | journal lines | ~160 KB per line (v9: 25 KB), grid ~110 KB per state |
| 2026-11-12 | v10 | physics ticks arriving in bursts (< 15 ms apart) | 15.2 % (v9: 5.9 %): `observe` blocks Node |
| 2026-10-25 | | grid radius 16 | 33^3 = 35,937 cells, 86 KB, ~33 ms (radius 8: 11 KB, ~5 ms) |
| 2026-10-22 | 73f8b9d | field bench, seed 3, 30 places, line of sight | mine 27/27, explore 29/30 (1 budget timeout), move_to 25/26 (1 justified alert: on a bamboo, 10-block fall), place_block 17/17 |
| 2026-10-22 | 73f8b9d | episodes crafting_table, qwen2.5:14b, context 16k | 9/10 (the failure: assumed oak with spruce in the inventory). With a 4096 context (Ollama restarted without OLLAMA_CONTEXT_LENGTH) episodes are worthless: check `context_length` |
| 2026-10-21 | | crafting_table, qwen2.5:14b, line of sight | 4/4 with "In sight" (sight 2/2, x-ray 2/2); then 3/4 with `#planks` / `uses` / `craftable` (2 spruce forests solved at once via `recipe("#planks")`). The failure: a plan written in advance around oak, replayed 10 times with spruce in sight at 4 blocks (a prior of the model, not missing information) |
| 2026-10-21 | | crafting_table, seed 3 (the CEILING) | qwen2.5:14b 3/3 (3 to 5 turns, ~1 min 30 per episode); llama3.1:8b 0/7; qwen2.5:3b fails (crafts the table without making planks) |
| 2026-10-21 | | perception fan of rays | 97 ms the first time, 4 ms cached, x-ray 218 ms; our DDA ~3x faster than Mineflayer's raycast |
| 2026-10-21 | | without "In sight" | the 14B looked for oak in a spruce forest: 1/4 instead of 3/3 |
| 2026-10-21 | | arena after perception, journal v9, walk / press | all suites pass except eat (the world was peaceful then); walk confirms the angle convention (0 = north, pi/2 = west, -pi/2 = east) |
| 2026-10-20 | | oak_logs, 3 places, seed 1 | llama3.1:8b 3/3 (1-2 turns, uses `mine`); qwen2.5:3b 3/3 with condition (2, 2, 8 turns), 3/3 without (3, 7, 7). Too few places; the task no longer discriminates |
| 2026-10-21 | | context | qwen2.5:14b fits on the M2 16 GB next to the server with a 16k context; the episode is still a growing conversation, enough for ~60 turns in 16k |
| (before) | | field bench, seed 1, 19 places, after `fixWallContact` | move_to 11 % -> 100 %, explore 5 % -> 100 %, mine 67 % -> 100 % |

Conclusion drawn from the ceiling (2026-10-21): the architecture (skills, one-level `recipe`, goal condition)
is enough for a strong enough model; the small models fail because of their size. The prompt is no longer
tuned for them: their failures are the reference the world model must improve (step 8).

## 3. Decisions, and things tried then removed

- 2026-11-13: the journal format is never frozen: it evolves by `schema_version`, and the code reading the
  journal says which versions it reads. A small collection is a test (check the chain, measure, feed the
  training code), not a commitment. Changing an existing skill stays possible, as a versioned change.

- 2026-11-12: `settle_ticks` on every line (6 for a top line, 0 for a step): no wait between the
  primitives of a shortcut (a player does not pause; each primitive waits for its own effect).
- 2026-11-12: slowing down Mineflayer's clicks was considered: only half possible (the put-away clicks go
  through an internal function), so the resync is kept; if crafts still fail, write our own click sequence.
- 2026-10-25: grid radius 16, chosen large on purpose: a model can crop a large grid, never grow a small one.
  Beyond it, `in_sight` (32 blocks). Its cost is measured in section 2.
- 2026-10-24: a new world takes the difficulty of `server.properties` (normal) for the collection.
- 2026-10-21: `observe` (journal v8) keeps EVERYTHING the client knows and MARKS what the bot sees (line of
  sight in every direction: a mask on the grid, `visible` on entities): perception is a mask on the same
  line, not a second format. `in_sight` replaces `notable_blocks` (which saw through walls): every kind of
  block in sight within 32 blocks, no list, ~18,000 rays from the eyes (1.5 degrees), stopped at the first
  opaque block. No limit on the kinds shown to the LLM (a limit cut the trees off).
- 2026-10-21: perception plugged in (`MC_PERCEPTION`, `POST /setup {perception}`): find, mine, scan and the
  LLM's view only see the line of sight by default. Not yet: memory of what was seen; the pathfinder still
  plans with everything the client knows; `hostile_near` also counts a monster behind a wall (a player hears it).
- 2026-10-21: skills reviewed before freezing: place_block accepts what the game replaces (tag replaceable
  AND no collision box); break_block `require_tool` (false = break anyway, `no_drop`); find / mine accept a
  game group (`#logs`); break_block refuses a block not in sight (`not_seen`, without saying what it is);
  liquids = the server's fluid tags plus `bubble_column`; the single 60 s time limit replaced by budget,
  progress and alerts; mine limited by its budget (~18 blocks per call).
- 2026-10-21: hostile = the game's category "Hostile mobs".
- 2026-10-21: the 14B now chains long plans (up to `goal_reached`): judged positive, the loop stops at the
  first failure.
- Tried then removed: a `how` field per ingredient in `recipe`, and choosing "the useful wood" from the trees
  around: they answered the next question before it was asked (the body linked logs -> planks itself).
  Kept instead: `recipe(uses: X)`, variants named with the game group (`#planks`), `craftable()`.
  Seen: the 14B with birch asked `recipe(oak_planks)` (12 variants unrelated to its inventory).
- Tried then removed: asking for one or two sentences of reasoning before the calls (`--reasoning`). No
  effect on llama3.1:8b; qwen2.5:14b then wrote its calls as TEXT (0 skills in 10 turns; 3/3 without).
- Tried then removed: a single tool `propose_plans` holding a list of skills: qwen2.5:3b called the skills
  directly, Ollama dropped calls to unknown tools -> empty answers.
- Flat arguments for tools: with a nested object, qwen2.5:3b closed the braces badly and Ollama dropped the call.
- The text a model writes next to its calls is not put back in the history: Ollama's prompt templates cannot
  show text AND calls (llama3.1 drops the text, qwen2.5 drops the CALLS). qwen2.5:14b sometimes writes it in
  Russian: no effect, it is not read.
- Set aside: sub-goals written by the LLM (`add_step`).
- `missing_capability`: qwen2.5:3b left it empty in ALL episodes, even when stuck. A small model tells badly
  what it lacks: for gaps, use a larger model now and then, or an explicit question after a failure, plus the
  expressiveness check done by hand.
- Item names are not checked on the Python side (no list): seen "cook a beef" -> `beef`.
- Left out for now (the user's decision): refusing a place whose ground is not full (bamboo), a guard on
  Ollama's context size.

## 4. Root causes found (and fixed)

- `state.oxygen` up to 400 on a 0-20 scale (2026-11-16, seen by the first world model features): Mineflayer
  sets `bot.oxygenLevel` from the air of ANY entity (axolotl: 6000 ticks -> 400) -> `botOxygen` reads the
  bot's own metadata (`bot/src/game/fixes.js`); journal v11, v10 oxygen read as unknown.

- The bot froze against every wall: Mineflayer's physics put it EXACTLY against the face, Paper sent it back
  every tick -> `fixWallContact` (`bot/src/game/fixes.js`).
- `not_collected`: not "the leaves" but a target that MOVES: aim where the item lands (`landingSpot`).
- Several crafts in the 2x2 grid left the inventory view wrong (Mineflayer only resyncs after a table) ->
  `fixCraftSync`; then (2026-11-12) the resync stopped on an OLD answer -> `resyncWindow` waits for quiet.
- `dig` fell off an edge (2026-11-12): stepping checked every 50 ms, physics ticks in bursts -> checked at
  every tick (`stepInto`).
- `mine` said "partial" when an item was picked up later (2026-11-12) -> counts as dug, `not_picked_up`.
- `mine` searched 32 blocks and `find` 64: block_not_found with a log at 42.
- Episode bench: 100 draws over +-5000 blocks (skipping played places left the oceans first); an ocean
  refused by the server fails at once (`setup.js`).
- The bot stops when it loses the server (seen: the Mac asleep, lid closed: run long jobs on power with
  `caffeinate`, lid open). Alerts compare with the PREVIOUS check (regeneration then a hit, a monster coming back).
- Numbers written as text by Llama ("3"); "Digging aborted" -> `dig_failed`; a step's duration counted its
  observations (-> journal v9).

## 5. Ideas beyond step 8 (an OPEN list: the order is decided by measurements)

Overview and order of the stages: `docs/architecture.md`. Common rule: one component at a time, measured with
/ without on the benches; a learned component is ADDED (understand, predict, choose) and does not replace a
reliable deterministic skill. Directions, not commitments: add and remove according to the data.

- Outside data (discussed 2026-11-13, not for v1): VPT / MineRL are pixels + keyboard/mouse of humans
  (older Minecraft versions), not (structured state, skill call) -> result: useful later for the low-level
  controller (`walk`/`look`/`press`, same kind of actions) and the pixel stage, not for the skill world model.
  Human play on our own server, recorded by a server plugin in our format with `source: human`: same state
  format, events close to our primitives, but it describes a human's body, not our skills' costs and failures;
  if tried, as extra data with a source input, measured with / without on unseen places. The volume lever for
  v1 is several bots in parallel and more seeds / biomes.
- Autonomy: triggers (hunger, health, full inventory, monster): a Node reflex interrupts the skill and wakes the
  brain with an alert message; a goal generator with Maslow-style priorities (survive > eat > shelter > tools >
  explore), written as DATA / rules the LLM uses; a long-term goal ("a castle") kept in memory.
- Memory, in stages: history summarized by the code, then the prompt as a constructed view; facts kept by the
  code (places, chests and their content, explored areas), updated from the skill results; later a fact graph
  (GraphRAG), a vector store of memories and lessons, memory managed by the LLM (MemGPT style) with a strong
  enough model, a "nightly compression" (an LLM rereads the day's journal and writes lessons, Reflexion style);
  retrieval of past experiences (successful plans for a close goal), a precursor of macros; game knowledge
  filtered by experience: "unlocked" recipes (seen or crafted) instead of all, measured all / unlocked / none.
- Learning on the journal (COLLECTION data only, never dev): supervised heads (step 7) against trivial
  baselines; hindsight relabeling (cf. STEVE-1); describing changes in sentences (templates, then paraphrases
  by a local LLM; check a sample by hand); contrastive alignment text <-> change (InfoNCE, frozen pretrained
  text encoder + learned state encoder), compared with the symbolic baseline `define_goal`; a shared state
  encoder, then prediction in the latent space (JEPA: slow target encoder, watch for collapse) when the state
  grows; LoRA fine-tuning of the small LLM on successful episodes, distillation from a large model, A/B with
  the world model.
- Data: mix LLM episodes, scripted curricula (benches), random exploration (a purely random bot never reaches
  interesting states); several bots in parallel; count ~300 transitions per hour per bot.
- Planning: macros recorded by the LLM (DATA, a mini-language if needed), a planner on the world model (fewer
  LLM calls), a learned controller for tactics.
- Learned gestures as extra skills next to the written ones (trained on walk / press data), measured with /
  without; the written gesture stays as reference and fallback.
- A body inside the server (plugin / mod, the server simulates the bot: no client copy to keep in sync) if
  Mineflayer keeps costing fixes; the brain, the journal and the API would stay.
- Later still: several bots and roles, voice, pixels (visual JEPA; a STEVE-1 style policy as ONE more skill,
  `act(instruction)`, wrapped like the others), RL on a behavior that plateaus.
