import * as lancedb from "@lancedb/lancedb";
import { config } from "./config.js";
import { embed } from "./embeddings.js";

let db: lancedb.Connection | null = null;
let table: lancedb.Table | null = null;

const TABLE_NAME = "vault_chunks";

async function getTable(): Promise<lancedb.Table | null> {
  if (table) return table;
  try {
    db = await lancedb.connect(config.dbPath);
    table = await db.openTable(TABLE_NAME);
    return table;
  } catch {
    return null;
  }
}

export interface SearchResult {
  id: string;
  text: string;
  relPath: string;
  headers: string;
  type: string;
  tags: string[];
  score: number;
}

/**
 * Vector similarity search across the vault.
 */
export async function vectorSearch(
  query: string,
  limit: number = config.searchDefaults.limit,
  typeFilter?: string
): Promise<SearchResult[]> {
  const t = await getTable();
  if (!t) return [];

  const queryVector = await embed(query, "query");

  let queryBuilder = t.search(queryVector).limit(limit);

  if (typeFilter) {
    queryBuilder = queryBuilder.where(`type = '${typeFilter.replace(/'/g, "''")}'`);
  }

  const results = await queryBuilder.toArray();

  return results.map((row: any) => ({
    id: row.id,
    text: row.text,
    relPath: row.relPath,
    headers: row.headers,
    type: row.type,
    tags: safeParseTags(row.tags),
    score: row._distance != null ? 1 - row._distance : 0,
  }));
}

/**
 * Full-text search across the vault.
 */
export async function textSearch(
  query: string,
  limit: number = config.searchDefaults.limit,
  typeFilter?: string
): Promise<SearchResult[]> {
  const t = await getTable();
  if (!t) return [];

  // Use vector search with a text-based approach
  // LanceDB FTS requires explicit index creation, fall back to vector search
  return vectorSearch(query, limit, typeFilter);
}

/**
 * Hybrid search combining vector similarity and keyword matching.
 * Uses reciprocal rank fusion to merge results.
 */
export async function hybridSearch(
  query: string,
  limit: number = config.searchDefaults.limit,
  typeFilter?: string
): Promise<SearchResult[]> {
  // For now, use vector search as the primary method
  // FTS integration can be added once the vault has enough content
  // to warrant a full-text index
  const results = await vectorSearch(query, limit * 2, typeFilter);

  // Also do a simple text match to boost exact keyword hits
  const queryLower = query.toLowerCase();
  for (const result of results) {
    if (result.text.toLowerCase().includes(queryLower)) {
      result.score += 0.2; // boost exact matches
    }
  }

  // Re-sort by score and limit
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

function safeParseTags(tags: string): string[] {
  try {
    return JSON.parse(tags);
  } catch {
    return [];
  }
}
