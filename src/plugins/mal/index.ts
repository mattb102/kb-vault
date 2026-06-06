import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  searchAnime,
  updateAnimeStatus,
  removeAnime,
  getMyAnimeList,
  searchManga,
  updateMangaStatus,
  removeManga,
  getMyMangaList,
} from "./logic.js";

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
    "Add or update an anime on your MyAnimeList. Search first to get the anime ID.",
    {
      anime_id: z.number().describe("MAL anime ID (use mal_search to find it)"),
      status: z
        .enum(["watching", "completed", "on_hold", "dropped", "plan_to_watch"])
        .describe("Watch status"),
      score: z.number().min(0).max(10).optional().describe("Score 1-10 (0 to clear)"),
      episodes_watched: z.number().optional().describe("Number of episodes watched"),
    },
    async ({ anime_id, status, score, episodes_watched }) => {
      const result = await updateAnimeStatus(anime_id, status, score, episodes_watched);
      return { content: [{ type: "text", text: result }] };
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
