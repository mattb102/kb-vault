/**
 * Morning report entry point. Driven by scripts/cron-morning-report.sh on the
 * VPS; also runnable by hand with `npm run morning-report`.
 *
 * Exits non-zero only if the report could not be written at all. A delivery
 * channel failing (Discord down, no phone subscribed) is reported and survived
 * — the report is already safe in the vault by then.
 */
import { runMorningReport } from "../src/plugins/morning_report/logic.js";

async function main() {
  const outcome = await runMorningReport();
  console.log(`Report written to ${outcome.vaultPath}`);
  console.log(`Delivered: ${outcome.delivered.join(", ")}`);
  for (const f of outcome.failed) {
    console.error(`Delivery failed — ${f.channel}: ${f.error}`);
  }
}

main().catch((err) => {
  console.error("Morning report failed:", err?.message || err);
  process.exit(1);
});
