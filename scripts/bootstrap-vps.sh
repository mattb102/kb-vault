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

# ── 8. verify ───────────────────────────────────────────────────────
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
