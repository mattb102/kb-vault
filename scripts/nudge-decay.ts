import { readFile, writeFile } from "fs/promises";
import { frontmatterIndex } from "../src/core/frontmatter.js";
import { archiveNudgeRows, logObservation } from "../src/core/observer.js";
import { today } from "../src/core/utils.js";
import { config } from "../src/core/config.js";

// Weekly nudge decay: open P2/P3 nudges untouched for STALE_DAYS move to the
// archive as `expired`, and each expiry is logged to the scratchpad under
// behavior/abandoned-intentions so the promote pipeline can synthesize
// follow-through patterns instead of abandoned intentions just vanishing.
// P0/P1 are exempt: a stale high-priority nudge is a signal to surface, not bury.
//
// Threshold is read from config.decay.nudgeDecayDays (default 60 days).
// Override on the command line: --days=90

const DAYS_ARG = process.argv.find((a) => a.startsWith("--days="));
const STALE_DAYS = DAYS_ARG
  ? parseInt(DAYS_ARG.split("=")[1], 10)
  : config.decay.nudgeDecayDays;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  await frontmatterIndex.rebuild();

  const entry = frontmatterIndex.findOne({
    type: "ai-observation",
    topic: "nudges",
  });
  if (!entry) throw new Error("AI nudges file not found");

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - STALE_DAYS);
  const cutoffStr = cutoff.toLocaleDateString("en-CA");

  const raw = await readFile(entry.path, "utf-8");
  const lines = raw.split("\n");

  const kept: string[] = [];
  const expired: { row: string; goal: string; first: string; last: string; priority: string }[] = [];
  let dataRowsSeen = 0;

  for (const line of lines) {
    if (!line.trimStart().startsWith("|")) {
      kept.push(line);
      continue;
    }
    dataRowsSeen++;
    // Header + separator are the first two table rows.
    if (dataRowsSeen <= 2) {
      kept.push(line);
      continue;
    }
    // Columns (unescaped-pipe split): ["", goal, first, last, status, priority, note, resolution, due, ""]
    const cells = line.split(/(?<!\\)\|/);
    const status = (cells[4] || "").trim().toLowerCase();
    const priority = (cells[5] || "").trim().toUpperCase();
    const last = (cells[3] || "").trim();
    if (
      status === "open" &&
      (priority === "P2" || priority === "P3") &&
      /^\d{4}-\d{2}-\d{2}$/.test(last) &&
      last < cutoffStr
    ) {
      cells[4] = " expired ";
      const resCell = ` auto-expired ${today()}: untouched ${STALE_DAYS}+ days `;
      // Resolution lives at index 7; insert before trailing "" if not present.
      if (cells.length >= 9) {
        cells[7] = resCell;
      } else {
        cells.splice(cells.length - 1, 0, resCell);
      }
      expired.push({
        row: cells.join("|"),
        goal: (cells[1] || "").trim(),
        first: (cells[2] || "").trim(),
        last,
        priority,
      });
    } else {
      kept.push(line);
    }
  }

  if (expired.length === 0) {
    console.log(`No open ${STALE_DAYS}d-stale P2/P3 nudges to expire.`);
    return;
  }

  console.log(`Expiring ${expired.length} nudge(s):`);
  for (const e of expired) {
    console.log(`  - [${e.priority}] ${e.goal.slice(0, 90)} (last touched ${e.last})`);
  }
  if (dryRun) return;

  await archiveNudgeRows(expired.map((e) => e.row));
  await writeFile(entry.path, kept.join("\n"));

  // One observation per expiry feeds the follow-through pattern cluster.
  for (const e of expired) {
    await logObservation(
      `Nudge expired unactioned after ${STALE_DAYS}+ days: "${e.goal}" (${e.priority}, first mentioned ${e.first}, last touched ${e.last}). Logged as intention, never closed.`,
      "behavior",
      "abandoned-intentions",
    );
  }
}

main().catch((err) => {
  console.error("nudge-decay failed:", err);
  process.exit(1);
});
