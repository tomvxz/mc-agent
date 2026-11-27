# Project map

One page to find your way. Details: `CLAUDE.md` (rules and principles for CLAUDE), `docs/status.md` (where we are, measurements,
decisions), `docs/journal.md` (data format), `docs/api_contract.json` (fields exchanged by the body and the brain),
`docs/architecture.md` (the target architecture and the stages to get there, can evolve).

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

The brain (Python part) never talks directly to Minecraft. The body runs the skill and handles automatically low-level actions ; the brain chooses the plan and sends the instruction.

## Follow one call (read these first)

When the brain asks `mine(oak_log, 3)`:

1. `bot/src/api/api.js`: receives `POST /execute`, checks the request, one skill at a time.
2. `bot/src/execution/execute.js`: state before (`observe`), runs the skill while recording a trace, state after, writes one line.
3. `bot/src/execution/runSkill.js`: when a skill should be stopped (its own time budget, no progress for 15 s, an alert: hurt or a
   new monster close, a 300 s hard cap), catches errors, then stops the skill properly (`cancel.js`).
4. `bot/src/skills/shortcuts/mine.js`: repeats `find` + `collect_block` until 3 logs are collected.
5. `bot/src/skills/shortcuts/collect_block.js`: `break_block` (gets a viewpoint, digs) then `pick_up` (walks onto the items).

On the Python side, `brain/agent.py` is the loop: state -> prompt -> LLM -> plan -> execute -> results -> again.

## Folders in one line

For the detail of a file, refer to its header; for a skill, its entry in `bot/src/skills/catalogue.js` (`GET /skills?all=1`) can be used instead.

**bot/** (the body, Node.js). `bot.js` creates the bot once; modes `serve` (API), `suite` (arena tests),
`field` (field bench).

| Folder                  | Role                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| `src/api/`              | the HTTP API used by the brain (`/state`, `/skills`, `/run`, `/execute`, `/setup`)            |
| `src/execution/`        | running a skill: journal line (`execute`), stop rules (`runSkill`), cancellation, steps       |
| `src/journal/`          | what is written: the journal lines, the trace of a skill, the run (id, versions)              |
| `src/observation/`      | `observe(bot)`, the one definition of the state, and what the bot perceives                   |
| `src/game/`             | game facts and settings: tags, pathfinder movements, Mineflayer fixes, server commands        |
| `src/skills/`           | the skills (each returns `{ success, reason, details }`), their catalogue and shared helpers  |
| `src/skills/actions/`   | primitives that act on the world (`move_to`, `break_block`, `place_block`, `craft`, `dig`...) |
| `src/skills/questions/` | skills without effect on the world (`find`, `scan`, `recipe`, `craftable`)                    |
| `src/skills/shortcuts/` | assemblies of primitives (`collect_block`, `mine`, `strip_mine`)                              |
| `src/skills/low_level/` | without the pathfinder, hidden from the LLM (`walk`, `look`, `press`)                         |

**brain/** (the mind, Python): the agent loop and its parts (`agent.py`, `llm.py`, `render.py`, `body.py`,
`goal.py`, `journal.py`), tools (`show.py`: `uv run python -m brain.show [id] [--full]`; `bench.py`:
`uv run python -m brain.bench [--places N] [--seed S]`), and `world_model/` (`inputs/`: the variables and
data processing for the world model).

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
