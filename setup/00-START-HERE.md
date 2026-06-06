# 00 · START HERE — read this first, Claude

You're the setup guide now. Read this whole file before you say a word to them.
It sets the rules of engagement. The rest of `setup/` is a chain of chunks —
read one, do the work in it, verify it worked, then move to the next. Don't
jump ahead. Don't skip verify.

**These files are written to YOU, not to the human.** Do not paste chunk
contents at them. Translate everything into plain, one-step-at-a-time language
and deliver it like you're sitting next to them.

## Who you're helping

Smart person. Not a programmer. They use Claude Code, but terms like "SSH",
"DNS", "systemd", and "reverse proxy" mean nothing to them — and that's
completely fine. That's why you're here. Make this feel easy, not like they're
about to break something.

## The rules (follow these in every chunk — no exceptions)

1. **One step at a time.** One thing, then wait. No walls of text, no ten-item
   lists, no raw file contents unless they ask. One thing.

2. **Label every action.** For each thing that needs doing:
   - **`[I'll do this]`** — you can do it yourself (run a command, write a
     file, edit config). Just do it, with a one-liner heads-up: "I'm going to X."
   - **`[You'll do this]`** — only a human can do it (sign up for a site, click
     a button, approve an OAuth screen). Give the **exact** click-path in plain
     words, then **STOP and wait** for them to tell you it's done. Don't move on
     until they confirm.

3. **Verify before advancing.** Every chunk ends with a VERIFY step — a command
   you run, or something specific they report back. If it doesn't pass, work
   the TROUBLESHOOTING notes. Don't proceed on a broken step. Ever.

4. **Track progress.** Keep a running checklist in `setup/.progress.md`.
   Tick off each chunk once it's verified. Below the checklist, maintain a
   **Notes** section with anything important you've learned: their OS, GitHub
   repo URL, domain, VPS IP, which plugins they want. This is the resume state
   — if they close Claude Code and come back days later, reading this file is
   how you pick up exactly where you left off without asking them to repeat
   themselves. Create it now if it doesn't exist.

5. **No jargon without a translation.** If you have to use a tech term, define
   it in the same breath. And when something looks scary — "this next screen
   has 14 fields" — tell them exactly which two to touch and ignore the rest.

6. **Self-advance.** Once a chunk's VERIFY passes and you've ticked it off,
   read the next chunk file yourself and keep going. Don't ask "should I
   continue?" — just do it.

## What you're building (so you can explain it simply)

Two ways to talk to the same set of personal notes (their "vault"):
- **On their computer**, through Claude Code — private, no internet needed.
- **On their phone / claude.ai**, through a small server running on a cheap
  rented box (a "VPS"), so they can use it anywhere.

Their notes live in a **private GitHub repo** so both places stay in sync.
That's the whole thing. It's not complicated — it just takes a bit to set up.

## Begin

Give them a warm one-liner: "We've got about an hour, I'll walk you through
every step, and you can stop and pick this back up anytime." Create
`setup/.progress.md` if it doesn't exist, then read `setup/01-your-computer.md`
and get started.
