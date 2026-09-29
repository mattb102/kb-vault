/**
 * Vault health check — runs a battery of watchdog probes and pushes an alert
 * if anything is broken.
 *
 * Checks (in order):
 *   1. Search alive — probes search_vault through the RUNNING server via the MCP
 *      HTTP transport. Catches the class of failures (stale index, crashed
 *      process) that only show up in-process, not on disk.
 *   2. Reindex freshness — verifies data/last-indexed-rev was written within the
 *      last 2 hours (the reindex cron runs every 10 min; 2h = 12 missed runs).
 *   3. Morning report freshness — if the morning_report plugin is enabled, checks
 *      that Reports/<today>-morning.md (or yesterday's) exists in the vault.
 *
 * Alerts are sent as a push notification via the ios_app plugin when VAPID is
 * configured; failures are always written to stderr regardless.
 *
 * Designed to run on the VPS (HTTP transport). Silently no-ops on stdio
 * transport since there is no HTTP server to probe.
 *
 * Run with --dry-run to print what would alert without sending a push.
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { config } from "../src/core/config.js";
import { recordSend } from "../src/core/push-ledger.js";

const DRY_RUN = process.argv.includes("--dry-run");

const PORT = process.env.PORT || "3000";
const API_KEY = process.env.API_KEY || "";

const DATA_DIR = path.dirname(config.dbPath);
const STAMP_FILE = path.join(DATA_DIR, "last-indexed-rev");
const REINDEX_MAX_AGE_H = 2; // alert if stamp untouched for this many hours

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// Per-check timeout so no single probe can block the whole script forever.
const CHECK_TIMEOUT_MS = Number(process.env.HEALTH_CHECK_TIMEOUT_MS ?? 20_000);

/** Wrap a promise with a hard timeout. Rejects with a clear message on expiry. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms),
    ),
  ]);
}

// ─── CHECK 1: Search alive ────────────────────────────────────────────────

async function checkSearch(): Promise<string | null> {
  if (!API_KEY) return "API_KEY not set — cannot probe search";

  try {
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${PORT}/mcp`),
      { requestInit: { headers: { Authorization: `Bearer ${API_KEY}` } } },
    );
    const client = new Client({ name: "vault-watchdog", version: "1.0.0" });
    await withTimeout(client.connect(transport), CHECK_TIMEOUT_MS, "search connect");
    const res: any = await withTimeout(
      client.callTool({ name: "search_vault", arguments: { query: "watchdog health probe", limit: 1 } }),
      CHECK_TIMEOUT_MS,
      "search_vault call",
    );
    const text = res?.content?.[0]?.text ?? "";
    if (res?.isError) return `search_vault errored: ${String(text).slice(0, 150)}`;
    if (!String(text).trim()) return "search_vault returned nothing — index may be empty";
    return null; // ok
  } catch (e: any) {
    return `search probe failed: ${e?.message || e}`;
  }
}

// ─── CHECK 2: Reindex freshness ──────────────────────────────────────────

async function checkReindex(): Promise<string | null> {
  try {
    const s = await stat(STAMP_FILE);
    const ageH = (Date.now() - s.mtimeMs) / 3_600_000;
    if (ageH > REINDEX_MAX_AGE_H) {
      const lastStr = new Date(s.mtimeMs).toISOString().slice(0, 16);
      return `reindex stamp not updated in ${Math.round(ageH)}h (last: ${lastStr}) — cron may be dead`;
    }
    return null;
  } catch {
    return `reindex stamp file missing (${STAMP_FILE}) — cron has never run?`;
  }
}

// ─── CHECK 3: Morning report freshness ──────────────────────────────────

async function checkMorningReport(): Promise<string | null> {
  if (!config.enabledPlugins.includes("morning_report")) return null;

  const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const yesterdayMs = Date.now() - 86_400_000;
  const yesterdayStr = new Date(yesterdayMs).toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });

  const reportsDir = path.join(config.vaultPath, "Reports");
  for (const dateStr of [todayStr, yesterdayStr]) {
    const candidate = path.join(reportsDir, `${dateStr}-morning.md`);
    try {
      await stat(candidate);
      return null; // found a recent report
    } catch { /* not there — keep looking */ }
  }

  return `no morning report for ${todayStr} or ${yesterdayStr} — did the cron run?`;
}

// ─── ALERT ───────────────────────────────────────────────────────────────

async function sendAlert(message: string): Promise<void> {
  const title = "vault health alert";
  const body = message.slice(0, 150);

  if (DRY_RUN) {
    log(`DRY RUN — would push: ${title}: ${body}`);
    return;
  }

  // Dynamic import: ios_app may not be enabled (no VAPID keys).
  try {
    const { sendPush } = await import("../src/plugins/ios_app/logic.js");
    const res = await sendPush(title, body, "/app");
    await recordSend({ goal: "health-check", title, source: "health-check" });
    log(`alert sent: ${JSON.stringify(res)}`);
  } catch (e: any) {
    log(`could not send push alert (ios_app not configured?): ${e?.message || e}`);
    log(`ALERT: ${message}`);
  }
}

// ─── MAIN ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (config.transport !== "http" && !DRY_RUN) {
    log("skip: health-check only runs on HTTP transport (VPS deployment)");
    return;
  }

  // --dry-run: report what checks would run without touching any network or DB.
  if (DRY_RUN) {
    log("DRY RUN — checks that would run:");
    log("  check 1/3: search alive (HTTP probe to 127.0.0.1:" + PORT + "/mcp, timeout " + CHECK_TIMEOUT_MS / 1000 + "s)");
    log("  check 2/3: reindex freshness (stamp file: " + STAMP_FILE + ", max age " + REINDEX_MAX_AGE_H + "h)");
    if (config.enabledPlugins.includes("morning_report")) {
      log("  check 3/3: morning report freshness (Reports/<today|yesterday>-morning.md)");
    } else {
      log("  check 3/3: morning report (skipped — plugin not enabled)");
    }
    log("DRY RUN complete — no network calls made");
    return;
  }

  const alerts: string[] = [];

  const searchErr = await withTimeout(checkSearch(), CHECK_TIMEOUT_MS, "checkSearch").catch((e: any) => String(e?.message || e));
  if (searchErr) alerts.push(`search: ${searchErr}`);
  else log("check 1/3: search ok");

  const reindexErr = await checkReindex().catch((e: any) => String(e?.message || e));
  if (reindexErr) alerts.push(`reindex: ${reindexErr}`);
  else log("check 2/3: reindex ok");

  const reportErr = await checkMorningReport().catch((e: any) => String(e?.message || e));
  if (reportErr) alerts.push(`morning-report: ${reportErr}`);
  else log("check 3/3: morning-report ok");

  if (alerts.length === 0) {
    log("all checks passed");
    return;
  }

  const message = alerts.join(" | ");
  console.error(`HEALTH ALERT: ${message}`);
  await sendAlert(message);
  process.exit(1);
}

main().catch((e) => {
  log(`error: ${e?.stack || e}`);
  process.exit(1);
});
