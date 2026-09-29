/**
 * The Due column on the nudges table holds one of three things:
 *
 *   ""            open-ended intention, or a standing constraint. Never due,
 *                 never expires.
 *   "2026-08-23"  a dated task.
 *   "daily" | "weekdays" | "mon".."sun"   a recurring practice.
 *
 * Recurring rows must never auto-expire. Expiring "every Monday" the day after
 * a Monday would delete a standing commitment from a system whose entire job is
 * not losing things.
 */

export type RecurToken =
  | "daily" | "weekdays"
  | "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type Due =
  | { kind: "none" }
  | { kind: "date"; date: string }
  | { kind: "recur"; recur: RecurToken };

const DAYS: RecurToken[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const RECUR: Set<string> = new Set<string>(["daily", "weekdays", ...DAYS]);

export function parseDue(raw: string | undefined): Due {
  const v = (raw || "").trim().toLowerCase();
  if (!v) return { kind: "none" };
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return { kind: "date", date: v };
  if (RECUR.has(v)) return { kind: "recur", recur: v as RecurToken };
  return { kind: "none" }; // unrecognised: treat as undated rather than guessing
}

function utc(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function weekdayOf(iso: string): RecurToken {
  return DAYS[new Date(utc(iso)).getUTCDay()];
}

/** Is this row live on the given date? Dated rows stay live once overdue. */
export function isDueOn(raw: string | undefined, iso: string): boolean {
  const due = parseDue(raw);
  if (due.kind === "none") return false;
  if (due.kind === "date") return due.date <= iso;
  if (due.recur === "daily") return true;
  const wd = weekdayOf(iso);
  if (due.recur === "weekdays") return wd !== "sat" && wd !== "sun";
  return due.recur === wd;
}

/** Days past a dated due. null for recurring and undated rows, which never expire. */
export function daysOverdue(raw: string | undefined, iso: string): number | null {
  const due = parseDue(raw);
  if (due.kind !== "date") return null;
  return Math.floor((utc(iso) - utc(due.date)) / 86400000);
}

/** Human phrasing for prompts and reports. */
export function describeDue(raw: string | undefined, iso: string): string {
  const due = parseDue(raw);
  if (due.kind === "none") return "no date";
  if (due.kind === "recur") return `recurring: ${due.recur}`;
  const n = daysOverdue(raw, iso) as number;
  if (n === 0) return "due today";
  if (n > 0) return `overdue by ${n} day${n === 1 ? "" : "s"}`;
  return `due in ${-n} day${-n === 1 ? "" : "s"} (${due.date})`;
}
