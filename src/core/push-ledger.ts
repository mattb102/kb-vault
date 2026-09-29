/**
 * Shared push ledger — single source of truth for every web-push sent.
 *
 * Backs onto data/push-ledger.json (alongside the vector index). Every push
 * script and the send_phone_notification MCP tool write here so cap, gap, and
 * no-repeat checks can be evaluated across sources.
 *
 * Concurrency: recordSend holds a lockfile and writes atomically via a .tmp
 * file + rename so concurrent cron scripts never corrupt the JSON.
 */
import { readFile, writeFile, mkdir, open, unlink, stat, rename } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

export const DEFAULT_LEDGER_FILE = path.join(
  path.dirname(config.dbPath),
  "push-ledger.json",
);

const LOCK_STALE_MS = 30_000;
const LOCK_RETRIES = 10;
const LOCK_RETRY_MS = 75;

export interface LedgerEntry {
  ts: string;
  goal: string;
  source?: string;
  title?: string;
}

/** Eastern-time breakdown — shared so scripts don't duplicate it. */
export function eastern(d: Date = new Date()): { date: string; hour: number; weekday: string } {
  const parts: Record<string, string> = {};
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "long",
  });
  for (const p of fmt.formatToParts(d)) parts[p.type] = p.value;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour) % 24,
    weekday: parts.weekday,
  };
}

export async function loadLedger(filePath: string = DEFAULT_LEDGER_FILE): Promise<LedgerEntry[]> {
  try {
    const s = JSON.parse(await readFile(filePath, "utf-8"));
    return Array.isArray(s?.sends) ? (s.sends as LedgerEntry[]) : [];
  } catch {
    return [];
  }
}

async function acquireLock(lockFile: string): Promise<void> {
  for (let i = 0; i < LOCK_RETRIES; i++) {
    try {
      const fh = await open(lockFile, "wx");
      await fh.writeFile(String(process.pid));
      await fh.close();
      return;
    } catch (e: any) {
      if (e?.code !== "EEXIST") throw e;
      try {
        const s = await stat(lockFile);
        if (Date.now() - s.mtimeMs > LOCK_STALE_MS) {
          await unlink(lockFile);
          continue;
        }
      } catch { /* lock disappeared between check and stat — retry */ }
      await new Promise<void>((r) => setTimeout(r, LOCK_RETRY_MS));
    }
  }
  throw new Error(`Could not acquire lock ${lockFile} after ${LOCK_RETRIES} retries`);
}

async function releaseLock(lockFile: string): Promise<void> {
  try { await unlink(lockFile); } catch { /* already gone */ }
}

export async function recordSend(
  entry: { goal: string; title?: string; source: string },
  filePath: string = DEFAULT_LEDGER_FILE,
): Promise<void> {
  const lockFile = filePath + ".lock";
  await mkdir(path.dirname(filePath), { recursive: true });
  await acquireLock(lockFile);
  try {
    let existing: LedgerEntry[] = [];
    try {
      const s = JSON.parse(await readFile(filePath, "utf-8"));
      existing = Array.isArray(s?.sends) ? (s.sends as LedgerEntry[]) : [];
    } catch { /* missing or corrupt — start fresh */ }

    const newEntry: LedgerEntry = {
      ts: new Date().toISOString(),
      goal: entry.goal,
      source: entry.source,
      ...(entry.title !== undefined ? { title: entry.title } : {}),
    };
    existing.push(newEntry);

    const tmp = filePath + `.tmp.${process.pid}`;
    await writeFile(tmp, JSON.stringify({ sends: existing }, null, 2));
    await rename(tmp, filePath);
  } finally {
    await releaseLock(lockFile);
  }
}

export function sendsOnEasternDate(entries: LedgerEntry[], etDate: string): LedgerEntry[] {
  return entries.filter((e) => eastern(new Date(e.ts)).date === etDate);
}

/** Count distinct push topics, not raw sends. One nudge ladder = one interruption. */
export function distinctGoalsOnEasternDate(entries: LedgerEntry[], etDate: string): Set<string> {
  return new Set(sendsOnEasternDate(entries, etDate).map((e) => e.goal));
}

export function lastSend(entries: LedgerEntry[]): LedgerEntry | undefined {
  return entries[entries.length - 1];
}

export function goalsWithinDays(entries: LedgerEntry[], days: number): Set<string> {
  const cutoff = Date.now() - days * 86_400_000;
  return new Set(entries.filter((e) => new Date(e.ts).getTime() > cutoff).map((e) => e.goal));
}

// ─── POLICY ────────────────────────────────────────────────────────────────
// Read push policy from the ios_app plugin config with env-var overrides.
// These are shared by nudge-push.ts and any other automated push script.

export interface PushPolicy {
  /** Max distinct push topics per Eastern day. 0 = unlimited. */
  dailyCap: number;
  /** Min minutes between any two pushes from any source. */
  minGapMinutes: number;
  /** Days before the same goal topic can push again. */
  noRepeatDays: number;
  /** Earliest Eastern hour (inclusive) at which automated pushes may go out. */
  startHour: number;
  /** Latest Eastern hour (inclusive) at which automated pushes may go out. */
  endHour: number;
}

export function pushPolicy(): PushPolicy {
  const raw = (config.pluginConfig?.ios_app?.push as Record<string, any>) ?? {};
  return {
    dailyCap:       Number(process.env.PUSH_DAILY_CAP       ?? raw.dailyCap       ?? 3),
    minGapMinutes:  Number(process.env.PUSH_MIN_GAP_MIN      ?? raw.minGapMinutes  ?? 60),
    noRepeatDays:   Number(process.env.PUSH_NO_REPEAT_DAYS   ?? raw.noRepeatDays   ?? 14),
    startHour:      Number(process.env.PUSH_START_HOUR       ?? raw.startHour      ?? 9),
    endHour:        Number(process.env.PUSH_END_HOUR         ?? raw.endHour        ?? 21),
  };
}
