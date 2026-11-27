# mc-agent

A Minecraft agent that reasons and talks (an LLM) and predicts the consequences of its actions (a world model),
playing the real game through Mineflayer. A learning project.

```
brain/ (Python): LLM + world model, decides  ──HTTP, local──▶  bot/ (Node.js): Mineflayer, acts in Minecraft
```

The brain chooses the plan; the body executes skills (`mine`, `move_to`, `craft`...) and logs every one of them
as data for the world model.

## Requirements
- Java 21 and a Paper 1.21.11 server in `server/` (not in git; `online-mode=false`)
- Node.js with `--env-file` support (20.6+), then `cd bot && npm install`
- [uv](https://docs.astral.sh/uv/) (Python 3.13), then `uv sync`
- A local LLM server with an OpenAI-compatible API, Ollama by default (`LLM_*` variables: see `brain/llm.py`)
- A `.env` at the root: `MC_HOST`, `MC_PORT`, `MC_VERSION`, `MC_USERNAME`

## Quick start
```
scripts/server_start.sh                                                    # the Minecraft server
scripts/start_bot.sh serve                                                 # the body (API on port 3000)
uv run python -m brain.agent "collect 3 oak logs" --max-turns 10           # the brain
```

## Tests
```
cd bot && npm test      # JavaScript unit tests, without Minecraft
uv run pytest           # Python tests, without the body
```
In-game tests (arena, field bench) and the episode bench: see [`docs/overview.md`](docs/overview.md).

## Documentation
- [`docs/overview.md`](docs/overview.md): where things are (one line per folder), tests
- [`docs/architecture.md`](docs/architecture.md): the target architecture
- [`docs/journal.md`](docs/journal.md): the journal format (the training data)
- [`docs/status.md`](docs/status.md): where the project stands, measurements, decisions
- [`docs/references.md`](docs/references.md): related research
- [`CLAUDE.md`](CLAUDE.md): rules and principles
