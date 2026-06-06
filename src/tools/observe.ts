import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  logObservation,
  logPattern,
  logNudge,
  clearNudge,
  writeWeeklySummary,
} from "../core/observer.js";
import { promotePatterns } from "../core/promoter.js";

/**
 * Register the AI-observation tools: the scratchpad/pattern/nudge system plus
 * pattern promotion. promote_patterns calls the Anthropic API (ANTHROPIC_API_KEY);
 * everything else is local file writes.
 */
export function register(server: McpServer): void {
  server.tool(
    "log_observation",
    "Log a raw observation to the AI scratchpad. Use this when you notice something about the user mid-conversation.",
    {
      content: z
        .string()
        .describe("The observation (e.g., 'User mentioned back pain for the 3rd time this week')"),
      type: z
        .enum([
          "identity",
          "preference",
          "behavior",
          "mood",
          "health",
          "relationship",
          "project",
          "meta",
        ])
        .describe(
          "Category of the observation: identity (who they are), preference (likes/dislikes), behavior (what they do, contradictions), mood (emotional state), health (sleep/diet/body), relationship (people, dynamics), project (work/side projects), meta (observations about Claude's own behavior)"
        ),
      subject: z
        .string()
        .describe(
          "Short topic tag, e.g., 'sleep', 'boston-friends', 'music-taste', 'kb-system'"
        ),
      supersedes: z
        .string()
        .optional()
        .describe(
          "Timestamp of a prior entry this updates/corrects, e.g., '2026-04-17 23:05'"
        ),
    },
    async ({ content, type, subject, supersedes }) => {
      const result = await logObservation(content, type, subject, supersedes);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "log_pattern",
    "Record a recurring pattern you've noticed about the user.",
    {
      pattern: z.string().describe("Description of the pattern"),
      evidence: z
        .string()
        .describe("Evidence supporting this pattern (dates, examples)"),
    },
    async ({ pattern, evidence }) => {
      const result = await logPattern(pattern, evidence);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "log_nudge",
    "Add an accountability nudge — something the user mentioned wanting to do.",
    {
      goal: z.string().describe("The goal or intention"),
      last_mentioned: z
        .string()
        .describe("When the user last mentioned this (YYYY-MM-DD)"),
      note: z.string().optional().describe("Additional context"),
      priority: z
        .enum(["P0", "P1", "P2", "P3"])
        .optional()
        .describe(
          "Priority: P0=urgent/blocker, P1=high-value time-sensitive, P2=should do soon (default), P3=nice to have"
        ),
    },
    async ({ goal, last_mentioned, note, priority }) => {
      const result = await logNudge(goal, last_mentioned, note, priority);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "clear_nudge",
    "Set a nudge's status: addressed (followed through), wont_do (decided against it), or in_progress (actively being worked on — not done, but no longer untouched/open).",
    {
      goal: z.string().describe("The goal whose status to set"),
      resolution: z
        .string()
        .optional()
        .describe(
          "Optional note — how it was resolved when closing, or a short progress note when marking in_progress."
        ),
      status: z
        .enum(["addressed", "wont_do", "in_progress"])
        .optional()
        .describe(
          "addressed (did it), wont_do (explicitly decided not to), or in_progress (actively cooking). Defaults to addressed."
        ),
    },
    async ({ goal, resolution, status }) => {
      const result = await clearNudge(goal, resolution, status);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "write_weekly_summary",
    "Write an AI weekly summary with observations, mood trends, and insights.",
    {
      week: z
        .string()
        .describe("Week identifier (e.g., '2026-W15')"),
      content: z.string().describe("The full weekly summary content"),
    },
    async ({ week, content }) => {
      const result = await writeWeeklySummary(week, content);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "promote_patterns",
    "Scan the scratchpad for (type, subject) clusters of 3+ recent entries and synthesize each into a pattern appended to AI-Observations/patterns.md. Calls the Anthropic API directly using ANTHROPIC_API_KEY on the server.",
    {
      dry_run: z
        .boolean()
        .optional()
        .default(false)
        .describe("List candidate clusters without calling the LLM or writing anything."),
      min_cluster_size: z
        .number()
        .optional()
        .default(3)
        .describe("Minimum entries in a cluster to consider it (default 3)."),
      window_days: z
        .number()
        .optional()
        .default(30)
        .describe("Only consider scratchpad entries from the last N days (default 30)."),
    },
    async ({ dry_run, min_cluster_size, window_days }) => {
      const result = await promotePatterns({
        dryRun: dry_run,
        minClusterSize: min_cluster_size,
        windowDays: window_days,
      });
      return { content: [{ type: "text", text: result }] };
    }
  );
}
