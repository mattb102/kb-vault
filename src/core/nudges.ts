/**
 * Nudge-table helpers for display and scheduling logic. Used by the morning
 * report plugin and the nudge-decay script.
 */

import { parseDue, isDueOn, daysOverdue, describeDue } from "./due.js";
import { today } from "./utils.js";

export interface NudgeRow {
  goal: string;
  status: string;
  priority: string;
  note: string;
  /** Raw Due cell: "" | YYYY-MM-DD | recur token */
  due: string;
}

/**
 * Parse one table row into a NudgeRow. Returns null for header, separator, or
 * non-active rows. Handles both 7-column legacy rows (no Due) and 8-column rows.
 * Uses unescaped-pipe splitting so escaped pipes inside goal/note cells don't
 * shift column indices.
 */
export function parseNudgeRow(line: string): NudgeRow | null {
  if (!line.trimStart().startsWith("|")) return null;
  const cells = line.split(/(?<!\\)\|/).map((c) => c.trim());
  const status = (cells[4] || "").toLowerCase();
  if (status !== "open" && status !== "in_progress") return null;
  return {
    goal: (cells[1] || "").replace(/\\\|/g, "|"),
    status,
    priority: (cells[5] || "").toUpperCase(),
    note: (cells[6] || "").replace(/<br>/g, " "),
    // Due sits at index 8 (after resolution at 7); absent in legacy 7-col rows.
    due: cells.length >= 10 ? (cells[8] || "") : "",
  };
}

function renderNudge(r: NudgeRow, marker?: string): string {
  const note = r.note.slice(0, 260);
  const head = `- [${r.priority}] ${r.goal}${marker ? ` — ${marker}` : ""}`;
  return `${head}${note ? `\n    context: ${note}` : ""}`;
}

const rankOfPriority = (p: string): number =>
  ({ P0: 0, P1: 1, P2: 2, P3: 3 } as Record<string, number>)[p] ?? 2;

/**
 * Rank the top open nudges for a report, capped at `limit`. Ordering:
 *   a. OVERDUE dated items (due date strictly before today), most overdue first
 *   b. DUE TODAY — dated-for-today or a recurrence token matching today
 *   c. DUE SOON — dated items due within the next 7 days
 *   d. Undated P0/P1 items, by priority
 *
 * Undated P2/P3 items are not surfaced unless there are no dated items at all
 * (fallback mode), keeping the report focused on what's actually scheduled.
 * If no nudge has a due date, falls back to returning the top `limit` rows
 * sorted by priority (preserving legacy behavior for vaults without due dates).
 */
export function topNudges(nudgesTable: string | null, limit = 5): string | null {
  if (!nudgesTable) return null;
  const iso = today();
  const rows = nudgesTable
    .split("\n")
    .map(parseNudgeRow)
    .filter((r): r is NudgeRow => r !== null);
  if (!rows.length) return null;

  const hasDueDates = rows.some((r) => parseDue(r.due).kind !== "none");

  if (!hasDueDates) {
    // Legacy fallback: no due dates anywhere — sort by priority and return top N.
    const sorted = [...rows].sort(
      (a, b) => rankOfPriority(a.priority) - rankOfPriority(b.priority),
    );
    return sorted
      .slice(0, limit)
      .map((r) => renderNudge(r))
      .join("\n");
  }

  const overdue: { r: NudgeRow; over: number }[] = [];
  const dueToday: NudgeRow[] = [];
  const dueSoon: { r: NudgeRow; daysUntil: number }[] = [];
  const undated: NudgeRow[] = [];

  for (const r of rows) {
    const over = daysOverdue(r.due, iso);
    if (over !== null && over > 0) {
      overdue.push({ r, over });
    } else if (isDueOn(r.due, iso)) {
      dueToday.push(r);
    } else if (over !== null && over < 0 && over >= -7) {
      dueSoon.push({ r, daysUntil: -over });
    } else if (parseDue(r.due).kind === "none" && (r.priority === "P0" || r.priority === "P1")) {
      undated.push(r);
    }
  }

  overdue.sort((a, b) => b.over - a.over);
  dueSoon.sort((a, b) => a.daysUntil - b.daysUntil);
  undated.sort((a, b) => rankOfPriority(a.priority) - rankOfPriority(b.priority));

  const ordered: string[] = [
    ...overdue.map(({ r }) => renderNudge(r, describeDue(r.due, iso))),
    ...dueToday.map((r) => renderNudge(r, describeDue(r.due, iso))),
    ...dueSoon.map(({ r }) => renderNudge(r, `coming up — ${describeDue(r.due, iso)}`)),
    ...undated.map((r) => renderNudge(r)),
  ];
  if (!ordered.length) return null;
  return ordered.slice(0, limit).join("\n");
}
