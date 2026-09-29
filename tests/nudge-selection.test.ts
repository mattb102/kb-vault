/**
 * Unit tests for evening-nudges.ts selection and composition helpers.
 *
 * Key regression: the personal system's nudge-push / evening-nudges used a
 * simple `string.split("|")` that did not handle escaped pipes (`\|`) inside
 * cells. When a goal or note contained `\|`, the status column shifted right
 * and rows with terminal statuses (expired, addressed, wont_do) could slip
 * past the filter and appear in the push payload.
 *
 * The public repo fix: parseNudgeRow in src/core/nudges.ts uses
 * `split(/(?<!\\)\|/)` (unescaped-pipe split), so escaped pipes never shift
 * column indices, and the status filter (`open` | `in_progress` only) is
 * applied before selectDue ever sees the row.
 */
import { selectDue, filterByState, shortLabel, compose } from "../scripts/evening-nudges.js";

// ─── helpers ────────────────────────────────────────────────────────────────

function row(goal: string, status: string, due: string, priority = "P2"): string {
  // Build a table row matching the public repo's 8-column nudge table:
  // | Goal | First | Last | Status | Priority | Note | Resolution | Due |
  return `| ${goal} | 2026-01-01 | 2026-09-01 | ${status} | ${priority} | some note | | ${due} |`;
}

let passed = 0;
let failed = 0;

function ok(label: string, condition: boolean): void {
  if (condition) {
    console.log(`PASS: ${label}`);
    passed++;
  } else {
    console.log(`FAIL: ${label}`);
    failed++;
  }
}

// ─── selectDue ──────────────────────────────────────────────────────────────

{
  const ISO = "2026-09-29";

  // Table with a mix of statuses — only open/in_progress should ever reach selectDue.
  const table = [
    row("open due today", "open", ISO),
    row("overdue open", "open", "2026-09-20"),
    row("expired row", "expired", "2026-09-20"),
    row("addressed row", "addressed", "2026-09-15"),
    row("wont_do row", "wont_do", "2026-09-28"),
    row("in_progress due today", "in_progress", ISO),
    row("undated open", "open", ""),
    row("future open", "open", "2026-10-05"),
  ].join("\n");

  const due = selectDue(table, ISO);

  // Terminal statuses must never appear.
  const goals = due.map((d) => d.row.goal);
  ok("expired row excluded", !goals.includes("expired row"));
  ok("addressed row excluded", !goals.includes("addressed row"));
  ok("wont_do row excluded", !goals.includes("wont_do row"));

  // Due items must appear.
  ok("open due today included", goals.includes("open due today"));
  ok("overdue open included", goals.includes("overdue open"));
  ok("in_progress due today included", goals.includes("in_progress due today"));

  // Undated and future items must not appear.
  ok("undated open excluded", !goals.includes("undated open"));
  ok("future open excluded", !goals.includes("future open"));

  // Overdue items appear before due-today items.
  const overdueIdx = goals.indexOf("overdue open");
  const dueTodayIdx = goals.indexOf("open due today");
  ok("overdue sorted before due-today", overdueIdx < dueTodayIdx);
}

// ─── selectDue with escaped pipe in goal (the personal-system bug scenario) ─

{
  const ISO = "2026-09-29";
  // A goal cell containing \| — simple split would shift status to wrong column.
  const table = [
    row("goal with \\| escaped pipe", "open", ISO),
    row("expired \\| should vanish", "expired", ISO),
  ].join("\n");

  const due = selectDue(table, ISO);
  ok("escaped-pipe open row included", due.some((d) => d.row.goal.includes("escaped pipe")));
  ok("expired row with escaped pipe excluded", !due.some((d) => d.row.goal.includes("should vanish")));
}

// ─── filterByState ──────────────────────────────────────────────────────────

{
  const ISO = "2026-09-29";

  const table = [
    row("item A", "open", ISO),               // due today
    row("item B", "open", "2026-09-20"),       // overdue by 9 days
    row("item C", "open", "2026-09-28"),       // overdue by 1 day (newly)
    row("item D", "open", "2026-09-10"),       // overdue by 19 days
  ].join("\n");

  const due = selectDue(table, ISO);

  // Empty state — everything passes.
  const toPush = filterByState(due, {}, ISO);
  ok("all items pass with empty state", toPush.length === due.length);

  // Already notified today.
  const stateToday: Record<string, string> = { "item A": ISO };
  const afterToday = filterByState(due, stateToday, ISO);
  ok("item A suppressed when already notified today", !afterToday.some((d) => d.row.goal === "item A"));

  // Newly overdue (1 day) always passes even if recently notified.
  const stateRecent: Record<string, string> = { "item C": "2026-09-28" };
  const afterRecent = filterByState(due, stateRecent, ISO);
  ok("newly overdue (1d) passes even when recently notified", afterRecent.some((d) => d.row.goal === "item C"));

  // Older overdue item suppressed if last notified < OVERDUE_GAP_DAYS ago.
  const stateOld: Record<string, string> = { "item D": "2026-09-27" }; // 2 days ago < 3
  const afterOld = filterByState(due, stateOld, ISO);
  ok("overdue item suppressed when last notified < OVERDUE_GAP_DAYS", !afterOld.some((d) => d.row.goal === "item D"));

  // Older overdue item passes if last notified >= OVERDUE_GAP_DAYS ago.
  const stateOlder: Record<string, string> = { "item B": "2026-09-25" }; // 4 days ago >= 3
  const afterOlder = filterByState(due, stateOlder, ISO);
  ok("overdue item passes when last notified >= OVERDUE_GAP_DAYS", afterOlder.some((d) => d.row.goal === "item B"));
}

// ─── shortLabel ─────────────────────────────────────────────────────────────

ok("shortLabel: splits at em-dash", shortLabel("Exercise — daily mobility block") === "Exercise");
ok("shortLabel: splits at hyphen-space", shortLabel("Book dentist - make the call") === "Book dentist");
ok("shortLabel: no delimiter, short", shortLabel("Quick task") === "Quick task");
ok("shortLabel: no delimiter, long", shortLabel("A".repeat(40)).endsWith("…"));

// ─── compose ────────────────────────────────────────────────────────────────

{
  const ISO = "2026-09-29";
  const table = [
    row("Only task", "open", ISO),
  ].join("\n");
  const due = selectDue(table, ISO);
  const { title } = compose(due);
  ok("compose: single item uses short label as title", title === "Only task");
}

{
  const ISO = "2026-09-29";
  const table = [
    row("Task one", "open", ISO),
    row("Task two", "open", ISO),
    row("Task three", "open", "2026-09-20"),
  ].join("\n");
  const due = selectDue(table, ISO);
  const { title } = compose(due);
  ok("compose: multiple items shows count", title === "3 due");
}

// ─── summary ─────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
