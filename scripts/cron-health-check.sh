#!/bin/bash
# Daily vault health check — runs after the morning report (6am) to catch
# problems before they age unnoticed.
#
# Checks: search index alive, reindex cron freshness, morning report present.
# Failures push a notification if the ios_app plugin is configured.
#
# Install (example — runs at 7 AM ET, using two UTC hours to handle DST):
#   0 11 * * * bash /path/to/kb-vault/scripts/cron-health-check.sh >> /path/to/kb-vault/logs/health-check.log 2>&1
#   0 12 * * * bash /path/to/kb-vault/scripts/cron-health-check.sh >> /path/to/kb-vault/logs/health-check.log 2>&1
set -e
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
source .env 2>/dev/null || true
mkdir -p logs
echo "===== $(date) =====" >> logs/health-check.log
npx tsx scripts/health-check.ts >> logs/health-check.log 2>&1
