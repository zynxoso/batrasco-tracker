#!/usr/bin/env bash
# Runs poll-sinotrack-portal.js from the repo root. Uses PATH for node, with common Homebrew paths.
# Configure SINOTRACK_*, INGEST_URL, and (recommended) SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
# in .env.local so dashboard “Save tracker updates” switches are respected each poll.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

NODE_BIN=""
for c in /opt/homebrew/bin/node /usr/local/bin/node; do
  if [[ -x "$c" ]]; then NODE_BIN="$c"; break; fi
done
if [[ -z "$NODE_BIN" ]]; then
  NODE_BIN="$(command -v node || true)"
fi
if [[ -z "$NODE_BIN" ]]; then
  echo "run-sinotrack-poller.sh: node not found. Install Node or set PATH for LaunchAgents." >&2
  exit 1
fi

exec "$NODE_BIN" "$REPO_ROOT/scripts/poll-sinotrack-portal.js"
