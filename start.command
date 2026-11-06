#!/bin/zsh
set -e
cd "${0:A:h}"

if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi
.venv/bin/python -m pip install -r requirements.txt

presence_server_pid=""
presence_tunnel_pid=""
cleanup_presence_lab() {
  [[ -n "$presence_tunnel_pid" ]] && kill "$presence_tunnel_pid" 2>/dev/null || true
  [[ -n "$presence_server_pid" ]] && kill "$presence_server_pid" 2>/dev/null || true
}
trap cleanup_presence_lab EXIT INT TERM

if ! curl -fsS http://127.0.0.1:8000/health >/dev/null 2>&1; then
  .venv/bin/python run.py &
  presence_server_pid=$!
  for attempt in {1..50}; do
    curl -fsS http://127.0.0.1:8000/health >/dev/null 2>&1 && break
    sleep 0.1
  done
fi

if ! curl -fsS http://127.0.0.1:8000/health >/dev/null 2>&1; then
  echo "Presence Lab could not start on port 8000."
  exit 1
fi

mkdir -p data
: > data/public_url.txt
: > data/tunnel.log
ssh -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes -R 80:localhost:8000 nokey@localhost.run > data/tunnel.log 2>&1 &
presence_tunnel_pid=$!

presence_public_url=""
for attempt in {1..150}; do
  presence_public_url=$(grep -Eo 'https://[a-z0-9]+\.lhr\.life' data/tunnel.log | head -1 || true)
  [[ -n "$presence_public_url" ]] && break
  kill -0 "$presence_tunnel_pid" 2>/dev/null || break
  sleep 0.2
done

if [[ -n "$presence_public_url" ]]; then
  print -r -- "$presence_public_url" > data/public_url.txt
  echo "Phone upload address: $presence_public_url/upload"
else
  echo "Could not create phone access. See data/tunnel.log for details."
fi

open "http://localhost:8000/?started=$(date +%s)"
echo "Keep this Terminal window open while using Presence Lab."
wait "$presence_tunnel_pid"
