import { writeFile, appendFile, access, mkdir } from "fs/promises";
import { join, dirname } from "path";
import matter from "gray-matter";
import { config } from "../src/core/config.js";
import { readScratchpad, renderEntry, type Entry } from "../src/core/scratchpad.js";

// Nightly scratchpad decay: entries older than DECAY_DAYS are moved from the
// live scratchpad to monthly archive files (AI-Observations/scratchpad-archive-YYYY-MM.md).
// The live file is a rolling window; the archives are readable via get_observations
// with include_archive=true.
//
// Window is read from config.decay.scratchpadDecayDays (default 120 days).
// Override on the command line: --days=90

const DAYS_ARG = process.argv.find((a) => a.startsWith("--days="));
const DECAY_DAYS = DAYS_ARG
  ? parseInt(DAYS_ARG.split("=")[1], 10)
  : config.decay.scratchpadDecayDays;

const ARCHIVE_DIR_REL = "AI-Observations";
const DRY_RUN = process.argv.includes("--dry-run");

function shouldArchive(entries: Entry[], cutoff: Date): Set<number> {
  const toArchive = new Set<number>();
  entries.forEach((e, i) => {
    if (e.date < cutoff) toArchive.add(i);
  });
  return toArchive;
}

function archiveMonthKey(e: Entry): string {
  return e.timestamp.slice(0, 7); // YYYY-MM
}

async function appendArchive(month: string, rendered: string[]): Promise<void> {
  const path = join(config.vaultPath, ARCHIVE_DIR_REL, `scratchpad-archive-${month}.md`);
  let exists = false;
  try {
    await access(path);
    exists = true;
  } catch {}

  if (!exists) {
    const fm = {
      type: "ai-observation-archive",
      topic: "scratchpad-archive",
      month,
      tags: ["ai", "observations", "scratchpad", "archive"],
      created: new Date().toISOString().split("T")[0],
    };
    const header = matter.stringify(
      `\n# Scratchpad Archive — ${month}\n\nArchived observations from the AI scratchpad. Entries older than ${DECAY_DAYS} days are moved here from the live scratchpad.\n`,
      fm,
    );
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, header);
  }

  await appendFile(path, "\n" + rendered.join("\n\n") + "\n");
}

async function main() {
  const { path: scratchpadPath, frontmatter, preamble, entries } = await readScratchpad();

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - DECAY_DAYS);

  const archiveIdxs = shouldArchive(entries, cutoff);
  if (archiveIdxs.size === 0) {
    console.log(`No entries older than ${DECAY_DAYS} days to archive. (${entries.length} total)`);
    return;
  }

  const byMonth = new Map<string, string[]>();
  const kept: Entry[] = [];
  entries.forEach((e, i) => {
    if (archiveIdxs.has(i)) {
      const m = archiveMonthKey(e);
      if (!byMonth.has(m)) byMonth.set(m, []);
      byMonth.get(m)!.push(renderEntry(e));
    } else {
      kept.push(e);
    }
  });

  console.log(
    `Archiving ${archiveIdxs.size} of ${entries.length} entries across ${byMonth.size} month(s): ${[...byMonth.keys()].join(", ")}`,
  );

  if (DRY_RUN) {
    for (const [month, rendered] of byMonth) {
      console.log(`\n--- ${month} (${rendered.length} entries) ---`);
      for (const r of rendered) console.log(r.split("\n")[0]);
    }
    return;
  }

  for (const [month, rendered] of byMonth) {
    await appendArchive(month, rendered);
  }

  const newContent =
    preamble.replace(/\s+$/, "") +
    "\n" +
    kept.map(renderEntry).join("\n\n") +
    "\n";
  const rewritten = matter.stringify(newContent, {
    ...frontmatter,
    updated: new Date().toISOString().split("T")[0],
  });
  await writeFile(scratchpadPath, rewritten);

  console.log(`Scratchpad: ${entries.length} → ${kept.length} entries.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
