import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { runClaudeCode, formatRunResult } from "./logic.js";

/**
 * Delegate a coding task to Claude Code running on the VPS. This is what lets
 * you ask, from claude.ai on mobile, "add me a feature" and have it actually
 * land in the repo. Powerful — enable deliberately.
 */
export function register(server: McpServer): void {
  server.tool(
    "run_claude_code",
    "Delegate a task to Claude Code running on the VPS. Runs `claude --print --dangerously-skip-permissions <task>` in the given working_dir and returns stdout/stderr. Use this to make code changes to your vault server (or other projects on the VPS) from claude.ai on mobile.",
    {
      task: z
        .string()
        .describe(
          "The full prompt for Claude Code. Write it like you would write a Claude Code message — include enough context to act without follow-ups."
        ),
      working_dir: z
        .string()
        .optional()
        .describe(
          "Absolute path on the VPS. Defaults to the server's project directory. Use this to point at a different project repo."
        ),
      timeout_seconds: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Max seconds before SIGKILL. Default 300, max 900."),
    },
    async ({ task, working_dir, timeout_seconds }) => {
      try {
        const result = await runClaudeCode({
          task,
          workingDir: working_dir,
          timeoutMs: timeout_seconds ? timeout_seconds * 1000 : undefined,
        });
        return { content: [{ type: "text", text: formatRunResult(result) }] };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `run_claude_code failed: ${err.message || err}` }],
          isError: true,
        };
      }
    }
  );
}
