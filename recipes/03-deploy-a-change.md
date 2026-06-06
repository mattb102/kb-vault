# 03 · Deploy a change to the VPS — safely

A code change only matters on the phone surface after it's built and the
service is restarted on the VPS. The silent failure mode: you edited source,
restarted, and nothing changed — because **the server runs compiled
`build/index.js`, not `src/`**. Skip the build step and you're running the old
code forever.

## The safe sequence

```bash
ssh root@<IP>
cd ~/kb-vault

git fetch origin
git reset --hard origin/<branch>   # match the repo exactly — no merge surprises

npm install                        # only if package.json changed
npm run build                      # required — compiles src/ -> build/

sudo systemctl restart vault
sleep 2
systemctl is-active vault          # expect: active
curl -fsS https://<domain>/health  # expect: {"status":"ok", ...}
```

## Why each step is there

- **`git reset --hard`** instead of `git pull`: the VPS isn't an editing
  surface; forcing it to match the repo avoids any merge mess from stray local
  state.
- **`npm run build` before restart**: the #1 silent failure. Skip it and the
  server keeps running the old compiled binary — the change appears to "not
  work" with zero error output.
- **Check `is-active` + `/health`**: a bad change can crash the service on
  start. If it's not active, read the logs:
  `journalctl -u vault --no-pager | tail -30` — usually a missing env var or
  a TypeScript error that slipped through.

## After a restart: reconnect the phone

Restarting the server kills all live MCP sessions (intentional — clients
re-initialize on the next message). After a deploy, the claude.ai connector
reconnects on its own; if it seems stuck, remove and re-add the connector once.

## Vault vs. code

These are two separate repos. A code deploy (`kb-vault`) doesn't touch notes
(`vault`), and vice-versa. If a new feature also needs new seed/template notes
in the vault, commit those to the vault repo and let the normal sync pull them
onto the VPS.
