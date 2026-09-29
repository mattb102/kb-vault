import { readFile, writeFile, mkdir, readdir } from "fs/promises";
import { join } from "path";
import matter from "gray-matter";
import { config } from "./config.js";
import { frontmatterIndex } from "./frontmatter.js";
import { absPath, today, nowTime, currentWeek } from "./utils.js";
import { gitCommitAndPush } from "./sync.js";
import { isDueOn, daysOverdue } from "./due.js";

/**
 * Append a raw observation to the AI scratchpad.
 */
export async function logObservation(
  content: string,
  type: string,
  subject: string,
  supersedes?: string,
): Promise<string> {
  // Guard against callers jamming structured fields into the content body —
  // produces malformed entries that the scratchpad parser silently drops.
  if (/^\s*type:\s*[\w-]+\s*[,|]\s*subject:/i.test(content)) {
    throw new Error(
      "log_observation content must be the observation body only — pass type and subject as separate parameters, not inside content",
    );
  }
  if (!type || !subject) {
    throw new Error("log_observation requires non-empty type and subject");
  }

  const entry = frontmatterIndex.findOne({
    type: "ai-observation",
    topic: "scratchpad",
  });

  if (!entry) {
    throw new Error("AI scratchpad file not found");
  }

  const raw = await readFile(entry.path, "utf-8");
  const timestamp = `${today()} ${nowTime()}`;
  const header = `### ${timestamp} | type: ${type} | subject: ${subject}${supersedes ? ` | supersedes: ${supersedes}` : ""}`;
  const observation = `\n${header}\n${content}\n`;
  const updated = raw.trimEnd() + observation;

  await writeFile(entry.path, updated);
  await gitCommitAndPush(`AI observation: ${today()}`);

  return `Observation logged to scratchpad`;
}

/**
 * Add a recurring pattern that Claude has noticed.
 */
export async function logPattern(
  pattern: string,
  evidence: string
): Promise<string> {
  const entry = frontmatterIndex.findOne({
    type: "ai-observation",
    topic: "patterns",
  });

  if (!entry) {
    throw new Error("AI patterns file not found");
  }

  const raw = await readFile(entry.path, "utf-8");
  const timestamp = today();
  const patternEntry = `\n### ${pattern}\n- **First noticed:** ${timestamp}\n- **Evidence:** ${evidence}\n`;
  const updated = raw.trimEnd() + patternEntry;

  await writeFile(entry.path, updated);
  await gitCommitAndPush(`AI pattern: ${pattern}`);

  return `Pattern logged: ${pattern}`;
}

const NUDGE_ARCHIVE_REL = join("AI-Observations", "nudges-archive.md");

const NUDGE_TABLE_HEADER = [
  "| Goal | First Mentioned | Last Checked | Status | Priority | Note | Resolution | Due |",
  "| --- | --- | --- | --- | --- | --- | --- | --- |",
].join("\n");

/** Statuses that remove a nudge from the live table. */
const TERMINAL_NUDGE_STATUSES = new Set(["addressed", "wont_do", "expired"]);

function normalizeGoal(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Find an open or in_progress nudge row whose goal matches (case-insensitive,
 * whitespace-normalized). Returns a description string if found, null otherwise.
 */
export function findExistingOpenNudge(raw: string, goal: string): string | null {
  const normalized = normalizeGoal(goal);
  for (const line of raw.split("\n")) {
    if (!line.trimStart().startsWith("|")) continue;
    const cells = line.split(/(?<!\\)\|/);
    if (cells.length < 5) continue;
    const rowGoal = (cells[1] ?? "").replace(/\\\|/g, "|").trim();
    const rowStatus = (cells[4] ?? "").trim().toLowerCase();
    if (
      (rowStatus === "open" || rowStatus === "in_progress") &&
      normalizeGoal(rowGoal) === normalized
    ) {
      return `${rowGoal} (${rowStatus})`;
    }
  }
  return null;
}

/**
 * Append rows to the nudges archive (created on first use). Terminal nudges
 * live here so the active table — loaded into context every conversation —
 * stays small and 100% signal. Append-only; resurrect by re-logging.
 */
export async function archiveNudgeRows(rows: string[]): Promise<void> {
  if (rows.length === 0) return;
  const path = join(config.vaultPath, NUDGE_ARCHIVE_REL);
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    raw = matter.stringify(
      `\n# Nudges Archive\n\nTerminal nudges (addressed, wont_do, expired) moved out of the live table. Append-only.\n\n${NUDGE_TABLE_HEADER}\n`,
      {
        type: "ai-observation-archive",
        topic: "nudges-archive",
        tags: ["ai", "observations", "nudges", "archive"],
        created: today(),
      },
    );
  }
  await writeFile(path, raw.trimEnd() + "\n" + rows.join("\n") + "\n");
}

/**
 * Add an accountability nudge.
 */
export async function logNudge(
  goal: string,
  lastMentioned: string,
  note?: string,
  priority: "P0" | "P1" | "P2" | "P3" = "P2",
  due?: string,
): Promise<string> {
  const entry = frontmatterIndex.findOne({
    type: "ai-observation",
    topic: "nudges",
  });

  if (!entry) {
    throw new Error("AI nudges file not found");
  }

  const raw = await readFile(entry.path, "utf-8");

  const existing = findExistingOpenNudge(raw, goal);
  if (existing) {
    return `Nudge already exists — not added. Existing: ${existing}`;
  }

  const sanitize = (s: string) =>
    s.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
  // Column order: goal | first | last | status | priority | note | resolution | due
  // Empty resolution cell keeps the table rectangular (8 columns); due is last.
  const row = `| ${sanitize(goal)} | ${lastMentioned} | ${today()} | open | ${priority} | ${sanitize(note || "")} | | ${due || ""} |`;

  // In-place header upgrade: if the live table has 7 columns (no Due), add it.
  // Matches any 7-column nudge header regardless of capitalisation or spacing
  // variants, and any corresponding separator row.
  const upgraded = raw.replace(
    /^(\|[ \t]*[Gg]oal[ \t]*\|[^|]+\|[^|]+\|[^|]+\|[^|]+\|[^|]+\|[^|]+\|)[ \t]*$/m,
    (match) => match.trimEnd().endsWith("Due |") ? match : match.trimEnd() + " Due |",
  ).replace(
    /^(\|[-| \t]+\|[-| \t]+\|[-| \t]+\|[-| \t]+\|[-| \t]+\|[-| \t]+\|[-| \t]+\|)[ \t]*$/m,
    (match) => {
      // Only upgrade if this is a 7-column separator (count pipes).
      const pipes = (match.match(/\|/g) || []).length;
      return pipes === 8 ? match.trimEnd() + " --- |" : match;
    },
  );

  const updated = upgraded.trimEnd() + "\n" + row + "\n";

  await writeFile(entry.path, updated);
  await gitCommitAndPush(`AI nudge: ${goal}`);

  return `Nudge logged: ${goal}`;
}

/**
 * Set a nudge's status: addressed (did it), wont_do (decided against it),
 * expired (aged out unactioned), or in_progress (actively being worked on).
 * Terminal statuses (addressed, wont_do, expired) MOVE the row to
 * nudges-archive.md; in_progress updates in place. Optionally records a note
 * in the resolution column when closing, or a progress note for in_progress.
 * Matches the first row with the goal.
 */
export async function clearNudge(
  goal: string,
  resolution?: string,
  status: "addressed" | "wont_do" | "in_progress" | "expired" = "addressed",
): Promise<string> {
  const entry = frontmatterIndex.findOne({
    type: "ai-observation",
    topic: "nudges",
  });

  if (!entry) {
    throw new Error("AI nudges file not found");
  }

  const raw = await readFile(entry.path, "utf-8");
  const sanitize = (s: string) =>
    s.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");

  // Anchor on the goal as a full cell: | <goal> |
  const goalRe = new RegExp(
    `\\|\\s*${goal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\|`,
  );

  const isTerminal = TERMINAL_NUDGE_STATUSES.has(status);
  const lines = raw.split("\n");
  let matchedRow: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trimStart().startsWith("|") || !goalRe.test(line)) continue;

    // Split on UNESCAPED pipes so escaped pipes (\|) inside the goal/note
    // cells don't shift column indices.
    // Columns: ["", goal, first, last, status, priority, note, (resolution,) (due,) ""].
    const cells = line.split(/(?<!\\)\|/);

    if (cells.length > 5) {
      cells[4] = ` ${status} `;
    }

    if (resolution !== undefined) {
      const resCell = ` ${sanitize(resolution)} `;
      // Resolution lives at index 7 (after goal, first, last, status, priority, note).
      // Index 7 is safe because goal/first/last/status/priority never contain pipes.
      if (cells.length >= 9) {
        cells[7] = resCell;
      } else if (cells.length >= 8) {
        cells.splice(cells.length - 1, 0, resCell);
      }
    }

    lines[i] = cells.join("|");
    matchedRow = lines[i];

    if (isTerminal) {
      lines.splice(i, 1);
    }
    break;
  }

  await writeFile(entry.path, lines.join("\n"));

  if (isTerminal && matchedRow) {
    await archiveNudgeRows([matchedRow]);
  }

  const action = status === "in_progress" ? "Mark nudge in-progress" : "Clear nudge";
  await gitCommitAndPush(`${action}: ${goal}`);

  const verb =
    status === "wont_do"
      ? "marked won't-do"
      : status === "in_progress"
        ? "marked in-progress"
        : status === "expired"
          ? "expired"
          : "addressed";
  return `Nudge ${verb}: ${goal}`;
}

/**
 * Expire dated open nudges whose due date is strictly more than `daysGrace`
 * days in the past. Recurring and undated rows are never touched — a
 * "daily" or "weekdays" nudge represents a standing commitment, not a task.
 * Moves expired rows to nudges-archive.md. Returns the number of rows expired.
 *
 * Call this at report-generation time so the live table stays clean without
 * requiring a separate cron job for the most common case.
 */
export async function sweepExpiredNudges(daysGrace = 0): Promise<number> {
  const entry = frontmatterIndex.findOne({
    type: "ai-observation",
    topic: "nudges",
  });
  if (!entry) return 0;

  const iso = today();
  const raw = await readFile(entry.path, "utf-8");
  const lines = raw.split("\n");

  const kept: string[] = [];
  const toArchive: string[] = [];

  let dataRowsSeen = 0;
  for (const line of lines) {
    if (!line.trimStart().startsWith("|")) {
      kept.push(line);
      continue;
    }
    dataRowsSeen++;
    if (dataRowsSeen <= 2) {
      kept.push(line);
      continue;
    }
    const cells = line.split(/(?<!\\)\|/);
    const status = (cells[4] || "").trim().toLowerCase();
    // Due is the last real column (index 8 in 8-col rows, absent in legacy 7-col rows).
    const dueRaw = cells.length >= 10 ? (cells[8] || "").trim() : "";

    if (status !== "open" && status !== "in_progress") {
      kept.push(line);
      continue;
    }

    const over = daysOverdue(dueRaw, iso);
    if (over !== null && over > daysGrace) {
      // Mark as expired in-place for the archive copy.
      const archived = [...cells];
      archived[4] = " expired ";
      toArchive.push(archived.join("|"));
    } else {
      kept.push(line);
    }
  }

  if (toArchive.length === 0) return 0;

  await writeFile(entry.path, kept.join("\n"));
  await archiveNudgeRows(toArchive);
  return toArchive.length;
}

/**
 * Create or update a weekly summary.
 */
export async function writeWeeklySummary(
  week: string,
  content: string
): Promise<string> {
  const weeklyDir = join(config.vaultPath, "AI-Observations", "weekly");
  await mkdir(weeklyDir, { recursive: true });

  const filePath = join(weeklyDir, `${week}.md`);
  const fm = {
    type: "ai-weekly-summary",
    week,
    tags: ["ai", "weekly-summary"],
    created: today(),
    updated: today(),
  };

  const fileContent = matter.stringify(
    `\n# Weekly Summary — ${week}\n\n${content}\n`,
    fm
  );

  await writeFile(filePath, fileContent);
  await frontmatterIndex.indexFile(filePath);
  await gitCommitAndPush(`AI weekly summary: ${week}`);

  return `Weekly summary written for ${week}`;
}

/**
 * Sort the nudges table so ACTIVE rows (open + in_progress) come first, ordered
 * P0 > P1 > P2 > P3, with in_progress ahead of open at equal priority (actively
 * cooking floats to the top). Closed rows (addressed, wont_do) follow in
 * original order. Header and separator lines are preserved; the reconstructed
 * table is returned. Tolerant of the trailing resolution column (it sits after
 * the note, so it never shifts the status/priority cells the sort reads).
 */
function sortNudgesByPriority(content: string): string {
  const lines = content.split("\n");
  const isTableRow = (l: string) => l.trimStart().startsWith("|");

  const firstTable = lines.findIndex(isTableRow);
  // Need at least a header + separator + one data row to sort anything.
  if (firstTable === -1 || firstTable + 2 >= lines.length) {
    return content;
  }

  // Everything up to and including the header + separator rows stays put.
  const dataStart = firstTable + 2;
  const head = lines.slice(0, dataStart);
  const rows: string[] = [];
  const trailing: string[] = [];
  for (let i = dataStart; i < lines.length; i++) {
    if (isTableRow(lines[i])) rows.push(lines[i]);
    else trailing.push(lines[i]);
  }

  const rankOf = (p: string): number =>
    ({ P0: 0, P1: 1, P2: 2, P3: 3 } as Record<string, number>)[p] ?? 2;

  // Columns: ["", goal, first, last, status, priority, note, (resolution,) ""].
  // Cells before the note are pipe-free, so splitting on "|" indexes
  // status/priority safely regardless of the trailing resolution column.
  const parse = (row: string): { status: string; priority: string } => {
    const cells = row.split("|").map((c) => c.trim());
    return {
      status: (cells[4] || "").toLowerCase(),
      priority: (cells[5] || "").toUpperCase(),
    };
  };

  const isActive = (s: string) => s === "open" || s === "in_progress";
  const active = rows.filter((r) => isActive(parse(r).status));
  const rest = rows.filter((r) => !isActive(parse(r).status));
  // Sort active by priority; within equal priority, in_progress before open so
  // what's actively being worked on floats to the top. Stable otherwise.
  const inProgFirst = (s: string) => (s === "in_progress" ? 0 : 1);
  active.sort((a, b) => {
    const pa = parse(a);
    const pb = parse(b);
    const byPriority = rankOf(pa.priority) - rankOf(pb.priority);
    if (byPriority !== 0) return byPriority;
    return inProgFirst(pa.status) - inProgFirst(pb.status);
  });

  return [...head, ...active, ...rest, ...trailing].join("\n");
}

/**
 * Read AI observations for a given topic. For scratchpad, `days` filters to
 * entries from the last N days (inclusive of today), `maxEntries` caps to the
 * most-recent N entries as a safety fallback, and `includeArchive` splices in
 * the monthly archive files written by scripts/decay-scratchpad.ts so
 * subject/search filters can reach past the live rolling window.
 */
export async function getObservations(
  topic: "patterns" | "nudges" | "scratchpad",
  days?: number,
  maxEntries?: number,
  type?: string,
  subject?: string,
  search?: string,
  includeArchive?: boolean,
): Promise<string> {
  const entry = frontmatterIndex.findOne({
    type: "ai-observation",
    topic,
  });

  if (!entry) {
    return `No AI observations file found for topic "${topic}"`;
  }

  const raw = await readFile(entry.path, "utf-8");
  const { content } = matter(raw);

  if (topic === "nudges") {
    return sortNudgesByPriority(content);
  }

  const hasFilter =
    days !== undefined ||
    maxEntries !== undefined ||
    type !== undefined ||
    subject !== undefined ||
    search !== undefined;

  if (topic !== "scratchpad" || !hasFilter) {
    return content;
  }

  // Optionally splice in the monthly archive files (written by
  // scripts/decay-scratchpad.ts) so subject/search filters can reach past the
  // live rolling window. Archive entries come first; the combined list is
  // re-sorted by timestamp below since decay appends out of order.
  let combined = content;
  if (includeArchive) {
    const dir = join(config.vaultPath, "AI-Observations");
    const names = (await readdir(dir))
      .filter((n) => /^scratchpad-archive-\d{4}-\d{2}\.md$/.test(n))
      .sort();
    const archived: string[] = [];
    for (const n of names) {
      const { content: c } = matter(await readFile(join(dir, n), "utf-8"));
      const idx = c.search(/^### \d{4}-\d{2}-\d{2}\b/m);
      if (idx >= 0) archived.push(c.slice(idx));
    }
    const liveIdx = content.search(/^### \d{4}-\d{2}-\d{2}\b/m);
    const livePreamble = liveIdx >= 0 ? content.slice(0, liveIdx) : content;
    const liveEntries = liveIdx >= 0 ? content.slice(liveIdx) : "";
    combined = [livePreamble, ...archived, liveEntries].join("\n");
  }

  const lines = combined.split("\n");
  const entryStartRe = /^### (\d{4}-\d{2}-\d{2})\b/;

  const header: string[] = [];
  const entries: {
    date: string;
    type?: string;
    subject?: string;
    text: string;
  }[] = [];
  let current: { date: string; lines: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    const headerLine = current.lines[0] || "";
    const t = headerLine.match(/\btype:\s*([^|]+)/i);
    const s = headerLine.match(/\bsubject:\s*([^|]+)/i);
    entries.push({
      date: current.date,
      type: t ? t[1].trim() : undefined,
      subject: s ? s[1].trim() : undefined,
      text: current.lines.join("\n"),
    });
  };

  for (const line of lines) {
    const match = line.match(entryStartRe);
    if (match) {
      flush();
      current = { date: match[1], lines: [line] };
    } else if (current) {
      current.lines.push(line);
    } else {
      header.push(line);
    }
  }
  flush();

  if (includeArchive) {
    // Header is "### YYYY-MM-DD HH:MM | ..." so a plain string compare on the
    // first 16 chars sorts chronologically.
    entries.sort((a, b) => a.text.slice(4, 20).localeCompare(b.text.slice(4, 20)));
  }

  let filtered = entries;
  if (days !== undefined) {
    // Compute cutoff in the same TZ that scratchpad entries are stamped in (see today()).
    const cutoffStr = new Date(Date.now() - (days - 1) * 86_400_000)
      .toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    filtered = filtered.filter((e) => e.date >= cutoffStr);
  }
  if (type !== undefined) {
    const want = type.toLowerCase();
    filtered = filtered.filter((e) => e.type?.toLowerCase() === want);
  }
  if (subject !== undefined) {
    const want = subject.toLowerCase();
    filtered = filtered.filter((e) => e.subject?.toLowerCase() === want);
  }
  if (search !== undefined) {
    const want = search.toLowerCase();
    filtered = filtered.filter((e) => e.text.toLowerCase().includes(want));
  }
  if (maxEntries !== undefined && filtered.length > maxEntries) {
    filtered = filtered.slice(-maxEntries);
  }

  if (filtered.length === 0) {
    return (
      [...header, "_(no scratchpad entries matched the given filters)_"]
        .join("\n")
        .trimEnd() + "\n"
    );
  }

  return [...header, ...filtered.map((e) => e.text)].join("\n").trimEnd() + "\n";
}
