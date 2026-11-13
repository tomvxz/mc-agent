# Project map

One page to find your way. Details: `CLAUDE.md` (rules and principles), `docs/status.md` (where we are, measurements,
decisions), `docs/journal.md` (data format), `docs/api_contract.json` (fields exchanged by the body and the brain),
`docs/architecture.md` (the target architecture and the stages to get there).

## The idea in one picture
```
 brain/ (Python, decides)                    bot/ (Node.js, acts in Minecraft)
 ┌──────────────────────┐   HTTP (local)   ┌──────────────────────────────────┐
 │ agent.py  the loop   │ ── GET /state ──▶│ api.js                           │
 │ llm.py    asks LLM   │ ── GET /skills ─▶│   └▶ execute.js  (1 journal line) │
 │ render.py texts      │ ── POST /execute▶│        └▶ runSkill.js (time limit)│
 │ body.py   HTTP calls │ ◀── result ───── │             └▶ skills/<name>.js   │──▶ Minecraft server
 │ journal.py episodes  │                  │                                  │    (Paper, server/)
 └──────────────────────┘                  └──────────────────────────────────┘
        │ data/dev/episodes.jsonl                  │ data/dev/transitions.jsonl
```
The brain never talks to Minecraft. The body handles reflexes and the details inside a skill; the brain chooses the plan.

## Follow one call (read these first)
When the brain asks `mine(oak_log, 3)`:
1. `bot/src/api/api.js`: receives `POST /execute`, checks the request, one skill at a time.
2. `bot/src/execution/execute.js`: state before (`observe`), runs the skill while recording a trace, state after, writes one line.
3. `bot/src/execution/runSkill.js`: when a skill is stopped (its own time budget, no progress for 15 s, an alert: hurt or a
   new monster close, a 300 s hard cap), catches errors, really stops a stopped skill (`cancel.js`).
4. `bot/src/skills/shortcuts/mine.js`: repeats `find` + `collect_block` until 3 logs are collected.
5. `bot/src/skills/shortcuts/collect_block.js`: `break_block` (gets a viewpoint, digs) then `pick_up` (walks onto the items).

On the Python side, `brain/agent.py` is the loop: state -> prompt -> LLM -> plan -> execute -> results -> again.

## Every file in one line
**bot/** (the body). `bot.js` creates the bot once; modes `serve` (API), `suite` (arena tests), `field`
(field bench). Under `src/`, one folder per job:

| Folder | Files | Role |
|---|---|---|
| `api/` | `api.js` | the small HTTP API used by the brain (`/state`, `/skills`, `/run`, `/execute`, `/setup`) |
| | `setup.js` | starting situation for the benches (place, inventory, day): `POST /setup`, field bench |
| `execution/` | `execute.js` | runs a skill and writes its journal line (always call this, never `runSkill` alone) |
| | `runSkill.js` | when a skill is stopped (budget, no progress, alert, hard cap), error capture |
| | `cancel.js` | makes a stopped skill unable to act (no "ghost" skill in the background) |
| | `steps.js` | the journal lines of the skills called inside a shortcut (`parent_seq`) |
| `journal/` | `trace.js` | what happens during a skill: positions and keys every tick, events, blocks, actions |
| | `run.js`, `version.js`, `logger.js` | run id, versions (git commit), where the journal is written |
| `observation/` | `state.js` | `observe(bot)`: THE definition of the state |
| | `perception.js` | what the bot perceives: line of sight (default) or everything the client knows (x-ray) |
| `game/` | `tags.js` | the game's tags sent by the server (replaceable, leaves, fluids...): game facts, not our lists |
| | `movements.js` | pathfinder settings: jumps, digs a passage, pillars up, avoids lava and monsters |
| | `fixes.js` | fixes for Mineflayer bugs (window clicks, inventory resync, difficulty, walls) |
| | `commands.js` | `runCommand`: send a server command (/tp, /give...) |
| `skills/` | `index.js` | the list of every skill (inputs of the world model: a rename is a versioned format change) |
| | `catalogue.js` | what the LLM reads about each skill: description, parameters, failure reasons |
| | `utils.js` | shared helpers (`gotoWatched` = walking with a stuck detector, pickup...) |
| | `actions/`, `questions/`, `shortcuts/`, `low_level/` | one skill per file (see below) |

**Skills** (each returns `{ success, reason, details }`; "LLM" = shown to the LLM, `SHOWN_TO_LLM`)
| Folder | Skill | LLM | What it does |
|---|---|---|---|
| `actions/` | `move_to(x, y, z, range)` | yes | walk somewhere (the bot handles obstacles itself) |
| | `explore(direction, distance)` | yes | go somewhere new when nothing is found |
| | `place_block(item, x, y, z)` | yes | place a block from the inventory |
| | `craft(item, count)` | yes | craft an item (walks to a crafting table when the recipe needs one) |
| | `break_block(x, y, z)` | no | break one block, only that (reports what fell) |
| | `pick_up(item?, max_distance)` | no | pick up items lying on the ground nearby |
| | `eat(food?)` | no | eat from the inventory |
| | `dig(direction, distance, slope, stop_at)` | no | dig a 1x2 tunnel or a staircase, stop when a block of interest comes into sight |
| `questions/` | `find(target)` | yes | where are the nearest blocks or entities of a type (what the bot perceives) |
| | `recipe(item \| uses)` | yes | one page of the recipe book, one level only, both ways |
| | `craftable()` | yes | what the inventory allows to craft now |
| | `scan(radius)` | no | summary of what is perceived around |
| `shortcuts/` | `collect_block(x, y, z)` | yes | break one block AND pick up what drops (break_block + pick_up) |
| | `mine(block, count)` | yes | gather blocks of a type: find + collect_block, repeated |
| | `strip_mine(direction, blocks, ...)` | no | dig + collect_block: a tunnel that collects what it uncovers |
| `low_level/` | `walk(yaw, distance)`, `look(yaw, pitch)`, `press(keys, ticks)` | no | without the pathfinder: a way out, varied data, a future learned controller |

**brain/** (the mind, Python): `agent.py` loop, `llm.py` the single LLM call (replaceable provider),
`render.py` every text the LLM reads, `body.py` HTTP client of the body, `journal.py` episode log,
`goal.py` the goal condition (the LLM turns the goal into data once, the code checks it),
`show.py` an episode in a readable way (`uv run python -m brain.show [id] [--full]`),
`bench.py` the episode bench (`uv run python -m brain.bench [--places N] [--seed S]`).

**Tests**
| Where | What | Command (from `bot/`) |
|---|---|---|
| `bot/tests/unit/` | without Minecraft (fake bot), seconds | `npm test` |
| `bot/tests/game/` | in a reproducible arena, one skill at a time | `node --env-file=../.env bot.js suite <skill> [N]` |
| `bot/tests/field/` | random natural places, success rate and failure reasons | `node --env-file=../.env bot.js field [N] [seed] [only]` |
| `brain/tests/` | Python, without the body | `uv run pytest` (from the repo root) |
| `brain/bench.py` | the LLM agent on a task in random places: success checked on the state | `uv run python -m brain.bench` (bot in `serve` mode) |

## Data
`data/dev/` (development, disposable, never for training): `runs.jsonl` (one line per launch),
`transitions.jsonl` (one line per skill), `episodes.jsonl` (one LLM episode = several lines).
The notebook `notebooks/explore_body.ipynb` shows how to read them.
