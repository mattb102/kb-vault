import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  getStandings,
  getRosterWithStats,
  getMatchup,
  getPlayerStats,
} from "./logic.js";

/**
 * ESPN fantasy baseball. Reference example plugin (off by default) showing a
 * read-only third-party API integration. The team name defaults are in
 * logic.ts — adjust there for your league.
 */
export function register(server: McpServer): void {
  server.tool(
    "fb_standings",
    "Get current fantasy baseball league standings (live from ESPN).",
    {},
    async () => {
      const result = await getStandings();
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "fb_roster",
    "Get your fantasy baseball roster with actual and projected stats (live from ESPN).",
    {
      team: z.string().optional().describe("Team name (defaults to your configured team)"),
    },
    async ({ team }) => {
      const result = await getRosterWithStats(team);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "fb_matchup",
    "Get current week matchup for a fantasy baseball team.",
    {
      team: z.string().optional().describe("Team name (defaults to your configured team)"),
    },
    async ({ team }) => {
      const result = await getMatchup(team);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "fb_player_stats",
    "Get recent MLB game log for a player (pitching and hitting). Uses official MLB StatsAPI.",
    {
      name: z.string().describe("Player's full name (e.g. 'Emerson Hancock')"),
    },
    async ({ name }) => {
      const result = await getPlayerStats(name);
      return { content: [{ type: "text", text: result }] };
    }
  );
}
