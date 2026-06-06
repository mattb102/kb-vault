# 04 · Provision the VPS — rent the always-on computer

**GOAL:** A running Ubuntu server on Hetzner that you can SSH into. This is the
machine that makes the vault reachable from their phone.

**WHO DOES WHAT:** The console clicks are `[You'll do this]`; the SSH key
setup and the connection test are `[I'll do this]`.

## STEPS

1. `[I'll do this]` Check if they have an SSH key (a file on their machine
   that proves who they are to the server — no password needed). Check for
   `~/.ssh/id_ed25519.pub`; if it's not there, create one:
   ```
   ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519
   ```
   Then read the public key so you can hand it to them to paste.

2. `[You'll do this]` Create the server. Walk them through the Hetzner Cloud
   console one field at a time — most things can be left as-is; tell them that:
   - "Click **+ New Project**, name it whatever you want, open it."
   - "Click **Add Server**."
   - "**Location**: pick the one closest to you."
   - "**Image**: choose **Ubuntu** — the newest LTS number." (This matters;
     everything else assumes Ubuntu. Don't pick Debian, Fedora, etc.)
   - "**Type**: pick a **shared vCPU x86** option with **4 GB RAM** — the
     **CX22** at around €4/mo is exactly right." **Important:** CX22 x86, not
     the CAX11 ARM (same price, different chip). Local search depends on
     prebuilt binaries that only ship for x86; picking ARM can cause install
     failures. If they're on hosted OpenAI embeddings ARM would technically
     work, but just steer everyone to x86 — it's foolproof.
   - "**SSH key**: click **Add SSH Key** and paste this:" → give them the
     public key from step 1. (One-liner explanation: "This is like a digital
     lock — it lets me log into the server securely, no password.")
   - "Leave everything else alone, click **Create & Buy now**."

3. `[You'll do this]` "Once it's built — should only take a few seconds —
   copy the server's **IPv4 address** (looks like `1.2.3.4`) and paste it to
   me." Wait. Save the IP.

## VERIFY

`[I'll do this]`:
```
ssh -o StrictHostKeyChecking=accept-new root@<IP> 'echo connected && lsb_release -ds'
```
Prints `connected` and an Ubuntu version → we're in.

## TROUBLESHOOTING

- `Permission denied (publickey)`: the SSH key in the Hetzner console doesn't
  match this machine's key. Re-copy `~/.ssh/id_ed25519.pub` exactly — one
  line, no line breaks.
- `Connection refused` / timeout: the box might still be booting. Wait 60
  seconds and try again; double-check the IP.

## NEXT

Tick `04`, then read `setup/05-domain-dns.md`.
