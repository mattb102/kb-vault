#!/bin/bash
# Evening nudge push — run at the two UTC hours that bracket 8 PM Eastern
# (00:00 UTC in EDT, 01:00 UTC in EST) so the job stays correct across
# daylight-saving changes without touching the crontab.
#
# Install:
#   0 0 * * * bash /path/to/kb-vault/scripts/cron-evening-nudges.sh >> /path/to/kb-vault/logs/evening-nudges.log 2>&1
#   0 1 * * * bash /path/to/kb-vault/scripts/cron-evening-nudges.sh >> /path/to/kb-vault/logs/evening-nudges.log 2>&1
#
# Required env (in .env):
#   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
[ "$(TZ=America/New_York date +%-H)" = "20" ] || exit 0

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
source .env 2>/dev/null || true
mkdir -p logs
echo "===== $(date) =====" >> logs/evening-nudges.log
npx tsx scripts/evening-nudges.ts >> logs/evening-nudges.log 2>&1
