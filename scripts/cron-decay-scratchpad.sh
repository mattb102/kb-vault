#!/bin/bash
# Nightly scratchpad decay — archives every entry older than the configured
# window (default 120 days) to monthly archive files.
set -e
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
source .env 2>/dev/null || true
npx tsx scripts/decay-scratchpad.ts
