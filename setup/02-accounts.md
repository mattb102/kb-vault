# 02 · Accounts — the sign-ups only a human can do

**GOAL:** Make sure they have the accounts the rest of setup needs. Knock these
out now so there are no surprise interruptions mid-deploy.

**WHO DOES WHAT:** All `[You'll do this]`. You give exact paths, wait, and
verify each one before moving on. Do them **one at a time** — don't front-load
a list. Three are required (GitHub, Hetzner, DuckDNS); the rest are opt-in.

## STEPS

1. **GitHub** (stores their notes privately and keeps their phone and computer
   in sync).
   - `[You'll do this]` "If you don't already have a GitHub account, go to
     github.com and sign up — it's free." Wait.
   - `[I'll do this]` Check if the `gh` command-line tool is installed and
     logged in (`gh auth status`). If not, walk them through `gh auth login`
     (it opens a browser tab — `[You'll do this]` is just clicking "authorize").
     This lets you create their private vault repo later without them having to
     touch the GitHub website.

2. **Hetzner** (rents the always-on server — basically a computer that's on
   24/7 in a data center, for about the price of a coffee a month).
   - `[You'll do this]` "Go to hetzner.com/cloud, create an account, and add a
     payment method. You don't need to create a server yet — I'll do that part
     with you." Wait. Reassure them: the cheapest box is around €4/month and
     they can delete it whenever.

3. **DuckDNS** (a free web address for their server — like a street address,
   but for the internet).
   - `[You'll do this]` "Go to duckdns.org and sign in with one of the social
     login buttons. Pick a name — something like `yourname-vault` — and click
     **add domain**. Tell me the full domain it gives you (e.g.
     `yourname-vault.duckdns.org`) and paste me the **token** shown at the top."
     Wait. Save the domain and token for later — don't commit them anywhere.

4. **(Optional) OpenAI** — only if they specifically want hosted search instead
   of the local default.
   - Search works out of the box without any account — **skip this by default.**
     Only do it if they asked for it. If so: `[You'll do this]` "Go to
     platform.openai.com, sign in, open **API keys**, create a new secret key
     (starts with `sk-`), and keep it somewhere safe." Note this choice so the
     install wires it in correctly.

5. **(Optional) Google Cloud** — only if they want the calendar plugin. Skip
   for now; revisit during personalization (chunk 08) if they bring it up.

## VERIFY

- `gh auth status` shows them logged in.
- They've given you their **DuckDNS domain** and **DuckDNS token**, and they
  have a **Hetzner account with billing set up**.
- An OpenAI key only if they specifically opted in.

Keep the domain, treat the tokens/keys as secrets — don't write them into
anything that gets committed.

## TROUBLESHOOTING

- `gh` not installed: `[I'll do this]` — install it (`apt install gh`, etc.)
- Hetzner asks for ID verification: normal for new accounts, may take a bit to
  approve. If they're blocked, do the local install (chunk 03) in the meantime
  and come back to the VPS chunks (04–07) when Hetzner clears them.

## NEXT

Tick `02`, then read `setup/03-local-install.md`.
