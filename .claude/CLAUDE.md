# START OF EVERY SESSION — check if they're set up yet

Before anything else, check whether this vault has been set up: look for
`config/config.yaml` (it does **not** exist on a fresh clone — the installer
creates it). If it's **missing**, the person almost certainly hasn't run setup
yet. Open with a short, friendly greeting and point them at the skill — don't
make them figure it out. Something like:

> 👋 Hey! Looks like this vault isn't set up on this machine yet. The owner left
> you a guided installer — just type **`/setup`** and I'll walk you through it
> step by step (I do the techy parts, you click a few things). Want to start?

Keep it warm and one paragraph. If they say yes, run the `/setup` skill. If
`config/config.yaml` **does** exist, they're already set up — skip the greeting
and just help with whatever they ask.

---

# This repo: a personal vault (MCP server) the owner runs themselves

This is a self-hosted knowledge vault: a folder of markdown notes plus an MCP
server that lets you (Claude) read and write them with semantic search,
write-back, and AI observations. The notes are browsable in **Obsidian** (a
free markdown notebook app — `obsidian.md`). The MCP server runs locally over
stdio for Claude Code, and optionally on a small VPS over HTTP for the claude.ai
phone/web app.

**Assume the person running this is not a programmer.** They use Claude Code, but
terms like SSH, systemd, and reverse proxy mean nothing to them — and that's
fine. Keep explanations plain, do the technical work for them, and only surface
jargon with a one-sentence translation. If they're curious and want to learn how
something works, teach it — but never force it.

## How they drive this

- **Setting up / installing / finishing setup** → run the **`/setup`** skill. It
  walks them through everything from a menu, one verified step at a time. Don't
  improvise the install — `/setup` and the `setup/` chunks have the tested steps.
- **"I want to track / add / build <thing>"** → read `recipes/00-how-to-add-a-feature.md`.
  Most personal features are a new note with the right frontmatter (zero code);
  some are a new self-registering tool module under `src/plugins/`. Follow the
  recipe; don't hand-roll a different pattern.
- **Deploying a code change to their VPS** → `recipes/03-deploy-a-change.md`.

## How the code is laid out

- `src/core/` — the engine (search, write-back, observations, indexer,
  embeddings, sync). Generic; rarely needs editing.
- `src/tools/{read,write,observe}.ts` — the always-on core MCP tools. Each
  exports `register(server)`.
- `src/plugins/<name>/` — opt-in feature plugins, each self-registering. Enabled
  via `enabledPlugins` in `config/config.yaml`. Adding a feature = a new plugin
  here, not an edit to a giant file.
- `config/config.yaml` — their non-secret settings (vault path, name, enabled
  plugins, embedding provider). Secrets live in `.env` (gitignored).
- `setup/` — the guided-install manual (written to you, the AI). `recipes/` — how
  to build features post-install.

## House rules

- Search runs on a **local** embedding model by default — no API key. OpenAI is
  opt-in (`EMBEDDING_PROVIDER=openai`).
- Never echo or commit secrets. `.env` is gitignored; keep it that way.
- Their notes are personal. Treat vault contents as private; don't paste them
  anywhere external.
