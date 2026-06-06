# 08b · Systems tour — show them what's actually in the box

**GOAL:** Before they go use this thing on their own, make sure they actually
understand the systems they just installed. Not from docs — live. Show them,
let them poke around, and be honest about how it works and what it's for.

**WHO DOES WHAT:** This is a demo. You drive, they watch and ask questions.
Use `AskUserQuestion` to make it interactive — don't just monologue.

---

## The framing

Open with this:

> "Okay — you're set up. But I want to do a quick tour before we close this
> out. There are a few systems in here that aren't obvious from the outside, and
> if you don't know they exist you'll never use them. Some of this is stuff the
> person who built this template uses daily — I'll show you how he does it and
> you can steal it, adapt it, or ignore it entirely."

Then go through each section below. Keep it conversational, not a lecture.
Actually call the tools as you explain them so they can see it working, not
just hear about it.

---

## 1. The observation system

> "While we talk, I'm quietly logging things I notice about you — patterns,
> moods, contradictions, things you say that seem significant. You never see me
> doing it. It just happens in the background."

`[I'll do this]` Call `log_observation` on something real you noticed during
the interview. Then call `get_observations` with `topic: "scratchpad"` and
show them the entry. Make it concrete:

> "So I just logged that. That's what the scratchpad looks like. Every
> conversation, these pile up. You can ask me 'what have you noticed about me
> lately?' any time and I'll pull from this."

Tell them what kinds of things get logged:
- A contradiction (they said they value X but keep doing Y)
- A mood signal they mentioned in passing
- Something they're clearly avoiding
- A pattern that's starting to emerge

> "I try to be honest in these, not flattering. If you're slacking on something
> you said you cared about, I'll log that."

---

## 2. Patterns synthesis

> "The scratchpad is raw. Over time it gets synthesized into something more
> durable — named patterns."

`[I'll do this]` Call `get_observations` with `topic: "patterns"` and show
them the patterns file (it'll be empty or near-empty right now — that's fine,
explain what it'll look like in a month).

> "Once a week — automatically, on Sunday if you have an Anthropic key — the
> system looks for clusters in the scratchpad and synthesizes them into a
> one-sentence truth. Like: 'tends to front-load energy on new projects and
> drop them around week three.' That's a pattern. Once it's in there, I carry
> it across every session."

> "The person who built this realized his identity doc was always stale because
> it only had what he manually wrote. Patterns fix that — they capture the
> stuff that only shows up over time."

If they're curious, show them what a real pattern looks like. Something like:
> "Work stress tends to manifest as avoidance of the actual problem — lots of
> busy-work, not the hard thing."
> or
> "Gets genuinely excited about new tools and systems, then loses steam once
> the setup is done."

Then ask: *"Is there a pattern in your own life you'd want me to start watching
for?"* — and log it as an observation seed if they name one.

---

## 3. The nudge system

> "If you tell me you want to do something — 'I should call my dad more,' 'I
> keep meaning to read that book,' 'I want to start going to bed earlier' — I
> log it as a nudge. I'll bring it up in future sessions if you haven't
> followed through. Not aggressively — just a light 'hey, remember you wanted
> to do this.'"

`[I'll do this]` Ask them right now:
> "Is there anything you've been meaning to do that you keep not doing?"

If they name something, log it with `log_nudge`. Show them:
> "Okay, that's in there now. Next time we talk and it comes up — or if it
> doesn't come up and it should — I'll mention it."

Tell them how to clear one:
> "Once you actually do it, just tell me and I'll clear it. The whole point is
> light accountability, not a guilt list."

---

## 4. Plugins — integrations with stuff outside the vault

> "The vault also has optional plugins that connect to things outside it. These
> aren't for everyone — but I want to show you what's possible because some of
> them are genuinely useful depending on what you're into."

Walk through the available plugins. Be concrete about how they actually get
used — not just "tracks your anime" but what that looks like day-to-day.

**`mal` — MyAnimeList**
> "The person who built this watches a lot of anime. Instead of opening
> MyAnimeList to update his list, he just tells me 'finished Frieren, give it
> a 9' and I update it through the API. He can also ask 'what's on my
> watching list' or 'find me something like X' and I search MAL. If you're
> not into anime, skip it — but if you track any kind of media list, it's a
> good example of the pattern."

**`espn` — fantasy sports**
> "Fantasy sports integration. He uses it for his fantasy baseball league —
> can ask me about standings, roster moves, matchups, without opening the ESPN
> app. If you have a fantasy league, it connects. If not, irrelevant."

**`running` — run log**
> "Log runs by just telling me — 'ran 5 miles in 42 minutes.' I track pace,
> distance, weekly mileage over time. You can ask 'how's my mileage this month'
> or 'what was my pace last week.' If you run, it's a zero-friction way to
> keep a training log. If you don't, ignore it."

**`calendar` — Google Calendar**
> "Read-only access to your Google Calendar. Lets me help schedule things or
> answer 'what do I have Thursday' without you having to look it up. Needs
> an extra OAuth step — more setup than the others."

Then ask them:
> "Any of those feel relevant to your life? And is there something you *wish*
> was in that list? Like — is there an app or service you use constantly where
> 'just tell Claude' instead of opening the app would be useful?"

`[I'll do this]` Note any ideas they have. If there's a straightforward one
(a public API, a service with a simple client), tell them it's buildable —
and it's exactly the kind of thing the recipes are for. Plant the seed.

---

## 5. The weekly summary

> "Sunday evening, or whenever — you can say 'write my weekly summary' and I'll
> pull your recent journals, stream entries, metrics, and observations and write
> a summary + insights into your vault. It becomes a record over time. The
> first one will be thin since you just set this up, but in a month it'll
> actually be useful."

> "The person who built this uses it mostly to see whether the week was actually
> as bad (or as good) as it felt. Having the data there changes your perception."

---

## 6. Metrics — what's worth tracking

> "The vault has a log_metric tool that lets you track any number over time.
> Weight, sleep hours, mood on a scale, drinks per week, miles run, whatever.
> You just tell me the number and I write it. After a month you have a real
> picture."

> "The template starts you with mood, sleep, and weight — three pretty common
> ones. But those might not be the right metrics for you. Think about: what's
> a number in your life you'd actually want to see over time?"

`[I'll do this]` As they answer, note which starter metrics to keep and which
to delete (circle back to what you pruned in step 1B if needed). If they name
something new, create the metric file now.

---

## Wrap-up

After the tour, ask one final question:

> "Anything here that surprised you? Anything that immediately made you think
> of something you'd want to build or track?"

Log anything interesting they say. If they have a feature idea, write it down
somewhere they can find it — maybe a quick note in their vault under a
`Projects/` or `Ideas/` folder.

Then tell them:
> "Everything you just saw — all of it is buildable on or customizable. The
> observation system, the patterns architecture, the plugins — those are all
> patterns you can use to build your own things. The recipes folder explains
> how. You don't have to know how to code, you just have to know what you want."

## NEXT

Tick `08b`, then read `setup/09-verify-everything.md`.
