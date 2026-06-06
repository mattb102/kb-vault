# 00 · How to add a feature — read this first, Claude

The human just finished setup (or they already have a running vault) and they
want to add something. Maybe they said "track my gym workouts" or "remember my
book notes" or "pull my Spotify history." Before you touch any code, walk this
tree.

**Most requests are data, not software.** The wrong instinct is to start coding.
Start here.

```
What are they asking for?
│
├─ "Log or track something over time"
│     weight, workouts, books read, mood, water, runs, mood, money…
│        → IT'S A TRACKER. Almost always ZERO code.
│        → recipes/01-add-a-tracker.md
│
├─ "Remember a new kind of note"
│     recipes, trip plans, people, movies I want to watch, ideas…
│        → NEW NOTE TYPE. No code — just frontmatter + one routing line.
│        → see "New note type" below
│
└─ "Connect to an outside service or do something with logic"
      GitHub, Spotify, a webhook, compute a stat from multiple sources…
         → REAL INTEGRATION. A new plugin module.
         → recipes/02-add-an-mcp-tool.md
```

## New note type (the middle branch — no code)

1. Pick a `type:` value (e.g. `recipe`, `trip`, `book`, `idea`) and a folder.
2. Create notes with that frontmatter via `create_note`. The existing
   `find_notes` and `search_vault` tools already work on them immediately —
   no restart, no code change.
3. Add one line to their `CLAUDE.md` routing table so you always know where the
   new type lives and when to use it. That's the whole thing.

## The rules

- **Prefer no code.** A tracker is a markdown file with the right frontmatter;
  `log_metric` and `find_notes` already handle it. Don't write a tool when a
  file will do.
- **The frontmatter `type:` is the API.** Tools route by it. Nail the type and
  everything else is free.
- **One feature = one self-contained thing.** A tracker = one file. A real
  integration = one new folder in `src/plugins/` that exports `register()`.
  Never edit the core engine for a personal feature.
- **Always update `CLAUDE.md`** when you add a type or a tool. The routing table
  is how you remember what exists.
- **After any code change**, deploy carefully → `recipes/03-deploy-a-change.md`.

---

## What kinds of things can they build? (starting ideas)

If they're not sure what to ask for, here are things that work well with this
system. None of these require code unless noted.

**No-code trackers** — all just `log_metric` + a file:
- Workouts / gym sessions (sets, reps, or just "went")
- Daily mood (1–10 + a note)
- Water intake, sleep hours, weight
- Books finished (or reading list with a status)
- What they ate / how they felt
- Money spent per category
- Migraine / headache log
- Runs (distance, time, route)
- Days clean / streak tracking

**New note types** — just frontmatter + a folder:
- People they want to remember facts about (friends, coworkers, contacts)
- Trip logs / travel notes
- Recipe collection
- Movie or show watchlist
- Ideas and project notes
- Meeting notes with tags

**Real integrations** — need a plugin (code), but the patterns are already in
`src/plugins/`:
- Pull recent GitHub activity
- Fetch Spotify listening history
- Sync a Google Calendar
- Morning summary from multiple sources
- Connect a habit-tracking app via API

---

**Works just as well for work stuff.** No-code trackers:
- Daily wins / things accomplished (great for end-of-week reviews)
- Projects and their status / blockers
- 1:1 meeting notes (tagged by person)
- Job applications and where they are in the process
- Things to follow up on
- Hours logged per client or project
- Ideas and decisions (with "why we did this" context)

New note types for work:
- Meeting notes with `type: meeting`, tagged by attendees
- Decisions with `type: decision` and a `rationale:` field — like a decision
  log you can actually search later
- Client or project reference pages

Integrations for work:
- Summarize a GitHub PR list or recent commits
- Pull Jira/Linear ticket status
- Morning standup builder from multiple sources
- Weekly summary of what actually got done

If they want something new, ask them to describe what they want in plain terms.
Then route it. Most requests land in the tracker bucket.
