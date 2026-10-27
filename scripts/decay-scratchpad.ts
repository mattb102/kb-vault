import { writeFile, readFile } from "fs/promises";
import matter from "gray-matter";
import {
  readScratchpad,
  renderEntry,
  partitionForDecay,
  mergeArchiveEntries,
  readArchiveMonthEntries,
  archiveMonthPath,
  currentMonthET,
  parseScratchpad,
  type Entry,
} from "../src/core/scratchpad.js";

// Nightly scratchpad decay: entries from earlier calendar months are moved from
// the live scratchpad to monthly archive files (AI-Observations/scratchpad-archive-YYYY-MM.md).
// The live file always holds only the current calendar month (America/New_York).
// Archived entries are searchable via get_observations with include_archive=true.

const DRY_RUN = process.argv.includes("--dry-run");
// Override the "current" month (YYYY-MM) for testing/backfill; defaults to the
// real current calendar month in America/New_York.
const MONTH_ARG = process.argv.find((a) => a.startsWith("--month="));
const CURRENT_MONTH = MONTH_ARG ? MONTH_ARG.split("=")[1] : currentMonthET();

function renderEntries(entries: Entry[]): string {
  return entries.map(renderEntry).join("\n\n");
}

/**
 * Rewrite one archive month file with the merged (existing + incoming),
 * de-duplicated, chronologically-ordered entries. Preserves the file's
 * frontmatter and preamble if it already exists; otherwise creates both.
 */
async function writeArchiveMonth(month: string, incoming: Entry[]): Promise<number> {
  const path = archiveMonthPath(month);

  let frontmatter: Record<string, unknown>;
  let preamble: string;
  let existing: Entry[] = [];
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = matter(raw);
    frontmatter = parsed.data;
    const p = parseScratchpad(parsed.content);
    preamble = p.preamble;
    existing = p.entries;
  } catch {
    frontmatter = {
      type: "ai-observation-archive",
      topic: "scratchpad-archive",
      month,
      tags: ["ai", "observations", "scratchpad", "archive"],
      created: new Date().toISOString().split("T")[0],
    };
    preamble = `\n# Scratchpad Archive — ${month}\n\nArchived observations from the AI scratchpad. The live scratchpad holds only the current calendar month; entries from earlier months are moved here, one file per month.`;
  }

  const merged = mergeArchiveEntries(existing, incoming);
  const body = preamble.replace(/\s+$/, "") + "\n\n" + renderEntries(merged) + "\n";
  const content = matter.stringify(body, {
    ...frontmatter,
    updated: new Date().toISOString().split("T")[0],
  });

  if (!DRY_RUN) await writeFile(path, content);
  return merged.length - existing.length; // net new rows added this run
}

async function main() {
  const { path: scratchpadPath, frontmatter, preamble, entries } = await readScratchpad();

  const { kept, byMonth } = partitionForDecay(entries, CURRENT_MONTH);
  const moved = [...byMonth.values()].reduce((n, es) => n + es.length, 0);

  if (byMonth.size === 0) {
    console.log(
      `Live scratchpad already holds only ${CURRENT_MONTH} (${entries.length} entries). Nothing to archive.`,
    );
    return;
  }

  const months = [...byMonth.keys()].sort();
  console.log(
    `Current month: ${CURRENT_MONTH}. Archiving ${moved} of ${entries.length} entries across ${months.length} month(s): ${months.join(", ")}`,
  );

  if (DRY_RUN) {
    for (const m of months) {
      console.log(`  ${m}: ${byMonth.get(m)!.length} entries`);
    }
    console.log(`Live would go ${entries.length} -> ${kept.length} entries.`);
    return;
  }

  let newlyArchived = 0;
  for (const m of months) {
    newlyArchived += await writeArchiveMonth(m, byMonth.get(m)!);
  }

  const newContent =
    preamble.replace(/\s+$/, "") + "\n" + renderEntries(kept) + "\n";
  const rewritten = matter.stringify(newContent, {
    ...frontmatter,
    updated: new Date().toISOString().split("T")[0],
  });
  await writeFile(scratchpadPath, rewritten);

  // Count invariant: everything in the live file before the run is either kept
  // or moved. (newlyArchived may be < moved if some entries were already in an
  // archive from a prior run -- dedupe absorbs those.)
  console.log(
    `Live scratchpad: ${entries.length} -> ${kept.length} entries (moved ${moved}, ${newlyArchived} net-new into archives).`,
  );
  if (kept.length + moved !== entries.length) {
    console.error(
      `WARNING: count mismatch -- kept(${kept.length}) + moved(${moved}) != before(${entries.length})`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
