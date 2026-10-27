/**
 * Sync your Steam library to vault media files.
 *
 * Writes two files:
 *   Media/games.md        -- curated game log with hand-entered notes preserved
 *   Media/steam-library.md -- raw Steam dump (playtime, last played)
 *
 * Per-item files in Media/Games/ can link back via steam_appid frontmatter.
 *
 * Requires:
 *   STEAM_API_KEY env var -- your Steam Web API key (store.steampowered.com/dev/apikey)
 *   STEAM_USER_ID env var -- your 64-bit Steam user ID (profile URL or SteamID64)
 */
import { writeFile, readFile, readdir } from "fs/promises";
import { join } from "path";
import matter from "gray-matter";
import { config } from "../src/core/config.js";
import { today } from "../src/core/utils.js";

const STEAM_KEY = process.env.STEAM_API_KEY || "";
const STEAM_ID = process.env.STEAM_USER_ID || "";

if (!STEAM_KEY || !STEAM_ID) {
  console.error("STEAM_API_KEY and STEAM_USER_ID env vars are required");
  process.exit(1);
}

interface SteamGame {
  appid: number;
  name: string;
  playtime_forever: number;
  rtime_last_played?: number;
  playtime_2weeks?: number;
}

async function fetchOwnedGames(): Promise<SteamGame[]> {
  const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${STEAM_KEY}&steamid=${STEAM_ID}&include_appinfo=1&include_played_free_games=1`;
  const res = await fetch(url);
  const data = await res.json();
  return data.response?.games || [];
}

async function fetchRecentGames(): Promise<SteamGame[]> {
  const url = `https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v1/?key=${STEAM_KEY}&steamid=${STEAM_ID}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.response?.games || [];
}

function formatPlaytime(minutes: number): string {
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

function formatDate(timestamp: number): string {
  if (!timestamp) return "";
  return new Date(timestamp * 1000).toISOString().split("T")[0];
}

interface PerItemGameFile {
  rel: string;
  slug: string;
  appid: number;
}

/**
 * Extract steam_appid from parsed frontmatter data.
 * Accepts `steam_appid: n` (integer).
 */
export function parseSteamAppIdsFromFrontmatter(data: Record<string, unknown>): number[] {
  const appid = data.steam_appid;
  if (typeof appid === "number" && appid > 0) return [appid];
  return [];
}

/** Scan Media/Games/ for per-item files that have a steam_appid in frontmatter. */
async function loadPerItemGameFiles(): Promise<PerItemGameFile[]> {
  const dirPath = join(config.vaultPath, "Media/Games");
  let names: string[];
  try {
    names = await readdir(dirPath);
  } catch {
    return [];
  }
  const out: PerItemGameFile[] = [];
  for (const n of names.filter((x) => x.endsWith(".md") && x !== "README.md")) {
    const rel = `Media/Games/${n}`;
    try {
      const raw = await readFile(join(config.vaultPath, rel), "utf-8");
      const parsed = matter(raw);
      for (const id of parseSteamAppIdsFromFrontmatter(parsed.data as Record<string, unknown>)) {
        out.push({ rel, slug: n.replace(/\.md$/, ""), appid: id });
      }
    } catch {
      // skip unreadable files
    }
  }
  return out;
}

/** Extract rows from a table section that do NOT match any Steam game name. */
export function extractGamesHandRows(
  tableText: string,
  steamTitles: Set<string>
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
    const title = cells[0].replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1").trim();
    if (!steamTitles.has(title.toLowerCase())) {
      rows.push(line);
    }
  }
  return rows;
}

/** Extract a named section's content (between the heading and the next ##). */
export function extractSection(content: string, heading: string): string {
  const lines = content.split("\n");
  let inSection = false;
  const out: string[] = [];
  for (const line of lines) {
    if (line.match(/^## /)) {
      if (inSection) break;
      if (line.trim() === `## ${heading}`) { inSection = true; continue; }
    }
    if (inSection) out.push(line);
  }
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out.join("\n");
}

async function loadExistingHandRows(
  filePath: string,
  steamTitles: Set<string>
): Promise<string[]> {
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = matter(raw);
    const playedSection = extractSection(parsed.content, "Played");
    return extractGamesHandRows(playedSection, steamTitles);
  } catch {
    return [];
  }
}

async function loadPreservedSections(filePath: string): Promise<{ currentlyPlaying: string; wantToPlay: string }> {
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = matter(raw);
    return {
      currentlyPlaying: extractSection(parsed.content, "Currently Playing"),
      wantToPlay: extractSection(parsed.content, "Want to Play"),
    };
  } catch {
    return { currentlyPlaying: "", wantToPlay: "" };
  }
}

async function main() {
  console.log("Syncing Steam library...");

  const games = await fetchOwnedGames();
  const recent = await fetchRecentGames();

  games.sort((a, b) => b.playtime_forever - a.playtime_forever);

  const steamTitles = new Set(games.map((g) => g.name.toLowerCase()));
  const perItemFiles = await loadPerItemGameFiles();
  const byAppId = new Map(perItemFiles.map((f) => [f.appid, f.slug]));

  const gamesIndexPath = join(config.vaultPath, "Media", "games.md");
  const handRows = await loadExistingHandRows(gamesIndexPath, steamTitles);
  const { currentlyPlaying, wantToPlay } = await loadPreservedSections(gamesIndexPath);

  const playedGames = games.filter((g) => g.playtime_forever > 0);
  const steamPlayedRows = playedGames.map((g) => {
    const link = byAppId.has(g.appid) ? `[[Media/Games/${byAppId.get(g.appid)}]]` : "";
    const finished = formatDate(g.rtime_last_played || 0);
    return `| ${g.name} | Steam | ${finished} | | ${formatPlaytime(g.playtime_forever)} total | ${link} |`;
  });

  const allPlayedRows = [...steamPlayedRows, ...handRows].join("\n");

  let recentSection = "";
  if (recent.length > 0) {
    const recentRows = recent
      .map((g) => {
        const link = byAppId.has(g.appid) ? `[[Media/Games/${byAppId.get(g.appid)}]]` : "";
        return `| ${g.name} | ${formatPlaytime(g.playtime_2weeks || 0)} | ${link} |`;
      })
      .join("\n");
    recentSection = `\n## Recently Played (Steam)\n\n| Game | Last 2 Weeks | Notes |\n|------|-------------|-------|\n${recentRows}\n`;
  }

  const currentlyPlayingBlock = currentlyPlaying
    ? `\n## Currently Playing\n\n${currentlyPlaying}\n`
    : "\n## Currently Playing\n\n*(none)*\n";

  const wantToPlayBlock = wantToPlay
    ? `\n## Want to Play\n${wantToPlay}\n`
    : "\n## Want to Play\n*(none)*\n";

  const gamesContent = `*Played section auto-synced from Steam. Last updated: ${today()}.*
*Non-Steam rows are hand-entered and preserved across syncs.*
${currentlyPlayingBlock}${recentSection}
## Played

| Title | Platform | Finished | Rating | Playtime | Notes |
|-------|----------|----------|--------|----------|-------|
${allPlayedRows}
${wantToPlayBlock}`;

  const gamesFm = {
    type: "media-log",
    media: "games",
    tags: ["media", "games"],
    updated: today(),
  };

  await writeFile(gamesIndexPath, matter.stringify("\n# Games\n\n" + gamesContent, gamesFm));
  console.log(`Written games.md: ${playedGames.length} Steam played, ${handRows.length} hand rows`);

  // ── Steam Library (raw dump) ──────────────────────────────────────────────────

  const top10 = games.slice(0, 10);
  const top10Table = top10
    .map((g) => `| ${g.name} | ${formatPlaytime(g.playtime_forever)} | ${formatDate(g.rtime_last_played || 0)} |`)
    .join("\n");

  const fullTable = games
    .filter((g) => g.playtime_forever > 0)
    .map((g) => `| ${g.name} | ${formatPlaytime(g.playtime_forever)} | ${formatDate(g.rtime_last_played || 0)} |`)
    .join("\n");

  let steamRecentSection = "*No recent Steam activity.*";
  if (recent.length > 0) {
    const recentTable = recent
      .map((g) => `| ${g.name} | ${formatPlaytime(g.playtime_2weeks || 0)} | ${formatPlaytime(g.playtime_forever)} |`)
      .join("\n");
    steamRecentSection = `| Game | Last 2 Weeks | Total |\n|------|-------------|-------|\n${recentTable}`;
  }

  const libraryContent = `*Auto-synced from Steam. Last updated: ${today()}.*

**Total Games:** ${games.length}

## Recently Played

${steamRecentSection}

## Top Games by Playtime

| Game | Playtime | Last Played |
|------|----------|-------------|
${top10Table}

## Full Library (${games.filter((g) => g.playtime_forever > 0).length} played)

| Game | Playtime | Last Played |
|------|----------|-------------|
${fullTable}
`;

  const libraryFm = {
    type: "media-log",
    media: "steam",
    tags: ["media", "games", "steam"],
    updated: today(),
  };

  const libraryPath = join(config.vaultPath, "Media", "steam-library.md");
  await writeFile(libraryPath, matter.stringify("\n# Steam Library\n\n" + libraryContent, libraryFm));
  console.log(`Written steam-library.md: ${games.length} total, ${recent.length} recently played`);
}

if (process.argv[1]?.endsWith("sync-steam.ts") || process.argv[1]?.endsWith("sync-steam.js")) {
  main().catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
}
