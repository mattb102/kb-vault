import * as lancedb from "@lancedb/lancedb";
import { config } from "./config.js";
import { frontmatterIndex } from "./frontmatter.js";
import { chunkFile, type Chunk } from "./chunker.js";
import { embed } from "./embeddings.js";
import { contentHash } from "./utils.js";

let db: lancedb.Connection | null = null;
let table: lancedb.Table | null = null;

const TABLE_NAME = "vault_chunks";

interface VaultRecord {
  [key: string]: unknown;
  id: string;
  text: string;
  filePath: string;
  relPath: string;
  headers: string;
  type: string;
  tags: string;
  contentHash: string;
  vector: number[];
}

/**
 * Get or open the LanceDB connection and table.
 */
async function getTable(): Promise<lancedb.Table> {
  if (table) return table;

  db = await lancedb.connect(config.dbPath);
  const tableNames = await db.tableNames();

  if (tableNames.includes(TABLE_NAME)) {
    table = await db.openTable(TABLE_NAME);
  }
  // Table doesn't exist yet — it will be created on first index

  return table!;
}

/**
 * Create the table with initial data.
 */
async function createTable(records: VaultRecord[]): Promise<lancedb.Table> {
  if (!db) {
    db = await lancedb.connect(config.dbPath);
  }

  // Drop existing table if it exists
  const tableNames = await db.tableNames();
  if (tableNames.includes(TABLE_NAME)) {
    await db.dropTable(TABLE_NAME);
  }

  table = await db.createTable(TABLE_NAME, records);
  return table;
}

/**
 * Full re-index of the entire vault.
 * Rebuilds the frontmatter index, chunks all files, embeds, and stores.
 */
export async function fullReindex(): Promise<{ chunks: number; files: number }> {
  console.log("Starting full vault re-index...");
  await frontmatterIndex.rebuild();

  const allEntries = frontmatterIndex.all();
  const allChunks: Chunk[] = [];

  for (const entry of allEntries) {
    const chunks = chunkFile(entry);
    allChunks.push(...chunks);
  }

  console.log(
    `Chunked ${allEntries.length} files into ${allChunks.length} chunks. Embedding...`
  );

  const records: VaultRecord[] = [];
  let processed = 0;

  for (const chunk of allChunks) {
    const vector = await embed(chunk.text, "document");
    records.push({
      id: chunk.id,
      text: chunk.text,
      filePath: chunk.filePath,
      relPath: chunk.relPath,
      headers: chunk.headers,
      type: chunk.type,
      tags: JSON.stringify(chunk.tags),
      contentHash: contentHash(chunk.text),
      vector,
    });

    processed++;
    if (processed % 50 === 0) {
      console.log(`Embedded ${processed}/${allChunks.length} chunks...`);
    }
  }

  if (records.length > 0) {
    await createTable(records);
    console.log(`Index complete: ${records.length} chunks stored.`);
  } else {
    console.log("No content to index.");
  }

  return { chunks: records.length, files: allEntries.length };
}

/**
 * Incrementally index a single file (after it changes).
 */
export async function indexFile(filePath: string): Promise<void> {
  const entry = await frontmatterIndex.indexFile(filePath);
  if (!entry) return;

  const chunks = chunkFile(entry);
  const records: VaultRecord[] = [];

  for (const chunk of chunks) {
    const vector = await embed(chunk.text, "document");
    records.push({
      id: chunk.id,
      text: chunk.text,
      filePath: chunk.filePath,
      relPath: chunk.relPath,
      headers: chunk.headers,
      type: chunk.type,
      tags: JSON.stringify(chunk.tags),
      contentHash: contentHash(chunk.text),
      vector,
    });
  }

  const t = await getTable();
  if (!t) {
    // Table doesn't exist yet, create it
    if (records.length > 0) {
      await createTable(records);
    }
    return;
  }

  // Delete old chunks for this file, then add new ones
  try {
    await t.delete(`relPath = '${entry.relPath.replace(/'/g, "''")}'`);
  } catch {
    // Table might not have this file yet
  }

  if (records.length > 0) {
    await t.add(records);
  }
}

/**
 * Remove a file from the index.
 */
export async function removeFromIndex(filePath: string): Promise<void> {
  const rp = filePath.replace(config.vaultPath + "/", "");
  frontmatterIndex.removeFile(filePath);

  const t = await getTable();
  if (t) {
    try {
      await t.delete(`relPath = '${rp.replace(/'/g, "''")}'`);
    } catch {
      // Ignore if not found
    }
  }
}

/**
 * Check if the index exists and has data.
 */
export async function isIndexed(): Promise<boolean> {
  try {
    const t = await getTable();
    if (!t) return false;
    const count = await t.countRows();
    return count > 0;
  } catch {
    return false;
  }
}
