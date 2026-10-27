/**
 * Stale-nudge sweep for the nightly reconcile.
 *
 * Finds open/in_progress nudge rows whose Due date is strictly before today,
 * gathers relevant scratchpad context per nudge, asks the model for a verdict,
 * and closes the "done" ones by moving them to the archive. "not_done" and
 * "unclear" rows are listed in the reconcile log for the owner to decide.
 *
 * This module never calls gitCommitAndPush -- the reconcile cron wrapper owns
 * the final vault commit, the same way bookSweep works.
 */
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import matter from "gray-matter";
import { config } from "./config.js";
import { claudePrompt } from "./claude-cli.js";
import { today } from "./utils.js";
import type { Entry } from "./scratchpad.js";
import { renderEntry } from "./scratchpad.js";

export const NUDGES_REL = "AI-Observations/nudges.md";
const NUDGE_ARCHIVE_REL = "AI-Observations/nudges-archive.md";

const NUDGE_TABLE_HEADER = [
  "| Goal | First Mentioned | Last Checked | Status | Priority | Note | Resolution | Due |",
  "| --- | --- | --- | --- | --- | --- | --- | --- |",
].join("\n");

export interface NudgeRowFull {
  goal: string;
  firstMentioned: string; // YYYY-MM-DD or ""
  status: string;
  due: string; // YYYY-MM-DD
  rawLine: string;
}

export interface NudgeVerdict {
  verdict: "done" | "not_done" | "unclear";
  evidence_ts: string | null;
  resolution: string;
}

export interface NudgeSweepItem {
  nudge: NudgeRowFull;
  verdict: NudgeVerdict;
}

export interface NudgeSweepResult {
  autoClosed: NudgeSweepItem[];
  pastDueOpen: NudgeRowFull[];
}

/**
 * Parse open/in_progress rows from nudges table content whose Due is a past date.
 * todayStr is YYYY-MM-DD; rows with due < todayStr qualify.
 */
export function parseOverdueNudgeRows(content: string, todayStr: string): NudgeRowFull[] {
  const rows: NudgeRowFull[] = [];
  for (const line of content.split("\n")) {
    if (!line.trimStart().startsWith("|")) continue;
    const cells = line.split(/(?<!\\)\|/);
    if (cells.length < 9) continue;
    const status = (cells[4] ?? "").trim().toLowerCase();
    if (status !== "open" && status !== "in_progress") continue;
    const due = (cells[8] ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) continue; // only dated rows
    if (due >= todayStr) continue; // not past due
    const goal = (cells[1] ?? "").replace(/\\\|/g, "|").trim();
    if (!goal || goal.startsWith("---")) continue; // separator row
    const firstMentioned = (cells[2] ?? "").trim();
    rows.push({ goal, firstMentioned, status, due, rawLine: line });
  }
  return rows;
}

const STOPWORDS = new Set([
  "about", "after", "again", "before", "could", "every", "finish",
  "follow", "going", "their", "there", "these", "those", "until",
  "using", "watch", "which", "would", "start", "check", "begin",
  "today", "daily", "first", "email", "reply", "should", "still",
]);

/**
 * Extract meaningful search keywords from a goal string.
 * Returns lowercase words, length >= 5, not stopwords.
 */
export function goalKeywords(goal: string): string[] {
  return [...new Set(
    goal
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 5 && !STOPWORDS.has(w)),
  )];
}

/**
 * Filter scratchpad entries relevant to a nudge: from firstMentioned onward,
 * scored by keyword match, capped at max entries.
 */
export function scratchpadContextForNudge(
  entries: Entry[],
  nudge: NudgeRowFull,
  max: number,
): Entry[] {
  const cutoff = nudge.firstMentioned || "0000-00-00";
  const fromDate = entries.filter((e) => e.timestamp.slice(0, 10) >= cutoff);
  const keywords = goalKeywords(nudge.goal);
  if (!keywords.length) return fromDate.slice(-max);

  const scored = fromDate.map((e) => {
    const text = `${e.subject} ${e.body}`.toLowerCase();
    const score = keywords.filter((k) => text.includes(k)).length;
    return { e, score };
  });

  const hits = scored.filter((x) => x.score > 0).map((x) => x.e);
  const needed = max - Math.min(hits.length, max);
  const nonHits = scored.filter((x) => x.score === 0).map((x) => x.e);
  const combined = [...hits, ...nonHits.slice(-needed)];
  return combined.sort((a, b) => a.timestamp.localeCompare(b.timestamp)).slice(-max);
}

export function nudgeSweepPrompt(nudge: NudgeRowFull, context: string, todayStr: string): string {
  const daysAgo = Math.round(
    (new Date(todayStr).getTime() - new Date(nudge.due).getTime()) / 86400000,
  );
  return `You are the nightly reconciler for a personal vault. A nudge is past its due date and you must decide if scratchpad evidence proves it was completed.

TODAY: ${todayStr}
NUDGE GOAL: ${nudge.goal}
DUE DATE: ${nudge.due} (${daysAgo} day${daysAgo === 1 ? "" : "s"} ago)
FIRST MENTIONED: ${nudge.firstMentioned || "unknown"}
STATUS: ${nudge.status}

Return ONLY a single JSON object with no fences, no commentary:
{"verdict": "done" | "not_done" | "unclear", "evidence_ts": "<timestamp or null>", "resolution": "<one short line>"}

Rules:
- "done" ONLY when a scratchpad entry explicitly shows the goal was completed, the event happened, or the user said it was done. Never infer done from absence of mention, from progress notes, or from the event date passing.
- "not_done" when entries show it was not done, the event was missed, or recent entries show it is still pending.
- "unclear" when the scratchpad is silent or you cannot determine completion from what is here.
- The resolution must be one short line. Do not use em dashes.
- evidence_ts must be an exact timestamp from the scratchpad entries below, or null.

=== SCRATCHPAD ENTRIES (from ${nudge.firstMentioned || "start"} onward, filtered by relevance) ===
${context || "(no matching scratchpad entries found)"}`;
}

export function parseNudgeVerdict(raw: string): NudgeVerdict {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.search(/\{/);
  if (start === -1) throw new Error("no JSON object in nudge verdict reply");
  const obj = JSON.parse(candidate.slice(start).trim()) as Record<string, unknown>;
  const v = obj.verdict as string;
  if (v !== "done" && v !== "not_done" && v !== "unclear") {
    throw new Error(`invalid verdict value: ${v}`);
  }
  return {
    verdict: v,
    evidence_ts: typeof obj.evidence_ts === "string" && obj.evidence_ts ? obj.evidence_ts : null,
    resolution: typeof obj.resolution === "string" && obj.resolution
      ? obj.resolution
      : "auto-closed by reconcile",
  };
}

/**
 * Apply batch closures to the raw nudges file string (frontmatter included).
 * Matching rows are removed from the live content and collected for the archive.
 */
export function applyNudgeClosures(
  raw: string,
  closures: { goal: string; resolution: string }[],
): { content: string; archivedRows: string[] } {
  if (!closures.length) return { content: raw, archivedRows: [] };

  const sanitize = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
  const goalMap = new Map(
    closures.map((c) => [
      c.goal.toLowerCase().replace(/\s+/g, " ").trim(),
      c,
    ]),
  );

  const lines = raw.split("\n");
  const archivedRows: string[] = [];
  const newLines: string[] = [];

  for (const line of lines) {
    if (!line.trimStart().startsWith("|")) {
      newLines.push(line);
      continue;
    }
    const cells = line.split(/(?<!\\)\|/);
    if (cells.length < 5) {
      newLines.push(line);
      continue;
    }
    const rowGoal = (cells[1] ?? "").replace(/\\\|/g, "|").trim()
      .toLowerCase().replace(/\s+/g, " ");
    const closure = goalMap.get(rowGoal);
    if (!closure) {
      newLines.push(line);
      continue;
    }
    // Stamp status as "addressed" and set resolution cell (index 7)
    cells[4] = " addressed ";
    const resCell = ` ${sanitize(closure.resolution)} `;
    if (cells.length >= 10) {
      cells[7] = resCell;
    } else {
      cells.splice(cells.length - 1, 0, resCell);
    }
    archivedRows.push(cells.join("|"));
    // Row leaves the live table
  }

  return { content: newLines.join("\n"), archivedRows };
}

async function appendToArchive(archivedRows: string[]): Promise<void> {
  if (!archivedRows.length) return;
  const archivePath = join(config.vaultPath, NUDGE_ARCHIVE_REL);
  let raw: string;
  try {
    raw = await readFile(archivePath, "utf-8");
  } catch {
    raw = matter.stringify(
      `\n# Nudges Archive\n\nTerminal nudges moved out of the live table. Append-only.\n\n${NUDGE_TABLE_HEADER}\n`,
      {
        type: "ai-observation-archive",
        topic: "nudges-archive",
        tags: ["ai", "observations", "nudges", "archive"],
        created: today(),
      },
    );
  }
  await writeFile(archivePath, raw.trimEnd() + "\n" + archivedRows.join("\n") + "\n");
}

const MAX_CONTEXT_ENTRIES = 20;

/**
 * Run the stale-nudge sweep. Reads the live nudges file, identifies overdue
 * rows, asks the model for a completion verdict per row, and closes the proven-
 * done ones. Does NOT commit to git -- the cron wrapper handles that.
 */
export async function sweepOverdueNudges(opts: {
  entries: Entry[];
  todayStr: string;
  model: string;
  dryRun: boolean;
}): Promise<NudgeSweepResult> {
  const nudgesPath = join(config.vaultPath, NUDGES_REL);
  let nudgesRaw: string;
  try {
    nudgesRaw = await readFile(nudgesPath, "utf-8");
  } catch {
    return { autoClosed: [], pastDueOpen: [] };
  }

  const { content } = matter(nudgesRaw);
  const overdue = parseOverdueNudgeRows(content, opts.todayStr);
  if (!overdue.length) return { autoClosed: [], pastDueOpen: [] };

  const autoClosed: NudgeSweepItem[] = [];
  const pastDueOpen: NudgeRowFull[] = [];

  for (const nudge of overdue) {
    const ctxEntries = scratchpadContextForNudge(opts.entries, nudge, MAX_CONTEXT_ENTRIES);
    const context = ctxEntries.map(renderEntry).join("\n\n");
    const prompt = nudgeSweepPrompt(nudge, context, opts.todayStr);

    let verdict: NudgeVerdict;
    try {
      const reply = await claudePrompt(prompt, opts.model, 60_000);
      verdict = parseNudgeVerdict(reply);
    } catch (e) {
      verdict = {
        verdict: "unclear",
        evidence_ts: null,
        resolution: `verdict unavailable: ${(e as Error).message.slice(0, 80)}`,
      };
    }

    if (verdict.verdict === "done") {
      autoClosed.push({ nudge, verdict });
    } else {
      pastDueOpen.push(nudge);
    }
  }

  if (autoClosed.length && !opts.dryRun) {
    const closures = autoClosed.map((item) => ({
      goal: item.nudge.goal,
      resolution: `Auto-closed by reconcile from scratchpad ${item.verdict.evidence_ts ?? "n/a"}: ${item.verdict.resolution}`,
    }));
    const { content: newContent, archivedRows } = applyNudgeClosures(nudgesRaw, closures);
    await writeFile(nudgesPath, newContent);
    await appendToArchive(archivedRows);
  }

  return { autoClosed, pastDueOpen };
}
