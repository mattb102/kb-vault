import { reconcileVault } from "../src/core/reconcile.js";
import { config } from "../src/core/config.js";

// Nightly: reads the last N days of scratchpad entries, triages which canonical
// files they affect, proposes + guards + applies rewrites, logs diffs to
// AI-Observations/reconcile/<date>.md.
//
// Flags: --days=N  --dry-run  --only=<vault-relative-path>  --max=N
//
// The script exits 0 with no output when reconcile.enabled is false in config
// so the cron entry is harmless before the feature is turned on.

async function main() {
  if (!config.reconcileConfig.enabled) {
    console.log(
      "Reconcile is disabled (reconcile.enabled: false in config). Set it to true to enable.",
    );
    return;
  }

  const arg = (k: string) =>
    process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];

  const res = await reconcileVault({
    days: arg("days") ? parseInt(arg("days")!, 10) : undefined,
    dryRun: process.argv.includes("--dry-run"),
    only: arg("only"),
    max: arg("max") ? parseInt(arg("max")!, 10) : undefined,
  });

  console.log(
    `Reconcile ${res.date}: ${res.entries} entries / ${res.days}d → ${res.triage.length} triaged`,
  );
  for (const r of res.results) {
    console.log(`  [${r.status}] ${r.file} — ${r.reason}`);
  }
  if (process.argv.includes("--dry-run")) {
    for (const r of res.results.filter((x) => x.diff)) {
      console.log(`\n--- ${r.file} ---\n${r.diff}`);
    }
  }
  if (res.logPath) console.log(`Log: ${res.logPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
