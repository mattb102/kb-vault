# 06 · Deploy the server — stand it up on the VPS

**GOAL:** The vault server running on the VPS behind Caddy with HTTPS, so
`https://<domain>/health` returns OK. This is the heavy-lifting chunk and it's
almost entirely automated — you do the work, they watch.

**WHO DOES WHAT:** Almost all `[I'll do this]`, over SSH. The only human
moment is creating a GitHub token if the vault repo is private and the VPS
needs read access.

## STEPS

1. `[I'll do this]` Get the code and their private vault onto the VPS. Over SSH:
   - Clone this repo to `~/kb-vault` on the VPS.
   - The vault repo is **private**, so the VPS needs read access. Easiest path:
     clone using an HTTPS URL with a GitHub token — either a fine-grained PAT
     scoped to just the vault repo, or a deploy key. If they need a token:
     `[You'll do this]` — walk them through GitHub → Settings → Developer
     settings → Personal access tokens → fine-grained → select only the vault
     repo → read/write contents. Keep the token out of any committed file.

2. `[I'll do this]` Run the VPS bootstrap over SSH. Search runs on a local
   model, so no key needed:
   ```
   DOMAIN=<domain> VAULT_REPO=<private-vault-git-url> \
     bash ~/kb-vault/scripts/bootstrap-vps.sh
   ```
   (Only if they opted into hosted embeddings in chunk 02, prepend
   `EMBEDDING_PROVIDER=openai OPENAI_API_KEY=<key>`.)

   While it runs, narrate what's happening in plain language: "Installing the
   server, setting up automatic HTTPS, starting it so it stays running even
   if the machine reboots." The script handles: node + Caddy install, vault
   clone + build, `.env` with a fresh `API_KEY` and login **passphrase**,
   search index, systemd service (keeps it running), Caddy config
   (auto-TLS), and a final health check.

3. `[I'll do this]` **Grab the passphrase** the script prints at the end
   (`AUTH_PASSWORD`). You'll hand it to them in the next chunk so they can log
   in from the claude.ai app. Don't write it into any committed file.

## VERIFY

`[I'll do this]`:
```
curl -fsS https://<domain>/health
```
Returns `{"status":"ok","files":N}` with N > 0 → server is live, HTTPS works,
vault loaded. That's the whole thing.

## TROUBLESHOOTING

- Health check not green right away: Caddy provisions the TLS cert on the
  first request, which can take up to a minute. Give it a moment and retry.
- `git clone` of the vault fails on the VPS: the token/deploy key isn't right.
  Re-check the PAT scope (must cover the vault repo, contents read access).
- Service not running: `ssh root@<IP> 'journalctl -u vault --no-pager | tail -30'`
  — most common cause is a missing env var in `.env` (usually `VAULT_PATH`,
  or `OPENAI_API_KEY` if they went that route).

## NEXT

Tick `06`, then read `setup/07-connect-claude-ai.md`.
