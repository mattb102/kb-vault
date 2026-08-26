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

# Check for updates

A session-start hook (`.claude/hooks/session-start.sh`) checks whether this copy
of the vault software is behind the version it was installed from, and prints
one of two lines into your context:

- `[vault] Software is up to date.` — say nothing about it. Don't mention that
  you checked.
- `[vault] UPDATE AVAILABLE: this copy is N commit(s) behind …` — mention it
  **once**, early, in plain language, and offer to do it. They are not going to
  run `git pull` on their own; nobody has ever told them it exists.

Something like:

> "Quick heads up before we get into it — there's a newer version of the vault
> software available (looks like it adds X). Takes about a minute and I can do
> it now, or we can leave it. Your notes aren't affected either way."

The last sentence matters: **their notes live in a different repo from this
code.** Updating the software cannot touch what they've written, and saying so
removes the only reason they'd hesitate.

If they say yes, `[I'll do this]`:

```
git pull --ff-only
npm install
npm run build
```

Then, **if they have the VPS half set up, the server needs the same treatment**
— it's a separate copy of this repo on a different machine, and updating their
laptop does nothing for their phone. Over SSH: same three commands in
`~/kb-vault`, then `sudo systemctl restart vault`.

**After the pull succeeds, check whether they missed anything.** The setup
chunks grow over time, and their checklist ticks chunks by number — so a step
added to chunk `01` after they finished `01` is invisible to them forever, even
though they just pulled it. If `setup/.progress.md` exists (they have done some
or all of setup), read **`setup/CHANGELOG.md`** and work any entry newer than
the `Installed at commit` recorded in their progress file. The hook flags this
for you when the update touches `setup/`, but do the check whenever you pull —
the flag is a convenience, not the mechanism.

Most catch-up entries are things you just quietly do (a missing cron, a config
default). Only bring a person into it when it needs their decision or their
hands. Update `Installed at commit` when you're done so it doesn't re-run.

Rules:
- **Never pull without asking**, and never over uncommitted changes — if the
  hook reported local changes, show them what's modified and let them decide.
- If `git pull --ff-only` refuses, don't force it. Explain that their copy has
  diverged and offer to look at what's different.
- If they decline, drop it. Don't bring it up again this session.

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
- **Any request to expand what the vault can do** — "can you track X", "I want
  a way to log Y", "can this connect to Z", "I wish you knew about...", "add a
  feature for...", "is it possible to..." → **read `recipes/00-how-to-add-a-feature.md`
  before doing anything else.** The decision tree there tells you whether it's a
  zero-code tracker (just a new note with the right frontmatter), a new note
  type, or a real plugin. Don't hand-roll a solution without reading it first —
  the patterns matter for consistency and for future Claude sessions being able
  to route correctly.
- **Deploying a code change to their VPS** → `recipes/03-deploy-a-change.md`.
- **Anything about their phone** — "log this from my phone", "can it notify
  me", "add a button for X", "notifications aren't working" → the `ios_app`
  plugin. `setup/08c-phone-app.md` has the setup and the troubleshooting. The
  single most common problem is that they never added it to their home screen,
  which on iOS means notifications can never be delivered — check that first.
- **Anything about the daily briefing** — "my morning report", "it didn't run",
  "make it blunter" → the `morning_report` plugin, `setup/08d-morning-report.md`.

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
- **Don't raise `MAX_CHUNK_CHARS` in `src/core/chunker.ts`, and don't remove the
  `flock` in `scripts/cron-reindex.sh`.** Both exist because the local embedder
  will OOM a 4GB box: one giant markdown table chunked whole, or two reindexes
  running at once, will take the whole server down until someone notices.
- The phone app's `APP_TOKEN` is deliberately a **different secret** from
  `API_KEY`. Never "simplify" them into one — the phone holds a token that can
  log trackers and nothing else.
- **`scripts/` is not compiled** — those files run from source under `tsx`, so
  the main `tsconfig.json` excludes them. `npm run typecheck` (and `build`, via
  `prebuild`) uses `tsconfig.scripts.json` to cover `src/` *and* `scripts/`
  together. Keep it that way: without it, a change in `src/` can break a cron
  entry point with nothing failing until that job's next scheduled run, into a
  log file nobody is reading.
- Never echo or commit secrets. `.env` is gitignored; keep it that way.
- Their notes are personal. Treat vault contents as private; don't paste them
  anywhere external.
