import { fullReindex } from "../src/core/indexer.js";
import { frontmatterIndex } from "../src/core/frontmatter.js";
import { config } from "../src/core/config.js";

async function main() {
  console.log(`Indexing vault at: ${config.vaultPath}`);
  console.log(`Database at: ${config.dbPath}`);

  await frontmatterIndex.rebuild();
  console.log(`Found ${frontmatterIndex.size} files.`);

  const { chunks, files } = await fullReindex();
  console.log(`Done! Indexed ${files} files into ${chunks} chunks.`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
