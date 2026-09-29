/**
 * Evening nudge push — fires once at a configurable hour (default 8 PM ET).
 *
 * Deterministic and quiet by design. Reads the nudges table, keeps only the
 * items that are DATED-and-DUE (due today or overdue) using the same due helpers
 * the morning report uses, dedupes against a small state file, and — only if
 * something survives — sends ONE push.
 *
 * Non-negotiable: if nothing is dated and due, it sends nothing. Undated nudges
 * never push. There is no "all clear" message. Silence is the correct state.
 *
 * It never writes to the vault and never mutates nudge status.
 *
 * Run with --dry-run to print what would be sent without sending or touching
 * the state file.
 */
import { readFile, writeFile, mkdir } from "fs/promises";
import { realpathSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

import { sendPush, listSubscriptions } from "../src/plugins/ios_app/logic.js";
import { parseNudgeRow, type NudgeRow } from "../src/core/nudges.js";
import { daysOverdue, isDueOn, describeDue } from "../src/core/due.js";
import { frontmatterIndex } from "../src/core/frontmatter.js";
import { today } from "../src/core/utils.js";
import { config } from "../src/core/config.js";
import { recordSend } from "../src/core/push-ledger.js";

const DRY_RUN = process.argv.includes("--dry-run");

// Overdue items push at most once every this-many days each.
const OVERDUE_GAP_DAYS = 3;

const STATE = path.join(path.dirname(config.dbPath), "evening-push-state.json");

// goal text -> last ET date (YYYY-MM-DD) we notified about it.
type State = Record<string, string>;

async function loadState(): Promise<State> {
  try {
    const s = JSON.parse(await readFile(STATE, "utf-8"));
    return s && typeof s === "object" ? s : {};
  } catch {
    return {};
  }
}

async function saveState(s: State): Promise<void> {
  await mkdir(path.dirname(STATE), { recursive: true });
  await writeFile(STATE, JSON.stringify(s, null, 2));
}

function daysBetween(a: string, b: string): number {
  return Math.floor(
    (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000,
  );
}

export interface DueItem {
  row: NudgeRow;
  marker: string;
  overdue: boolean;
  over: number;
}

/**
 * Select the dated-and-due rows: overdue items, plus rows whose due date or
 * recurrence token is live today. Undated, future-dated, and off-day recurrences
 * are dropped.
 *
 * Bug note (personal system): the original version used a simple pipe split
 * (`string.split("|")`) without accounting for escaped pipes (`\|`) in goal or
 * note cells. If any cell contained `\|`, column indices shifted and rows whose
 * status was "expired" or "wont_do" could appear in the output because the
 * status cell landed at the wrong index.
 *
 * Fix here: `parseNudgeRow` from src/core/nudges.ts uses `split(/(?<!\\)\|/)`
 * (unescaped-pipe split), which correctly handles escaped pipes, and already
 * filters to only open/in_progress rows. So cleared/expired/wont_do rows can
 * never reach `selectDue`.
 */
export function selectDue(nudgesTable: string, iso: string): DueItem[] {
  const rows = nudgesTable
    .split("\n")
    .map(parseNudgeRow)
    .filter((r): r is NudgeRow => r !== null);

  const items: DueItem[] = [];
  for (const row of rows) {
    const over = daysOverdue(row.due, iso);
    if (over !== null && over > 0) {
      items.push({ row, marker: describeDue(row.due, iso), overdue: true, over });
    } else if (isDueOn(row.due, iso)) {
      items.push({ row, marker: describeDue(row.due, iso), overdue: false, over: 0 });
    }
    // else: undated, future-dated, or off-day recurrence — not due tonight
  }
  // Most-overdue first, then due-today.
  items.sort((a, b) => b.over - a.over);
  return items;
}

/**
 * Dedup gate. Returns the items that should actually push tonight.
 *   - due-today items always push (but never twice the same day)
 *   - a newly-overdue item (first day past due) always pushes
 *   - other overdue items push only if >= OVERDUE_GAP_DAYS since we last notified
 */
export function filterByState(items: DueItem[], state: State, iso: string): DueItem[] {
  return items.filter(({ row, overdue, over }) => {
    const last = state[row.goal];
    if (last === iso) return false;    // already notified about this today
    if (!overdue) return true;         // due today -> always
    if (over === 1) return true;       // newly overdue -> always
    if (!last) return true;            // never told about this overdue item
    return daysBetween(iso, last) >= OVERDUE_GAP_DAYS;
  });
}

/**
 * Compact label from a goal string: splits on the first ` — `, ` – `, ` - `,
 * `: `, ` (`, or `, `; hard-caps at 32 chars on a word boundary.
 */
export function shortLabel(goal: string): string {
  const DELIMITERS = [" — ", " – ", " - ", ": ", " (", ", "];
  let splitIdx = goal.length;
  for (const d of DELIMITERS) {
    const i = goal.indexOf(d);
    if (i !== -1 && i < splitIdx) splitIdx = i;
  }
  const raw = goal.slice(0, splitIdx).trim();
  const cleaned = raw.replace(/[—–]/g, "").trim();
  if (cleaned.length <= 32) return cleaned;
  const cut = cleaned.slice(0, 32);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut) + "…";
}

/** Compact due-state suffix: "(Nd)" for N days overdue, "(today)" otherwise. */
export function compactSuffix(item: DueItem): string {
  return item.over > 0 ? ` (${item.over}d)` : " (today)";
}

/** Plain, quiet notification content. No emoji, no urgency markers. */
export function compose(items: DueItem[]): { title: string; body: string } {
  if (items.length === 1) {
    const it = items[0];
    return { title: shortLabel(it.row.goal), body: it.marker };
  }
  const title = `${items.length} due`;
  const MAX_SHOWN = 6;
  const shown = items.slice(0, MAX_SHOWN);
  const rest = items.length - MAX_SHOWN;
  const lines = shown.map((it) => `${shortLabel(it.row.goal)}${compactSuffix(it)}`);
  if (rest > 0) lines.push(`+${rest} more`);
  return { title, body: lines.join("\n") };
}

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function main(): Promise<void> {
  const iso = today();

  await frontmatterIndex.rebuild();
  const nudgeEntry = frontmatterIndex.findOne({ type: "ai-observation", topic: "nudges" });
  if (!nudgeEntry) {
    log("no nudges file found (type=ai-observation topic=nudges) — nothing to push");
    return;
  }

  const raw = await readFile(nudgeEntry.path, "utf-8");
  // Strip frontmatter — keep only lines that are part of a markdown table.
  const tableContent = raw.split("\n").filter((l) => l.trimStart().startsWith("|")).join("\n");

  const due = selectDue(tableContent, iso);
  const state = await loadState();
  const toPush = filterByState(due, state, iso);

  if (DRY_RUN) {
    const subs = await listSubscriptions();
    console.log(`=== Evening nudges — ${iso} (DRY RUN) ===`);
    console.log(`Dated-and-due tonight: ${due.length}`);
    for (const d of due) {
      const last = state[d.row.goal];
      const gated = !toPush.includes(d);
      console.log(
        `  - ${d.marker.padEnd(18)} ${gated ? "[suppressed]" : "[would push]"} ` +
          `${d.row.goal}${last ? `  (last notified ${last})` : ""}`,
      );
    }
    console.log(`\nWould push: ${toPush.length} item(s)`);
    if (toPush.length) {
      const { title, body } = compose(toPush);
      console.log(`  title: ${title}`);
      console.log(`  body:  ${body.replace(/\n/g, "\n         ")}`);
    } else {
      console.log("  (nothing dated and due — sending nothing, as designed)");
    }
    console.log(`\nTo ${subs.length} subscription(s).`);
    return;
  }

  if (!toPush.length) {
    log(`no send: ${due.length} due, 0 past the dedup gate`);
    return;
  }

  const { title, body } = compose(toPush);
  const res = await sendPush(title, body, "/app");
  await recordSend({ goal: title, title, source: "evening-nudges" });

  for (const d of toPush) state[d.row.goal] = iso;
  await saveState(state);

  log(`sent "${title}" (${toPush.length} item(s)) -> ${JSON.stringify(res)}`);
}

// Only run when invoked directly, not when imported by tests.
const invokedDirectly = (() => {
  const arg = process.argv[1];
  if (!arg) return false;
  try {
    return realpathSync(arg) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main().catch((e) => {
    log(`error: ${e?.stack || e}`);
    process.exit(1);
  });
}
