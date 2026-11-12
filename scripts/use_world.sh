#!/bin/zsh
# Choose, list and remove the worlds of the server. Each world lives in worlds/<seed> (Paper puts the
# nether and the end next to it: worlds/<seed>_nether, worlds/<seed>_the_end). The server must be
# stopped to switch or remove.
# Usage:
#   scripts/use_world.sh                   the current world
#   scripts/use_world.sh <seed>            next start on worlds/<seed>: reused if it exists, generated if not
#   scripts/use_world.sh <seed> --fresh    the same, but an existing worlds/<seed> is deleted first (a new copy)
#   scripts/use_world.sh --remove <seed>   delete worlds/<seed> (never the current world, never a kept one)
#   scripts/use_world.sh --list            every world, its size, the current and kept ones
# A world with a file named "keep" in its folder is never deleted (e.g. the evaluation world:
# touch server/worlds/<seed>/keep). The world seed is recorded in every run (data/*/runs.jsonl).
source "${0:A:h}/server_lib.sh"
cd "$SERVER_DIR" || exit 1  # the worlds/ paths below are relative to the server folder, like level-name

current=$(grep '^level-name=' "$PROPERTIES" | cut -d= -f2)
running() { server_pid >/dev/null; }
is_seed() { [[ "$1" =~ '^-?[0-9]+$' ]]; }

# Delete the folders of one world (the seed is checked first: no other path can be deleted)
remove_world() {
  local seed=$1
  if [[ "worlds/$seed" == "$current" ]]; then
    echo "worlds/$seed is the current world: not deleted" >&2
    return 1
  fi
  if [[ -e "worlds/$seed/keep" ]]; then
    echo "worlds/$seed is kept (worlds/$seed/keep): not deleted" >&2
    return 1
  fi
  if [[ ! -d "worlds/$seed" ]]; then
    echo "worlds/$seed does not exist"
    return 0
  fi
  rm -rf "worlds/$seed" "worlds/${seed}_nether" "worlds/${seed}_the_end"
  echo "$SERVER_DIR/worlds/$seed deleted"
}

case "$1" in
  "")
    echo "$PROPERTIES:"
    grep -E '^level-(name|seed)=' "$PROPERTIES"
    exit 0
    ;;
  --list)
    for dir in worlds/*(N/); do
      [[ "$dir" == *_nether || "$dir" == *_the_end ]] && continue
      size=$(du -sh "$dir" "${dir}_nether" "${dir}_the_end" 2>/dev/null | awk '{print $1}' | head -1)
      echo "$dir  $size$([[ "$dir" == "$current" ]] && echo '  (current)')$([[ -e "$dir/keep" ]] && echo '  (kept)')"
    done
    exit 0
    ;;
  --remove)
    is_seed "$2" || { echo "usage: use_world.sh --remove <seed>" >&2; exit 1; }
    running && { echo "the server is running: stop it first (scripts/server_stop.sh)" >&2; exit 1; }
    remove_world "$2"
    exit $?
    ;;
esac

seed=$1
is_seed "$seed" || { echo "the seed must be a whole number: $seed" >&2; exit 1; }
running && { echo "the server is running: stop it first (scripts/server_stop.sh)" >&2; exit 1; }
mkdir -p worlds
if [[ "$2" == "--fresh" && -d "worlds/$seed" ]]; then
  [[ -e "worlds/$seed/keep" ]] && { echo "worlds/$seed is kept: not regenerated" >&2; exit 1; }
  rm -rf "worlds/$seed" "worlds/${seed}_nether" "worlds/${seed}_the_end"
  echo "worlds/$seed deleted, it will be generated again"
fi
if [[ -d "worlds/$seed" ]]; then state="existing world, reused"; else state="new world, generated at start"; fi
sed -i '' -e "s|^level-name=.*|level-name=worlds/$seed|" -e "s|^level-seed=.*|level-seed=$seed|" "$PROPERTIES"
echo "next start: $SERVER_DIR/worlds/$seed ($state)"
