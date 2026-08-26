import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type http from "http";
import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { z } from "zod";

import {
  appTitle,
  listTrackers,
  logEntry,
  readEntries,
  saveSubscription,
  countSubscriptions,
  sendPush,
  vapidPublicKey,
} from "./logic.js";

/**
 * ios_app — the phone half of the vault.
 *
 * Adds a small web app you install on your iPhone home screen: tap a number to
 * log a tracker, and receive push notifications from your vault. It is a PWA,
 * not an App Store app — "add to home screen" in Safari is the install, and on
 * iOS that step is what unlocks notifications at all (a Safari tab cannot
 * receive them).
 *
 * Auth: every data route requires APP_TOKEN, which is deliberately a DIFFERENT
 * secret from API_KEY. The phone holds a token that can log trackers and
 * nothing else — it cannot read or write the rest of the vault. The page shell
 * and the service worker are unauthenticated because iOS fetches them before
 * any token exists.
 */

// Static assets live next to this file and are read from source (tsc does not
// copy non-TS files into build/), so the paths must be resolved relative to the
// repo root rather than to build/.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = HERE.includes(`${path.sep}build${path.sep}`)
  ? path.resolve(HERE, "../../../../src/plugins/ios_app/public")
  : path.join(HERE, "public");

function appToken(): string {
  return process.env.APP_TOKEN || "";
}

function authorized(req: http.IncomingMessage, url: URL): boolean {
  const token = appToken();
  if (!token) return false; // fail closed: no token configured, no access
  const bearer = (req.headers.authorization || "").replace("Bearer ", "");
  // The service worker cannot set headers on its own fetches, so a query
  // parameter is accepted too. Same secret either way.
  return bearer === token || url.searchParams.get("token") === token;
}

function json(res: http.ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage, cap = 8192): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c: Buffer) => {
      body += c.toString();
      if (body.length > cap) req.destroy();
    });
    req.on("end", () => resolve(body));
  });
}

async function serveAsset(
  res: http.ServerResponse,
  file: string,
  contentType: string,
  extraHeaders: Record<string, string> = {}
): Promise<void> {
  try {
    const body = await readFile(path.join(PUBLIC_DIR, file), "utf-8");
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-cache",
      ...extraHeaders,
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  }
}

export async function handleHttp(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL
): Promise<boolean> {
  // ── unauthenticated shell ──
  // iOS fetches these before the user has entered a token, and the service
  // worker must be served from the root for its scope to cover /app.
  if (url.pathname === "/app-sw.js" && req.method === "GET") {
    await serveAsset(res, "app-sw.js", "application/javascript; charset=utf-8", {
      "Service-Worker-Allowed": "/",
    });
    return true;
  }

  if (url.pathname === "/app" && req.method === "GET") {
    await serveAsset(res, "app.html", "text/html; charset=utf-8");
    return true;
  }

  if (url.pathname === "/app/manifest.webmanifest" && req.method === "GET") {
    const title = appTitle();
    res.writeHead(200, { "Content-Type": "application/manifest+json" });
    res.end(
      JSON.stringify({
        name: title,
        short_name: title.split(/\s+/)[0] || "Vault",
        start_url: "/app",
        scope: "/app",
        display: "standalone",
        background_color: "#11131a",
        theme_color: "#11131a",
        icons: [
          {
            // Inline so there is no binary asset to keep in sync.
            src:
              "data:image/svg+xml," +
              encodeURIComponent(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192">' +
                  '<rect width="192" height="192" rx="42" fill="#11131a"/>' +
                  '<circle cx="96" cy="96" r="46" fill="none" stroke="#7dd3fc" stroke-width="12"/>' +
                  '<circle cx="96" cy="96" r="12" fill="#7dd3fc"/></svg>'
              ),
            sizes: "192x192",
            type: "image/svg+xml",
            purpose: "any",
          },
        ],
      })
    );
    return true;
  }

  if (!url.pathname.startsWith("/app/")) return false;

  // ── everything below needs APP_TOKEN ──
  if (!authorized(req, url)) {
    json(res, 401, { error: "unauthorized" });
    return true;
  }

  if (url.pathname === "/app/config" && req.method === "GET") {
    json(res, 200, {
      title: appTitle(),
      trackers: listTrackers(),
      vapidPublicKey: vapidPublicKey(),
      devices: await countSubscriptions(),
    });
    return true;
  }

  if (url.pathname === "/app/subscribe" && req.method === "POST") {
    const body = await readBody(req);
    try {
      const devices = await saveSubscription(JSON.parse(body || "{}"));
      json(res, 200, { ok: true, devices });
    } catch (e: any) {
      json(res, 400, { ok: false, error: String(e?.message || e) });
    }
    return true;
  }

  if (url.pathname === "/app/notify" && req.method === "POST") {
    const body = await readBody(req);
    try {
      const parsed = JSON.parse(body || "{}");
      const result = await sendPush(
        String(parsed.title || appTitle()),
        String(parsed.body || "Test notification — this is working."),
        String(parsed.url || "/app")
      );
      json(res, 200, { ok: true, ...result });
    } catch (e: any) {
      json(res, 500, { ok: false, error: String(e?.message || e) });
    }
    return true;
  }

  if (url.pathname === "/app/entries" && req.method === "GET") {
    try {
      const tracker = url.searchParams.get("tracker") || "";
      const entries = await readEntries(tracker, 30);
      json(res, 200, { entries });
    } catch (e: any) {
      json(res, 400, { error: String(e?.message || e) });
    }
    return true;
  }

  if (url.pathname === "/app/log" && req.method === "POST") {
    const body = await readBody(req, 4096);
    try {
      const p = JSON.parse(body || "{}");
      const result = await logEntry(
        String(p.tracker),
        Number(p.value),
        p.date ? String(p.date) : undefined,
        p.notes ? String(p.notes) : undefined
      );
      json(res, 200, { ok: true, result });
    } catch (e: any) {
      json(res, 400, { ok: false, error: String(e?.message || e) });
    }
    return true;
  }

  json(res, 404, { error: "not found" });
  return true;
}

export function register(server: McpServer): void {
  server.tool(
    "ios_app_info",
    "Show the phone app's install URL, configured trackers, and how many devices are subscribed to notifications.",
    {},
    async () => {
      const trackers = listTrackers();
      const devices = await countSubscriptions();
      const base = process.env.BASE_URL || "";
      const lines = [
        `${appTitle()} — ${base ? `${base}/app` : "/app"}`,
        `Devices subscribed to notifications: ${devices}`,
        "",
        trackers.length
          ? "Trackers:"
          : "No trackers configured yet. Add them under plugins.ios_app.trackers in config/config.yaml.",
        ...trackers.map(
          (t) =>
            `- ${t.id} (${t.label}) — ${t.kind}${t.kind === "scale" ? ` ${t.min}-${t.max}` : ""} → ${t.note}`
        ),
      ];
      if (!appToken()) {
        lines.push(
          "",
          "⚠ APP_TOKEN is not set in .env — the phone app will refuse every request until it is."
        );
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  server.tool(
    "log_tracker",
    "Log a value for one of the phone app's trackers. Logging the same day twice updates that day's entry.",
    {
      tracker: z.string().describe("Tracker id (see ios_app_info)"),
      value: z.number().describe("The value to record"),
      date: z.string().optional().describe("Date as YYYY-MM-DD (defaults to today)"),
      notes: z.string().optional().describe("Optional free-form note for the entry"),
    },
    async ({ tracker, value, date, notes }) => {
      try {
        const result = await logEntry(tracker, value, date, notes);
        return {
          content: [
            { type: "text", text: `${result} ${tracker} = ${value} for ${date || "today"}.` },
          ],
        };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: String(e?.message || e) }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "tracker_history",
    "Read back recent entries for one of the phone app's trackers, most recent first.",
    {
      tracker: z.string().describe("Tracker id (see ios_app_info)"),
      limit: z.number().optional().describe("Max entries to return (default 14)"),
    },
    async ({ tracker, limit }) => {
      try {
        const entries = await readEntries(tracker, limit || 14);
        if (entries.length === 0) {
          return { content: [{ type: "text", text: `No entries logged for ${tracker} yet.` }] };
        }
        const text = entries
          .map((e) => `- ${e.date}: ${e.value}${e.notes ? ` — ${e.notes}` : ""}`)
          .join("\n");
        return { content: [{ type: "text", text }] };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: String(e?.message || e) }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "send_phone_notification",
    "Send a push notification to every phone that has installed the app and allowed notifications.",
    {
      title: z.string().describe("Notification title"),
      body: z.string().describe("Notification body text"),
    },
    async ({ title, body }) => {
      try {
        const devices = await countSubscriptions();
        if (devices === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No devices are subscribed yet. Open the app on your phone and tap 'Enable notifications' first.",
              },
            ],
          };
        }
        const r = await sendPush(title, body);
        return {
          content: [
            {
              type: "text",
              text: `Sent to ${r.sent}/${devices} device(s).${r.pruned ? ` Pruned ${r.pruned} dead.` : ""}${r.failed ? ` ${r.failed} failed.` : ""}`,
            },
          ],
        };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: String(e?.message || e) }],
          isError: true,
        };
      }
    }
  );
}
