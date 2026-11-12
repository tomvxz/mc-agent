#!/bin/zsh
# Start the Minecraft server in the background (server/run.sh) and wait until it is ready.
# Its console output goes to server/logs/console.out. Usage: scripts/server_start.sh
# (to use the console, start server/run.sh in a terminal instead)
source "${0:A:h}/server_lib.sh"
cd "$SERVER_DIR" || exit 1

if server_pid >/dev/null; then
  echo "server ($SERVER_DIR): already running"
  exit 0
fi

mkdir -p logs
: > logs/console.out
nohup ./run.sh > logs/console.out 2>&1 &
echo "server ($SERVER_DIR): starting $(grep '^level-name=' "$PROPERTIES")..."
# Ready = Paper prints "Done (12.3s)! For help, type help"; a new world takes longer (generation)
for i in {1..300}; do
  if grep -q "Done (" logs/console.out; then
    echo "server: ready"
    exit 0
  fi
  if ! server_pid >/dev/null && (( i > 5 )); then
    echo "server: stopped while starting, see $SERVER_DIR/logs/console.out" >&2
    exit 1
  fi
  sleep 1
done
echo "server: not ready after 300 s, see $SERVER_DIR/logs/console.out" >&2
exit 1
