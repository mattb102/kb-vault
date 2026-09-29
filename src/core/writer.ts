import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import matter from "gray-matter";
import { config } from "./config.js";
import { frontmatterIndex, type FileEntry } from "./frontmatter.js";
import { absPath, today, nowTime } from "./utils.js";
import { gitCommitAndPush } from "./sync.js";

/**
 * Append a timestamped metric row to a metric-log file.
 * Finds the file by frontmatter: type=metric-log, metric=<metric>.
 */
export async function logMetric(
  metric: string,
  value: string,
  note?: string
): Promise<string> {
  const entry = frontmatterIndex.findOne({
    type: "metric-log",
    metric,
  });

  if (!entry) {
    throw new Error(
      `No metric-log file found for metric "${metric}". Create one with frontmatter: type: metric-log, metric: ${metric}`
    );
  }

  const row = `| ${today()} | ${value} | ${note || ""} |`;
  const content = await readFile(entry.path, "utf-8");
  const updatedContent = content.trimEnd() + "\n" + row + "\n";

  await writeFile(entry.path, updatedContent);
  await gitCommitAndPush(`Log ${metric}: ${value}`);

  return `Logged ${metric}=${value} to ${entry.relPath}`;
}

/**
 * Replace a specific section (identified by header) in an existing note.
 */
export async function updateNoteSection(
  path: string,
  sectionHeader: string,
  newContent: string
): Promise<string> {
  const filePath = absPath(path);
  const raw = await readFile(filePath, "utf-8");
  const lines = raw.split("\n");

  let sectionStart = -1;
  let sectionEnd = lines.length;
  let sectionLevel = 0;

  // Find the section header
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,6})\s+(.+)/);
    if (match && match[2].trim() === sectionHeader) {
      sectionStart = i;
      sectionLevel = match[1].length;
      continue;
    }
    // Find where the section ends (next header of same or higher level)
    if (sectionStart >= 0 && match && match[1].length <= sectionLevel) {
      sectionEnd = i;
      break;
    }
  }

  if (sectionStart === -1) {
    throw new Error(
      `Section "${sectionHeader}" not found in ${path}`
    );
  }

  // Replace section content (keep the header line)
  const before = lines.slice(0, sectionStart + 1);
  const after = lines.slice(sectionEnd);
  const updated = [...before, newContent, ...after].join("\n");

  await writeFile(filePath, updated);
  await gitCommitAndPush(`Update section "${sectionHeader}" in ${path}`);

  return `Updated section "${sectionHeader}" in ${path}`;
}

/**
 * Append content to the end of a note.
 */
export async function appendToNote(
  path: string,
  content: string
): Promise<string> {
  const filePath = absPath(path);
  const raw = await readFile(filePath, "utf-8");
  const updated = raw.trimEnd() + "\n\n" + content + "\n";

  await writeFile(filePath, updated);
  await gitCommitAndPush(`Append to ${path}`);

  return `Appended content to ${path}`;
}

/**
 * Create a new note with frontmatter.
 */
export async function createNote(
  folder: string,
  title: string,
  content: string,
  fm: Record<string, unknown>
): Promise<string> {
  const dir = join(config.vaultPath, folder);
  await mkdir(dir, { recursive: true });

  const filename = title.replace(/[^a-zA-Z0-9-_ ]/g, "").replace(/\s+/g, "-");
  const filePath = join(dir, `${filename}.md`);
  const relP = `${folder}/${filename}.md`;

  // Build frontmatter
  const frontmatterData = {
    ...fm,
    created: today(),
    updated: today(),
  };

  const fileContent = matter.stringify(`\n# ${title}\n\n${content}\n`, frontmatterData);

  await writeFile(filePath, fileContent);
  await frontmatterIndex.indexFile(filePath);
  await gitCommitAndPush(`Create note: ${title}`);

  return `Created ${relP}`;
}

/**
 * Append a timestamped thought to today's stream file.
 */
export async function logStream(content: string): Promise<string> {
  const dateStr = today();
  const streamDir = join(config.vaultPath, "Stream");
  await mkdir(streamDir, { recursive: true });

  const filePath = join(streamDir, `${dateStr}-stream.md`);
  let existing = "";

  try {
    existing = await readFile(filePath, "utf-8");
  } catch {
    // File doesn't exist, create with frontmatter
    const fm = {
      type: "stream",
      date: dateStr,
      tags: ["stream"],
      created: dateStr,
      updated: dateStr,
    };
    existing = matter.stringify(`\n# Stream — ${dateStr}\n`, fm);
  }

  const entry = `\n---\n**${nowTime()}**\n\n${content}\n`;
  const updated = existing.trimEnd() + entry;

  await writeFile(filePath, updated);
  await frontmatterIndex.indexFile(filePath);
  await gitCommitAndPush(`Stream entry: ${dateStr}`);

  return `Logged stream entry for ${dateStr}`;
}

/**
 * Append a formatted entry to an interest note located by frontmatter
 * (interest + topic) — e.g. a fishing catch, a ski day, a new spot — without
 * needing the file path. The entry is appended verbatim: match the target note's
 * existing format (dated H2 block for catch-log, a table row for season-log, a
 * bullet for spots/gear). Unknown interest/topic returns the valid options rather
 * than failing blind.
 */
export async function logInterestEntry(
  interest: string,
  topic: string,
  entry: string,
): Promise<string> {
  await frontmatterIndex.rebuild();
  const note = frontmatterIndex.findOne({ interest, topic });
  if (!note) {
    const forInterest = frontmatterIndex
      .find({ interest })
      .filter((e) => e.frontmatter.topic)
      .map((e) => `${e.frontmatter.topic} (${e.relPath})`);
    if (forInterest.length) {
      throw new Error(
        `No note with interest=${interest} topic=${topic}. Topics for "${interest}": ${forInterest.join(", ")}`,
      );
    }
    const interests = [
      ...new Set(
        frontmatterIndex
          .all()
          .map((e) => e.frontmatter.interest)
          .filter((v): v is string => typeof v === "string"),
      ),
    ].sort();
    throw new Error(
      `No notes with interest=${interest}. Known interests: ${interests.length ? interests.join(", ") : "(none yet)"}`,
    );
  }

  const raw = await readFile(note.path, "utf-8");
  let updated = raw.trimEnd() + "\n\n" + entry.trim() + "\n";
  // Keep the frontmatter updated: date up to the tick
  updated = updated.replace(/^updated: .*$/m, `updated: '${today()}'`);

  await writeFile(note.path, updated);
  await frontmatterIndex.indexFile(note.path);
  await gitCommitAndPush(`Log ${interest}/${topic} entry`);

  return `Logged to ${note.relPath}`;
}

/**
 * Update a section in a core identity file.
 * Finds by frontmatter: type=core, topic=<topic>.
 */
export async function updateIdentityField(
  topic: string,
  section: string,
  content: string
): Promise<string> {
  const entry = frontmatterIndex.findOne({
    type: "core",
    topic,
  });

  if (!entry) {
    throw new Error(
      `No core file found for topic "${topic}". Create one with frontmatter: type: core, topic: ${topic}`
    );
  }

  return updateNoteSection(entry.relPath, section, content);
}
