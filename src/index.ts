import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import http from "http";
import crypto from "crypto";

import { config } from "./core/config.js";
import { frontmatterIndex } from "./core/frontmatter.js";
import { preloadModel } from "./core/embeddings.js";
import { isIndexed } from "./core/indexer.js";

import { register as registerReadTools } from "./tools/read.js";
import { register as registerWriteTools } from "./tools/write.js";
import { register as registerObserveTools } from "./tools/observe.js";
import type { PluginModule } from "./plugins/types.js";

// ─── PLUGIN LOADING ────────────────────────────────────────────────
// Enabled plugins are imported once at startup. Their `register` is called
// per session (in createServer); their optional `handleHttp` is consulted by
// the HTTP router. A fresh install enables nothing — this stays empty.
const loadedPlugins = new Map<string, PluginModule>();

async function loadPlugins(): Promise<void> {
  for (const name of config.enabledPlugins) {
    try {
      const mod = (await import(`./plugins/${name}/index.js`)) as PluginModule;
      if (typeof mod.register !== "function") {
        console.error(`[plugins] '${name}' has no register() export — skipping.`);
        continue;
      }
      loadedPlugins.set(name, mod);
      console.error(`[plugins] loaded '${name}'.`);
    } catch (err: any) {
      console.error(`[plugins] failed to load '${name}': ${err.message || err}`);
    }
  }
}

function createServer(): McpServer {
  const server = new McpServer({
    name: config.serverName,
    version: "1.0.0",
  });

  // Core tools — always on. This is "the product".
  registerReadTools(server);
  registerWriteTools(server);
  registerObserveTools(server);

  // Opt-in plugins.
  for (const mod of loadedPlugins.values()) {
    mod.register(server);
  }

  return server;
}

// ─── STARTUP ───────────────────────────────────────────────────────

async function main() {
  console.error("KB vault MCP server starting...");
  console.error(`Vault: ${config.vaultPath}`);
  console.error(`Transport: ${config.transport}`);
  console.error(`Embeddings: ${config.embeddingProvider} (${config.embeddingModel})`);

  await loadPlugins();

  // Build frontmatter index.
  await frontmatterIndex.rebuild();
  console.error(`Indexed ${frontmatterIndex.size} files in vault.`);

  // Check if the vector index exists.
  const indexed = await isIndexed();
  if (!indexed) {
    console.error(
      "Vector index not found. Run 'npm run index-vault' to build it."
    );
    console.error(
      "Search will not work until the index is built, but read/write tools are available."
    );
  }

  // Warm the embedding model in the background (no-op for the hosted backend).
  preloadModel().catch((err) => {
    console.error("Warning: failed to preload embedding model:", err.message);
  });

  if (config.transport === "stdio") {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("KB vault MCP server running on stdio.");
    return;
  }

  // ── Streamable HTTP transport for remote deployment ──
  const BASE_URL = process.env.BASE_URL || `http://localhost:${config.port}`;

  // Simple OAuth: one valid token = the API key.
  const VALID_TOKEN = config.apiKey;
  const authCodes = new Map<string, number>(); // code -> expiry timestamp

  function checkAuth(req: http.IncomingMessage): boolean {
    const auth = req.headers.authorization;
    if (!auth) return false;
    const token = auth.replace("Bearer ", "");
    return Boolean(VALID_TOKEN) && token === VALID_TOKEN;
  }

  function parseBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
      let body = "";
      req.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on("end", () => resolve(body));
    });
  }

  function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) =>
      (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[c])
    );
  }

  function renderLogin(redirectUri: string, state: string | null, error: boolean): string {
    const stateField = state ? `<input type="hidden" name="state" value="${escapeHtml(state)}">` : "";
    return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(config.serverName)} — Sign in</title>
    <style>body{font-family:system-ui,sans-serif;background:#111;color:#eee;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}form{background:#1c1c1c;padding:2rem;border-radius:12px;width:280px}h3{margin:.2rem 0 1rem}input{width:100%;box-sizing:border-box;padding:.6rem;margin:.4rem 0;border-radius:6px;border:1px solid #333;background:#222;color:#eee}button{width:100%;padding:.6rem;margin-top:.5rem;border:0;border-radius:6px;background:#4f46e5;color:#fff;font-weight:600;cursor:pointer}.err{color:#f87171;font-size:.85rem;margin-bottom:.4rem}</style></head>
    <body><form method="POST" action="/authorize">
    <h3>${escapeHtml(config.serverName)}</h3>
    ${error ? '<div class="err">Incorrect passphrase</div>' : ''}
    <input type="password" name="password" placeholder="Passphrase" autofocus>
    <input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}">
    ${stateField}
    <button type="submit">Authorize</button>
    </form></body></html>`;
  }

  // Track transports by session ID.
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", BASE_URL);

    // ── OAuth 2.0 endpoints (no auth required) ──

    if (url.pathname === "/.well-known/oauth-protected-resource") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ resource: BASE_URL, authorization_servers: [BASE_URL] }));
      return;
    }

    if (url.pathname === "/.well-known/oauth-authorization-server") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        issuer: BASE_URL,
        authorization_endpoint: `${BASE_URL}/authorize`,
        token_endpoint: `${BASE_URL}/token`,
        registration_endpoint: `${BASE_URL}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code"],
        token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
        code_challenge_methods_supported: ["S256"],
      }));
      return;
    }

    // Dynamic client registration (RFC 7591). Strict clients (claude.ai)
    // validate that server-assigned fields are present AND that client
    // metadata from the request is echoed back.
    if (url.pathname === "/register" && req.method === "POST") {
      const body = await parseBody(req);
      let meta: Record<string, unknown> = {};
      try {
        meta = JSON.parse(body);
      } catch {}

      const response: Record<string, unknown> = {
        client_id: "kb-client",
        client_secret: "kb-secret",
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_secret_expires_at: 0,
        redirect_uris: meta.redirect_uris ?? [],
        token_endpoint_auth_method: meta.token_endpoint_auth_method ?? "client_secret_post",
        grant_types: meta.grant_types ?? ["authorization_code"],
        response_types: meta.response_types ?? ["code"],
        client_name: meta.client_name ?? "kb-client",
        scope: meta.scope ?? "",
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response));
      return;
    }

    // GET /authorize: show the login form.
    if (url.pathname === "/authorize" && req.method === "GET") {
      const redirectUri = url.searchParams.get("redirect_uri");
      const state = url.searchParams.get("state");
      if (!redirectUri) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Missing redirect_uri");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(renderLogin(redirectUri, state, false));
      return;
    }

    // POST /authorize: verify the passphrase, then issue the code + redirect.
    if (url.pathname === "/authorize" && req.method === "POST") {
      const body = await parseBody(req);
      const params = new URLSearchParams(body);
      const password = params.get("password") || "";
      const redirectUri = params.get("redirect_uri");
      const state = params.get("state");
      if (!redirectUri) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Missing redirect_uri");
        return;
      }
      // Fail closed: if no AUTH_PASSWORD is configured, reject everything.
      if (!config.authPassword || password !== config.authPassword) {
        res.writeHead(401, { "Content-Type": "text/html" });
        res.end(renderLogin(redirectUri, state, true));
        return;
      }
      const code = Array.from({ length: 32 }, () => Math.random().toString(36)[2]).join("");
      authCodes.set(code, Date.now() + 300_000);
      const redirect = new URL(redirectUri);
      redirect.searchParams.set("code", code);
      if (state) redirect.searchParams.set("state", state);
      res.writeHead(302, { Location: redirect.toString() });
      res.end();
      return;
    }

    if (url.pathname === "/token" && req.method === "POST") {
      const body = await parseBody(req);
      const params = new URLSearchParams(body);
      const grantType = params.get("grant_type");
      const code = params.get("code");

      if (grantType === "authorization_code" && code) {
        const expiry = authCodes.get(code);
        if (expiry && Date.now() < expiry) {
          authCodes.delete(code);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            access_token: VALID_TOKEN,
            token_type: "Bearer",
            expires_in: 86400 * 365,
          }));
          return;
        }
      }

      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_grant" }));
      return;
    }

    // ── Health check (no auth) ──

    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", files: frontmatterIndex.size }));
      return;
    }

    // ── Plugin-provided routes (e.g. OAuth callbacks). No core auth. ──
    for (const mod of loadedPlugins.values()) {
      if (mod.handleHttp && (await mod.handleHttp(req, res, url))) {
        return;
      }
    }

    // ── MCP endpoint at root (auth required) ──

    if (url.pathname === "/" || url.pathname === "/mcp") {
      // MCP's auth spec (RFC 9728 §5.3) requires the WWW-Authenticate header
      // on 401s — without it, clients can't discover the OAuth flow.
      if (!checkAuth(req)) {
        res.writeHead(401, {
          "Content-Type": "text/plain",
          "WWW-Authenticate": `Bearer realm="mcp", resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource"`,
        });
        res.end("Unauthorized");
        return;
      }

      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (req.method === "POST") {
        const body = await parseBody(req);
        let isInitRequest = false;
        let parsedBody: any = null;
        try {
          parsedBody = JSON.parse(body);
          isInitRequest = parsedBody?.method === "initialize";
        } catch {}

        // Re-inject the body so the transport can read it.
        (req as any).body = parsedBody;
        const origOn = req.on.bind(req);
        (req as any).on = (event: string, handler: any) => {
          if (event === "data") {
            setImmediate(() => handler(Buffer.from(body)));
            return req;
          }
          if (event === "end") {
            setImmediate(() => handler());
            return req;
          }
          return origOn(event, handler);
        };

        if (sessionId && transports.has(sessionId)) {
          const transport = transports.get(sessionId)!;
          await transport.handleRequest(req, res, parsedBody);
        } else if (isInitRequest) {
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => crypto.randomUUID(),
            onsessioninitialized: (id) => {
              transports.set(id, transport);
            },
          });
          transport.onclose = () => {
            if (transport.sessionId) transports.delete(transport.sessionId);
          };
          const session = createServer();
          await session.connect(transport);
          await transport.handleRequest(req, res, parsedBody);
        } else {
          // Unknown session + not an init request = stale session.
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32001, message: "Session not found. Please re-initialize." },
            id: parsedBody?.id || null,
          }));
        }
      } else if (req.method === "GET") {
        if (sessionId && transports.has(sessionId)) {
          const transport = transports.get(sessionId)!;
          await transport.handleRequest(req, res);
        } else {
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end("Invalid or missing session");
        }
      } else if (req.method === "DELETE") {
        if (sessionId && transports.has(sessionId)) {
          const transport = transports.get(sessionId)!;
          await transport.handleRequest(req, res);
          transports.delete(sessionId);
        } else {
          res.writeHead(404);
          res.end("Session not found");
        }
      } else {
        res.writeHead(405);
        res.end("Method not allowed");
      }
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  const host = process.env.HOST || "0.0.0.0";
  httpServer.listen(config.port, host, () => {
    console.error(`KB vault MCP server running on ${BASE_URL}`);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
