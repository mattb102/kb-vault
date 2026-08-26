# 08c · The phone app — tap to log, notifications that actually arrive

**GOAL:** Get a real app icon on their phone's home screen that logs whatever
they want to track in one tap, and can send them notifications.

**SKIP THIS CHUNK IF:** they did a **Local only** install (no VPS). The phone
app is served by the server from chunk 06 — there's nothing to install it from
yet. Tell them it's here whenever they want to do the server half, and move on.

**WHO DOES WHAT:** Mostly `[I'll do this]`. The two human bits are adding it to
the home screen and tapping "allow" on notifications — and the home screen step
is not optional, see below.

---

## The framing

Open with something like:

> "Alright, this is the fun one. You're gonna have an actual app on your phone
> — real icon, opens fullscreen, no browser bar — and tapping a number in it
> writes straight into your vault. And it can ping you. What do you want to be
> able to log in one tap?"

Don't lead with the tech. Lead with *their* thing.

**One thing you need to know before you start, because it shapes every step:**
this is a web app you *install* (a "PWA"), not an App Store download. On iPhone,
notifications are only delivered to an app that's been added to the home screen.
A Safari tab gets nothing — no prompt, no error, just silence. So "Add to Home
Screen" isn't a nice-to-have, it's the install. The app itself pops up a card
walking them through it, but **say it out loud too.**

---

## STEP 1 — Figure out what they want to track

Have a real conversation. Two or three trackers is the sweet spot — this thing
works if they actually tap it, and six buttons on a screen is how you get zero.

Ask:
- "What's something you'd want a daily number on? Mood, sleep, pain, drinks,
  whether you did the thing you keep saying you'll do?"
- "Do you want a 1-10 slider, a yes/no, or an actual number like hours?"

Map their answers onto the three kinds:

| They said | `kind` | Looks like |
|---|---|---|
| "rate my mood 1-10" | `scale` (with `min`/`max`) | a row of numbered buttons |
| "did I meditate today" | `yesno` | a Yes / No pair, stored as 1/0 |
| "how many hours I slept" | `number` (with `unit`) | a number field + Log button |

If they already have metric notes from chunk 08 (`Health/metrics/mood.md` and
friends), **point the trackers at those existing files** rather than making new
ones. Same note, now also tappable from their pocket.

---

## STEP 2 — Turn it on

`[I'll do this]` — all of this, no need to narrate the details:

1. Add `ios_app` to `enabledPlugins` in `config/config.yaml`.
2. Add their trackers under `plugins.ios_app.trackers` (the commented example in
   `config/config.example.yaml` shows the exact shape). Set `title` to something
   they'll like seeing under the icon — their name, their vault's name, whatever.
3. Generate the two secrets into `.env` on the **VPS**:

```bash
# The phone's token. Deliberately NOT the same as API_KEY — see the note below.
echo "APP_TOKEN=$(openssl rand -hex 24)" >> .env

# The notification signing keys (VAPID). One pair, generated once, forever.
npx web-push generate-vapid-keys
# then add to .env:
#   VAPID_PUBLIC_KEY=...
#   VAPID_PRIVATE_KEY=...
#   VAPID_SUBJECT=mailto:their@email.com
```

4. `npm run build && sudo systemctl restart vault`

**Worth telling them, in one sentence:** the phone gets its own separate token,
so if they ever paste that link somewhere dumb or lose the phone, the worst case
is someone logging fake moods — it can't read their journal. That's on purpose.

---

## STEP 3 — Put it on their phone

`[You'll do this]` — walk them through it one line at a time, waiting between
each. Do **not** dump all five steps at once.

1. "Open Safari on your phone and go to `https://<their-domain>/app`"
2. "Paste this token in and hit Go" — send them the `APP_TOKEN` value.
   (Their password manager or a self-DM is the easy way to get it there.)
3. "See that card at the bottom asking you to add it to your home screen? Do
   that now — tap the Share button, scroll down, **Add to Home Screen**."
4. "Close Safari completely. Open it from the new icon on your home screen."
5. "Now tap **Enable notifications** and allow it."

**STOP AND WAIT** after each. Step 3 is the one people skip — if they say
notifications aren't working later, this is why, 90% of the time.

The token is stored on the device, so they only paste it once.

---

## STEP 4 — Prove it works, from both ends

While you have them holding their phone, close the loop in both directions —
this is the moment the whole thing clicks for people:

`[You'll do this]` "Tap a number in the app."

`[I'll do this]` Then immediately read it back:
```
tracker_history  (tracker: <their tracker id>)
```
Show them the entry with today's date. *"That's in your vault now. It's a
markdown file. It'll still be readable in twenty years."*

`[I'll do this]` Then push the other way:
```
send_phone_notification  (title: "Hey", body: "<something specific to them>")
```
Make it personal, not "test 123". Their phone should buzz within a second or two.

---

## VERIFY

- `ios_app_info` lists their trackers and reports **at least 1 device**
  subscribed.
- A value they tapped on the phone appears in the vault note (open it in
  Obsidian if they have it — seeing the markdown row lands better than a tool
  response).
- `send_phone_notification` actually buzzes their phone.

## TROUBLESHOOTING

- **"Enable notifications" says to add it to the home screen first** — it's
  right, and it's iOS, not a bug. They're still in a Safari tab. Back to STEP 3.
- **Nothing happens when they tap Enable, no permission popup** — same cause.
  Also check they opened it from the *icon*, not from a Safari tab they left open.
- **"That token didn't work"** — `APP_TOKEN` isn't in `.env`, or the service
  wasn't restarted after adding it. Check `ios_app_info` — it warns explicitly
  when `APP_TOKEN` is unset.
- **`ios_app_info` shows 0 devices after they enabled notifications** — the
  subscribe call failed. Check `sudo journalctl -u vault -n 50`.
- **The VAPID error on send** — `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` missing
  or mismatched. Regenerate the pair, put **both** in `.env`, restart. If they
  regenerate after phones subscribed, those phones must re-enable notifications.
- **They previously deleted the app and reinstalled** — old subscription is dead.
  Harmless: the server drops dead endpoints automatically the next time it sends.
- **Buttons log to the wrong day late at night** — the app uses the phone's
  local calendar date on purpose. If they log at 12:30am they'll get the new
  day, which is usually what they meant.

## NEXT

Tick `08c`, then read `setup/08d-morning-report.md`.
