---
type: ai-observation
topic: scratchpad
tags: [ai, scratchpad]
---

# AI Scratchpad

Raw, timestamped observations Claude logs via `log_observation`. Each entry:

`### YYYY-MM-DD HH:MM | type: <category> | subject: <tag>`

Leave this file in place (the tools find it by frontmatter). Entries get added
below over time, then periodically distilled into patterns by `promote_patterns`.
