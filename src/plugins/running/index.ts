import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { logRun, listRuns, runningStats, invalidateRunningCache } from "./logic.js";

/**
 * Running tracker. Worked-example plugin showing a write-back integration over
 * a markdown table in the vault (Health/metrics/running.md). A good template
 * for any "log a thing and aggregate it" feature.
 */
export function register(server: McpServer): void {
  server.tool(
    "log_run",
    "Log a run to Health/metrics/running.md. Pace is auto-computed.",
    {
      distance_mi: z.number().describe("Distance in miles (e.g. 2.5)"),
      duration: z.string().describe("Duration as mm:ss or h:mm:ss (e.g. '18:30')"),
      feel: z
        .number()
        .min(1)
        .max(10)
        .optional()
        .describe("How it felt, 1-10 (1=brutal, 10=effortless)"),
      notes: z.string().optional().describe("Free-form notes (route, weather, body, etc.)"),
      date: z.string().optional().describe("Date as YYYY-MM-DD (defaults to today)"),
    },
    async ({ distance_mi, duration, feel, notes, date }) => {
      const result = await logRun({ distance_mi, duration, feel, notes, date });
      invalidateRunningCache();
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "list_runs",
    "List logged runs from Health/metrics/running.md.",
    {
      since: z.string().optional().describe("Only include runs on or after this date (YYYY-MM-DD)"),
      limit: z.number().optional().describe("Max number of most-recent runs to return"),
    },
    async ({ since, limit }) => {
      const runs = await listRuns({ since, limit });
      if (runs.length === 0) {
        return { content: [{ type: "text", text: "No runs logged yet." }] };
      }
      const text = runs
        .map(
          (r) =>
            `- ${r.date} — ${r.distance} mi in ${r.duration} (${r.pace}/mi)${r.feel !== null ? `, feel ${r.feel}/10` : ""}${r.notes ? ` — ${r.notes}` : ""}`
        )
        .join("\n");
      return { content: [{ type: "text", text }] };
    }
  );

  server.tool(
    "running_stats",
    "Aggregate running stats: totals, longest run, current week, longest streak, half-marathon progress.",
    {},
    async () => {
      const s = await runningStats();
      const text = [
        `Total: ${s.total_miles} mi across ${s.total_runs} runs`,
        `Longest run: ${s.longest_run} mi`,
        `This week: ${s.current_week_mi} mi`,
        `Longest streak: ${s.longest_streak_days} days`,
        `Days to half marathon: ${s.days_to_half}`,
        `Miles still to add to longest run to hit 13.1: ${s.miles_to_half_target}`,
      ].join("\n");
      return { content: [{ type: "text", text }] };
    }
  );
}
