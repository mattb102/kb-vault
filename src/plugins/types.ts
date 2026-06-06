import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type http from "http";

/**
 * A plugin is an opt-in bundle of MCP tools (and optionally a few HTTP routes,
 * e.g. an OAuth callback). Each plugin lives in src/plugins/<name>/ and its
 * index.ts exports `register` plus, optionally, `handleHttp`.
 *
 * Plugins are loaded only when their name appears in config.enabledPlugins.
 */
export interface PluginModule {
  /** Add this plugin's MCP tools to a server instance. Called per session. */
  register(server: McpServer): void;
  /**
   * Optionally handle a plugin-specific HTTP route (e.g. an OAuth callback).
   * Return true if the request was handled, false to let the core router
   * continue. Only consulted on the HTTP transport.
   */
  handleHttp?(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL
  ): Promise<boolean>;
}
