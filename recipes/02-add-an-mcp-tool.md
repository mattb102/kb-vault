# 02 · Add an MCP tool — a real integration (a new plugin)

When the feature needs logic or talks to an outside service, you write a
**plugin**: one folder under `src/plugins/<name>/` that exports `register(server)`.
This is the only kind of feature that touches code, and it never requires
editing the core engine. The pattern is the same every time — copy it.

## The shape

Every plugin registers tools the same way. The simplest working example is
`src/tools/read.ts`. A plugin mirrors it:

```ts
// src/plugins/github/index.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getStars } from "./logic.js";   // real work lives here

export function register(server: McpServer): void {
  server.tool(
    "gh_stars",
    "List the user's recently starred GitHub repos.",
    { limit: z.number().optional().default(10) },
    async ({ limit }) => {
      const text = await getStars(limit);
      return { content: [{ type: "text", text }] };
    }
  );
}
```

**Structure:**
- `src/plugins/<name>/index.ts` — tool registrations only; keep it thin
- `src/plugins/<name>/logic.ts` — HTTP calls, parsing, computation
- This split is how `mal`, `espn`, `running` are built — stick to it

**Need vault access?** Import from core:
- `frontmatterIndex` from `../../core/frontmatter.js`
- `gitCommitAndPush` from `../../core/sync.js`
- `today` from `../../core/utils.js`
See `src/plugins/running/logic.ts` for a real example.

**Need a one-time OAuth callback** (like the calendar plugin)?
Export `async handleHttp(req, res, url): Promise<boolean>` that returns `true`
when it handled the route — see `src/plugins/calendar/index.ts`. It wires up
automatically on the HTTP surface.

## Turn it on

1. Add the plugin name to `enabledPlugins` in `config/config.yaml`.
2. **Rebuild and restart** — the server runs compiled `build/`, not `src/`:
   ```
   npm run build
   ```
   Then restart: locally, bounce Claude Code; on the VPS, follow
   `recipes/03-deploy-a-change.md`.
3. **Reconnect** the claude.ai connector after a VPS restart (a restart
   invalidates live sessions by design — they re-init on the next message).

## The one gotcha worth knowing

If your tool relies on a *new* frontmatter field or type, the in-memory
frontmatter index needs to include it. The index rebuilds on server start, so
a restart covers it automatically. But if you add files at runtime (outside of
`create_note`), call `frontmatterIndex.indexFile(...)` on them. Symptom if you
forget: a brand-new note that `find_notes` can't find until the next restart.

## Verify

After rebuild + restart, `tools/list` includes your new tool and calling it
works. Add a routing line to their `CLAUDE.md` explaining when to use it.
