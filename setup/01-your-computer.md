# 01 · Your computer — get to a Linux shell

**GOAL:** End this chunk with them at a working Linux-style shell that has
`node` (v18+) and `git`, where Claude Code is running. Everything after this
chunk is the same regardless of their OS — so it's worth nailing this.

**WHO DOES WHAT:** Mostly `[You'll do this]` (you can't install things on their
machine — only they can); you detect, guide, and verify.

## STEPS

1. **Figure out the OS.** Ask them straight: "Windows, Mac, or Linux?" — or
   if you can already run a command, just check: `uname -s`. If that bombs,
   they're almost certainly on Windows.

2. **Branch:**
   - **Windows →** One chunk of special handling and then they're on the same
     path as everyone else. Read `setup/01a-windows-wsl.md`, run that, then
     come back here for VERIFY.
   - **Mac →** Probably has Homebrew or can get it. `[I'll do this]` — check
     `node -v` / `git --version`; if missing, `[You'll do this]` — give them
     `brew install node git`. Then VERIFY.
   - **Linux →** `[I'll do this]` — detect the package manager (`apt`, `dnf`,
     or `pacman`), confirm `node -v` ≥ 18 and `git --version`. If node is old
     or missing, the bootstrap script in the next chunk will handle it — you
     can defer. Then VERIFY.

## VERIFY

Run these:
```
node -v        # must print v18 or higher
git --version  # must print anything
```
Both succeed → done. If they're on Windows, these **must** be running inside
the Ubuntu/WSL shell, not PowerShell — the prompt should look like
`user@machine:~$`, not `PS C:\>`.

## TROUBLESHOOTING

- `node -v` too old (< v18): defer — the bootstrap script will upgrade it on
  Linux/WSL. On Mac: `brew upgrade node`.
- "command not found" for both: on Windows, this almost always means they're
  still in PowerShell instead of WSL — send them back to chunk `01a`.

## NEXT

Tick `01` in `setup/.progress.md`, then read `setup/02-accounts.md`.
