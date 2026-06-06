# Vault

A personal knowledge base you talk to through Claude — on your computer and on
your phone. It remembers who you are, lets you log and recall the threads of
your life, quietly notices patterns, and can grow new features on request.

It's an [MCP](https://modelcontextprotocol.io) server over a folder of markdown
notes (your "vault"): semantic search, structured write-back, an AI-observation
system, and opt-in plugins.

## Setting it up

**You don't follow a manual — Claude does.** Open this folder in Claude Code and
type:

> **`/setup`**

Claude becomes a patient instructor: it does the technical steps itself, walks
you through the few that need you (signing up for a cheap server, clicking an
"authorize" button), checks each step worked, and remembers where you are if you
stop and come back. Plan for about an hour. You need no programming knowledge —
Windows, Mac, and Linux are all fine.

When you're done you'll have:
- the vault in **Claude Code** on your computer, and
- the same vault on **claude.ai / your phone**, served from a ~€4/month box,
- your notes synced privately through a **private GitHub repo**.

## What's in here

| Path | What it is |
|------|------------|
| `setup/` | The guided install — written for Claude to run, step by step. |
| `recipes/` | How to ask Claude to build you new features after setup. |
| `src/core/` | The engine: indexing, search, write-back, observations, git sync. |
| `src/tools/` | The always-on core tools (read / write / observe). |
| `src/plugins/` | Opt-in features (running, calendar, and reference examples). Off by default. |
| `config/` | `config.example.yaml`, the starter `vault-template/`, and `CLAUDE.md.template`. |
| `scripts/` | `bootstrap-local.sh` and `bootstrap-vps.sh` — the install does the heavy lifting. |

## Adding features later

Once it's running, just ask — *"track my gym workouts", "remember my book
notes", "connect my calendar"*. Claude follows the house patterns in `recipes/`;
most trackers need no code at all.

## Configuration at a glance

- **Vault** location, owner name, transport, and enabled plugins live in
  `config/config.yaml` (copied from the example during setup).
- **Secrets** (on the server, `API_KEY` / `AUTH_PASSWORD`; `OPENAI_API_KEY` only
  if you opt into hosted embeddings) live in `.env`, written by the bootstrap
  scripts — never committed.
- **Embeddings** default to a **local** ONNX model (`nomic-embed-text-v1.5`) — no
  API key, no account, no cost; wants a 4 GB x86 box (the cheapest Hetzner CX22
  is fine). Prefer a hosted API? Set `embeddingProvider: openai` + an
  `OPENAI_API_KEY` (runs on a tinier box, indexes faster, a few pennies/month).

## Running it directly (for tinkerers)

```bash
npm install && npm run build
VAULT_PATH=/path/to/vault npm run index-vault    # local embeddings, no key needed
VAULT_PATH=/path/to/vault npm start              # stdio by default
```
