import { readFile, readdir } from "fs/promises";
import { join } from "path";
import matter from "gray-matter";
import { config } from "./config.js";

export const SCRATCHPAD_REL = "AI-Observations/scratchpad.md";
export const PATTERNS_REL = "AI-Observations/patterns.md";
export const OBS_DIR_REL = "AI-Observations";
export const ARCHIVE_PREFIX = "scratchpad-archive-";
const ARCHIVE_FILE_RE = /^scratchpad-archive-(\d{4}-\d{2})\.md$/;

export interface Entry {
  timestamp: string;
  date: Date;
  type: string;
  subject: string;
  supersedes?: string;
  headerLine: string;
  body: string;
}

const HEADER_RE =
  /^### (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) \| type: ([^|]+?) \| subject: ([^|\n]+?)(?:\s*\|\s*supersedes:\s*([^\n]+?))?\s*$/;

export function parseScratchpad(body: string): { preamble: string; entries: Entry[] } {
  const lines = body.split("\n");
  const entries: Entry[] = [];
  let preambleEnd = lines.length;
  let current: Entry | null = null;
  let currentBody: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(HEADER_RE);
    if (m) {
      if (current) {
        current.body = currentBody.join("\n").replace(/\s+$/, "");
        entries.push(current);
      } else {
        preambleEnd = i;
      }
      const [, date, time, type, subject, supersedes] = m;
      current = {
        timestamp: `${date} ${time}`,
        date: new Date(`${date}T${time}:00`),
        type: type.trim(),
        subject: subject.trim(),
        supersedes: supersedes?.trim(),
        headerLine: line,
        body: "",
      };
      currentBody = [];
    } else if (current) {
      currentBody.push(line);
    }
  }
  if (current) {
    current.body = currentBody.join("\n").replace(/\s+$/, "");
    entries.push(current);
  }

  const preamble = lines.slice(0, preambleEnd).join("\n").replace(/\s+$/, "");
  return { preamble, entries };
}

export function renderEntry(e: Entry): string {
  return `${e.headerLine}\n${e.body}`.replace(/\s+$/, "");
}

export async function readScratchpad(): Promise<{
  path: string;
  frontmatter: Record<string, unknown>;
  preamble: string;
  entries: Entry[];
}> {
  const path = join(config.vaultPath, SCRATCHPAD_REL);
  const raw = await readFile(path, "utf-8");
  const parsed = matter(raw);
  const { preamble, entries } = parseScratchpad(parsed.content);
  return { path, frontmatter: parsed.data, preamble, entries };
}

// ─── calendar-month archiving ────────────────────────────────────────────────
//
// The live scratchpad holds only the CURRENT calendar month (America/New_York).
// scripts/decay-scratchpad.ts moves older entries into
// AI-Observations/scratchpad-archive-YYYY-MM.md, one file per month. Readers
// that want a date-bounded recent window must splice back the archive months
// their window reaches into (see readScratchpadEntries) -- early in a month the
// live file alone would be nearly empty.

/** Calendar month (YYYY-MM) of a Date in America/New_York. */
export function monthET(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" }).slice(0, 7);
}

/** Current calendar month (YYYY-MM) in America/New_York. */
export function currentMonthET(): string {
  return monthET(new Date());
}

/** Calendar month (YYYY-MM, ET) of the day `days` before now. */
export function monthDaysAgoET(days: number): string {
  return monthET(new Date(Date.now() - days * 86_400_000));
}

/**
 * Of the archive month keys present on disk, the ones a reader must read to
 * cover a window reaching back to `sinceMonth`: months >= sinceMonth and <
 * currentMonth (archives never hold the current month -- that's the live file).
 * Pure; returns ascending.
 */
export function archiveMonthsInWindow(
  available: string[],
  sinceMonth: string,
  currentMonth: string,
): string[] {
  return available.filter((m) => m >= sinceMonth && m < currentMonth).sort();
}

/**
 * Split live entries into those belonging to the current calendar month (kept)
 * and those from earlier months (to archive), grouped by each entry's own
 * stamped month (YYYY-MM). An entry is archived iff its stamped month is
 * strictly before `currentMonth` (YYYY-MM, ET). Pure.
 */
export function partitionForDecay(
  entries: Entry[],
  currentMonth: string,
): { kept: Entry[]; byMonth: Map<string, Entry[]> } {
  const kept: Entry[] = [];
  const byMonth = new Map<string, Entry[]>();
  for (const e of entries) {
    const m = e.timestamp.slice(0, 7);
    if (m < currentMonth) {
      if (!byMonth.has(m)) byMonth.set(m, []);
      byMonth.get(m)!.push(e);
    } else {
      kept.push(e);
    }
  }
  return { kept, byMonth };
}

/**
 * Merge two sets of entries, de-duplicating by rendered content (header + body)
 * and returning them in chronological order (oldest first). Used both to splice
 * archive months into a reader's window and to fold freshly-decayed entries into
 * an existing archive file idempotently (running decay twice is a no-op).
 */
export function mergeArchiveEntries(a: Entry[], b: Entry[]): Entry[] {
  const seen = new Set<string>();
  const out: Entry[] = [];
  for (const e of [...a, ...b]) {
    const key = renderEntry(e);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  out.sort((x, y) => x.timestamp.localeCompare(y.timestamp));
  return out;
}

/** The archive month keys (YYYY-MM) present in the vault, ascending. */
export async function listArchiveMonths(): Promise<string[]> {
  const dir = join(config.vaultPath, OBS_DIR_REL);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  return names
    .map((n) => n.match(ARCHIVE_FILE_RE)?.[1])
    .filter((m): m is string => Boolean(m))
    .sort();
}

/** Absolute path of one archive month file. */
export function archiveMonthPath(month: string): string {
  return join(config.vaultPath, OBS_DIR_REL, `${ARCHIVE_PREFIX}${month}.md`);
}

/** Parse the entries out of one archive month file. Returns [] if missing. */
export async function readArchiveMonthEntries(month: string): Promise<Entry[]> {
  try {
    const raw = await readFile(archiveMonthPath(month), "utf-8");
    return parseScratchpad(matter(raw).content).entries;
  } catch {
    return [];
  }
}

/**
 * Read scratchpad entries spanning the live file PLUS any monthly archive files
 * whose month falls within the caller's window. Use this (not readScratchpad)
 * anywhere a date-bounded view of recent observations is needed: the live file
 * holds only the current calendar month, so early in a month a reader touching
 * only the live file would lose all prior-month context.
 *
 * `sinceDays` -- how far back the caller's window reaches. Archive months from
 * the month `sinceDays` ago through last month are merged in. Omit to read only
 * the live file (callers that rewrite the live file, e.g. decay, must omit it).
 *
 * Entries are de-duplicated by rendered content and returned chronologically.
 */
export async function readScratchpadEntries(
  opts: { sinceDays?: number } = {},
): Promise<Entry[]> {
  const { entries: live } = await readScratchpad();
  if (opts.sinceDays === undefined) return live;

  const months = archiveMonthsInWindow(
    await listArchiveMonths(),
    monthDaysAgoET(opts.sinceDays),
    currentMonthET(),
  );
  if (months.length === 0) return live;

  const archived: Entry[] = [];
  for (const m of months) archived.push(...(await readArchiveMonthEntries(m)));
  return mergeArchiveEntries(archived, live);
}
