#!/bin/bash
# Keep the search index fresh.
#
# Pulls the vault repo, and reindexes only when the vault's git HEAD actually
# moved since the last successful index. Without this, notes you write on your
# phone (or from Claude Code on another machine) stay invisible to semantic
# search until something else happens to rebuild the index.
#
# The flock is load-bearing: two full reindexes running at once will OOM a 4GB
# box. If this job is still running when the next tick fires, the new one exits
# immediately rather than piling on.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

cd "$REPO_DIR"
set -a
[ -f .env ] && source .env
set +a

if [ -z "${VAULT_PATH:-}" ]; then
  echo "$(date): VAULT_PATH not set — skipping reindex"
  exit 1
fi

exec 9>/tmp/vault-reindex.lock
flock -n 9 || exit 0

cd "$VAULT_PATH"
git pull --rebase --quiet 2>/dev/null || true
HEAD_REV="$(git rev-parse HEAD 2>/dev/null || echo none)"

cd "$REPO_DIR"
mkdir -p data
STAMP_FILE="data/last-indexed-rev"
LAST_REV="$(cat "$STAMP_FILE" 2>/dev/null || echo none)"

if [ "$HEAD_REV" = "$LAST_REV" ]; then
  exit 0
fi

echo "$(date): vault moved ($LAST_REV -> $HEAD_REV), reindexing"
npx tsx scripts/index-vault.ts
echo "$HEAD_REV" > "$STAMP_FILE"
echo "$(date): reindex complete"
