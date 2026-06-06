# 08 · Personalize — make it actually theirs

**GOAL:** Turn the empty template into *their* vault: a real identity, a
CLAUDE.md that reflects who they are, and only the plugins they actually want
turned on.

**WHO DOES WHAT:** `[I'll do this]` — you ask, they talk, you write. This
chunk is a conversation, not a form.

## STEPS

1. **Have a real conversation.** Don't fire a questionnaire at them. Just talk.
   Cover, naturally and over a few minutes: who they are and what they do,
   what's going on in this season of their life, what they care about, how they
   like to be talked to, a couple of interests. As they talk, `[I'll do this]`
   fill in the `Core/` notes (`bio.md`, `values.md`, `goals.md`,
   `preferences.md`, `relationships.md`, `routines.md`) using
   `update_identity_field` or by writing the files directly. Don't push them
   to fill every section — capture what's real.

2. `[I'll do this]` Write their `CLAUDE.md` from `config/CLAUDE.md.template`,
   filling in `{{owner_name}}`, `{{owner_blurb}}`, `{{personality}}`, and
   `{{enabled_plugins}}` with what you just learned. Put it at the vault root
   and the repo root so every future session loads it automatically.

3. `[I'll do this]` Rebuild the identity summary:
   ```
   npm run generate-identity
   ```
   This turns the `Core/` notes into a compact `Core/core-identity.md` that
   you load on every session — the vault's memory of who they are.

4. `[I'll do this]` Generate their **claude.ai custom instructions** — a short
   block they paste into the Claude app so that every conversation on their
   phone and desktop already knows who they are and how to use the vault. Fill
   in `config/claude-ai-instructions.template` with the same `{{owner_name}}`,
   `{{owner_blurb}}`, and `{{personality}}` you just used, and show them the
   result.

   `[You'll do this]` Paste it into Claude's custom instructions: in claude.ai,
   go to **Settings → Customize Claude** (desktop) or the profile menu on
   mobile, and paste it into the **"What would you like Claude to know about
   you?"** field. This applies to all Claude chats — not just vault sessions —
   so keep the blurb honest and concise. Once pasted, every Claude conversation
   will open knowing who they are, even without the vault connected.

5. **Pick plugins.** Show them the short list with plain-language descriptions
   (use `AskUserQuestion` with multi-select if you want a menu):
   - **running** — log runs and see your stats
   - **calendar** — connect Google Calendar (needs an extra setup step)
   - **mal** — track anime you're watching
   - **espn** — fantasy sports stuff
   - **coinbase** — crypto holdings
   - The rest are off by default for a reason; only mention them if they ask.

   `[I'll do this]` Set `enabledPlugins` in `config/config.yaml` to exactly
   what they want. Plugins they don't enable stay on disk but don't run —
   they can turn them on later just by adding the name and restarting.

   - If they pick **calendar**: needs Google Cloud OAuth credentials. Walk
     the optional Google steps from chunk 02 now, set the `GOOGLE_*` env vars,
     and have them visit `https://<domain>/calendar/auth` once to link their
     account.

6. `[I'll do this]` Commit and push the vault so both surfaces see the changes:
   ```
   git add -A && git commit -m "personalize vault" && git push
   ```
   Then restart the local server and the VPS service so the new plugin config
   takes effect.

## VERIFY

- `get_identity` (local and from the phone) returns *their* info, not the
  placeholder template.
- The plugins they chose show up as tools in Claude Code; the ones they
  didn't, don't.

## TROUBLESHOOTING

- `generate-identity` produces a thin or empty summary: expected if the `Core/`
  notes are sparse — it only includes filled-in sections. More notes = better
  summary; they can add more later just by talking to you.
- A newly enabled plugin's tools don't appear: the server needs a restart to
  reload `enabledPlugins`. Restart it (and re-add the connector on the phone).

## Building features later

This is the part that makes the vault actually valuable over time: it can
grow. Once the setup is done, they don't need a programmer — they just ask
you. "Track my gym workouts." "Remember my book notes." "Show me my mood
over the past month." You know the house patterns; you build it for them.

The `recipes/` folder has the playbook for how to add new things. Most
trackers (workouts, meals, books, moods, money) need **zero code** — just a
new note with the right shape and the existing tools handle the rest. Tools
that connect to external services (a calendar API, a site's data) take a
little more, but you've got those recipes too.

There is no ceiling here, and the friend doesn't need to touch the code to
keep going. That's the whole point.

## NEXT

Tick `08`, then read `setup/09-verify-everything.md`.
