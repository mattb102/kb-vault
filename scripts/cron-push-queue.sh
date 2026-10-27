#!/bin/bash
# Every-minute push queue poller. Sources .env, then runs the TypeScript poller
# under flock so concurrent cron instances can't double-send.
#
# VAULT_REPO_DIR defaults to the directory containing this script's parent.
# Set it explicitly in the cron environment if you use a non-standard layout.
set -a
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${VAULT_REPO_DIR:-$(dirname "$SCRIPT_DIR")}"
[ -f "$REPO_DIR/.env" ] && . "$REPO_DIR/.env"
set +a
cd "$REPO_DIR"
mkdir -p logs
echo "===== $(date) =====" >> logs/push-queue-poller.log
flock -n /tmp/push-queue-poller.lock npx tsx scripts/push-queue-poller.ts >> logs/push-queue-poller.log 2>&1
