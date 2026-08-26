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

6. **Reindexing is scheduled** — `crontab -l` on the VPS shows a
   `cron-reindex` line. Without it their search index quietly goes stale and
   notes written from the phone become unfindable. This one has no symptom
   until it matters, so check it rather than assume it.

7. **Swap exists** — `swapon --show` on the VPS returns a row. On a 4GB box the
   embedder can spike past free memory during a reindex; swap is the difference
   between "slow for a minute" and "the box killed the process". Also a silent
   failure, also worth actually looking at.

**Only if they set up the phone app (08c):**

8. **The app is installed and subscribed** — `ios_app_info` reports at least
   1 device, and `send_phone_notification` visibly buzzes their phone while
   they're holding it.

**Only if they set up the morning report (08d):**

9. **The report runs** — `morning_report_status` shows no MISSING keys, and
   `crontab -l` shows the two `cron-morning-report` lines.

Tick each in `setup/.progress.md` as it passes. When they're all green, mark
the whole setup **complete**.

## VERIFY

Every check that applies to them is green. If the sync check lags a bit, give
it a moment or trigger a read (which pulls first). Both surfaces should
converge fast.

## TROUBLESHOOTING

- Write shows locally but not on the phone (or vice-versa): one side didn't
  push/pull. Check that the vault on both sides has the GitHub remote set and
  that pushes are succeeding (`git log --oneline -5` in the vault dir).
- Anything red: walk it back to the chunk that owns that piece (search → 03/06,
  sync → GitHub remote, phone → 07, app → 08c, report → 08d).
- No reindex cron: re-run `bash scripts/bootstrap-vps.sh` (it's idempotent), or
  add the line by hand — `*/10 * * * * bash ~/kb-vault/scripts/cron-reindex.sh`.
- No swap: `sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile &&
  sudo mkswap /swapfile && sudo swapon /swapfile`, then add
  `/swapfile none swap sw 0 0` to `/etc/fstab` so it survives a reboot.

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

**Your phone** (if they set up `ios_app` in 08c)
- The icon on your home screen logs straight into the vault — one tap, no
  typing, no opening an app and finding the right screen. That's the whole
  point: the tracking you'll actually keep doing is the tracking that takes
  one second.
- I can also send you notifications. Nudges, reminders, your morning report.

**Morning report** (if they set up `morning_report` in 08d)
- Every morning I read your vault and write you a briefing — what matters
  today, what's slipping, one thing worth your attention. It's saved to
  `Reports/` so you can look back at what I was telling you a month ago, which
  turns out to be the interesting part.
- Ask me for one any time with `morning_report`, not just at 6am.

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

---

### Last thing, and don't skip it — set their expectations honestly

**This is the single highest-value thing you'll say all session.** Everything
above works right now. What they just installed does *not* — not really, not
yet — because it has almost nothing to go on. An empty vault is a stranger with
a notepad. If they walk away expecting the version they've been imagining for
the last hour, week one will feel like a letdown and they'll quietly stop
opening it. Tell them the truth up front and week one becomes exactly what they
were told to expect instead.

Say it plainly, in your own words, roughly this shape:

> "Real talk before you go. Right now this thing barely knows you — everything
> it's got is what we typed in today. So for the first week or two it's going to
> feel thinner than you want. It'll say generic stuff. It'll get things about
> you flat-out wrong. That's not it being broken, that's it having no data. It
> genuinely does get better the more you use it, and the curve is steeper than
> you'd think."

Then give them the honest arc — concrete, not hype:

- **Week one:** it's a notebook with good search. Fine, not magic.
- **A few weeks in:** enough observations accumulate that pattern synthesis has
  something to chew on, and it starts telling you things about yourself you
  didn't say out loud.
- **A couple of months in:** it references stuff from months back, notices when
  you're circling the same problem again, and knows the difference between a
  bad week and a real trend. This is the part people describe as uncanny. It is
  entirely built out of the boring logging you did in weeks one through four.

**Then teach them the one habit that actually matters: correcting it.**

They will assume a wrong answer means the system is broken. It doesn't — it
means the system has bad or missing data, and they are the only one who can
fix that. Make it concrete:

> "When I get something wrong about you — and I will — don't just let it slide.
> Tell me. Literally just 'that's not right, I stopped doing that in March' or
> 'you're reading that backwards, it's a work thing not a family thing.' I'll
> fix the note. And the fix sticks — it's not just this conversation, it's in
> your vault, so next month's version of me knows it too. Every correction makes
> the next answer better. Letting a wrong thing sit there is the only way this
> actually degrades."

`[I'll do this]` — **don't just describe it, do one.** Ask them for one thing
in `Core/` you got slightly wrong or too generic during personalization, and
fix it live in front of them. Then show them the updated note. People need to
see a correction land once before they'll bother doing it on their own.

Close on what "sticking with it" actually costs them, so it doesn't sound like
a chore:

> "You don't need a routine for this. No daily journaling homework. Just talk to
> me like you would anyway, tap your trackers when you think of it, and correct
> me when I'm wrong. That's it. The system does the rest in the background while
> you sleep."

If they seem like the type who'll bounce off it, one more honest line lands
well: **the only real failure mode is not using it for a month and expecting it
to know you.** It's not a subscription that improves on its own — it compounds
on what they put in, and nothing else.

That's the system. It's theirs.
