#!/usr/bin/env bash
#
# bootstrap-vps.sh — stand up the vault on a fresh Ubuntu VPS (the
# claude.ai / mobile surface, HTTP transport behind Caddy + OAuth). Idempotent.
#
# Claude runs this over SSH after cloning the repo to ~/kb-vault.
# Required inputs (env vars):
#   DOMAIN          e.g. yourname-vault.duckdns.org   (already pointing at this box)
#   VAULT_REPO      git URL of your PRIVATE vault repo (https with a token, or ssh)
# Optional:
#   EMBEDDING_PROVIDER  "local" (default — no key) or "openai"
#   OPENAI_API_KEY      only needed if EMBEDDING_PROVIDER=openai
#   API_KEY, AUTH_PASSWORD   (generated if absent — AUTH_PASSWORD is what you
#                             type at the claude.ai login gate)
#
# Usage:  DOMAIN=... VAULT_REPO=... bash scripts/bootstrap-vps.sh

set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$(pwd)"
USER_HOME="$HOME"
VAULT_PATH="$USER_HOME/vault"
SERVICE="vault"

: "${DOMAIN:?set DOMAIN}"; : "${VAULT_REPO:?set VAULT_REPO}"
EMBEDDING_PROVIDER="${EMBEDDING_PROVIDER:-local}"
OPENAI_API_KEY="${OPENAI_API_KEY:-}"
if [ "$EMBEDDING_PROVIDER" = "openai" ] && [ -z "$OPENAI_API_KEY" ]; then
  echo "EMBEDDING_PROVIDER=openai requires OPENAI_API_KEY. Set it, or use the default local provider."; exit 1
fi
API_KEY="${API_KEY:-$(openssl rand -hex 24)}"
AUTH_PASSWORD="${AUTH_PASSWORD:-$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-16)}"

say() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()  { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }

# ── 1. system packages ──────────────────────────────────────────────
say "Installing system packages (node, caddy, git)"
sudo apt-get update -y
sudo apt-get install -y git curl ca-certificates
command -v node >/dev/null || { curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -; sudo apt-get install -y nodejs; }
if ! command -v caddy >/dev/null; then
  sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -y && sudo apt-get install -y caddy
fi
ok "Packages ready ($(node -v), caddy $(caddy version | head -1))"

# ── 1b. swap ────────────────────────────────────────────────────────
# The cheapest boxes have 4GB and no swap. The local embedder is the memory
# hog: a full reindex (and `npm run build`'s tsc pass) can spike past what's
# free and get OOM-killed, which looks like a mysterious hang. A 2GB swapfile
# is the margin that makes those survivable. Skipped if swap already exists.
say "Ensuring swap exists (the embedder needs the headroom)"
if [ "$(swapon --show --noheadings | wc -l)" -eq 0 ]; then
  sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  ok "2GB swapfile created and persisted in /etc/fstab"
else
  ok "Swap already present ($(swapon --show=SIZE --noheadings | head -1))"
fi

# ── 2. vault repo ───────────────────────────────────────────────────
say "Cloning your private vault repo"
if [ -d "$VAULT_PATH/.git" ]; then ( cd "$VAULT_PATH" && git pull --ff-only || true ); else git clone "$VAULT_REPO" "$VAULT_PATH"; fi
ok "Vault at $VAULT_PATH"

# ── 3. build ────────────────────────────────────────────────────────
say "Installing + building the server"
npm install --no-audit --no-fund
npm run build
ok "Built"

# ── 4. config + .env ────────────────────────────────────────────────
say "Writing config + secrets"
[ -f config/config.yaml ] || cp config/config.example.yaml config/config.yaml
node - "$VAULT_PATH" "$DOMAIN" <<'NODE'
const fs=require("fs");const p="config/config.yaml";let s=fs.readFileSync(p,"utf8");
s=s.replace(/^vaultPath:.*$/m,`vaultPath: ${process.argv[2]}`).replace(/^transport:.*$/m,"transport: http");
fs.writeFileSync(p,s);
NODE
cat > .env <<EOF
TRANSPORT=http
PORT=3000
BASE_URL=https://$DOMAIN
VAULT_PATH=$VAULT_PATH
EMBEDDING_PROVIDER=$EMBEDDING_PROVIDER
OPENAI_API_KEY=$OPENAI_API_KEY
API_KEY=$API_KEY
AUTH_PASSWORD=$AUTH_PASSWORD
# Optional: enables promote_patterns (auto-synthesizes observations into patterns),
# and is required by the morning_report plugin.
# Get a key at console.anthropic.com → API keys.
# ANTHROPIC_API_KEY=sk-ant-...

# Optional — ios_app plugin (phone home-screen app: tap-to-track + notifications).
# APP_TOKEN scopes the phone app; it is deliberately NOT the API_KEY above, so a
# link you paste onto your phone can never read or write the rest of the vault.
# Generate the VAPID pair once with:  npx web-push generate-vapid-keys
# APP_TOKEN=$(openssl rand -hex 24)
# VAPID_PUBLIC_KEY=
# VAPID_PRIVATE_KEY=
# VAPID_SUBJECT=mailto:you@example.com

# Optional — morning_report plugin delivery. Leave unset to keep the report
# vault-only. Discord takes a webhook URL; push uses the ios_app plugin above.
# REPORT_DELIVERY=vault,push
# DISCORD_WEBHOOK_URL=
EOF
chmod 600 .env
ok ".env written"

# ── 5. index ────────────────────────────────────────────────────────
say "Building the search index"
set -a; source .env; set +a
npm run index-vault
ok "Index built"

# ── 6. systemd unit ─────────────────────────────────────────────────
say "Installing systemd service"
sudo tee /etc/systemd/system/$SERVICE.service >/dev/null <<EOF
[Unit]
Description=Vault MCP server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$REPO
EnvironmentFile=$REPO/.env
ExecStart=$(command -v node) $REPO/build/index.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now $SERVICE
sleep 2
sudo systemctl is-active --quiet $SERVICE && ok "Service running" || { sudo journalctl -u $SERVICE --no-pager | tail -20; exit 1; }

# ── 7. Caddy reverse proxy (auto HTTPS) ─────────────────────────────
say "Configuring Caddy for $DOMAIN"
BLOCK="$DOMAIN {
    reverse_proxy localhost:3000
}"
if ! grep -q "^$DOMAIN {" /etc/caddy/Caddyfile 2>/dev/null; then
  echo "$BLOCK" | sudo tee -a /etc/caddy/Caddyfile >/dev/null
fi
sudo systemctl reload caddy || sudo systemctl restart caddy
ok "Caddy configured (TLS provisions automatically on first request)"

# ── 8. cron ─────────────────────────────────────────────────────────
# The reindex job is unconditional — without it, notes you write from your
# phone never enter semantic search. It is flock-guarded and no-ops unless the
# vault's git HEAD actually moved, so running it often is cheap.
say "Installing the search-index refresh cron"
REINDEX_CRON="*/10 * * * * bash $REPO/scripts/cron-reindex.sh >> $REPO/logs/reindex.log 2>&1"
mkdir -p "$REPO/logs"
(
  crontab -l 2>/dev/null | grep -v "cron-reindex"
  echo "$REINDEX_CRON"
) | crontab -
ok "Reindex cron installed (every 10 minutes, only works when the vault changed)"

# The AI-synthesis crons need an Anthropic API key, so they are conditional.
if grep -q "^ANTHROPIC_API_KEY=sk-" "$REPO/.env" 2>/dev/null; then
  # Weekly patterns synthesis — Sunday 4am
  PROMOTE_CRON="0 4 * * 0 cd $REPO && VAULT_PATH=$VAULT_PATH npm run promote-patterns >> /var/log/vault-cron.log 2>&1"
  # Nightly identity rebuild — every night 4:05am (after promote on Sunday)
  IDENTITY_CRON="5 4 * * * bash $REPO/scripts/cron-rebuild-identity.sh >> /var/log/vault-cron.log 2>&1"
  # Morning report. Scheduled at two adjacent UTC hours; the script itself
  # exits unless the local hour matches REPORT_HOUR, which keeps it correct
  # across daylight saving without anyone touching the crontab.
  REPORT_CRON_A="0 10 * * * bash $REPO/scripts/cron-morning-report.sh >> $REPO/logs/morning-report.log 2>&1"
  REPORT_CRON_B="0 11 * * * bash $REPO/scripts/cron-morning-report.sh >> $REPO/logs/morning-report.log 2>&1"
  (
    crontab -l 2>/dev/null | grep -v "promote-patterns" | grep -v "cron-rebuild-identity" | grep -v "cron-morning-report"
    echo "$PROMOTE_CRON"
    echo "$IDENTITY_CRON"
    echo "$REPORT_CRON_A"
    echo "$REPORT_CRON_B"
  ) | crontab -
  ok "Crons installed: promote_patterns (Sun 4am), identity rebuild (nightly 4:05am), morning report (6am local)"
else
  echo "  (Skipping crons — ANTHROPIC_API_KEY not set in .env."
  echo "   Add the key and re-run to enable. See comments in .env.)"
fi

# ── 9. verify ───────────────────────────────────────────────────────
say "Verifying"
sleep 3
if curl -fsS "https://$DOMAIN/health" >/dev/null; then ok "https://$DOMAIN/health → 200"; else
  echo "Health check not green yet — Caddy may still be getting a certificate. Retry in a minute:"
  echo "  curl https://$DOMAIN/health"
fi

cat <<EOF

$(ok "VPS bootstrap done.")
Connector URL for claude.ai:  https://$DOMAIN/mcp
Login passphrase (you'll type this once in the app):  $AUTH_PASSWORD

(The passphrase is also in $REPO/.env as AUTH_PASSWORD. Keep it private.)
EOF
