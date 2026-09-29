#!/bin/bash
# Weekly nudge decay — expires stale open P2/P3 nudges to the archive and
# logs each as a behavior/abandoned-intentions observation for pattern synthesis.
set -e
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
source .env 2>/dev/null || true
npx tsx scripts/nudge-decay.ts
