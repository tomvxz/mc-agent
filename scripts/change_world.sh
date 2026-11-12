#!/bin/zsh
# Stop the server, switch to the world of another seed, start it again: for a collection that changes
# world from time to time (at night, between two runs). The bot must be stopped first (it would lose
# the server).
# Usage: scripts/change_world.sh <seed> [--remove-previous]
#   --remove-previous: delete the world we leave (unless it is kept: worlds/<seed>/keep), so that the
#   worlds do not pile up
here=${0:A:h}
source "$here/server_lib.sh"
export SERVER_DIR  # the same server for the scripts called below
previous=$(grep '^level-name=' "$PROPERTIES" | cut -d= -f2)

"$here/server_stop.sh" || exit 1
"$here/use_world.sh" "$1" || exit 1
if [[ "$2" == "--remove-previous" && "$previous" == worlds/* ]]; then
  "$here/use_world.sh" --remove "${previous#worlds/}"
fi
"$here/server_start.sh"
