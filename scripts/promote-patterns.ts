import { promotePatterns } from "../src/core/promoter.js";
import { config } from "../src/core/config.js";

// Standalone runner for promote_patterns — safe to call from cron.
// Requires ANTHROPIC_API_KEY in .env (or environment).
// Reads VAULT_PATH from .env / environment as usual.

async function main() {
  console.log(`[${new Date().toISOString()}] promote-patterns: vault=${config.vaultPath}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set — cannot synthesize patterns.");
    process.exit(1);
  }
  const result = await promotePatterns({});
  console.log(result);
}

main().catch((err) => {
  console.error("promote-patterns failed:", err);
  process.exit(1);
});
