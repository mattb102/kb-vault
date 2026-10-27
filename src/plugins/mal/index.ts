import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";

import {
  searchAnime,
  updateAnimeStatus,
  getAnimeById,
  removeAnime,
  getMyAnimeList,
  searchManga,
  updateMangaStatus,
  removeManga,
  getMyMangaList,
} from "./logic.js";
import { config } from "../../core/config.js";

/** MyAnimeList integration (anime + manga tracking). Reference example plugin. */
export function register(server: McpServer): void {
  server.tool(
    "mal_search",
    "Search MyAnimeList for an anime by name.",
    {
      query: z.string().describe("Anime title to search for"),
      limit: z.number().optional().default(5).describe("Max results"),
    },
    async ({ query, limit }) => {
      const results = await searchAnime(query, limit);
      const text = results
        .map((r) => `- **${r.title}** (ID: ${r.id}, ${r.episodes} eps, ${r.status})`)
        .join("\n");
      return { content: [{ type: "text", text: text || "No results found." }] };
    }
  );

  server.tool(
    "mal_update",
    "Add or update an anime on your MyAnimeList and keep tv.md / movies.md in sync. Search first to get the anime ID.",
    {
      anime_id: z.number().describe("MAL anime ID (use mal_search to find it)"),
      status: z
        .enum(["watching", "completed", "on_hold", "dropped", "plan_to_watch"])
        .describe("Watch status"),
      score: z.number().min(0).max(10).optional().describe("Score 1-10 (0 to clear)"),
      episodes_watched: z.number().optional().describe("Number of episodes watched"),
    },
    async ({ anime_id, status, score, episodes_watched }) => {
      const malResult = await updateAnimeStatus(anime_id, status, score, episodes_watched);

      // Best-effort vault update: update the episode/status line in tv.md or movies.md.
      let vaultNote = "";
      try {
        const details = await getAnimeById(anime_id);
        if (details) {
          const isMovie = details.mediaType === "movie";
          const targetRel = isMovie ? "Media/movies.md" : "Media/tv.md";
          const targetPath = join(config.vaultPath, targetRel);
          const raw = await readFile(targetPath, "utf-8").catch(() => "");
          if (raw) {
            const titleLower = details.title.toLowerCase();
            const lines = raw.split("\n");
            let changed = false;
            let currentSection = "";
            const out: string[] = [];
            for (const line of lines) {
              const h2 = line.match(/^## (.+)/);
              if (h2) currentSection = h2[1].trim().toLowerCase();
              if (line.startsWith("|") && status === "watching" && episodes_watched !== null) {
                const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
                if (cells.length >= 2) {
                  const cellTitle = cells[0].replace(/\[\[.*?\|?(.*?)\]\]/g, "$1").trim();
                  if (cellTitle.toLowerCase() === titleLower &&
                    (currentSection.includes("watching") || currentSection.includes("on hold"))) {
                    const newEp = `${episodes_watched}/${details.numEpisodes}`;
                    out.push("| " + [cells[0], newEp, ...cells.slice(2)].join(" | ") + " |");
                    changed = true;
                    continue;
                  }
                }
              }
              out.push(line);
            }
            if (changed) {
              await writeFile(targetPath, out.join("\n"));
              vaultNote = `; updated ${targetRel}`;
            }
          }
        }
      } catch (e) {
        vaultNote = `; vault update skipped: ${(e as Error).message}`;
      }

      return { content: [{ type: "text", text: malResult + vaultNote }] };
    }
  );

  server.tool(
    "mal_remove",
    "Remove an anime from your MyAnimeList.",
    {
      anime_id: z.number().describe("MAL anime ID to remove"),
    },
    async ({ anime_id }) => {
      const result = await removeAnime(anime_id);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "mal_list",
    "Get your current anime list from MyAnimeList.",
    {
      status: z
        .enum(["watching", "completed", "on_hold", "dropped", "plan_to_watch"])
        .optional()
        .describe("Filter by status"),
    },
    async ({ status }) => {
      const list = await getMyAnimeList(status);
      const text = list
        .map((e) => `- **${e.title}** — ${e.status} (${e.score}/10, ${e.episodes_watched} eps)`)
        .join("\n");
      return { content: [{ type: "text", text: text || "List is empty." }] };
    }
  );

  server.tool(
    "mal_manga_search",
    "Search MyAnimeList for a manga by name.",
    {
      query: z.string().describe("Manga title to search for"),
      limit: z.number().optional().default(5).describe("Max results"),
    },
    async ({ query, limit }) => {
      const results = await searchManga(query, limit);
      const text = results
        .map(
          (r) =>
            `- **${r.title}** (ID: ${r.id}, ${r.chapters} chs / ${r.volumes} vols, ${r.status})`
        )
        .join("\n");
      return { content: [{ type: "text", text: text || "No results found." }] };
    }
  );

  server.tool(
    "mal_manga_update",
    "Add or update a manga on your MyAnimeList. Search first to get the manga ID.",
    {
      manga_id: z.number().describe("MAL manga ID (use mal_manga_search to find it)"),
      status: z
        .enum(["reading", "completed", "on_hold", "dropped", "plan_to_read"])
        .describe("Read status"),
      score: z.number().min(0).max(10).optional().describe("Score 1-10 (0 to clear)"),
      chapters_read: z.number().optional().describe("Number of chapters read"),
      volumes_read: z.number().optional().describe("Number of volumes read"),
    },
    async ({ manga_id, status, score, chapters_read, volumes_read }) => {
      const result = await updateMangaStatus(
        manga_id,
        status,
        score,
        chapters_read,
        volumes_read
      );
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "mal_manga_remove",
    "Remove a manga from your MyAnimeList.",
    {
      manga_id: z.number().describe("MAL manga ID to remove"),
    },
    async ({ manga_id }) => {
      const result = await removeManga(manga_id);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "mal_manga_list",
    "Get your current manga list from MyAnimeList.",
    {
      status: z
        .enum(["reading", "completed", "on_hold", "dropped", "plan_to_read"])
        .optional()
        .describe("Filter by status"),
    },
    async ({ status }) => {
      const list = await getMyMangaList(status);
      const text = list
        .map(
          (e) =>
            `- **${e.title}** — ${e.status} (${e.score}/10, ${e.chapters_read} chs, ${e.volumes_read} vols)`
        )
        .join("\n");
      return { content: [{ type: "text", text: text || "List is empty." }] };
    }
  );
}
