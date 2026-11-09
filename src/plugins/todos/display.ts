/**
 * Per-day view over the to-do store. The ONLY place that decides what a day shows.
 *
 *  - Past day:   items done that day + recurring cycles completed that day.
 *  - Today:      open items with show_from <= today (unfinished work rolls forward
 *                implicitly) + anything done today.
 *  - Future day: open items whose show_from is exactly that day.
 *  - "(from MM/DD)" / "(missed MM/DD)" are display-only, derived from show_from and
 *    must_missed. Titles in the store stay clean. Recurring items carry no
 *    annotation: a daily you didn't tick yesterday is simply today's.
 */
import { addDays, localDateOf, type TodoItem } from "./store.js";

export interface TodoRow {
  id: string;
  text: string;
  annotation: string | null;
  must: boolean;
  time?: string;
  checked: boolean;
  resolution?: string;
  recurring: boolean;
  recurrence: "daily" | "weekly" | "monthly" | null;
  show_from?: string;
}

export interface TodoDay {
  date: string;
  dayLabel: string;
  items: TodoRow[];
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

const mmdd = (iso: string) => iso.slice(5).replace("-", "/");

function row(item: TodoItem, date: string, today: string, checked: boolean, resolution?: string): TodoRow {
  let annotation: string | null = null;
  if (!checked && date === today && !item.recurrence) {
    if (item.must_missed) annotation = `(missed ${mmdd(item.must_missed)})`;
    else if (item.show_from && item.show_from < today) annotation = `(from ${mmdd(item.show_from)})`;
  }
  return {
    id: item.id,
    text: item.title,
    annotation,
    must: !!item.must_from && item.must_from <= date,
    time: item.time,
    checked,
    resolution: resolution ?? (checked ? item.resolution : undefined),
    recurring: !!item.recurrence,
    recurrence: item.recurrence?.rule ?? null,
    show_from: item.show_from,
  };
}

export function buildTodoDisplay(
  items: TodoItem[],
  opts: { startDate: string; endDate?: string; today: string; timeZone: string },
): TodoDay[] {
  const { startDate, endDate = startDate, today, timeZone } = opts;
  const days: TodoDay[] = [];

  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    const open: TodoRow[] = [];
    const done: TodoRow[] = [];

    for (const item of items) {
      if (item.recurrence && item.status === "open") {
        const p = (item.progress ?? []).find((e) => e.date === date && /^Completed/.test(e.note));
        if (p) done.push(row(item, date, today, true, p.note.replace(/^Completed(?: \(retroactive\))?:?\s*/, "").trim() || undefined));
      }
      if (item.status === "done") {
        if (localDateOf(item.closed_at ?? item.updated_at, timeZone) === date) done.push(row(item, date, today, true));
        continue;
      }
      if (item.status !== "open") continue;
      if (date < today) continue;
      if (date === today) {
        if (!item.show_from || item.show_from <= today) open.push(row(item, date, today, false));
      } else if (item.show_from === date) {
        open.push(row(item, date, today, false));
      }
    }
    days.push({ date, dayLabel: dayLabel(date), items: [...open, ...done] });
  }
  return days;
}

/** Selector = 0-based index into a day's rows, an item id, or a unique title substring. */
export function resolveSelector(rows: TodoRow[], selector: string): TodoRow | null {
  const sel = selector.trim();
  if (/^\d+$/.test(sel)) return rows[parseInt(sel, 10)] ?? null;
  const byId = rows.find((r) => r.id === sel);
  if (byId) return byId;
  const q = sel.toLowerCase();
  const exact = rows.find((r) => r.text.toLowerCase() === q);
  if (exact) return exact;
  const subs = rows.filter((r) => r.text.toLowerCase().includes(q));
  return subs.length === 1 ? subs[0] : null;
}
