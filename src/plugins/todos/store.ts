/**
 * To-do store — a single JSON file (data/todos.json) that is the ONLY source of
 * truth for day-specific tasks. No markdown mirror, no per-week checklist files:
 * every read and write goes through here, so views can never drift.
 *
 * Concepts:
 *  - show_from   first day the item appears. An unfinished item keeps showing on
 *                "today" until it is checked or deleted (implicit rollover).
 *  - must_from   flex until this date, "must" on/after it. A must that lapses
 *                (must_from < today, never checked) is demoted to flex and the
 *                lapse is kept in must_missed so the UI can say "(missed MM/DD)".
 *  - recurrence  daily / weekly / monthly seed. Checking advances show_from to
 *                the next cycle and records a dated progress entry; the item
 *                itself stays open.
 */
import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname, join } from "path";

export type TodoStatus = "open" | "done" | "deleted";

export interface RecurrenceRule {
  rule: "daily" | "weekly" | "monthly";
  /** 0=Sun … 6=Sat (weekly) */
  weekday?: number;
  /** 1–31 (monthly) */
  day_of_month?: number;
  /** Days between show_from and must_from each cycle (0 = must on the day itself) */
  must_offset_days?: number;
}

export interface ProgressEntry {
  date: string; // YYYY-MM-DD
  note: string;
}

export interface TodoItem {
  id: string;
  title: string;
  status: TodoStatus;
  show_from?: string;
  must_from?: string;
  must_missed?: string;
  time?: string; // HH:MM local
  recurrence?: RecurrenceRule;
  resolution?: string;
  progress?: ProgressEntry[];
  created_at: string;
  updated_at: string;
  closed_at?: string;
}

export interface TodoStore {
  version: number;
  items: TodoItem[];
}

export const STORE_PATH = join(process.cwd(), "data", "todos.json");

export async function loadStore(): Promise<TodoStore> {
  try {
    return JSON.parse(await readFile(STORE_PATH, "utf-8"));
  } catch {
    return { version: 1, items: [] };
  }
}

export async function saveStore(store: TodoStore): Promise<void> {
  await mkdir(dirname(STORE_PATH), { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(store, null, 2));
}

export function newId(): string {
  return `todo_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// ── Date helpers ─────────────────────────────────────────────────────────────

export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Local calendar date (YYYY-MM-DD) of an ISO timestamp, in the configured time zone. */
export function localDateOf(iso: string | undefined, timeZone: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return undefined;
  return d.toLocaleDateString("en-CA", { timeZone });
}

// ── Recurrence ───────────────────────────────────────────────────────────────

export function computeMustFrom(showFrom: string, offsetDays: number): string {
  return offsetDays === 0 ? showFrom : addDays(showFrom, offsetDays);
}

/** show_from of the cycle that is current on `today`. */
export function currentCycleShowFrom(rule: RecurrenceRule, today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  if (rule.rule === "daily") return today;
  if (rule.rule === "weekly") {
    const target = rule.weekday ?? 1;
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return addDays(today, -((dow - target + 7) % 7));
  }
  const dom = rule.day_of_month ?? 1;
  const thisMonth = `${y}-${String(m).padStart(2, "0")}-${String(dom).padStart(2, "0")}`;
  if (thisMonth <= today) return thisMonth;
  const pm = m === 1 ? 12 : m - 1;
  const py = m === 1 ? y - 1 : y;
  return `${py}-${String(pm).padStart(2, "0")}-${String(dom).padStart(2, "0")}`;
}

export function nextCycleShowFrom(rule: RecurrenceRule, current: string): string {
  const [y, m] = current.split("-").map(Number);
  if (rule.rule === "daily") return addDays(current, 1);
  if (rule.rule === "weekly") return addDays(current, 7);
  const dom = rule.day_of_month ?? 1;
  const nm = m === 12 ? 1 : m + 1;
  const ny = m === 12 ? y + 1 : y;
  return `${ny}-${String(nm).padStart(2, "0")}-${String(dom).padStart(2, "0")}`;
}

export function prevCycleShowFrom(rule: RecurrenceRule, current: string): string {
  const [y, m] = current.split("-").map(Number);
  if (rule.rule === "daily") return addDays(current, -1);
  if (rule.rule === "weekly") return addDays(current, -7);
  const dom = rule.day_of_month ?? 1;
  const pm = m === 1 ? 12 : m - 1;
  const py = m === 1 ? y - 1 : y;
  return `${py}-${String(pm).padStart(2, "0")}-${String(dom).padStart(2, "0")}`;
}

// ── Pure item transitions (unit-testable; the plugin wraps them in load/save) ──

export function applyCheck(item: TodoItem, today: string, onDate?: string, resolution?: string): TodoItem {
  const now = new Date().toISOString();
  if (item.recurrence) {
    const current = item.show_from ?? currentCycleShowFrom(item.recurrence, today);
    const next = nextCycleShowFrom(item.recurrence, current);
    return {
      ...item,
      status: "open",
      show_from: next,
      must_from: item.recurrence.must_offset_days !== undefined ? computeMustFrom(next, item.recurrence.must_offset_days) : undefined,
      must_missed: undefined,
      resolution: undefined,
      progress: [...(item.progress ?? []), { date: onDate ?? today, note: `Completed${resolution ? ": " + resolution : ""}` }],
      updated_at: now,
    };
  }
  return { ...item, status: "done", resolution, closed_at: now, updated_at: now };
}

export function applyUncheck(item: TodoItem, today: string): TodoItem {
  const now = new Date().toISOString();
  if (item.recurrence) {
    const progress = [...(item.progress ?? [])];
    progress.pop();
    const prev = prevCycleShowFrom(item.recurrence, item.show_from ?? today);
    return {
      ...item,
      status: "open",
      show_from: prev,
      must_from: item.recurrence.must_offset_days !== undefined ? computeMustFrom(prev, item.recurrence.must_offset_days) : item.must_from,
      progress,
      updated_at: now,
    };
  }
  return { ...item, status: "open", resolution: undefined, closed_at: undefined, updated_at: now };
}

export function applyDelete(item: TodoItem): TodoItem {
  const now = new Date().toISOString();
  return { ...item, status: "deleted", closed_at: now, updated_at: now };
}

export function applyMove(item: TodoItem, toDate: string): TodoItem {
  return {
    ...item,
    show_from: toDate,
    must_from: item.must_from ? toDate : undefined,
    must_missed: undefined,
    updated_at: new Date().toISOString(),
  };
}

/** A recurring item whose cycle fell behind snaps to the cycle current today. */
export function catchUpRecurringItem(item: TodoItem, today: string): TodoItem | null {
  if (item.status !== "open" || !item.recurrence || !item.show_from) return null;
  const current = currentCycleShowFrom(item.recurrence, today);
  if (item.show_from >= current) return null;
  const off = item.recurrence.must_offset_days;
  return { ...item, show_from: current, must_from: off !== undefined ? computeMustFrom(current, off) : item.must_from, updated_at: new Date().toISOString() };
}

export async function catchUpRecurring(today: string): Promise<TodoItem[]> {
  const store = await loadStore();
  const moved: TodoItem[] = [];
  store.items = store.items.map((it) => { const n = catchUpRecurringItem(it, today); if (n) moved.push(n); return n ?? it; });
  if (moved.length) await saveStore(store);
  return moved;
}

/** A one-off must whose day has passed becomes flex; the lapse is recorded in must_missed. */
export function demoteIfLapsed(item: TodoItem, today: string): TodoItem | null {
  if (item.status !== "open" || !item.must_from || item.recurrence) return null;
  if (item.must_from >= today) return null;
  return { ...item, must_from: undefined, must_missed: item.must_from, updated_at: new Date().toISOString() };
}

/** Run demoteIfLapsed over the whole store. Returns the demoted items. */
export async function demotePastMusts(today: string): Promise<TodoItem[]> {
  const store = await loadStore();
  const demoted: TodoItem[] = [];
  store.items = store.items.map((it) => {
    const next = demoteIfLapsed(it, today);
    if (next) demoted.push(next);
    return next ?? it;
  });
  if (demoted.length) await saveStore(store);
  return demoted;
}
