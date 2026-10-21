# Project map

One page to find your way. Details: `CLAUDE.md` (rules and roadmap), `docs/journal.md` (data format).

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
1. `bot/src/api.js`: receives `POST /execute`, checks the request, one skill at a time.
2. `bot/src/execute.js`: state before (`observe`), runs the skill while recording a trace, state after, writes one line.
3. `bot/src/runSkill.js`: 60 s time limit, catches errors, really stops a timed-out skill (`cancel.js`).
4. `bot/src/skills/mine.js`: repeats `find` + `collect_block` until 3 logs are collected.
5. `bot/src/skills/collect_block.js`: `break_block` (gets a viewpoint, digs) then `pick_up` (walks onto the items).

On the Python side, `brain/agent.py` is the loop: state -> prompt -> LLM -> plan -> execute -> results -> again.

## Every file in one line
**bot/** (the body)
| File | Role |
|---|---|
| `bot.js` | creates the bot once; modes `serve` (API), `suite` (arena tests), `field` (field bench) |
| `src/api.js` | the small HTTP API used by the brain |
| `src/execute.js` | runs a skill and writes its journal line (always call this, never `runSkill` alone) |
| `src/runSkill.js` | time limit and error capture around a skill |
| `src/cancel.js` | makes a stopped skill unable to act (no "ghost" skill in the background) |
| `src/state.js` | `observe(bot)`: THE definition of the state |
| `src/trace.js` | what happens during a skill: positions and keys every tick, events, blocks, digs |
| `src/movements.js` | pathfinder settings: jumps, digs a passage, pillars up, avoids lava and monsters |
| `src/fixes.js` | fixes for Mineflayer bugs (window clicks, difficulty, freezing against walls) |
| `src/commands.js` | `runCommand`: send a server command (/tp, /give...) |
| `src/setup.js` | starting situation for the benches (place, inventory, day): `POST /setup`, field bench |
| `src/run.js`, `version.js`, `logger.js` | run id, versions, where the journal is written |
| `src/skills/catalogue.js` | what the LLM reads about each skill: description, parameters, failure reasons |
| `src/skills/utils.js` | shared helpers (`gotoWatched` = walking with a stuck detector, pickup...) |
| `src/skills/*.js` | one skill per file (see below) |

**Skills** (each returns `{ success, reason, details }`)
| Skill | Shown to the LLM | What it does |
|---|---|---|
| `move_to(x, y, z, range)` | yes | walk somewhere (the bot handles obstacles itself) |
| `find(target)` | yes | where are the nearest blocks or entities of a type |
| `collect_block(x, y, z)` | yes | break one block AND pick up what drops (break_block + pick_up) |
| `mine(block, count)` | yes | gather blocks of a type: find + collect_block, repeated |
| `craft(item, count)` | yes | craft an item (needs a crafting table nearby for most recipes) |
| `recipe(item)` | yes | question: how an item is crafted, one level (ingredients, how to get each) |
| `place_block(item, x, y, z)` | yes | place a block from the inventory |
| `explore(direction, distance)` | yes | go somewhere new when nothing is found |
| `break_block(x, y, z)` | no (for now) | break one block, only that (reports what fell) |
| `pick_up(item?, max_distance)` | no (for now) | pick up items lying on the ground nearby |
| `scan`, `eat` | no (for now) | summary of the surroundings, eat |

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
