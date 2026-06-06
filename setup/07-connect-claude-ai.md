# 07 · Connect claude.ai — the vault on their phone

**GOAL:** The vault shows up as a connector in the claude.ai app, logged in,
reading their notes.

**WHO DOES WHAT:** Hybrid. You supply the URL and the passphrase; the human
does the clicks in the app (you can't touch their claude.ai account).

## STEPS

1. **One-sentence explanation:** "We're going to add your server to the Claude
   app as a 'connector' — basically telling it 'hey, there's a vault at this
   address, and here's the password to get in.' You only have to do this once."

2. `[You'll do this]` In the claude.ai app or website, add a custom connector:
   - Settings → **Connectors** → **Add custom connector** (wording varies
     slightly depending on the app version).
   - **URL:** give them `https://<domain>/mcp`.
   - Save.

3. `[You'll do this]` It'll send them to a **sign-in page** — a simple page
   with a single "Passphrase" box. Give them the passphrase you saved from
   chunk 06 and have them paste it and click **Authorize**.
   - One-sentence explanation: "That login is what keeps your notes private —
     strangers hitting that URL get nothing without the passphrase. You only
     enter it once and then it remembers."

4. `[You'll do this]` Confirm the connector shows as **connected** and that the
   vault tools are visible in a new chat.

## VERIFY

Have them open a new chat in the claude.ai app and say *"search my vault for
anything"* or *"what do you know about me?"* — it should call `search_vault` /
`get_identity` and return something from their vault. If they can see that,
the phone surface is live. Nice.

## TROUBLESHOOTING

- Sign-in page rejects the passphrase: the correct value is `AUTH_PASSWORD`
  in the VPS `.env`. Re-read it:
  `ssh root@<IP> 'grep AUTH_PASSWORD ~/kb-vault/.env'`
- Connector won't connect at all: confirm `https://<domain>/health` still
  returns OK and that the connector URL ends in `/mcp` (not just the domain).
- Connects but no tools show up: the server probably restarted and the session
  was invalidated. In the app, remove the connector and re-add it.

## NEXT

Tick `07`, then read `setup/08-personalize.md`.
