/**
 * Push queue poller -- runs every minute via cron-push-queue.sh.
 *
 * Finds pending queue items whose fire_at <= now, sends each via web-push,
 * marks sent/failed, records successful sends in the shared push ledger.
 *
 * A per-process lockfile (data/push-queue-poller.lock) prevents double-send
 * when two cron runs overlap. The shell wrapper also uses `flock -n` as a
 * second layer.
 */
import { open, unlink, stat, mkdir } from "node:fs/promises";
import path from "node:path";

import { sendPush } from "../src/plugins/ios_app/logic.js";
import { recordSend } from "../src/core/push-ledger.js";
import {
  QUEUE_FILE,
  loadQueue,
  updateItem,
  isDue,
  type PushQueueItem,
} from "../src/core/push-queue.js";

export const POLLER_LOCK_FILE = path.join(
  process.cwd(),
  "data",
  "push-queue-poller.lock"
);

const LOCK_STALE_MS = 120_000; // 2 min -- poller should finish well within this

type SendFn = (
  title: string,
  body: string,
  url: string
) => Promise<{ sent: number; pruned: number; failed: number }>;

type RecordFn = (entry: {
  goal: string;
  title?: string;
  source: string;
}) => Promise<void>;

/** Try to acquire the poller lock (fail-fast, no retry). */
async function tryAcquirePollerLock(lockFile: string): Promise<boolean> {
  await mkdir(path.dirname(lockFile), { recursive: true });
  try {
    const fh = await open(lockFile, "wx");
    await fh.writeFile(String(process.pid));
    await fh.close();
    return true;
  } catch (e: any) {
    if (e?.code !== "EEXIST") throw e;
    try {
      const s = await stat(lockFile);
      if (Date.now() - s.mtimeMs > LOCK_STALE_MS) {
        await unlink(lockFile);
        const fh = await open(lockFile, "wx");
        await fh.writeFile(String(process.pid));
        await fh.close();
        return true;
      }
    } catch {
      /* lock disappeared between check and stat */
    }
    return false;
  }
}

async function releasePollerLock(lockFile: string): Promise<void> {
  try {
    await unlink(lockFile);
  } catch {
    /* already gone */
  }
}

export interface PollerResult {
  sent: number;
  failed: number;
  skipped: number;
  locked: boolean; // true if skipped because another poller was running
}

/**
 * Run one poll cycle: find due items, send them, update statuses.
 * Exported so tests can inject a mock sendFn.
 */
export async function runPoller(opts: {
  queueFile?: string;
  pollerLockFile?: string;
  sendFn?: SendFn;
  recordFn?: RecordFn;
  now?: Date;
} = {}): Promise<PollerResult> {
  const queueFile = opts.queueFile ?? QUEUE_FILE;
  const lockFile = opts.pollerLockFile ?? POLLER_LOCK_FILE;
  const sendFn = opts.sendFn ?? sendPush;
  const _recordFn = opts.recordFn ?? recordSend;
  const now = opts.now ?? new Date();

  const acquired = await tryAcquirePollerLock(lockFile);
  if (!acquired) {
    console.log("[push-queue-poller] lock busy -- another poller is running, skipping");
    return { sent: 0, failed: 0, skipped: 0, locked: true };
  }

  try {
    const items = await loadQueue(queueFile);
    const due = items.filter((item) => isDue(item, now));
    const skipped = items.filter(
      (item) => item.status === "pending" && !isDue(item, now)
    ).length;

    let sent = 0;
    let failed = 0;

    for (const item of due) {
      console.log(
        `[push-queue-poller] sending id=${item.id} title="${item.title}" fire_at=${item.fire_at}`
      );
      try {
        const result = await sendFn(item.title, item.body, item.url);
        console.log(
          `[push-queue-poller] done id=${item.id} sent=${result.sent} pruned=${result.pruned} failed=${result.failed}`
        );
        if (result.failed > 0 && result.sent === 0) {
          await updateItem(
            item.id,
            { status: "failed", last_error: `sent=0 failed=${result.failed}` },
            queueFile
          );
          failed++;
        } else {
          await updateItem(
            item.id,
            { status: "sent", sent_at: new Date().toISOString() },
            queueFile
          );
          if (result.sent > 0) {
            await _recordFn({ goal: item.title, title: item.title, source: "push-queue" });
          }
          sent++;
        }
      } catch (e: any) {
        const msg = String(e?.message || e);
        console.error(`[push-queue-poller] send error id=${item.id}: ${msg}`);
        await updateItem(item.id, { status: "failed", last_error: msg }, queueFile);
        failed++;
      }
    }

    console.log(
      `[push-queue-poller] cycle done sent=${sent} failed=${failed} skipped=${skipped}`
    );
    return { sent, failed, skipped, locked: false };
  } finally {
    await releasePollerLock(lockFile);
  }
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

const isMain =
  process.argv[1]?.endsWith("push-queue-poller.ts") ||
  process.argv[1]?.endsWith("push-queue-poller.js");

if (isMain) {
  runPoller().catch((e) => {
    console.error("[push-queue-poller] fatal:", e);
    process.exit(1);
  });
}
