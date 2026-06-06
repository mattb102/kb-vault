# 01a · Windows → WSL2 (the only Windows-specific chunk)

**GOAL:** Get a Windows user into an Ubuntu Linux shell with Claude Code
running inside it. After this, their machine acts like a Linux machine and
every later chunk applies unchanged. Windows is only weird for this one part.

**WHO DOES WHAT:** Almost entirely `[You'll do this]` — installing WSL touches
the OS and needs a reboot, which only the human can drive. Go one step at a
time and reassure them. This looks scarier than it is.

## STEPS (do these one at a time — wait after each)

1. **One-sentence explanation:** "WSL is a free, built-in Windows feature that
   runs real Linux inside your machine — one command and one reboot and it's
   done."

2. `[You'll do this]` — "Open the Start menu, type **PowerShell**, right-click
   it, and choose **Run as administrator**. Click Yes if it asks." Wait for
   "ok."

3. `[You'll do this]` — "In that blue window, type exactly `wsl --install` and
   press Enter. It'll download Ubuntu — this can take a few minutes, just let
   it run." Wait. (If it says WSL is already installed, nice — skip to step 5.)

4. `[You'll do this]` — "When it finishes it'll ask you to restart. Go ahead,
   then come back here when you're back at your desktop." Wait for them to
   return.

5. `[You'll do this]` — "After the reboot, an **Ubuntu** window should open on
   its own and ask you to create a username and password for Linux. Pick
   anything — the password won't show as you type, that's normal. Tell me when
   you're at a prompt that looks like `you@machine:~$`." Wait.
   - If no Ubuntu window opened automatically: "Open the Start menu and click
     **Ubuntu**."

6. **From here on, everything lives in that Ubuntu window — not PowerShell.**
   Make this explicit before continuing. `[You'll do this]` — install Claude
   Code inside the Ubuntu shell (give them the official Linux install command)
   and start `claude` in there.

## VERIFY

Inside the Ubuntu shell:
```
uname -s    # prints: Linux
```
And confirm the prompt ends in `:~$` (Linux shell), not `PS C:\>` (PowerShell).

## TROUBLESHOOTING

- `wsl --install` says "not recognized": Windows is too old — needs Windows 10
  version 2004+ or Windows 11. Have them run Windows Update first.
- Virtualization error on launch: they need to enable virtualization in BIOS.
  This is rare — worth pausing to look up the steps for their specific PC
  model together.
- They keep doing later steps in PowerShell: gently redirect — "hey, let's
  switch to the Ubuntu window for this."

## NEXT

Head back to `setup/01-your-computer.md` and run the VERIFY, then continue
the chain from there.
