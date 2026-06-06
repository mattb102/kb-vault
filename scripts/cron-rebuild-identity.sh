#!/bin/bash
# Nightly identity rebuild — re-synthesizes Core/core-identity.md as a rolling
# aggregate from Core notes + patterns + recent observations. Runs AFTER the
# promote-patterns cron so it picks up freshly synthesized patterns.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

cd "$REPO_DIR"
set -a
source .env
set +a

if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "$(date): ANTHROPIC_API_KEY not set — skipping identity rebuild"
  exit 0
fi

if [ -z "$VAULT_PATH" ]; then
  echo "$(date): VAULT_PATH not set — skipping identity rebuild"
  exit 1
fi

cd "$VAULT_PATH"
git pull --rebase 2>/dev/null || true

cd "$REPO_DIR"
npx tsx scripts/rebuild-identity.ts

cd "$VAULT_PATH"
if ! git diff --quiet || [ -n "$(git status --porcelain)" ]; then
  git add Core/core-identity.md
  git commit -m "Identity rebuild: re-synthesize from notes, patterns, recent observations"
  git push 2>/dev/null || true

  cd "$REPO_DIR"
  npx tsx scripts/index-vault.ts
fi

echo "$(date): identity rebuild complete"
