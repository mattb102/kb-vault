import { auditVault } from "../src/core/auditor.js";
import { config } from "../src/core/config.js";

// Monthly read-only audit → AI-Observations/audits/<date>.md.
// Reads every auditable top-level folder, asks Claude for per-file verdicts
// (KEEP / CLEAN / MERGE / DELETE), writes the report. Applies nothing.
//
// Flags: --dry-run  --only=<GroupName>
//
// The script exits 0 with no output when audit.enabled is false in config
// so the cron entry is harmless before the feature is turned on.

async function main() {
  if (!config.auditConfig.enabled) {
    console.log(
      "Audit is disabled (audit.enabled: false in config). Set it to true to enable.",
    );
    return;
  }

  const only = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1];
  const res = await auditVault({
    dryRun: process.argv.includes("--dry-run"),
    only,
  });

  if (res.path) console.log(`Audit written: ${res.path}`);
  else console.log(res.report);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
