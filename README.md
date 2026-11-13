# mc-agent

A Minecraft agent that reasons and talks (an LLM) and predicts the consequences of its actions (a world model),
playing the real game through Mineflayer.

- Project map, one line per file: [`docs/overview.md`](docs/overview.md)
- Target architecture and stages: [`docs/architecture.md`](docs/architecture.md)
- Journal format (the training data): [`docs/journal.md`](docs/journal.md)
- Where the project stands, measurements, decisions: [`docs/status.md`](docs/status.md)
- Rules and principles: [`CLAUDE.md`](CLAUDE.md)

Quick start: `scripts/server_start.sh`, then `scripts/start_bot.sh serve` (the body's API), then
`uv run python -m brain.agent "collect 3 oak logs" --max-turns 10` (the brain).
