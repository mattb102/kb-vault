import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFile } from "fs/promises";
import path from "path";
import { z } from "zod";

import { config } from "../../core/config.js";
import { frontmatterIndex } from "../../core/frontmatter.js";
import { today } from "../../core/utils.js";
import { runMorningReport, settings } from "./logic.js";

/**
 * morning_report — a daily briefing the vault writes about you.
 *
 * Every morning it reads your identity, your open nudges, what it has noticed
 * about you recently, your journals and your trackers, and writes a short,
 * specific brief. It always lands in the vault as `Reports/<date>-morning.md`;
 * it can also be pushed to your phone (via the ios_app plugin) or posted to
 * Discord, optionally read aloud as an mp3.
 *
 * On the VPS this is driven by `scripts/cron-morning-report.sh`. The tools here
 * are for running it on demand and reading it back.
 */
export function register(server: McpServer): void {
  server.tool(
    "morning_report",
    "Generate today's morning report now and deliver it through the configured channels. Also saves it to the vault.",
    {},
    async () => {
      try {
        const outcome = await runMorningReport();
        const lines = [
          outcome.report.display_text,
          "",
          "---",
          `Saved to ${outcome.vaultPath}. Delivered: ${outcome.delivered.join(", ")}.`,
        ];
        if (outcome.failed.length) {
          lines.push(
            `Failed: ${outcome.failed.map((f) => `${f.channel} (${f.error})`).join("; ")}`
          );
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: String(e?.message || e) }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "read_morning_report",
    "Read back a morning report from the vault. Defaults to today's; falls back to the most recent one.",
    {
      date: z.string().optional().describe("Date as YYYY-MM-DD (defaults to today)"),
    },
    async ({ date }) => {
      const want = date || today();
      try {
        const file = path.join(config.vaultPath, "Reports", `${want}-morning.md`);
        return { content: [{ type: "text", text: await readFile(file, "utf-8") }] };
      } catch {
        // No report for that day — hand back the newest one rather than nothing.
        const latest = frontmatterIndex
          .find({ type: "report" })
          .map((e) => ({ e, date: String(e.frontmatter.date || "") }))
          .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
        if (!latest) {
          return {
            content: [
              {
                type: "text",
                text: "No morning reports in the vault yet. Run the morning_report tool to make the first one.",
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text",
              text: `(No report for ${want}. Most recent is ${latest.date}.)\n\n${latest.e.content}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    "morning_report_status",
    "Show how the morning report is configured: delivery channels, audio, trackers it summarizes, and whether the required keys are set.",
    {},
    async () => {
      const s = settings();
      const lines = [
        `Delivery: vault${s.delivery.length ? ", " + s.delivery.join(", ") : " only"}`,
        `Audio (read aloud): ${s.audio ? "on" : "off"}`,
        `Trackers summarized: ${s.trackers.length ? s.trackers.join(", ") : "none"}`,
        `Weather location: ${s.location || "not set"}`,
        `Tone steer: ${s.tone || "default"}`,
        "",
        `ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? "set" : "MISSING — the report cannot run without it"}`,
      ];
      if (s.delivery.includes("discord")) {
        lines.push(
          `DISCORD_WEBHOOK_URL: ${process.env.DISCORD_WEBHOOK_URL ? "set" : "MISSING"}`
        );
      }
      if ((config.pluginConfig?.morning_report as any)?.audio && !process.env.OPENAI_API_KEY) {
        lines.push("OPENAI_API_KEY: MISSING — audio is configured on but will be skipped");
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );
}
