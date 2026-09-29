---
type: write-checklist
tags: [core, meta]
---

# Write Checklist

Rules to follow before writing to the vault. Read these before every write operation.

## Before You Write

1. **Read the target note first** — use `read_note` before `update_note` or `append_to_note`. Never overwrite blindly.
2. **Match the existing format** — if the note has a markdown table, append a row. If it uses dated H2 blocks, add one. Don't invent a new format.
3. **Use the specific tool** — prefer `update_note` (section replacement) over `append_to_note` when updating a named section.
4. **Frontmatter routing** — use `find_notes` to confirm the right file before writing. Notes are found by `type` + `topic` / `interest`, not by guessing paths.
5. **One commit per logical change** — don't bundle unrelated writes.

## For log_interest_entry

- Read the target note (`read_note`) first to confirm the format (table row vs. dated H2 vs. bullet).
- `entry` is appended verbatim — match the existing format exactly.
- Pass the exact `interest` and `topic` slugs from the note's frontmatter.

## For log_metric

- The metric name must match the `metric:` field in the target note's frontmatter.
- Use `find_notes` with `type=metric-log metric=<name>` to verify the file exists first.

## Do Not

- Do not create new files when an existing note should be updated.
- Do not append to a note you haven't read.
- Do not put structured fields (type, subject) inside `log_observation` content — pass them as separate parameters.
