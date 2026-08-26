# 06 · Deploy the server — stand it up on the VPS

**GOAL:** The vault server running on the VPS behind Caddy with HTTPS, so
`https://<domain>/health` returns OK. This is the heavy-lifting chunk and it's
almost entirely automated — you do the work, they watch.

**WHO DOES WHAT:** Almost all `[I'll do this]`, over SSH. The only human
moment is creating a GitHub token if the vault repo is private and the VPS
needs read access.

## STEPS

1. `[I'll do this]` Clone this repo to `~/kb-vault` on the VPS over SSH.

1b. `[You'll do this]` — **this is a real stop, not an aside.** Their notes repo
   is private, so the server needs its own permission to read it. Don't say
   "I need a PAT"; say what it is and why, then give the click-path and wait:

   > "One thing only you can do. Your notes live in a private GitHub repo, and
   > the server needs permission to read it — right now it's locked out, which
   > is what we want by default. GitHub calls that permission a 'token'. It
   > takes about a minute:
   > **github.com → your avatar (top right) → Settings → Developer settings →
   > Personal access tokens → Fine-grained tokens → Generate new token.**
   > Give it any name, under *Repository access* pick **Only select
   > repositories** and choose your vault repo, then under *Permissions →
   > Repository permissions* set **Contents** to **Read and write**. Generate
   > it, then paste me the token — it starts with `github_pat_`."

   **STOP and wait.** Keep the token out of every committed file and out of
   `setup/.progress.md`; use it for the clone URL and nothing else.

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
   in from the claude.ai app. Don't write it into any committed file, and don't
   put it in `setup/.progress.md` either — it's a password.

   That means it lives only in this conversation, so **if the session ends
   between here and chunk 07 it is gone from your context.** That's fine and
   expected: it is always recoverable from the server itself with
   `ssh root@<IP> 'grep AUTH_PASSWORD ~/kb-vault/.env'`. Read it back from
   there rather than asking them for a password they were never given.

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
