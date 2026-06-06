# 08 · Personalize — make it actually theirs

**GOAL:** Turn the empty template into *their* vault — a filled-in identity,
a CLAUDE.md that reflects who they are, a clear sense of what the vault will
pay attention to, and only the plugins they actually want.

**WHO DOES WHAT:** `[I'll do this]` — you ask, they talk, you write. This
chunk is a conversation. Take your time with it.

---

## STEP 1 — The identity interview

Don't fire a form at them. Just talk. Cover these naturally over a few minutes:

- Who are they and what do they do?
- What's going on in this season of their life — what are they working on,
  working through, trying to change?
- What do they care about? What gets them fired up?
- How do they like to be talked to? (Blunt and direct? Warm and patient?
  Should you push back when they're slipping on something?)
- A few interests, hobbies, relationships that matter.

As they talk, `[I'll do this]` fill in the `Core/` notes (`bio.md`,
`values.md`, `goals.md`, `preferences.md`, `relationships.md`, `routines.md`)
using `update_identity_field` or by writing the files directly. Don't push
them to fill every field — capture what's real and leave the rest blank.

---

## STEP 2 — Help them design what the vault pays attention to

This is the most important conversation in setup, and most people skip it
entirely. Don't.

The vault has an observation system: while you talk, you quietly log things
you notice — patterns in behavior, moods, contradictions, progress, slippage.
Those raw observations pile up in a scratchpad. Periodically (automatically, on
a weekly cron) the system synthesizes clusters of related observations into
named long-term **patterns** — one-sentence truths that survive across sessions.

The question is: **what should the vault be paying attention to?**

Walk them through this by asking questions. Not all at once — feel it out.
Some starting points:

**About their life right now:**
- "Is there anything in your life you feel like you can't see clearly because
  you're too close to it? Something you'd want an outside eye on?"
- "What's a habit you've tried to build or break and kept failing at? What
  would it mean to actually have something tracking that honestly?"
- "Is there an area — health, work, relationships, money, creative output —
  where you feel like you're flying blind? No data, no real picture?"

**About what they want tracked vs. noticed:**
- "There's a difference between *logging* (you tell me a number, I write it
  down) and *noticing* (I observe patterns in what you say and surface them
  back). What do you want logged? What do you want me to just watch for?"
- "Are there things you'd want me to call you on — like if you keep saying
  you're going to do something and never do it? Or would you rather I just
  log and not push?"
- "What would a really useful weekly check-in look like for you? What
  questions would you want answered?"

**About their patterns (help them find one live):**
- "Think about a recurring thing in your life — a way you respond to stress,
  a type of situation you always handle the same way, something that comes up
  again and again. Tell me about it."
  - As they describe it, sketch what that pattern looks like as a vault entry.
    Show them: *"So this would look like: I notice you tend to [X] when [Y] —
    first noticed [date], evidence piling up over time. Every few weeks the
    system synthesizes a cluster like this into a single sentence you can read
    back."* Make it concrete.
- "What's something you've changed about yourself in the last year? How would
  you know if you were drifting back?"

**About what they DON'T want:**
- "Are there things that are off-limits — topics you'd rather the vault just
  not touch? I can note that in your CLAUDE.md."
- "How honest do you want me to be when I notice something uncomfortable?
  Some people want brutal, some want diplomatic. There's no wrong answer."

`[I'll do this]` — as this conversation happens, actually log a few
observations in real time. Show them: *"I'm going to log something I just
noticed about you — you said X and Y in the same breath, which is interesting."*
Then read it back. This makes the system tangible instead of abstract.

After this conversation, add a section to their `CLAUDE.md` — **"What to
watch for"** — that captures the specific patterns, topics, and behaviors they
want the vault to track. This is their vault's personality, not just their
own.

Example:
```markdown
## What to watch for
- Calorie restriction / undereating when activity is high
- Avoidance of hard conversations — log when it comes up, surface the pattern
- Work anxiety signals: negative self-talk about performance, avoiding tasks
- Any mention of loneliness or social isolation in Boston
- Sleep quality and what precedes bad nights
- Momentum on the half marathon training (log any slippage)
```

---

## STEP 3 — Write their CLAUDE.md

`[I'll do this]` Fill in `config/CLAUDE.md.template` — `{{owner_name}}`,
`{{owner_blurb}}`, `{{personality}}`, `{{enabled_plugins}}` — using what you
just learned. Add the "What to watch for" section. Put it at the vault root
and the repo root so every future session loads it.

---

## STEP 4 — Rebuild the identity summary

`[I'll do this]`:
```
npm run generate-identity
```
This turns the `Core/` notes into a compact `Core/core-identity.md` that gets
loaded every session — the vault's compressed memory of who they are.

---

## STEP 5 — Generate their claude.ai custom instructions

`[I'll do this]` Fill in `config/claude-ai-instructions.template` with the
same owner info and personality, and show them the result.

`[You'll do this]` Paste it into claude.ai: **Settings → Customize Claude →
"What would you like Claude to know about you?"** This makes every Claude
conversation — not just vault sessions — open knowing who they are. Do it on
desktop and mobile.

---

## STEP 6 — Pick plugins

Show them the list with plain-language descriptions (use `AskUserQuestion`
multi-select):

- **running** — log runs and see stats (distance, pace, weekly mileage)
- **calendar** — connect Google Calendar (needs an extra setup step)
- **mal** — track anime and manga you're watching/reading
- **espn** — fantasy sports

`[I'll do this]` Set `enabledPlugins` in `config/config.yaml` to what they
want. Plugins they don't enable stay on disk but don't run — they can add
them later just by editing the list and restarting.

- If they pick **calendar**: needs Google Cloud OAuth credentials. Walk the
  optional Google steps from chunk 02 now, set the `GOOGLE_*` env vars, and
  have them visit `https://<domain>/calendar/auth` once to link their account.

---

## STEP 7 — Commit and sync

`[I'll do this]`:
```
git add -A && git commit -m "personalize vault" && git push
```
Then restart the local server and the VPS service so the new config takes
effect.

---

## VERIFY

- `get_identity` (locally and from the phone) returns *their* info, not the
  placeholder.
- The plugins they chose show up as tools; the ones they didn't, don't.
- Their CLAUDE.md has a "What to watch for" section with at least a few real
  entries — not just the template.

## TROUBLESHOOTING

- `generate-identity` produces a thin summary: expected if `Core/` notes are
  sparse — it only includes filled-in sections. More conversation = better
  summary over time.
- A newly enabled plugin's tools don't appear: restart the server (and
  re-add the phone connector).

## NEXT

Tick `08`, then read `setup/09-verify-everything.md`.
