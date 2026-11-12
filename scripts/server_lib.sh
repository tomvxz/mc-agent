# Shared by the server scripts (sourced, not run). Absolute paths, so that a script works from any
# folder and its messages say exactly which server and which files.
# SERVER_DIR: the server folder (default: server/ in this repo), made absolute.
REPO_DIR=${0:A:h:h}  # the repo: the folder above scripts/ (zsh: A = absolute path, h = parent)
SERVER_DIR=${SERVER_DIR:-$REPO_DIR/server}
SERVER_DIR=${SERVER_DIR:A}
PROPERTIES=$SERVER_DIR/server.properties

# The pid of THIS server's java process, or nothing: a Paper jar whose working folder is SERVER_DIR
# (not any Minecraft server running on the machine)
server_pid() {
  local pid
  for pid in $(pgrep -f "paper-.*\.jar"); do
    if [[ "$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')" == "$SERVER_DIR" ]]; then
      echo "$pid"
      return 0
    fi
  done
  return 1
}
