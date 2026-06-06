# 01 · Add a tracker — the no-code path (the common case)

The human wants to log something over time. Almost always you don't need to
write a single line of code. The existing `log_metric` tool looks for a file
by its frontmatter (`type: metric-log`, `metric: <name>`) and appends a dated
row. Adding a tracker = creating that file once.

## How it actually works

`logMetric` in `src/core/writer.ts` does this:

```ts
const entry = frontmatterIndex.findOne({ type: "metric-log", metric });
// …appends a row: | <date> | <value> | <note> |
```

If no file with that `type` and `metric` exists, it throws a helpful error that
tells you exactly what's missing. The setup is just: make the file.

## Steps

1. **Pick a name** — lowercase, no spaces: `pushups`, `water`, `weight`,
   `books`, `mood`, whatever they said.

2. **Create the log file** with `create_note` (or write it directly). Put it
   somewhere sensible — `Health/metrics/` for body stuff, `Habits/` for
   habits, etc.:

   ```
   ---
   type: metric-log
   metric: pushups
   unit: reps
   tags: [habit, metric]
   ---

   # Pushups log

   | Date | Value | Note |
   |------|-------|------|
   ```

   The `type: metric-log` + `metric:` frontmatter is the only load-bearing
   part. Keep the table header. Everything else is cosmetic.

3. **Log to it immediately** with the existing tool — no new code, no restart:
   ```
   log_metric { metric: "pushups", value: "40", note: "felt strong" }
   ```

4. **Read it back** with `find_notes { metric: "pushups" }` or `read_note`
   to confirm the row landed.

5. **Add a routing line** to their `CLAUDE.md` so you always know it exists:
   > "Pushups → `log_metric` with `metric: pushups`; history at
   > `Health/metrics/pushups.md`."

## That's it — no restart, no deploy, no code

Because you only added a data file, the server doesn't need to restart. The
change takes effect immediately.

## When a tracker needs a *little* more

If they want computed stats — totals, streaks, running averages — that's the
`running` plugin's territory. It reads a markdown table and aggregates. Copy
that pattern (`src/plugins/running/`) via `recipes/02-add-an-mcp-tool.md`
rather than building it from scratch.

## Verify

`log_metric` returns "Logged …", and reading the file shows the new row.
