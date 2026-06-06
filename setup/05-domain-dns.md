# 05 · Domain & DNS — point the web address at the server

**GOAL:** Their DuckDNS domain (from chunk 02) resolves to the VPS's IP. The
server needs this to get an HTTPS certificate and be reachable by name instead
of a raw IP.

**WHO DOES WHAT:** The DuckDNS update is `[You'll do this]` (or you can do it
via their token); the verification is `[I'll do this]`.

## STEPS

1. **One-sentence explanation:** "A domain is just a human-readable name that
   maps to a number. We're telling the internet: when someone looks up
   `yourname-vault.duckdns.org`, send them to your server."

2. Update the record. Two ways — pick whichever's easier:
   - `[You'll do this]` "Go to duckdns.org, find your domain, put the server's
     IP in the **current ip** box, and click **update ip**." Wait.
   - `[I'll do this]` (if they already gave you the token in chunk 02):
     ```
     curl "https://www.duckdns.org/update?domains=<NAME>&token=<TOKEN>&ip=<IP>"
     ```
     Returns `OK`. Treat the token as a secret — don't put it anywhere
     committed.

## VERIFY

`[I'll do this]`:
```
dig +short <domain>      # should print the VPS IP
```
If `dig` isn't around: `getent hosts <domain>` or `curl -sI http://<domain>`.
DNS usually propagates fast with DuckDNS — if it's empty, wait 60s and
retry. Don't move on until this resolves to the right IP.

## TROUBLESHOOTING

- `dig` returns nothing or the old IP: the DuckDNS update didn't stick, or
  you're seeing a cached result. Re-run the update, wait 60s, retry.
- Wrong IP in the result: they probably pasted an IPv6 address or had a typo
  — go back and re-confirm the IPv4 from the Hetzner console.

## NEXT

Tick `05`, then read `setup/06-deploy-server.md`.
