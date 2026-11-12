#!/bin/zsh
# Stop the Minecraft server cleanly and wait until it is gone. Paper saves the worlds and stops on
# SIGTERM, like the "stop" command typed in its console. Usage: scripts/server_stop.sh
# (SERVER_DIR: the server folder, server/ next to this repo by default)
source "${0:A:h}/server_lib.sh"

pid=$(server_pid)
if [[ -z "$pid" ]]; then
  echo "server ($SERVER_DIR): not running"
  exit 0
fi

echo "server ($SERVER_DIR): stopping (pid $pid), saving the worlds..."
kill -TERM "$pid"
for i in {1..120}; do
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "server: stopped"
    exit 0
  fi
  sleep 1
done
echo "server: still running after 120 s, NOT stopped" >&2
exit 1
