# 08d · The morning report — a daily briefing your vault writes about you

**GOAL:** Every morning, the vault reads everything it knows about them and
writes a short, specific brief: what matters today, what's slipping, one thing
worth their attention. Delivered where they'll actually see it.

**SKIP THIS CHUNK IF:** they don't have an `ANTHROPIC_API_KEY` in `.env`. This
one genuinely can't run without it — it's a real Claude call every morning.
Tell them what it does, tell them it's a couple of dollars a month at most, and
offer to come back to it. Don't push.

**WHO DOES WHAT:** `[I'll do this]` for all the wiring. One conversation about
what they want it to sound like, and one optional Discord step.

---

## The framing

This is the piece people don't expect, so sell it properly:

> "Last thing. Every morning at 6am, before you're awake, this thing reads your
> notes, your open nudges, the stuff it's noticed about you lately, whatever
> you've been tracking — and writes you a briefing. Not a to-do list. More like
> a friend who's been paying attention going 'hey, you've said you'd call your
> brother three weeks running now.' Want that?"

Then the honest part:

> "Fair warning — it's only as good as what's in your vault. Week one it'll be
> a bit thin. Month two it gets kind of uncanny."

---

## STEP 1 — Where should it land?

`[I'll do this]` Ask with `AskUserQuestion`, multi-select. It **always** writes
to their vault (`Reports/<date>-morning.md`); these are on top of that:

- 📱 **Push notification** — buzzes their phone, full text in the vault.
  *Requires chunk 08c.* If they skipped it, don't offer this one.
- 💬 **Discord** — posts into a channel. Good if they already live in Discord.
- 🎧 **Read aloud** — a voice mp3 posted to Discord. This is the one people
  actually love: it's a two-minute podcast about your own life while you make
  coffee. Needs `OPENAI_API_KEY` and Discord. Offer it, don't assume it.
- 📓 **Vault only** — it's just there when they open Obsidian in the morning.

Also ask, quickly and conversationally:

- **Tone.** "Should it be gentle or should it be blunt with you?" → goes in
  `tone`. Their words, not yours. "blunt, no pep talk" is a real config value.
- **Weather.** "Want the weather in it? What city?" → `location`. Skip it and
  the line just isn't there.
- **Trackers.** If they set any up in 08c, which should the report summarize?
  → `trackers`. This is what makes it say "your sleep's down to 5.8 hours
  average this week" instead of generic advice.
- **What time?** Defaults to 6am. → `REPORT_HOUR` in `.env`.

---

## STEP 2 — Discord webhook (only if they picked Discord)

`[You'll do this]` — give them this exact click-path, then **STOP and wait**:

1. In Discord, pick or make a channel just for this (a private server of their
   own is ideal — they can make one in about ten seconds).
2. Channel name → **Edit Channel** → **Integrations** → **Webhooks** →
   **New Webhook** → **Copy Webhook URL**.
3. Send it over.

`[I'll do this]` Add it to `.env` as `DISCORD_WEBHOOK_URL=...`

---

## STEP 3 — Wire it up

`[I'll do this]`, all at once, no narration needed:

1. Add `morning_report` to `enabledPlugins` in `config/config.yaml`.
2. Fill in `plugins.morning_report` with what they just told you —
   `delivery`, `audio`, `tone`, `location`, `trackers`.
3. Add `REPORT_HOUR` / `REPORT_TZ` to `.env` if they wanted something other
   than 6am Eastern.
4. Install the cron **on the VPS**:

```bash
crontab -l 2>/dev/null | grep -v cron-morning-report > /tmp/ct
echo "0 10 * * * bash $HOME/kb-vault/scripts/cron-morning-report.sh >> $HOME/kb-vault/logs/morning-report.log 2>&1" >> /tmp/ct
echo "0 11 * * * bash $HOME/kb-vault/scripts/cron-morning-report.sh >> $HOME/kb-vault/logs/morning-report.log 2>&1" >> /tmp/ct
crontab /tmp/ct && rm /tmp/ct
```

(`bootstrap-vps.sh` already installs these if the API key was in `.env` when it
ran — check `crontab -l` first and skip this if they're there.)

5. `npm run build && sudo systemctl restart vault`

**Why two cron lines, in case they ask** (and it's a good question): the server
runs on UTC, and cron can't do time zones. Two adjacent UTC hours are scheduled,
and the script itself bails unless the *local* hour is the one they picked. That
means it stays at 6am their time through daylight saving, forever, with nobody
touching anything. It is not a mistake, and please don't let a future session
"clean it up" into one line.

---

## STEP 4 — Run one right now

Don't make them wait until tomorrow to see it. `[I'll do this]`:

```
morning_report
```

It takes 20-40 seconds. Read it back to them, then ask the real question:
**"Does that sound like it knows you?"**

Whatever they say next is config. Too soft → sharpen `tone`. Too generic →
their `Core/` notes are thin, which is a chunk-08 problem, and worth saying
plainly: *"That's the vault not knowing you yet, not the report being broken.
Give it a few weeks of actual use."* Wrong focus → add a line to their
CLAUDE.md "What to watch for".

Then tune it and run it once more. Getting this to feel right on day one is
what makes them keep the thing.

---

## VERIFY

- `morning_report_status` shows the channels they picked and **no MISSING keys**.
- `morning_report` produces a real briefing that references at least one
  specific thing from their vault — a name, a nudge, a number. If it's all
  generic encouragement, it isn't working, no matter what it says.
- `Reports/<today>-morning.md` exists in their vault and is committed.
- Whichever channels they picked actually fired (phone buzzed / Discord posted).
- `crontab -l` shows the two `cron-morning-report` lines.

## TROUBLESHOOTING

- **"ANTHROPIC_API_KEY is not set"** — it's missing from `.env`, or the cron
  ran without sourcing it. The cron script sources `.env` itself; a manual run
  from a bare shell won't.
- **The report is bland and generic** — almost always a thin vault, not a
  broken report. Check `Core/core-identity.md` is real and not the placeholder.
  Run `rebuild-identity` and try again.
- **It repeats itself day to day** — it's given its own last 6 reports and told
  not to. If it's still looping, there isn't enough new input; more journal or
  tracker use fixes it, nothing in the config will.
- **Nothing arrived but the vault copy** — expected behaviour, not a failure:
  delivery channels are allowed to fail without losing the report. The error is
  in `logs/morning-report.log` and in the tool's output.
- **Push says "no phones subscribed"** — chunk 08c, STEP 3. They're not
  installed on the home screen.
- **Audio silently didn't happen** — `OPENAI_API_KEY` missing, or they picked
  audio without Discord (audio only rides the Discord attachment).
- **It fired at the wrong hour** — check `REPORT_TZ` is a real IANA name
  (`America/Chicago`, not `CST`) and that both UTC cron lines exist.
- **Old reports clogging up search** — the cron already prunes anything older
  than 14 days. If someone removed that line, put it back; generated reports
  outranking real notes in search is a genuine problem that has happened.

## NEXT

Tick `08d`, then read `setup/09-verify-everything.md`.
