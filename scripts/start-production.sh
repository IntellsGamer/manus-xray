#!/bin/sh
set -eu

socket_path="/tmp/nginx-vless-root-terminal.sock"
rm -f "$socket_path"
node /app/server/rootTerminalDaemon.mjs &
root_broker_pid=$!

cleanup() {
  kill "$root_broker_pid" 2>/dev/null || true
  if [ -n "${app_pid:-}" ]; then kill "$app_pid" 2>/dev/null || true; fi
  wait "$root_broker_pid" 2>/dev/null || true
  if [ -n "${app_pid:-}" ]; then wait "$app_pid" 2>/dev/null || true; fi
}
trap 'cleanup; exit 0' INT TERM

for attempt in $(seq 1 50); do
  if [ -S "$socket_path" ]; then
    chown root:app "$socket_path"
    chmod 0660 "$socket_path"
    break
  fi
  sleep 0.1
done

if [ ! -S "$socket_path" ]; then
  echo "Root terminal broker socket did not start" >&2
  cleanup
  exit 1
fi

HOME=/home/app setpriv --reuid=app --regid=app --init-groups node dist/index.js &
app_pid=$!
wait "$app_pid"
app_status=$?
cleanup
exit "$app_status"
