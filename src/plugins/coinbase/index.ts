import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { getHoldingsFormatted } from "./logic.js";

/** Coinbase holdings (read-only). Reference example plugin (off by default). */
export function register(server: McpServer): void {
  server.tool(
    "cb_holdings",
    "Get current Coinbase crypto holdings with live USD prices and total portfolio value.",
    {},
    async () => {
      const result = await getHoldingsFormatted();
      return { content: [{ type: "text", text: result }] };
    }
  );
}
