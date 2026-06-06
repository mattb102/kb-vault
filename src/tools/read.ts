import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile } from "fs/promises";

import { frontmatterIndex } from "../core/frontmatter.js";
import { hybridSearch } from "../core/search.js";
import { gitPull } from "../core/sync.js";
import { getObservations } from "../core/observer.js";
import { absPath } from "../core/utils.js";

/** Register the core read tools (search, read, find, identity, journals, observations). */
export function register(server: McpServer): void {
  server.tool(
    "search_vault",
    "Semantic search across the vault. Returns the most relevant chunks.",
    {
      query: z.string().describe("Search query"),
      limit: z.number().optional().default(10).describe("Max results"),
      type: z.string().optional().describe("Filter by frontmatter type"),
    },
    async ({ query, limit, type }) => {
      await gitPull();
      const results = await hybridSearch(query, limit, type);
      const text = results
        .map(
          (r, i) =>
            `### Result ${i + 1} (${r.relPath})\n**Section:** ${r.headers || "(root)"}\n**Type:** ${r.type}\n\n${r.text}`
        )
        .join("\n\n---\n\n");
      return { content: [{ type: "text", text: text || "No results found." }] };
    }
  );

  server.tool(
    "read_note",
    "Read a specific note by its path (relative to vault root).",
    {
      path: z.string().describe("Path relative to vault root, e.g. 'Core/bio.md'"),
    },
    async ({ path }) => {
      await gitPull();
      try {
        const content = await readFile(absPath(path), "utf-8");
        return { content: [{ type: "text", text: content }] };
      } catch {
        return {
          content: [{ type: "text", text: `File not found: ${path}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "find_notes",
    "Find notes by frontmatter fields. All provided fields must match.",
    {
      type: z.string().optional().describe("Frontmatter 'type' field"),
      topic: z.string().optional().describe("Frontmatter 'topic' field"),
      interest: z.string().optional().describe("Frontmatter 'interest' field"),
      relation: z.string().optional().describe("Frontmatter 'relation' field"),
      metric: z.string().optional().describe("Frontmatter 'metric' field"),
      media: z.string().optional().describe("Frontmatter 'media' field"),
    },
    async (params) => {
      await gitPull();
      const criteria: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) criteria[key] = value;
      }
      const results = frontmatterIndex.find(criteria);
      const text = results
        .map((r) => `- **${r.relPath}** (type: ${r.frontmatter.type})`)
        .join("\n");
      return {
        content: [
          {
            type: "text",
            text: text || "No matching notes found.",
          },
        ],
      };
    }
  );

  server.tool(
    "search_tags",
    "Find all notes that have any of the given tags.",
    {
      tags: z.array(z.string()).describe("Tags to search for"),
    },
    async ({ tags }) => {
      await gitPull();
      const results = frontmatterIndex.findByTags(tags);
      const text = results
        .map(
          (r) =>
            `- **${r.relPath}** — tags: ${(r.frontmatter.tags as string[]).join(", ")}`
        )
        .join("\n");
      return {
        content: [{ type: "text", text: text || "No notes found with those tags." }],
      };
    }
  );

  server.tool(
    "get_identity",
    "Return the core identity document (the summary of who the user is).",
    {},
    async () => {
      await gitPull();
      const entry = frontmatterIndex.findOne({ type: "core-identity" });
      if (!entry) {
        return {
          content: [{ type: "text", text: "Core identity document not found." }],
          isError: true,
        };
      }
      const content = await readFile(entry.path, "utf-8");
      return { content: [{ type: "text", text: content }] };
    }
  );

  server.tool(
    "recent_journals",
    "Return the most recent journal entries.",
    {
      count: z.number().optional().default(7).describe("Number of entries"),
    },
    async ({ count }) => {
      await gitPull();
      const journals = frontmatterIndex
        .find({ type: "journal" })
        .sort((a, b) => {
          const dateA = (a.frontmatter.date as string) || "";
          const dateB = (b.frontmatter.date as string) || "";
          return dateB.localeCompare(dateA);
        })
        .slice(0, count);

      if (journals.length === 0) {
        return {
          content: [{ type: "text", text: "No journal entries found." }],
        };
      }

      const texts: string[] = [];
      for (const j of journals) {
        const content = await readFile(j.path, "utf-8");
        texts.push(`## ${j.frontmatter.date}\n\n${content}`);
      }
      return { content: [{ type: "text", text: texts.join("\n\n---\n\n") }] };
    }
  );

  server.tool(
    "search_by_date",
    "Find journal and stream entries within a date range.",
    {
      start: z.string().describe("Start date (YYYY-MM-DD)"),
      end: z.string().describe("End date (YYYY-MM-DD)"),
    },
    async ({ start, end }) => {
      await gitPull();
      const entries = frontmatterIndex
        .all()
        .filter((e) => {
          const type = e.frontmatter.type as string;
          if (type !== "journal" && type !== "stream") return false;
          const date = (e.frontmatter.date as string) || "";
          return date >= start && date <= end;
        })
        .sort((a, b) => {
          const dateA = (a.frontmatter.date as string) || "";
          const dateB = (b.frontmatter.date as string) || "";
          return dateA.localeCompare(dateB);
        });

      if (entries.length === 0) {
        return {
          content: [{ type: "text", text: `No entries found between ${start} and ${end}.` }],
        };
      }

      const texts: string[] = [];
      for (const e of entries) {
        const content = await readFile(e.path, "utf-8");
        texts.push(`## ${e.frontmatter.date} (${e.frontmatter.type})\n\n${content}`);
      }
      return { content: [{ type: "text", text: texts.join("\n\n---\n\n") }] };
    }
  );

  server.tool(
    "get_observations",
    "Read AI observations (patterns, nudges, or scratchpad). For scratchpad, narrow the result with `days`, `type`, `subject`, and/or `search` instead of pulling the whole (large) file.",
    {
      topic: z
        .enum(["patterns", "nudges", "scratchpad"])
        .describe("Which observation type to read"),
      days: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          "Scratchpad only: only entries from the last N days (inclusive of today). Default: all."
        ),
      maxEntries: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          "Scratchpad only: hard cap on number of most-recent entries returned (applied after all other filters)."
        ),
      type: z
        .string()
        .optional()
        .describe(
          "Scratchpad only: keep entries whose header has `type: <value>` (e.g. health, behavior, project, meta). Case-insensitive exact match."
        ),
      subject: z
        .string()
        .optional()
        .describe(
          "Scratchpad only: keep entries whose header has `subject: <value>` (e.g. tension, kb-system). Case-insensitive exact match."
        ),
      search: z
        .string()
        .optional()
        .describe(
          "Scratchpad only: keep entries whose text contains this substring (case-insensitive)."
        ),
    },
    async ({ topic, days, maxEntries, type, subject, search }) => {
      await gitPull();
      const content = await getObservations(
        topic,
        days,
        maxEntries,
        type,
        subject,
        search
      );
      return { content: [{ type: "text", text: content }] };
    }
  );
}
