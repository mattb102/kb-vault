# Setup changelog — what to do for people who already installed

**Read this after pulling an update, whenever `setup/.progress.md` exists.**

The setup chunks change over time. Someone who installed in March and pulls in
August has ticked off chunks whose contents have since grown — and nothing in
the checklist will ever send them back, because `01` is still `01`. New steps
added to a chunk they already passed are invisible to them forever unless
something explicitly goes looking. That something is this file.

## How to use it

1. Find their install point: `setup/.progress.md` records
   `Installed at commit: <sha>` under Notes. If it's missing (installed before
   that was recorded), fall back to asking roughly when they set up, or check
   the first commit in their vault repo.
2. Read every entry below that is **newer** than that point.
3. For each one, run its **Catch-up** block — it says how to tell whether this
   person actually needs it, and what to do. Many will be no-ops. Check anyway;
   the whole point is that they can't.
4. Do them one at a time, with the same rules as setup itself (`[I'll do this]`
   vs `[You'll do this]`, verify before moving on, no walls of text).
5. When you're done, update `Installed at commit:` in `.progress.md` to the
   current `git rev-parse --short HEAD` so this doesn't re-run next time.

Don't dump this list at them. Most entries are things you just quietly do.
Only surface the ones that need a decision or an action from them, and lead
with why it's worth their thirty seconds.

## For whoever edits `setup/`

**If your change adds or alters something a person must do, add an entry here
in the same commit.** Rewording, typo fixes, and clearer explanations don't
need one — those only affect people who haven't reached that chunk yet.
Anything that changes the end state of their machine, their server, or their
config does, because people who already passed that chunk have the old end
state and no way to find out.

---

## 2026-08-26 — Phone app, morning report, and three OOM fixes

**Chunks affected:** `04` (swap), `06` (reindex cron), new `08c`, new `08d`.

Three fixes landed that the public repo was missing relative to the server it
was extracted from, plus two new optional plugins.

**Catch-up — do these in order:**

1. **Swap on the VPS (do this one silently, it's pure maintenance).**
   Their box was provisioned without it, and the search embedder can spike past
   free memory during a reindex and get killed. Check:
   ```
   ssh <them>@<IP> 'swapon --show'
   ```
   Empty output → no swap. Add 2GB:
   ```
   ssh <them>@<IP> 'sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && \
     sudo mkswap /swapfile && sudo swapon /swapfile && \
     grep -q "^/swapfile " /etc/fstab || echo "/swapfile none swap sw 0 0" | sudo tee -a /etc/fstab'
   ```

2. **Reindex cron (also silent, and this one is actively costing them).**
   Earlier installs never got one, which means their search index has been
   frozen since the day they installed — anything written from their phone is
   invisible to `search_vault`. Check:
   ```
   ssh <them>@<IP> 'crontab -l | grep cron-reindex'
   ```
   Nothing → install it:
   ```
   ssh <them>@<IP> 'cd ~/kb-vault && git pull && mkdir -p logs && \
     (crontab -l 2>/dev/null; echo "*/10 * * * * bash $HOME/kb-vault/scripts/cron-reindex.sh >> $HOME/kb-vault/logs/reindex.log 2>&1") | crontab -'
   ```
   Then force one rebuild so they stop being stale immediately:
   `ssh <them>@<IP> 'cd ~/kb-vault && npm run index-vault'`
   Worth mentioning to them afterwards, because they may have noticed search
   feeling wrong and assumed it was just bad: *"Found something — your search
   index hadn't been refreshing. Fixed, and it's rebuilt now. Anything you've
   written since you set up is findable again."*

3. **The chunk-size cap** ships in the code — `git pull && npm run build` on
   both their laptop and the VPS, then `sudo systemctl restart vault`. No
   decision needed from them.

4. **Offer the phone app (`08c`)** — new, optional, and the thing most people
   actually want. One line, no pressure: *"There's a new thing since you set
   up — an app for your home screen that logs stuff in one tap and can send you
   notifications. Want to add it? Takes about ten minutes."* If yes, read
   `setup/08c-phone-app.md` and run it as a normal chunk.

5. **Offer the morning report (`08d`)** — new, optional, needs an
   `ANTHROPIC_API_KEY`. Same deal: describe it in one line, run
   `setup/08d-morning-report.md` if they want it. If they don't have an API
   key, say what it'd cost (a couple of dollars a month) and let it go.
