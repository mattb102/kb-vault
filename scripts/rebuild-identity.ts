import { rebuildIdentity } from "../src/core/identity.js";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const daysArg = process.argv.find((a) => a.startsWith("--days="));

  const result = await rebuildIdentity({
    dryRun,
    scratchpadDays: daysArg ? parseInt(daysArg.split("=")[1], 10) : undefined,
  });

  if (dryRun) {
    console.log("=== DRY RUN — not written ===");
    console.log(result.doc);
    return;
  }

  console.log(`Wrote identity to: ${result.path}`);
  console.log(
    `Sources: patterns=${result.sources.patterns}, observationDays=${result.sources.observationDays}, groundTruthChars=${result.sources.groundTruthChars}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
