---
type: routing-manifest
tags: [core, kb-system]
---

This manifest tells the nightly reconciler which type of fact belongs in
which file. Edit the table below to match your vault's actual structure.
The reconciler reads the markdown body (not the frontmatter) and passes it
to Claude as routing guidance during triage.

**How to use:** add one row per file that holds facts your AI conversations
might update. The "fact type" column is plain-language — Claude matches
observations against it. Leave rows for files you do not want the reconciler
to touch *out of this table* (it only proposes changes to files it routes to).

| Fact type | File | Notes |
|-----------|------|-------|
| Personal background, biography, origin | Core/bio.md | Who you are, where you came from |
| Core values, principles, what matters | Core/values.md | What you stand for |
| Goals, intentions, aspirations | Core/goals.md | Short- and long-term things you're working toward |
| Relationships, important people | Core/relationships.md | People in your life |
| Daily routines, habits, schedules | Core/routines.md | How you structure your days |
| Preferences, opinions, taste | Core/preferences.md | What you like, dislike, or prefer |

Add rows for your own notes as you create them. Examples:

| Work role, team, projects | Work/current-role.md | Your job and what you're doing there |
| Health, fitness, training | Health/overview.md | Physical state, ongoing plans |
| Finances, budget, savings | Finance/overview.md | Money situation |
