#!/usr/bin/env bash
#
# bootstrap-local.sh — set up the vault on THIS machine (the local
# Claude Code surface, stdio transport). Idempotent: safe to re-run.
#
# Run from the repo root:  bash scripts/bootstrap-local.sh [VAULT_PATH]
#
# What it does:
#   1. Makes sure node + git are installed (apt/dnf/pacman aware).
#   2. npm install && npm run build.
#   3. Creates config/config.yaml and .env from the examples if missing.
#   4. Creates your vault from the template if it doesn't exist yet.
#   5. Builds the search index (local embeddings — no API key needed).
#
# Search runs on a local model by default: no account, no key, no cost. (To use
# hosted OpenAI embeddings instead, set EMBEDDING_PROVIDER=openai + OPENAI_API_KEY
# in .env and re-run — optional.)

set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$(pwd)"
VAULT_PATH="${1:-$HOME/vault}"

say() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()  { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }

# ── 1. package manager + deps ───────────────────────────────────────
say "Checking system dependencies"
if   command -v apt-get >/dev/null; then PM="sudo apt-get install -y"; UPD="sudo apt-get update";
elif command -v dnf     >/dev/null; then PM="sudo dnf install -y";     UPD="true";
elif command -v pacman  >/dev/null; then PM="sudo pacman -S --noconfirm"; UPD="sudo pacman -Sy";
else echo "No supported package manager (apt/dnf/pacman) found. Install node>=18 and git manually."; PM=""; fi

need_pkg() {
  command -v "$1" >/dev/null && { ok "$1 present"; return; }
  [ -z "$PM" ] && { echo "Please install $1 and re-run."; exit 1; }
  say "Installing $2"; eval "$UPD" || true; eval "$PM $2"
}
need_pkg git git
need_pkg node nodejs
need_pkg npm npm || true

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
[ "$NODE_MAJOR" -ge 18 ] || { echo "Node 18+ required (found $(node -v 2>/dev/null)). Upgrade node and re-run."; exit 1; }

# ── 2. build ────────────────────────────────────────────────────────
say "Installing npm packages (this can take a minute)"
npm install --no-audit --no-fund
say "Building"
npm run build
ok "Built to build/"

# ── 3. config + .env ────────────────────────────────────────────────
say "Configuring"
[ -f config/config.yaml ] || cp config/config.example.yaml config/config.yaml
# point config at the vault, stdio transport, local embeddings
node - "$VAULT_PATH" <<'NODE'
const fs=require("fs");const p="config/config.yaml";let s=fs.readFileSync(p,"utf8");
const vp=process.argv[2];
s=s.replace(/^vaultPath:.*$/m,`vaultPath: ${vp}`).replace(/^transport:.*$/m,"transport: stdio");
fs.writeFileSync(p,s);
NODE

if [ ! -f .env ]; then
  cat > .env <<EOF
# Local stdio surface. Search uses a local embedding model — no key needed.
# (Optional: to use hosted OpenAI embeddings, set EMBEDDING_PROVIDER=openai and
#  OPENAI_API_KEY=sk-... here, then re-run this script.)
EMBEDDING_PROVIDER=local
VAULT_PATH=$VAULT_PATH
EOF
  ok "Wrote .env (local embeddings — no API key required)"
fi

# ── 4. vault from template ──────────────────────────────────────────
if [ ! -d "$VAULT_PATH" ]; then
  say "Creating your vault at $VAULT_PATH from the template"
  cp -r config/vault-template "$VAULT_PATH"
  ( cd "$VAULT_PATH" && git init -q && git add -A && git commit -qm "Seed vault from template" || true )
  ok "Vault created"
else
  ok "Vault already exists at $VAULT_PATH (left as-is)"
fi

# ── 5. index ────────────────────────────────────────────────────────
set +u; source .env 2>/dev/null; set -u
PROVIDER="${EMBEDDING_PROVIDER:-local}"
if [ "$PROVIDER" = "openai" ] && [ -z "${OPENAI_API_KEY:-}" ]; then
  echo "⚠  EMBEDDING_PROVIDER=openai but OPENAI_API_KEY is blank — skipping index."
  echo "   Add the key to .env and re-run, or switch to EMBEDDING_PROVIDER=local."
else
  say "Building the search index ($PROVIDER embeddings)"
  VAULT_PATH="$VAULT_PATH" npm run index-vault && ok "Index built"
fi

# ── 6. tell Claude how to wire .mcp.json ────────────────────────────
cat <<EOF

$(ok "Local bootstrap done.")
Add this MCP server to Claude Code by writing .mcp.json in the directory you
open Claude Code from:

{
  "mcpServers": {
    "vault": {
      "command": "node",
      "args": ["$REPO/build/index.js"],
      "env": { "VAULT_PATH": "$VAULT_PATH", "EMBEDDING_PROVIDER": "local" }
    }
  }
}
EOF
