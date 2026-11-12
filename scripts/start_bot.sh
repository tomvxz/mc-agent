#!/bin/zsh
# Start the bot from the repo root, wherever this is called from. Usage: scripts/start_bot.sh [mode...]
# (modes of bot/bot.js: serve, suite <skill|all> [N], field [N] [seed] [only])
cd "${0:A:h}/.." || exit 1
node --env-file=./.env ./bot/bot.js "$@"
