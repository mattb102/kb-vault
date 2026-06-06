import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import matter from "gray-matter";
import { config } from "./config.js";
import { frontmatterIndex } from "./frontmatter.js";
import { absPath, today, nowTime, currentWeek } from "./utils.js";
import { gitCommitAndPush } from "./sync.js";

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

/**
 * Add an accountability nudge.
 */
export async function logNudge(
  goal: string,
  lastMentioned: string,
  note?: string,
  priority: "P0" | "P1" | "P2" | "P3" = "P2"
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
  // Column order: goal | first | last | status | priority | note | resolution
  // Trailing empty cell keeps the table rectangular (7 columns).
  const row = `| ${sanitize(goal)} | ${lastMentioned} | ${today()} | open | ${priority} | ${sanitize(note || "")} | |`;
  const updated = raw.trimEnd() + "\n" + row + "\n";

  await writeFile(entry.path, updated);
  await gitCommitAndPush(`AI nudge: ${goal}`);

  return `Nudge logged: ${goal}`;
}

/**
 * Set a nudge's status: addressed (did it), wont_do (decided against it), or
 * in_progress (actively being worked on — not done, but no longer untouched).
 * Optionally records a note in the 7th column (a resolution when closing, or a
 * progress note when marking in_progress). Matches the first row with the goal.
 */
export async function clearNudge(
  goal: string,
  resolution?: string,
  status: "addressed" | "wont_do" | "in_progress" = "addressed",
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

  // Anchor on the goal as a full cell: | <goal> | — same matching as before.
  const goalRe = new RegExp(
    `\\|\\s*${goal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\|`,
  );

  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trimStart().startsWith("|") || !goalRe.test(line)) continue;

    // Split on UNESCAPED pipes so escaped pipes (\|) inside the goal/note
    // cells don't shift column indices. The split brackets the row with a
    // leading and trailing "" (text before the first / after the last pipe).
    // Columns: ["", goal, first, last, status, priority, note, (resolution,) ""].
    const cells = line.split(/(?<!\\)\|/);

    // status lives at index 4, ahead of any note pipes, so it's always safe.
    if (cells.length > 5) {
      cells[4] = ` ${status} `;
    }

    if (resolution !== undefined && cells.length >= 8) {
      const resCell = ` ${sanitize(resolution)} `;
      if (cells.length >= 9) {
        // Row already has a 7th (resolution) cell — replace it in place.
        cells[7] = resCell;
      } else {
        // Legacy 6-column row — insert the resolution before the trailing "".
        cells.splice(cells.length - 1, 0, resCell);
      }
    }

    lines[i] = cells.join("|");
    break;
  }

  await writeFile(entry.path, lines.join("\n"));
  const action = status === "in_progress" ? "Mark nudge in-progress" : "Clear nudge";
  await gitCommitAndPush(`${action}: ${goal}`);

  const verb =
    status === "wont_do"
      ? "marked won't-do"
      : status === "in_progress"
        ? "marked in-progress"
        : "addressed";
  return `Nudge ${verb}: ${goal}`;
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
 * entries from the last N days (inclusive of today), and `maxEntries` caps to
 * the most-recent N entries as a safety fallback.
 */
export async function getObservations(
  topic: "patterns" | "nudges" | "scratchpad",
  days?: number,
  maxEntries?: number,
  type?: string,
  subject?: string,
  search?: string,
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

  const lines = content.split("\n");
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
