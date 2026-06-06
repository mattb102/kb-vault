# 03 · Local install — the vault on their machine

**GOAL:** A working vault on their computer: server built, notes created from
the starter template, pushed to a private GitHub repo, and wired into Claude
Code so `search_vault` and `find_notes` actually work.

**WHO DOES WHAT:** Almost entirely `[I'll do this]` — search runs on a local
model, so there's no key to paste. The one human moment is approving the GitHub
repo creation if `gh` asks them to confirm.

## STEPS

1. `[I'll do this]` From the repo root, run the bootstrap:
   ```
   bash scripts/bootstrap-local.sh ~/vault
   ```
   Tell them what's happening in plain words: "I'm installing the pieces,
   creating your starter vault, and setting up search — no account or key
   needed." It detects their package manager, installs node/git if needed,
   builds the server, creates the config, copies the template into `~/vault`,
   and builds the search index. The first run downloads a small local model
   (about 130 MB) so it might take a minute — totally normal.

2. `[I'll do this]` Create the private vault repo on GitHub and push:
   ```
   gh repo create vault --private --source ~/vault --push
   ```
   Tell them: "This is your private notebook in the cloud — only you can see
   it. It's also what keeps your phone and computer in sync." Save the repo
   URL; the VPS chunk needs it.

3. `[I'll do this]` Wire Claude Code: write `.mcp.json` (the bootstrap printed
   the exact contents) in the folder they open Claude Code from, pointing at
   the vault. Then tell them to restart Claude Code so it picks up the new
   tools.

4. `[You'll do this]` Install **Obsidian** if they haven't — it's the app
   they'll use to actually browse and read their notes visually. Free, no
   account needed. "Go to obsidian.md and download it. Once it's open, click
   **Open folder as vault** and pick the `~/vault` folder we just created."
   Their notes are now browsable as a real notebook. They don't *need* Obsidian
   for Claude to work, but without it the vault is just a folder of files they
   can't look at.

   > **Optional but recommended — obsidian-git.** This plugin shows their
   > vault's git history and lets them manually sync from inside Obsidian (pull
   > on mobile, see what changed, etc.). To install: in Obsidian, go to
   > **Settings → Community plugins → turn off Safe mode → Browse**, search
   > **obsidian-git**, install and enable it. No config needed — it picks up
   > the existing git repo automatically. `[You'll do this]` if they want it;
   > skip if they don't care.

> **Optional — hosted embeddings.** Only if they explicitly chose OpenAI search
> in chunk 02: add `EMBEDDING_PROVIDER=openai` and `OPENAI_API_KEY=sk-...` to
> `.env` and the `.mcp.json` `env` block, then re-run the bootstrap to re-index.
> Never echo the key back; `.env` is gitignored. Skip this for everyone else.

## VERIFY

In a fresh Claude Code session with the server connected, call:
- `find_notes` with `type: metric-log` → returns the starter weight/mood/sleep
  logs from the template.
- `get_identity` → returns the placeholder identity doc.
- `search_vault` with any query → returns results. (This proves the index +
  local embeddings are running end-to-end.)

All three working = local install is done. Tell them to open Obsidian and poke
around — they should see their starter notes already there. Hype them up a
little, this is the biggest step.

## TROUBLESHOOTING

- `search_vault` returns nothing or index errors: re-run
  `bash scripts/bootstrap-local.sh` — the first run downloads the local model
  and a flaky download can leave the index unbuilt. (If they went the OpenAI
  route, check `EMBEDDING_PROVIDER`/`OPENAI_API_KEY` in `.mcp.json`'s `env`.)
- No tools show up in Claude Code: `.mcp.json` is in the wrong folder, or
  Claude Code wasn't restarted. Confirm the path and bounce it.
- `gh repo create` fails: `gh auth status` — they may have skipped the login
  in chunk 02.

## NEXT

Tick `03`. If their Hetzner account is ready, read `setup/04-provision-vps.md`.
If not, no rush — the local vault already works on its own. They can stop here
and resume the VPS/phone half whenever.
