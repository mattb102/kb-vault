import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type http from "http";
import { z } from "zod";

import { getAuthUrl, handleCallback, listUpcoming, scheduleEvent } from "./logic.js";

/**
 * Google Calendar. Worked-example plugin that needs a one-time OAuth handshake,
 * so it also exports handleHttp to serve /calendar/auth and /calendar/callback
 * on the HTTP transport. Requires GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET /
 * GOOGLE_REDIRECT_URI in the environment.
 */
export function register(server: McpServer): void {
  server.tool(
    "calendar_list_upcoming",
    "List upcoming Google Calendar events.",
    {
      days: z.number().optional().default(7).describe("How many days ahead to look (default 7)"),
    },
    async ({ days }) => {
      try {
        const text = await listUpcoming(days);
        return { content: [{ type: "text", text }] };
      } catch (err: any) {
        return { content: [{ type: "text", text: err.message }], isError: true };
      }
    }
  );

  server.tool(
    "calendar_schedule",
    "Create a new event on Google Calendar.",
    {
      title: z.string().describe("Event title"),
      start: z.string().describe("Start datetime in ISO 8601 format, e.g. '2026-06-01T14:00:00'"),
      duration_minutes: z.number().optional().default(60).describe("Duration in minutes (default 60)"),
      description: z.string().optional().describe("Event description or notes"),
      location: z.string().optional().describe("Location"),
    },
    async ({ title, start, duration_minutes, description, location }) => {
      try {
        const text = await scheduleEvent(title, start, duration_minutes, description, location);
        return { content: [{ type: "text", text }] };
      } catch (err: any) {
        return { content: [{ type: "text", text: err.message }], isError: true };
      }
    }
  );
}

/** Serve the one-time Google OAuth handshake routes. */
export async function handleHttp(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL
): Promise<boolean> {
  if (url.pathname === "/calendar/auth" && req.method === "GET") {
    res.writeHead(302, { Location: getAuthUrl() });
    res.end();
    return true;
  }

  if (url.pathname === "/calendar/callback" && req.method === "GET") {
    const code = url.searchParams.get("code");
    if (!code) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Missing code parameter");
      return true;
    }
    try {
      await handleCallback(code);
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        "<!doctype html><html><body style='font-family:system-ui;background:#111;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0'><h2>✅ Google Calendar connected. You can close this tab.</h2></body></html>"
      );
    } catch (err: any) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(`Error: ${err.message}`);
    }
    return true;
  }

  return false;
}
