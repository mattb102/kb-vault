/**
 * Unit tests for applyNudgeEdit and filterRetiredPatterns.
 */
import { applyNudgeEdit, filterRetiredPatterns } from "../src/core/observer.js";

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

// ─── helpers ────────────────────────────────────────────────────────────────

function makeTable(...rows: string[]): string {
  const header = "| Goal | First Mentioned | Last Checked | Status | Priority | Note | Resolution | Due |";
  const sep    = "| --- | --- | --- | --- | --- | --- | --- | --- |";
  return ["", header, sep, ...rows, ""].join("\n");
}

function row(
  goal: string,
  status = "open",
  priority = "P2",
  note = "",
  due = "",
): string {
  return `| ${goal} | 2026-01-01 | 2026-09-01 | ${status} | ${priority} | ${note} | | ${due} |`;
}

// ─── applyNudgeEdit ─────────────────────────────────────────────────────────

{
  const raw = makeTable(row("write tests"));
  const { updated, changed, matchedGoal } = applyNudgeEdit(raw, "write tests", { priority: "P1" }, "2026-10-01");
  ok("exact match by goal", matchedGoal === "write tests");
  ok("priority updated in row", updated.includes("| P1 |"));
  ok("last_checked stamped", updated.includes("| 2026-10-01 |"));
  ok("changed list reports priority", changed.some((c) => c.includes("priority")));
}

{
  const raw = makeTable(row("fix the login page bug"));
  const { updated, matchedGoal } = applyNudgeEdit(raw, "login page", { note: "still blocking users" }, "2026-10-01");
  ok("substring match succeeds", matchedGoal === "fix the login page bug");
  ok("note updated", updated.includes("still blocking users"));
}

{
  const raw = makeTable(row("task one"), row("task two"));
  let threw = false;
  try {
    applyNudgeEdit(raw, "task", { note: "ambiguous" }, "2026-10-01");
  } catch (e: any) {
    threw = true;
    ok("ambiguous match throws informative error", e.message.includes("matches multiple"));
  }
  if (!threw) ok("ambiguous match throws informative error", false);
}

{
  const raw = makeTable(row("no such goal"));
  let threw = false;
  try {
    applyNudgeEdit(raw, "xyz not found", { note: "hi" }, "2026-10-01");
  } catch (e: any) {
    threw = true;
    ok("not-found throws", e.message.includes("no open/in_progress nudge found"));
  }
  if (!threw) ok("not-found throws", false);
}

{
  const raw = makeTable(row("addressed task", "addressed"));
  let threw = false;
  try {
    applyNudgeEdit(raw, "addressed task", { note: "try to edit closed" }, "2026-10-01");
  } catch (e: any) {
    threw = true;
    ok("terminal-status row not editable", e.message.includes("no open/in_progress"));
  }
  if (!threw) ok("terminal-status row not editable", false);
}

{
  const raw = makeTable(row("clear due date", "open", "P2", "", "2026-12-01"));
  const { updated } = applyNudgeEdit(raw, "clear due date", { due: "" }, "2026-10-01");
  const cells = updated.split("\n").find((l) => l.includes("clear due date"))?.split("|") ?? [];
  const dueCell = (cells[8] ?? "").trim();
  ok("due date cleared when empty string passed", dueCell === "");
}

{
  const raw = makeTable(row("rename me"));
  const { updated, matchedGoal } = applyNudgeEdit(raw, "rename me", { new_goal: "renamed goal" }, "2026-10-01");
  ok("goal renamed in row", updated.includes("renamed goal"));
  ok("matchedGoal returns new goal after rename", matchedGoal === "renamed goal");
}

{
  const raw = makeTable(row("append me", "open", "P2", "existing note"));
  const { updated } = applyNudgeEdit(raw, "append me", { append_note: "extra bit" }, "2026-10-01");
  ok("append_note joins existing note", updated.includes("existing note extra bit"));
}

// ─── filterRetiredPatterns ──────────────────────────────────────────────────

{
  const content = `
# Patterns

### Active pattern
<!-- source: type=behavior subject=coding synthesized=2026-09-01 -->
- **First noticed:** 2026-01-01
- **Evidence:** codes every day

### Retired pattern
<!-- source: type=behavior subject=gym synthesized=2026-06-01 -->
- **First noticed:** 2026-01-01
- **Evidence:** used to go
> **RETIRED 2026-09-15:** no longer accurate
`;
  const filtered = filterRetiredPatterns(content);
  ok("active pattern kept", filtered.includes("Active pattern"));
  ok("retired pattern removed", !filtered.includes("Retired pattern"));
  ok("preamble preserved", filtered.includes("# Patterns"));
}

{
  const content = "# Patterns\n\n(no patterns yet)\n";
  const filtered = filterRetiredPatterns(content);
  ok("empty pattern file unchanged", filtered === content);
}

// ─── summary ─────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
