#!/bin/bash
# Hourly nudge push evaluator. All policy (window, cap, gap, no-repeat) lives
# in nudge-push.ts and the ios_app push config. This wrapper only loads env
# and runs it.
#
# Install: add to crontab (one line per hour, or use */60 if your cron supports it)
#   0 * * * * bash /path/to/kb-vault/scripts/cron-nudge-push.sh >> /path/to/kb-vault/logs/nudge-push.log 2>&1
#
# Required env (in .env):
#   NUDGE_PUSH_ENABLED=1
#   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
# Optional env:
#   PUSH_DAILY_CAP, PUSH_MIN_GAP_MIN, PUSH_NO_REPEAT_DAYS, PUSH_START_HOUR, PUSH_END_HOUR
set -e
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
source .env 2>/dev/null || true
mkdir -p logs
npx tsx scripts/nudge-push.ts
