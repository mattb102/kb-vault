import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import webpush from "web-push";

import { config } from "../../core/config.js";
import { gitCommitAndPush } from "../../core/sync.js";
import { today } from "../../core/utils.js";

// ─── TRACKERS ──────────────────────────────────────────────────────

export type TrackerKind = "scale" | "yesno" | "number";

export interface TrackerDef {
  /** Stable id used in URLs and tool arguments. */
  id: string;
  /** Human label shown on the phone. */
  label: string;
  /** Vault note holding this tracker's table, relative to the vault root. */
  note: string;
  kind: TrackerKind;
  /** For kind "scale": the inclusive button range. Ignored otherwise. */
  min: number;
  max: number;
  /** Optional one-line prompt shown above the buttons. */
  prompt?: string;
  /** Optional unit suffix for kind "number" (e.g. "hrs", "lbs"). */
  unit?: string;
}

interface RawTracker {
  id?: string;
  label?: string;
  note?: string;
  kind?: string;
  min?: number;
  max?: number;
  prompt?: string;
  unit?: string;
}

function pluginSettings(): Record<string, any> {
  return (config.pluginConfig?.ios_app as Record<string, any>) || {};
}

/** The title shown on the phone home screen and in the app header. */
export function appTitle(): string {
  return String(pluginSettings().title || `${config.serverName} tracker`);
}

/**
 * Trackers declared in config.yaml under `plugins.ios_app.trackers`.
 * Anything malformed is dropped rather than crashing the server — a typo in
 * one tracker should not take the whole phone app offline.
 */
export function listTrackers(): TrackerDef[] {
  const raw = pluginSettings().trackers;
  if (!Array.isArray(raw)) return [];

  const out: TrackerDef[] = [];
  for (const t of raw as RawTracker[]) {
    if (!t || typeof t.id !== "string" || !/^[a-z0-9_-]+$/i.test(t.id)) continue;
    if (typeof t.note !== "string" || !t.note.trim()) continue;

    const kind: TrackerKind =
      t.kind === "yesno" || t.kind === "number" ? t.kind : "scale";
    const min = Number.isFinite(t.min) ? Number(t.min) : 1;
    const max = Number.isFinite(t.max) ? Number(t.max) : 10;

    out.push({
      id: t.id,
      label: String(t.label || t.id),
      note: t.note.trim(),
      kind,
      // Guard the button range: a scale is rendered as one button per step, so
      // an accidental 1-10000 would render ten thousand buttons.
      min: kind === "scale" ? Math.min(min, max) : min,
      max: kind === "scale" ? Math.min(Math.max(min, max), min + 20) : max,
      prompt: t.prompt ? String(t.prompt) : undefined,
      unit: t.unit ? String(t.unit) : undefined,
    });
  }
  return out;
}

export function getTracker(id: string): TrackerDef | undefined {
  return listTrackers().find((t) => t.id === id);
}

// ─── THE TABLE ─────────────────────────────────────────────────────
// Each tracker owns one markdown table in one vault note:
//
//   | Date | Value | Notes |
//   | ---- | ----- | ----- |
//   | 2026-08-26 | 7 | slept badly |
//
// One row per day (logging the same day again updates that row). The table is
// found by its column signature rather than by a heading, so you can write
// whatever prose you like around it without breaking the parser.

const HEADER = "| Date | Value | Notes |";
const SEPARATOR = "| --- | --- | --- |";
const COLS = 3;

export interface Entry {
  date: string;
  value: number;
  notes: string;
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  const cells = s.split("|").map((c) => c.trim());
  if (cells.length > COLS) {
    // A notes cell contained a literal pipe. Rejoin the overflow into Notes
    // instead of shifting every column right.
    const head = cells.slice(0, COLS - 1);
    head.push(cells.slice(COLS - 1).join(" | "));
    return head;
  }
  while (cells.length < COLS) cells.push("");
  return cells;
}

function buildRow(cells: string[]): string {
  return "| " + cells.map((c) => c.replace(/\|/g, "\\|")).join(" | ") + " |";
}

function isSeparator(t: string): boolean {
  return /^\|[\s:|-]+\|$/.test(t);
}

function notePath(tracker: TrackerDef): string {
  return path.join(config.vaultPath, tracker.note);
}

function starterNote(tracker: TrackerDef): string {
  const lines = [
    "---",
    "type: metric-log",
    `metric: ${tracker.id}`,
    "tags:",
    "  - tracker",
    "---",
    "",
    `# ${tracker.label}`,
    "",
  ];
  if (tracker.prompt) lines.push(tracker.prompt, "");
  lines.push("## Log", "", HEADER, SEPARATOR, "");
  return lines.join("\n");
}

interface Table {
  lines: string[];
  rows: number[];
  lastRow: number;
}

function locateTable(content: string): Table | null {
  const lines = content.split("\n");
  let header = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith("|") && /\|\s*Date\s*\|/i.test(t) && /\|\s*Value\s*\|/i.test(t)) {
      header = i;
      break;
    }
  }
  if (header === -1) return null;

  const rows: number[] = [];
  let lastRow = header;
  for (let i = header + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === "") continue;
    if (t.startsWith("#")) break;
    if (!t.startsWith("|")) break;
    if (isSeparator(t)) {
      lastRow = i;
      continue;
    }
    rows.push(i);
    lastRow = i;
  }
  return { lines, rows, lastRow };
}

async function readOrCreate(tracker: TrackerDef): Promise<string> {
  const file = notePath(tracker);
  try {
    return await readFile(file, "utf-8");
  } catch {
    const seed = starterNote(tracker);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, seed);
    return seed;
  }
}

function coerceValue(tracker: TrackerDef, value: number): number {
  if (!Number.isFinite(value)) throw new Error("value must be a number");
  if (tracker.kind === "yesno") return value ? 1 : 0;
  if (tracker.kind === "scale") {
    const v = Math.round(value);
    if (v < tracker.min || v > tracker.max) {
      throw new Error(`value must be between ${tracker.min} and ${tracker.max}`);
    }
    return v;
  }
  return value;
}

export type LogResult = "updated" | "inserted";

/** Log (or re-log) one day's value for a tracker. */
export async function logEntry(
  trackerId: string,
  value: number,
  date?: string,
  notes?: string
): Promise<LogResult> {
  const tracker = getTracker(trackerId);
  if (!tracker) throw new Error(`unknown tracker: ${trackerId}`);

  const day = date || today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`bad date: ${day}`);
  const v = coerceValue(tracker, value);

  const content = await readOrCreate(tracker);
  let table = locateTable(content);

  if (!table) {
    // The note exists but has no table (someone hand-wrote it, or emptied it).
    // Append one rather than failing.
    const lines = content.split("\n");
    lines.push("", "## Log", "", HEADER, SEPARATOR);
    table = { lines, rows: [], lastRow: lines.length - 1 };
  }

  const { lines, rows, lastRow } = table;
  let result: LogResult = "inserted";

  const existing = rows.find((i) => splitRow(lines[i])[0] === day);
  if (existing !== undefined) {
    const cells = splitRow(lines[existing]);
    cells[1] = String(v);
    if (notes !== undefined) cells[2] = notes;
    lines[existing] = buildRow(cells);
    result = "updated";
  } else {
    lines.splice(lastRow + 1, 0, buildRow([day, String(v), notes || ""]));
  }

  await writeFile(notePath(tracker), lines.join("\n"));
  await gitCommitAndPush(`${tracker.label} ${day}: ${v}`);
  return result;
}

/** Most-recent-first history for one tracker. */
export async function readEntries(
  trackerId: string,
  limit?: number
): Promise<Entry[]> {
  const tracker = getTracker(trackerId);
  if (!tracker) throw new Error(`unknown tracker: ${trackerId}`);

  let content: string;
  try {
    content = await readFile(notePath(tracker), "utf-8");
  } catch {
    return [];
  }

  const table = locateTable(content);
  if (!table) return [];

  const out: Entry[] = [];
  for (const i of table.rows) {
    const cells = splitRow(table.lines[i]);
    const v = Number(cells[1]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cells[0])) continue;
    if (cells[1] === "" || Number.isNaN(v)) continue;
    out.push({ date: cells[0], value: v, notes: cells[2] || "" });
  }

  out.sort((a, b) => (a.date < b.date ? 1 : -1));
  return limit && limit > 0 ? out.slice(0, limit) : out;
}

// ─── WEB PUSH ──────────────────────────────────────────────────────
// Notifications to the home-screen app. iOS delivers these only once the app
// has actually been added to the home screen — Safari tabs do not qualify.

// Lives beside the vector index, in the same gitignored data/ dir.
const STORE = path.join(path.dirname(config.dbPath), "push-subscriptions.json");

let vapidReady = false;

function ensureVapid(): void {
  if (vapidReady) return;
  const pub = process.env.VAPID_PUBLIC_KEY || "";
  const priv = process.env.VAPID_PRIVATE_KEY || "";
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@example.com";
  if (!pub || !priv) {
    throw new Error(
      "VAPID keys are not set. Generate a pair with `npx web-push generate-vapid-keys` " +
        "and add VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY to .env."
    );
  }
  webpush.setVapidDetails(subject, pub, priv);
  vapidReady = true;
}

export function vapidPublicKey(): string {
  return process.env.VAPID_PUBLIC_KEY || "";
}

async function loadSubs(): Promise<any[]> {
  try {
    return JSON.parse(await readFile(STORE, "utf-8"));
  } catch {
    return [];
  }
}

async function saveSubs(subs: any[]): Promise<void> {
  await mkdir(path.dirname(STORE), { recursive: true });
  await writeFile(STORE, JSON.stringify(subs, null, 2));
}

export async function saveSubscription(sub: any): Promise<number> {
  if (!sub || !sub.endpoint) throw new Error("invalid subscription");
  const subs = await loadSubs();
  if (!subs.some((s) => s.endpoint === sub.endpoint)) subs.push(sub);
  await saveSubs(subs);
  return subs.length;
}

export async function countSubscriptions(): Promise<number> {
  return (await loadSubs()).length;
}

/**
 * Push one notification to every registered device.
 *
 * Subscriptions the push service reports as gone (404/410) are dropped, so a
 * reinstalled home-screen app does not leave dead endpoints behind forever.
 */
export async function sendPush(
  title: string,
  body: string,
  url: string = "/app"
): Promise<{ sent: number; pruned: number; failed: number }> {
  ensureVapid();
  const subs = await loadSubs();
  const payload = JSON.stringify({ title, body, url });

  let sent = 0;
  let failed = 0;
  const keep: any[] = [];

  for (const s of subs) {
    try {
      await webpush.sendNotification(s, payload);
      sent++;
      keep.push(s);
    } catch (e: any) {
      const code = e?.statusCode;
      if (code === 404 || code === 410) continue; // gone for good — drop it
      failed++;
      keep.push(s);
    }
  }

  const pruned = subs.length - keep.length;
  if (pruned > 0) await saveSubs(keep);
  return { sent, pruned, failed };
}
