import { config } from "./config.js";

/**
 * Two embedding backends, chosen by config.embeddingProvider:
 *
 *   "openai" (default) — hosted API. Works on the cheapest VPS; no model
 *     download, no RAM pressure. Costs pennies. Needs OPENAI_API_KEY.
 *   "local"            — quantized ONNX nomic-embed via @huggingface/transformers.
 *     Fully self-contained, no API key, but wants a larger box.
 *
 * Both expose the same embed()/embedBatch() so search.ts and indexer.ts are
 * provider-agnostic. The local backend (and its heavy transformers dep) is
 * only imported when actually selected.
 */

// ─── OpenAI backend ────────────────────────────────────────────────
let openaiClient: any = null;
async function getOpenAI() {
  if (openaiClient) return openaiClient;
  const { default: OpenAI } = await import("openai");
  if (!config.openaiApiKey) {
    throw new Error(
      "EMBEDDING_PROVIDER=openai but OPENAI_API_KEY is not set. " +
        "Add it to your .env, or switch to EMBEDDING_PROVIDER=local."
    );
  }
  openaiClient = new OpenAI({ apiKey: config.openaiApiKey });
  return openaiClient;
}

async function openaiEmbed(texts: string[]): Promise<number[][]> {
  const client = await getOpenAI();
  const res = await client.embeddings.create({
    model: config.embeddingModel,
    input: texts,
  });
  // Preserve input order.
  return res.data
    .sort((a: any, b: any) => a.index - b.index)
    .map((d: any) => d.embedding as number[]);
}

// ─── Local ONNX backend ────────────────────────────────────────────
let extractor: any = null;
let loading: Promise<any> | null = null;

async function getExtractor(): Promise<any> {
  if (extractor) return extractor;
  if (loading) return loading;
  const { pipeline } = await import("@huggingface/transformers");
  loading = pipeline("feature-extraction", config.embeddingModel, {
    dtype: "q8" as any,
  }).then((ext: any) => {
    extractor = ext;
    loading = null;
    return ext;
  });
  return loading;
}

async function localEmbed(text: string, prefix: string): Promise<number[]> {
  const ext = await getExtractor();
  const result = await ext(prefix + text, { pooling: "mean", normalize: true });
  return Array.from(result.data as Float32Array);
}

// ─── Public API ────────────────────────────────────────────────────

/**
 * Generate an embedding for the given text.
 * For local nomic-embed, documents/queries get distinct prefixes; OpenAI
 * models don't use prefixes.
 */
export async function embed(
  text: string,
  type: "document" | "query" = "document"
): Promise<number[]> {
  if (config.embeddingProvider === "openai") {
    const [vec] = await openaiEmbed([text]);
    return vec;
  }
  const prefix = type === "document" ? "search_document: " : "search_query: ";
  return localEmbed(text, prefix);
}

/**
 * Generate embeddings for multiple texts.
 */
export async function embedBatch(
  texts: string[],
  type: "document" | "query" = "document"
): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (config.embeddingProvider === "openai") {
    return openaiEmbed(texts);
  }
  // Local backend: sequential to avoid OOM on large batches.
  const prefix = type === "document" ? "search_document: " : "search_query: ";
  const results: number[][] = [];
  for (const text of texts) {
    results.push(await localEmbed(text, prefix));
  }
  return results;
}

/**
 * Pre-load the embedding model (call at startup). No-op for the hosted
 * backend; warms the ONNX model for the local backend.
 */
export async function preloadModel(): Promise<void> {
  if (config.embeddingProvider === "local") {
    await getExtractor();
  }
}
