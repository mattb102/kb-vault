#!/bin/bash
# Daily morning report.
#
# TIMEZONE, and why this looks strange: a rented VPS runs on UTC and cron
# ignores CRON_TZ, so a job scheduled at one UTC hour drifts by an hour twice a
# year. Instead this is scheduled at TWO adjacent UTC hours and exits unless the
# local hour is the one you actually want. That stays correct across daylight
# saving with no maintenance. REPORT_HOUR and REPORT_TZ come from .env.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

cd "$REPO_DIR"
set -a
[ -f .env ] && source .env
set +a

REPORT_HOUR="${REPORT_HOUR:-6}"
REPORT_TZ="${REPORT_TZ:-America/New_York}"
[ "$(TZ="$REPORT_TZ" date +%-H)" = "$REPORT_HOUR" ] || exit 0

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "$(date): ANTHROPIC_API_KEY not set — skipping morning report"
  exit 0
fi

mkdir -p logs
echo "===== $(date) =====" >> logs/morning-report.log
npx tsx scripts/morning-report.ts >> logs/morning-report.log 2>&1

# Reports are generated artifacts. Left alone they pile up in the vault and
# pollute semantic search — old briefings start outranking real notes. Keep two
# weeks; the interesting content is in the notes they were written from.
if [ -n "${VAULT_PATH:-}" ]; then
  find "$VAULT_PATH/Reports" -name "*-morning.md" -mtime +14 -delete 2>/dev/null || true
  cd "$VAULT_PATH"
  git add -A
  git commit -m "Morning report $(date +%Y-%m-%d)" 2>/dev/null || true
  git push 2>/dev/null || true
fi
