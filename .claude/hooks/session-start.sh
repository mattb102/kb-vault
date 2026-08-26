#!/bin/bash
#
# Session-start update check.
#
# The people running this are not going to think to `git pull` — most of them
# have never pulled anything. So every time they open a Claude Code session in
# this repo, we quietly check whether their copy of the vault software is behind
# the version it was installed from, and hand Claude a one-line summary to act
# on (see "Check for updates" in .claude/CLAUDE.md).
#
# Rules for this script: never block the session, never prompt, never modify the
# repo. It only ever looks. Any failure — offline, no remote, no git — exits 0
# quietly, because a failed update check must never stop someone from using
# their own notes.
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}" 2>/dev/null || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
[ -n "$BRANCH" ] && [ "$BRANCH" != "HEAD" ] || exit 0
git remote get-url origin >/dev/null 2>&1 || exit 0

# Bound the network call. `timeout` is missing on stock macOS, so only use it
# when it exists rather than failing the whole check.
if command -v timeout >/dev/null 2>&1; then
  timeout 15s git fetch --quiet origin "$BRANCH" >/dev/null 2>&1
else
  git fetch --quiet origin "$BRANCH" >/dev/null 2>&1
fi

if ! git rev-parse --verify --quiet "origin/$BRANCH" >/dev/null 2>&1; then
  exit 0
fi

BEHIND="$(git rev-list --count "HEAD..origin/$BRANCH" 2>/dev/null || echo 0)"
if [ "${BEHIND:-0}" -eq 0 ]; then
  echo "[vault] Software is up to date."
  exit 0
fi

DIRTY=""
[ -n "$(git status --porcelain 2>/dev/null)" ] && DIRTY=" Local uncommitted changes are present, so a pull may conflict."

echo "[vault] UPDATE AVAILABLE: this copy is ${BEHIND} commit(s) behind origin/${BRANCH}.${DIRTY}"
echo "[vault] Recent upstream changes:"
git log --no-merges --format='  - %s' "HEAD..origin/$BRANCH" 2>/dev/null | head -8

# Did the incoming commits touch the install instructions? If so, and this
# person has already been through setup, they may have ticked off a chunk that
# has since grown a step they will never otherwise see. setup/CHANGELOG.md is
# what tells you which of those need retro-active action.
SETUP_TOUCHED="$(git diff --name-only "HEAD..origin/$BRANCH" -- setup/ .claude/skills/setup/ 2>/dev/null | head -20)"
if [ -n "$SETUP_TOUCHED" ]; then
  if [ -f setup/.progress.md ]; then
    echo "[vault] ⚠ The setup instructions changed in this update, and this person has already done setup."
    echo "[vault] After updating, read setup/CHANGELOG.md and run the catch-up for entries newer than"
    echo "[vault] the 'Installed at commit' recorded in setup/.progress.md. Steps added to chunks they"
    echo "[vault] already ticked off are invisible to them otherwise."
  else
    echo "[vault] (Setup instructions changed upstream; no setup/.progress.md here, so nothing to catch up.)"
  fi
fi

echo "[vault] Offer the update to the user before doing other work (see 'Check for updates' in .claude/CLAUDE.md). Do not pull without asking."
