/**
 * Push notification queue -- persistent store for scheduled web-push deliveries.
 *
 * Backing store: data/push-queue.json (atomic write via .tmp + rename).
 * Locking: data/push-queue.json.lock for queue mutations (same pattern as push-ledger.ts).
 */
import { readFile, writeFile, mkdir, open, unlink, stat, rename } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export const QUEUE_FILE = path.join(process.cwd(), "data", "push-queue.json");

const LOCK_STALE_MS = 30_000;
const LOCK_RETRIES = 10;
const LOCK_RETRY_MS = 75;

export type PushStatus = "pending" | "sent" | "failed" | "cancelled";

export interface PushQueueItem {
  id: string;
  title: string;
  body: string;
  url: string;
  fire_at: string;      // UTC ISO -- when to send
  created_at: string;   // UTC ISO
  status: PushStatus;
  last_error?: string;
  sent_at?: string;     // UTC ISO -- when it was actually sent
}

// ─── ET datetime parsing ─────────────────────────────────────────────────────

/**
 * Parse a naive America/New_York datetime string like "2026-10-07T18:00:00"
 * (no offset, no Z) into a UTC Date.
 *
 * DST-aware: tries EST (UTC-5) first, then EDT (UTC-4). For ambiguous times
 * during the fall-back hour, picks the second occurrence (post-transition = EST).
 * Throws on any offset/Z suffix or invalid format.
 */
export function parseEasternNaive(str: string): Date {
  if (/Z$/.test(str) || /[+-]\d{2}:?\d{2}$/.test(str)) {
    throw new Error(
      `Offset/timezone found in "${str}" -- pass a naive ET time like "2026-10-07T18:00:00" (no Z or +/-HH:MM).`
    );
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(str);
  if (!m) {
    throw new Error(
      `Invalid format "${str}" -- expected YYYY-MM-DDTHH:MM:SS (e.g. "2026-10-07T18:00:00").`
    );
  }
  const year = parseInt(m[1]), month = parseInt(m[2]), day = parseInt(m[3]);
  const hour = parseInt(m[4]), min = parseInt(m[5]), sec = parseInt(m[6]);

  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });

  for (const offsetH of [5, 4]) {
    const candidate = new Date(
      Date.UTC(year, month - 1, day, hour + offsetH, min, sec)
    );
    const p: Record<string, string> = {};
    for (const part of fmt.formatToParts(candidate)) p[part.type] = part.value;
    if (
      parseInt(p.year) === year &&
      parseInt(p.month) === month &&
      parseInt(p.day) === day &&
      parseInt(p.hour) % 24 === hour &&
      parseInt(p.minute) === min &&
      parseInt(p.second) === sec
    ) {
      return candidate;
    }
  }
  throw new Error(`Could not interpret "${str}" as an America/New_York time.`);
}

/** Render a UTC Date as a human-readable ET string, e.g. "10/07/2026, 06:00 PM ET". */
export function formatEastern(date: Date): string {
  return (
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
      hour12: true,
    }).format(date) + " ET"
  );
}

// ─── Predicates ──────────────────────────────────────────────────────────────

/** Returns true if the item should be delivered now. */
export function isDue(item: PushQueueItem, now: Date = new Date()): boolean {
  return item.status === "pending" && new Date(item.fire_at) <= now;
}

// ─── Storage ─────────────────────────────────────────────────────────────────

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
      } catch {
        /* disappeared between check and stat -- retry */
      }
      await new Promise<void>((r) => setTimeout(r, LOCK_RETRY_MS));
    }
  }
  throw new Error(
    `Could not acquire lock ${lockFile} after ${LOCK_RETRIES} retries`
  );
}

async function releaseLock(lockFile: string): Promise<void> {
  try {
    await unlink(lockFile);
  } catch {
    /* already gone */
  }
}

export async function loadQueue(
  filePath: string = QUEUE_FILE
): Promise<PushQueueItem[]> {
  try {
    const s = JSON.parse(await readFile(filePath, "utf-8"));
    return Array.isArray(s?.items) ? (s.items as PushQueueItem[]) : [];
  } catch {
    return [];
  }
}

async function saveQueue(
  items: PushQueueItem[],
  filePath: string
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = filePath + `.tmp.${process.pid}`;
  await writeFile(tmp, JSON.stringify({ items }, null, 2));
  await rename(tmp, filePath);
}

// ─── Mutations (all under queue lock) ────────────────────────────────────────

export async function addItem(
  item: Omit<PushQueueItem, "id" | "created_at" | "status">,
  filePath: string = QUEUE_FILE
): Promise<PushQueueItem> {
  const lockFile = filePath + ".lock";
  await mkdir(path.dirname(filePath), { recursive: true });
  await acquireLock(lockFile);
  try {
    const items = await loadQueue(filePath);
    const newItem: PushQueueItem = {
      id: crypto.randomUUID(),
      ...item,
      created_at: new Date().toISOString(),
      status: "pending",
    };
    items.push(newItem);
    await saveQueue(items, filePath);
    return newItem;
  } finally {
    await releaseLock(lockFile);
  }
}

export async function updateItem(
  id: string,
  patch: Partial<Pick<PushQueueItem, "status" | "last_error" | "sent_at">>,
  filePath: string = QUEUE_FILE
): Promise<void> {
  const lockFile = filePath + ".lock";
  await acquireLock(lockFile);
  try {
    const items = await loadQueue(filePath);
    const idx = items.findIndex((x) => x.id === id);
    if (idx === -1) throw new Error(`Push queue item not found: ${id}`);
    items[idx] = { ...items[idx], ...patch };
    await saveQueue(items, filePath);
  } finally {
    await releaseLock(lockFile);
  }
}
