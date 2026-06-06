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

## You're done — now comes the fun part

Tell them. Make it feel like a thing, because it is — they just built something
real. Then introduce what comes next: **they can ask you to build new features
for their vault.**

Read `recipes/00-how-to-add-a-feature.md` so you know the house patterns
cold, then invite them to try: *"Want to track your gym workouts? Your reading?
Your mood? Just ask me."* They don't need to touch code. They just have to
know what they want.

That's the system. It's theirs now.
