import { readFile, writeFile } from "fs/promises";
import { frontmatterIndex } from "../../core/frontmatter.js";
import { gitCommitAndPush } from "../../core/sync.js";
import { today } from "../../core/utils.js";

export interface Run {
  date: string;
  distance: number;
  duration: string;
  pace: string;
  feel: number | null;
  notes: string;
}

export interface RunningStats {
  total_miles: number;
  total_runs: number;
  longest_run: number;
  current_week_mi: number;
  longest_streak_days: number;
  days_to_half: number;
  miles_to_half_target: number;
}

export interface PublicPayload {
  runs: Run[];
  stats: RunningStats;
  generated_at: string;
  half_marathon_date: string;
}

const HALF_MARATHON_DATE = "2026-07-12"; // Narragansett Summer Running Festival Half
const HALF_DISTANCE_MI = 13.1;
const TZ = "America/New_York";

function findRunningFile() {
  return frontmatterIndex.findOne({ type: "metric-log", metric: "running" });
}

function parseDurationSec(s: string): number {
  const parts = s.trim().split(":").map((p) => parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function formatPace(distanceMi: number, durationSec: number): string {
  if (distanceMi <= 0 || durationSec <= 0) return "";
  const paceSec = Math.round(durationSec / distanceMi);
  const m = Math.floor(paceSec / 60);
  const s = paceSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function parseRunsTable(markdown: string): Run[] {
  const lines = markdown.split("\n");
  const runs: Run[] = [];
  let inTable = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) {
      inTable = false;
      continue;
    }
    // Header row: contains "Date" and "Distance"
    if (/^\|\s*Date\s*\|/i.test(trimmed)) {
      inTable = true;
      continue;
    }
    // Separator row: |---|---|...
    if (/^\|\s*[-:]+\s*\|/.test(trimmed)) continue;
    if (!inTable) continue;

    const cells = trimmed
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());

    if (cells.length < 5) continue;
    const [date, distanceRaw, duration, pace, feelRaw, ...rest] = cells;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    const distance = parseFloat(distanceRaw);
    if (Number.isNaN(distance)) continue;

    const feelNum = parseInt(feelRaw, 10);

    runs.push({
      date,
      distance,
      duration: duration || "",
      pace: pace || formatPace(distance, parseDurationSec(duration || "")),
      feel: Number.isNaN(feelNum) ? null : feelNum,
      notes: rest.join(" | ").trim(),
    });
  }

  runs.sort((a, b) => a.date.localeCompare(b.date));
  return runs;
}

export async function logRun(input: {
  date?: string;
  distance_mi: number;
  duration: string;
  feel?: number;
  notes?: string;
}): Promise<string> {
  const entry = findRunningFile();
  if (!entry) {
    throw new Error(
      "No metric-log file found for metric 'running'. Expected Health/metrics/running.md with frontmatter type=metric-log, metric=running."
    );
  }

  const date = input.date || today();
  const durationSec = parseDurationSec(input.duration);
  const pace = formatPace(input.distance_mi, durationSec);
  const feel = input.feel === undefined ? "" : String(input.feel);
  const notes = (input.notes || "").replace(/\|/g, "\\|").replace(/\n/g, " ");

  const row = `| ${date} | ${input.distance_mi} | ${input.duration} | ${pace} | ${feel} | ${notes} |`;
  const content = await readFile(entry.path, "utf-8");
  const updated = content.trimEnd() + "\n" + row + "\n";

  await writeFile(entry.path, updated);
  await gitCommitAndPush(`Log run: ${input.distance_mi} mi in ${input.duration}`);

  return `Logged run: ${input.distance_mi} mi in ${input.duration} (${pace}/mi) on ${date}`;
}

export async function listRuns(opts?: {
  since?: string;
  limit?: number;
}): Promise<Run[]> {
  const entry = findRunningFile();
  if (!entry) return [];
  const content = await readFile(entry.path, "utf-8");
  let runs = parseRunsTable(content);
  if (opts?.since) runs = runs.filter((r) => r.date >= opts.since!);
  if (opts?.limit && runs.length > opts.limit) {
    runs = runs.slice(runs.length - opts.limit);
  }
  return runs;
}

function todayInTz(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
}

function isoWeekStart(dateStr: string): string {
  // Monday of the ISO week containing dateStr.
  const d = new Date(dateStr + "T12:00:00");
  const day = d.getUTCDay() || 7; // 1=Mon ... 7=Sun
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a + "T00:00:00Z").getTime();
  const db = new Date(b + "T00:00:00Z").getTime();
  return Math.round((db - da) / 86400000);
}

export function computeStats(runs: Run[]): RunningStats {
  const totalRuns = runs.length;
  const totalMiles = runs.reduce((s, r) => s + r.distance, 0);
  const longestRun = runs.reduce((m, r) => Math.max(m, r.distance), 0);

  const todayStr = todayInTz();
  const weekStart = isoWeekStart(todayStr);
  const currentWeekMi = runs
    .filter((r) => r.date >= weekStart && r.date <= todayStr)
    .reduce((s, r) => s + r.distance, 0);

  // Longest streak: consecutive days with at least one run.
  const dates = Array.from(new Set(runs.map((r) => r.date))).sort();
  let longestStreak = 0;
  let cur = 0;
  let prev: string | null = null;
  for (const d of dates) {
    if (prev && daysBetween(prev, d) === 1) {
      cur += 1;
    } else {
      cur = 1;
    }
    if (cur > longestStreak) longestStreak = cur;
    prev = d;
  }

  const daysToHalf = Math.max(0, daysBetween(todayStr, HALF_MARATHON_DATE));
  const milesToHalfTarget = Math.max(0, +(HALF_DISTANCE_MI - longestRun).toFixed(2));

  return {
    total_miles: +totalMiles.toFixed(2),
    total_runs: totalRuns,
    longest_run: +longestRun.toFixed(2),
    current_week_mi: +currentWeekMi.toFixed(2),
    longest_streak_days: longestStreak,
    days_to_half: daysToHalf,
    miles_to_half_target: milesToHalfTarget,
  };
}

export async function runningStats(): Promise<RunningStats> {
  const runs = await listRuns();
  return computeStats(runs);
}

let cache: { payload: PublicPayload; ts: number } | null = null;
const CACHE_MS = 60_000;

export async function getPublicData(): Promise<PublicPayload> {
  if (cache && Date.now() - cache.ts < CACHE_MS) return cache.payload;
  const runs = await listRuns();
  const stats = computeStats(runs);
  const payload: PublicPayload = {
    runs,
    stats,
    generated_at: new Date().toISOString(),
    half_marathon_date: HALF_MARATHON_DATE,
  };
  cache = { payload, ts: Date.now() };
  return payload;
}

export function invalidateRunningCache() {
  cache = null;
}
