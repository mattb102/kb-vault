import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  logMetric,
  updateNoteSection,
  appendToNote,
  createNote,
  logStream,
  updateIdentityField,
} from "../core/writer.js";

/** Register the core write-back tools. Each persists to the vault and commits via git. */
export function register(server: McpServer): void {
  server.tool(
    "log_metric",
    "Log a health/life metric (weight, sleep, mood, energy, etc.). Finds the right file by frontmatter.",
    {
      metric: z
        .string()
        .describe("Metric name (weight, sleep, mood, energy, etc.)"),
      value: z.string().describe("The value to log"),
      note: z.string().optional().describe("Optional note"),
    },
    async ({ metric, value, note }) => {
      const result = await logMetric(metric, value, note);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "update_note",
    "Replace a specific section (by header name) in an existing note.",
    {
      path: z.string().describe("Path relative to vault root"),
      section: z.string().describe("Header text of the section to replace"),
      content: z.string().describe("New content for the section"),
    },
    async ({ path, section, content }) => {
      const result = await updateNoteSection(path, section, content);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "append_to_note",
    "Append content to the end of an existing note.",
    {
      path: z.string().describe("Path relative to vault root"),
      content: z.string().describe("Content to append"),
    },
    async ({ path, content }) => {
      const result = await appendToNote(path, content);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "create_note",
    "Create a new note with frontmatter in the specified folder.",
    {
      folder: z
        .string()
        .describe("Folder path relative to vault root (e.g. 'Interests/Fishing/catch-reports')"),
      title: z.string().describe("Note title"),
      content: z.string().describe("Markdown content (without frontmatter)"),
      frontmatter: z
        .record(z.string(), z.unknown())
        .describe("Frontmatter fields (type, tags, etc.)"),
    },
    async ({ folder, title, content, frontmatter }) => {
      const result = await createNote(folder, title, content, frontmatter);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "log_stream",
    "Append a timestamped thought to today's stream-of-consciousness file.",
    {
      content: z.string().describe("The thought/content to log"),
    },
    async ({ content }) => {
      const result = await logStream(content);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "update_identity_field",
    "Update a section in a core identity file. Finds the file by frontmatter type=core, topic=<topic>.",
    {
      topic: z
        .string()
        .describe("Core topic (bio, preferences, goals, values, relationships, routines)"),
      section: z.string().describe("Header text of the section to update"),
      content: z.string().describe("New content for the section"),
    },
    async ({ topic, section, content }) => {
      const result = await updateIdentityField(topic, section, content);
      return { content: [{ type: "text", text: result }] };
    }
  );
}
