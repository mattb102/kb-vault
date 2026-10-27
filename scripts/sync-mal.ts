/**
 * Sync your MyAnimeList data to vault media files.
 *
 * Writes two files:
 *   Media/tv.md    -- TV series, ONAs, and other non-movie types
 *   Media/movies.md -- anime films
 *
 * Per-item files in Media/TV/ and Media/Movies/ can link back via mal_id
 * (single season) or mal_ids (array, for multi-season series) frontmatter.
 *
 * Requires: MAL_USERNAME env var (your public MAL username).
 */
import { readFile, writeFile, readdir } from "fs/promises";
import { join } from "path";
import matter from "gray-matter";
import { config } from "../src/core/config.js";
import { today } from "../src/core/utils.js";

const MAL_USERNAME = process.env.MAL_USERNAME || "";
if (!MAL_USERNAME) {
  console.error("MAL_USERNAME env var is required");
  process.exit(1);
}

export interface MALEntry {
  anime_title: string;
  anime_id: number;
  anime_media_type_string: string; // "TV", "Movie", "OVA", "ONA", "Special", "Music"
  score: number;
  status: number; // 1=Watching, 2=Completed, 3=On Hold, 4=Dropped, 6=Plan to Watch
  anime_num_episodes: number;
  num_watched_episodes: number;
}

export const STATUS_MAP: Record<number, string> = {
  1: "Watching",
  2: "Completed",
  3: "On Hold",
  4: "Dropped",
  6: "Plan to Watch",
};

/** Returns true for entries that belong in movies.md (not tv.md). */
export function isMovieType(entry: Pick<MALEntry, "anime_media_type_string">): boolean {
  return entry.anime_media_type_string === "Movie";
}

async function fetchMALList(): Promise<MALEntry[]> {
  const url = `https://myanimelist.net/animelist/${MAL_USERNAME}?status=7`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; kb-sync/1.0)" },
  });
  const html = await res.text();

  const match = html.match(/data-items="([^"]*)"/);
  if (!match) {
    console.error("Could not find data-items in MAL page");
    return [];
  }

  const decoded = match[1]
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#039;/g, "'");

  return JSON.parse(decoded);
}

interface PerItemFile {
  rel: string;
  slug: string;
  malId: number;
}

/**
 * Extract MAL IDs from parsed frontmatter data.
 * Accepts `mal_ids: [n, ...]` (multi-season) or `mal_id: n` (single).
 */
export function parseMalIdsFromFrontmatter(data: Record<string, unknown>): number[] {
  const malIds = data.mal_ids;
  if (Array.isArray(malIds) && malIds.length > 0) {
    return (malIds as unknown[]).filter((id): id is number => typeof id === "number" && id > 0);
  }
  const malId = data.mal_id;
  if (typeof malId === "number" && malId > 0) return [malId];
  return [];
}

/** Scan a Media subdirectory for per-item files that have a mal_id in frontmatter. */
async function loadPerItemFiles(subdir: string): Promise<PerItemFile[]> {
  const dirPath = join(config.vaultPath, subdir);
  let names: string[];
  try {
    names = await readdir(dirPath);
  } catch {
    return [];
  }
  const out: PerItemFile[] = [];
  for (const n of names.filter((x) => x.endsWith(".md") && x !== "README.md")) {
    const rel = `${subdir}/${n}`;
    try {
      const raw = await readFile(join(config.vaultPath, rel), "utf-8");
      const parsed = matter(raw);
      for (const id of parseMalIdsFromFrontmatter(parsed.data)) {
        out.push({ rel, slug: n.replace(/\.md$/, ""), malId: id });
      }
    } catch {
      // skip unreadable files
    }
  }
  return out;
}

/** Extract rows from a markdown table section that do NOT match any MAL anime title. */
export function extractHandRows(
  tableText: string,
  malTitles: Set<string>
): string[] {
  const lines = tableText.split("\n");
  const rows: string[] = [];
  for (const line of lines) {
    if (!line.startsWith("|")) continue;
    if (line.includes("---")) continue;
    const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
    if (!cells.length) continue;
    const firstCell = cells[0].toLowerCase();
    if (firstCell === "title") continue;
    const title = cells[0].replace(/\[\[.*?\|?(.*?)\]\]/g, "$1").trim();
    if (!malTitles.has(title.toLowerCase())) {
      rows.push(line);
    }
  }
  return rows;
}

async function loadExistingHandRows(
  filePath: string,
  malTitles: Set<string>
): Promise<string[]> {
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = matter(raw);
    return extractHandRows(parsed.content, malTitles);
  } catch {
    return [];
  }
}

async function main() {
  console.log(`Syncing MAL list for ${MAL_USERNAME}...`);

  const entries = await fetchMALList();

  const tvEntries = entries.filter((e) => !isMovieType(e));
  const movieEntries = entries.filter((e) => isMovieType(e));

  const malTitles = new Set(entries.map((e) => e.anime_title.toLowerCase()));

  const tvFiles = await loadPerItemFiles("Media/TV");
  const movieFiles = await loadPerItemFiles("Media/Movies");
  const tvById = new Map(tvFiles.map((f) => [f.malId, f.slug]));
  const movieById = new Map(movieFiles.map((f) => [f.malId, f.slug]));

  const tvPath = join(config.vaultPath, "Media", "tv.md");
  const moviesPath = join(config.vaultPath, "Media", "movies.md");

  const tvHandRows = await loadExistingHandRows(tvPath, malTitles);
  const movieHandRows = await loadExistingHandRows(moviesPath, malTitles);

  // ── TV ───────────────────────────────────────────────────────────────────────

  const tvCompleted = tvEntries.filter((e) => e.status === 2);
  const tvWatching = tvEntries.filter((e) => e.status === 1);
  const tvOnHold = tvEntries.filter((e) => e.status === 3);
  const tvPlanToWatch = tvEntries.filter((e) => e.status === 6);

  const sortByScore = (a: MALEntry, b: MALEntry) =>
    b.score - a.score || a.anime_title.localeCompare(b.anime_title);

  tvCompleted.sort(sortByScore);

  const tvFavorites = tvCompleted
    .filter((e) => e.score >= 9)
    .map((e) => `- ${e.anime_title} (${e.score}/10)`)
    .join("\n");

  const tvWatchingRows = tvWatching
    .map((e) => {
      const link = tvById.has(e.anime_id) ? `[[Media/TV/${tvById.get(e.anime_id)}]]` : "";
      return `| ${e.anime_title} | ${e.num_watched_episodes}/${e.anime_num_episodes} | ${link} |`;
    })
    .join("\n");

  const tvOnHoldRows = tvOnHold
    .map((e) => {
      const link = tvById.has(e.anime_id) ? `[[Media/TV/${tvById.get(e.anime_id)}]]` : "";
      return `| ${e.anime_title} | ${e.num_watched_episodes}/${e.anime_num_episodes} | ${link} |`;
    })
    .join("\n");

  const tvWatchedRows = [
    ...tvCompleted.map((e) => {
      const link = tvById.has(e.anime_id) ? `[[Media/TV/${tvById.get(e.anime_id)}]]` : "";
      return `| ${e.anime_title} | ${e.score || ""}/10 | ${link} |`;
    }),
    ...tvHandRows,
  ].join("\n");

  const tvPtw = tvPlanToWatch.map((e) => `- ${e.anime_title}`).join("\n") || "";

  const tvMeanScore = tvCompleted.filter((e) => e.score > 0).length
    ? (tvCompleted.reduce((a, e) => a + (e.score || 0), 0) /
        tvCompleted.filter((e) => e.score > 0).length).toFixed(1)
    : "";

  const tvContent = `*Auto-synced from MyAnimeList (${MAL_USERNAME}). Last updated: ${today()}.*
*Non-anime rows are hand-entered and preserved across syncs.*
**Total anime:** ${tvEntries.length} entries | **Completed:** ${tvCompleted.length} | **Mean Score:** ${tvMeanScore}/10

## Favorites
${tvFavorites}

## Currently Watching

| Title | Episode | Notes |
|-------|---------|-------|
${tvWatchingRows || "*(nothing currently)*"}

## On Hold

| Title | Episode | Notes |
|-------|---------|-------|
${tvOnHoldRows || "*(nothing on hold)*"}

## Watched

| Title | Rating | Notes |
|-------|--------|-------|
${tvWatchedRows}

## Want to Watch
${tvPtw}
`;

  const tvFm = {
    type: "media-log",
    media: "tv",
    tags: ["media", "tv", "anime"],
    mal_username: MAL_USERNAME,
    updated: today(),
  };

  await writeFile(tvPath, matter.stringify("\n# TV\n\n" + tvContent, tvFm));
  console.log(`Written tv.md: ${tvEntries.length} TV entries`);

  // ── Movies ───────────────────────────────────────────────────────────────────

  const moviesCompleted = movieEntries.filter((e) => e.status === 2);
  const moviesPtw = movieEntries.filter((e) => e.status === 6);

  moviesCompleted.sort(sortByScore);

  const movieFavorites = moviesCompleted
    .filter((e) => e.score >= 9)
    .map((e) => `- ${e.anime_title} (${e.score}/10)`)
    .join("\n");

  const movieWatchedRows = [
    ...moviesCompleted.map((e) => {
      const link = movieById.has(e.anime_id) ? `[[Media/Movies/${movieById.get(e.anime_id)}]]` : "";
      return `| ${e.anime_title} | ${e.score || ""}/10 | ${link} |`;
    }),
    ...movieHandRows,
  ].join("\n");

  const moviesPtwList = moviesPtw.map((e) => `- ${e.anime_title}`).join("\n") || "";

  const moviesContent = `*Auto-synced from MyAnimeList (${MAL_USERNAME}) for anime films. Last updated: ${today()}.*
*Non-anime rows are hand-entered and preserved across syncs.*

## Favorites
${movieFavorites || "*(none yet)*"}

## Watched

| Title | Rating | Notes |
|-------|--------|-------|
${movieWatchedRows}

## Want to Watch
${moviesPtwList}
`;

  const moviesFm = {
    type: "media-log",
    media: "movies",
    tags: ["media", "movies"],
    mal_username: MAL_USERNAME,
    updated: today(),
  };

  await writeFile(moviesPath, matter.stringify("\n# Movies\n\n" + moviesContent, moviesFm));
  console.log(`Written movies.md: ${movieEntries.length} movie entries`);
  console.log(`Total MAL: ${entries.length}, TV: ${tvEntries.length}, Movies: ${movieEntries.length}`);
}

if (process.argv[1]?.includes("sync-mal")) {
  main().catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
}
