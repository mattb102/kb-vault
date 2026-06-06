# 09 · Verify everything — the full round-trip

**GOAL:** Prove the whole system works end to end, then hand them off to the
feature recipes. After this chunk they have a real, personal, two-surface vault.

**WHO DOES WHAT:** `[I'll do this]` runs the checks; the human does the one
phone-side test.

## STEPS — the smoke test

Run these as a checklist, narrating results plainly to them:

1. **Search works** — `search_vault` for something in their notes returns a
   sensible hit. (Confirms embeddings + index are alive.)

2. **Write-back works** — `log_metric` something (e.g. their mood today), then
   `find_notes` to show the new row actually landed. This is the write side of
   the loop.

3. **Sync works** — confirm that write made it to GitHub (committed + pushed),
   and that the *other* surface picks it up. Cleanest demo: you logged it
   locally → on the phone, ask "what's my latest mood entry?" and it comes
   back. (Or the reverse.) This proves the whole GitHub sync loop closes.

4. **Observation works** — `log_observation` something small, then
   `get_observations` (scratchpad) shows it. Confirms the observation system is
   running.

5. **Phone read works** — `[You'll do this]` in the claude.ai app, ask it
   something about themselves; it answers from the vault.

Tick each in `setup/.progress.md` as it passes. When all five are green, mark
the whole setup **complete**.

## VERIFY

All five checks green. If the sync check lags a bit, give it a moment or
trigger a read (which pulls first). Both surfaces should converge fast.

## TROUBLESHOOTING

- Write shows locally but not on the phone (or vice-versa): one side didn't
  push/pull. Check that the vault on both sides has the GitHub remote set and
  that pushes are succeeding (`git log --oneline -5` in the vault dir).
- Anything red: walk it back to the chunk that owns that piece (search → 03/06,
  sync → GitHub remote, phone → 07).

## You're done — give them the tour

Tell them, and make it feel like a thing. Then before you hand off to features,
walk them through what the system already does — because there's a lot in the
box they don't know about yet. Keep it conversational, not a doc dump. One
capability at a time, maybe show it live.

### The toolbox (walk through these)

**Logging things**
- `log_metric` — log any number over time: mood, weight, sleep hours, runs,
  whatever. You just tell me "log my mood as a 7" and I write it. It shows up
  in Obsidian as a table you can browse.
- `log_stream` — a thought, a ramble, a brain-dump. Just talk and I capture it
  dated and searchable forever.
- `create_note` / `update_note` — for things that aren't logs: a page about a
  person, a project, a trip.

**Remembering you**
- `get_identity` — every session I load who you are: your goals, values,
  relationships, routines. This is why I can pick up where we left off.
- `update_identity_field` — when something about you changes, I update it. You
  don't have to re-explain yourself every conversation.

**The observation system** — this is the part that makes it feel alive:
- While we talk, I quietly log observations about patterns I notice — things
  you say, moods, contradictions, what you're working through. You never see
  me doing it, it just happens.
- `get_observations` — you can ask me "what have you noticed about me lately?"
  and I'll pull from the scratchpad.
- `promote_patterns` — periodically, clusters of observations get synthesized
  into long-term patterns. Runs automatically every Sunday on your server if you
  added an Anthropic API key, or trigger it manually anytime. It's what makes
  the system get smarter about you over time instead of just piling up raw notes.
- `rebuild_identity` — re-synthesizes your identity summary from scratch: pulls
  your Core notes (hard facts), your distilled patterns, and the last 30 days of
  observations, and rewrites `Core/core-identity.md` as a single coherent
  portrait of who you are *right now*. This runs nightly on your VPS (4:05am,
  after Sunday's pattern synthesis). You can also call it manually — useful after
  a big life change or after your first month of observations have accumulated.
  Requires `ANTHROPIC_API_KEY`.

**Weekly summary**
- Ask me "write my weekly summary" any time (Sunday evenings work well). I'll
  pull your recent journals, stream entries, metrics, and observations and write
  a summary + insights to your vault. Worth doing once a week if you want the
  long-term picture to build up.

**Search**
- `search_vault` — semantic search across everything. Not keyword matching —
  actual meaning. "times I felt anxious about work" will find relevant entries
  even if those exact words aren't there.
- `find_notes` / `recent_journals` / `search_by_date` — more targeted lookups
  when you know roughly what you're looking for.

**Nudges**
- If you tell me you want to do something — "I should start meditating", "I
  need to call my dad" — I log it as a nudge. I'll bring it up in future
  sessions if you haven't followed through. It's not nagging, it's a light
  "hey, remember you wanted to do this."

### Now — build new things

Read `recipes/00-how-to-add-a-feature.md` so you know the house patterns,
then invite them to try. Most trackers are zero code. *"Want to track your gym
workouts? Your reading? Your mood swings? Just ask."*

That's the system. It's theirs.
