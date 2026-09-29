#!/bin/bash
# Monthly read-only vault audit — writes AI-Observations/audits/<date>.md.
# The morning report links it. Applies nothing.
#
# Runs only when audit.enabled: true is set in config/config.yaml.
# Requires the claude CLI on PATH with subscription auth (CLAUDE_CODE_OAUTH_TOKEN
# or stored credentials in ~/.claude). Does NOT use ANTHROPIC_API_KEY.
set -e
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
source .env 2>/dev/null || true
npx tsx scripts/audit-vault.ts

# Commit the audit report if written.
VAULT_PATH_CLEAN="${VAULT_PATH:-}"
if [ -n "$VAULT_PATH_CLEAN" ] && [ -d "$VAULT_PATH_CLEAN/.git" ]; then
  cd "$VAULT_PATH_CLEAN"
  git pull --rebase 2>/dev/null || true
  if [ -n "$(git status --porcelain AI-Observations/audits)" ]; then
    git add AI-Observations/audits
    git commit -m "Vault audit $(date +%Y-%m-%d) (read-only report)"
    git push 2>/dev/null || true
  fi
fi
