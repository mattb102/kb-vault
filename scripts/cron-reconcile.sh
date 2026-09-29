#!/bin/bash
# Nightly vault reconcile — reads yesterday's observations, triages which
# canonical files they affect, applies guarded rewrites, logs diffs to
# AI-Observations/reconcile/<date>.md. The morning report surfaces what changed.
#
# Runs only when reconcile.enabled: true is set in config/config.yaml.
# Requires the claude CLI on PATH with subscription auth (CLAUDE_CODE_OAUTH_TOKEN
# or stored credentials in ~/.claude). Does NOT use ANTHROPIC_API_KEY.
set -e
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
source .env 2>/dev/null || true
npx tsx scripts/reconcile-vault.ts

# Keep 60 days of reconcile logs; they are generated artifacts.
VAULT_PATH_CLEAN="${VAULT_PATH:-}"
if [ -n "$VAULT_PATH_CLEAN" ] && [ -d "$VAULT_PATH_CLEAN/AI-Observations/reconcile" ]; then
  find "$VAULT_PATH_CLEAN/AI-Observations/reconcile" -name '*.md' -mtime +60 -delete 2>/dev/null || true
fi

# Commit any canonical-file changes and the reconcile log together.
if [ -n "$VAULT_PATH_CLEAN" ] && [ -d "$VAULT_PATH_CLEAN/.git" ]; then
  cd "$VAULT_PATH_CLEAN"
  git pull --rebase 2>/dev/null || true
  if ! git diff --quiet || [ -n "$(git status --porcelain)" ]; then
    changed=$(git status --porcelain | grep -v 'AI-Observations/reconcile' | wc -l)
    git add -A
    git commit -m "Vault reconcile $(date +%Y-%m-%d): ${changed} canonical file(s) updated from observations"
    git push 2>/dev/null || true
  fi
fi
