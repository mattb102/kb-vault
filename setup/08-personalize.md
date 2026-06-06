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

As they talk, `[I'll do this]` fill in the `Core/` notes using
`update_identity_field` or by writing the files directly. Don't push them to
fill every field — capture what's real and leave the rest blank.

---

## STEP 1B — Trim the vault to what they'll actually use

The template ships with a bunch of folders and files. Some are genuinely useful.
Some look useful and never get touched. Walk them through it honestly and help
them delete or add anything that doesn't fit.

**Tell them this:**
> "The template has a bunch of files in it. Let's go through them quickly —
> some you'll use, some you probably won't, and there might be things you want
> that aren't here yet. We can delete stuff."

**Honest field notes — use these to guide the conversation:**

**`AI-Observations/` (scratchpad, patterns, nudges)** — don't touch. These
are managed automatically. Deleting them breaks things. `[I'll do this]`
make sure they know not to manually edit these.

**`Core/bio.md`** — fill this out, it's the foundation everything else builds
on. You need it.

**`Core/goals.md`** — actually useful. Claude will reference this to check in
on progress and notice when something isn't moving. Worth filling in even briefly.

**`Core/preferences.md`** — good for telling Claude your quirks: what you like,
what you hate, how you want to be talked to. Feeds directly into the identity
summary. Worth a few lines.

**`Core/values.md`** — looks philosophical and easy to skip. In practice it
shapes how Claude gives advice and what it notices. Worth 5 minutes if they
have any strong opinions about how they want to live. Skip if they don't.

**`Core/relationships.md`** — this one exists in the template, but honestly
it doesn't get much use in practice. The idea is Claude knows who the important
people in your life are so it can give better advice. Useful *if* they want
that — e.g. "remind me about my sister's situation when I bring her up." If
they don't care, just delete it.

**`Core/routines.md`** — similar deal. Useful if their schedule/rhythm matters
for context (night owl, morning routine, workout days). Otherwise it just sits
empty. Delete it if they shrug.

**`Health/health-overview.md`** — fill in the basics (any conditions, meds,
general fitness situation). Gets pulled into the identity summary.

**`Health/metrics/` (weight, mood, sleep)** — starter set. `[I'll do this]`
ask them: which of these do you actually want to track? Delete the ones they
won't use. If they want to track something else (workouts, food, drinks,
whatever), that's easy to add — just a new file with the right frontmatter.

**`Work/work-overview.md`** — useful if work is any part of their life. Even
a few sentences gives Claude context when work stuff comes up.

**`Interests/reading.md`** — this is just an example. `[I'll do this]`
rename/replace it with their actual interests. If they're into gaming, fishing,
music, cooking — whatever — make a file for it. If they don't care about
tracking interests at all, delete the whole folder.

**`Journal/` and `Stream/`** — both optional but worth knowing about. Journal
is for intentional dated entries. Stream is freeform brain-dump with timestamps.
You can use one, both, or neither. They don't need to decide now.

After this conversation:
- `[I'll do this]` delete whatever they don't want
- `[I'll do this]` create any new files/folders they asked for (use the right
  frontmatter `type:` so the routing works — see `CLAUDE.md` for the table)
- `[I'll do this]` add any new folders to the routing table in `CLAUDE.md`

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

Example (the exact topics will come from the conversation you just had with them):
```markdown
## What to watch for
- [Whatever habit they said they keep failing at]
- [The thing they said they're too close to see clearly]
- [Work/relationship/health area where they feel like they're flying blind]
- [Something they want called out if they start slipping]
- [Any patterns you notice while they talk that they didn't name but should]
```

---

## STEP 3 — Write their CLAUDE.md

`[I'll do this]` Fill in `config/CLAUDE.md.template` — `{{owner_name}}`,
`{{owner_blurb}}`, `{{personality}}`, `{{enabled_plugins}}` — using what you
just learned. Add the "What to watch for" section. Put it at the vault root
and the repo root so every future session loads it.

---

## STEP 4 — Build the identity summary

**Tell them this before running anything:**

> "There are two versions of this. The basic one just flattens your notes into
> a single file — it's fine, but it's dumb. The good one uses Claude to actually
> *synthesize* your notes, your patterns, and your recent observations into a
> single document that reflects who you are right now. Like, if you've been
> tracking a habit change for two months, the basic one won't know that — the
> smart one will bake it in. The smart one needs an Anthropic API key though."

If they have `ANTHROPIC_API_KEY` in `.env`, `[I'll do this]` run the smart version:
```
npm run rebuild-identity
```
If not, run the fallback:
```
npm run generate-identity
```
Either produces `Core/core-identity.md` — loaded every session so the vault
knows who they are without re-explaining.

If you ran the fallback, **tell them**: once they add an Anthropic API key
(which they'll need for `promote_patterns` anyway — it's the same key), run
`npm run rebuild-identity` from the repo and they'll get the real version. The
nightly cron will keep it fresh from then on.

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

Tick `08`, then read `setup/08b-systems-tour.md`.
