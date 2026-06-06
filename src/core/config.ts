import { resolve } from "path";
import { readFileSync } from "fs";
import { parse as parseYaml } from "yaml";

/**
 * Configuration is layered:
 *   1. defaults below
 *   2. config.yaml (non-secret preferences: vault path, owner, plugins, …)
 *   3. environment variables (secrets + deploy-time overrides) — highest priority
 *
 * The bootstrap scripts write secrets into a .env file; humans edit
 * config.yaml during personalization. Nothing here is personal — every
 * person-specific value comes from config.yaml or the environment.
 */

interface FileConfig {
  vaultPath?: string;
  ownerName?: string;
  serverName?: string;
  transport?: "stdio" | "http";
  port?: number;
  embeddingProvider?: "openai" | "local";
  embeddingModel?: string;
  enabledPlugins?: string[];
}

function loadFileConfig(): FileConfig {
  const path = process.env.CONFIG_PATH || resolve("config/config.yaml");
  try {
    return (parseYaml(readFileSync(path, "utf-8")) as FileConfig) || {};
  } catch {
    // No config.yaml is fine — env vars can supply everything.
    return {};
  }
}

const file = loadFileConfig();

function requireVaultPath(): string {
  const raw = process.env.VAULT_PATH || file.vaultPath;
  if (!raw) {
    throw new Error(
      "VAULT_PATH is not set. Set it in the environment or `vaultPath` in config/config.yaml. " +
        "There is no default — point it at your vault."
    );
  }
  return resolve(raw);
}

const provider = (process.env.EMBEDDING_PROVIDER ||
  file.embeddingProvider ||
  "local") as "openai" | "local";

export const config = {
  vaultPath: requireVaultPath(),
  ownerName: process.env.OWNER_NAME || file.ownerName || "the user",
  serverName: process.env.SERVER_NAME || file.serverName || "kb",
  dbPath: resolve(process.env.DB_PATH || "./data/lancedb"),
  transport: (process.env.TRANSPORT || file.transport || "stdio") as
    | "stdio"
    | "http",
  port: parseInt(process.env.PORT || String(file.port || 3000), 10),
  apiKey: process.env.API_KEY || "",
  authPassword: process.env.AUTH_PASSWORD || "",

  // Embeddings: local quantized ONNX (default — no API key, runs on the box) or
  // hosted "openai" (opt-in). The model string is provider-specific (a
  // HuggingFace repo for local, or an OpenAI model id).
  embeddingProvider: provider,
  embeddingModel:
    process.env.EMBEDDING_MODEL ||
    file.embeddingModel ||
    (provider === "local"
      ? "nomic-ai/nomic-embed-text-v1.5"
      : "text-embedding-3-small"),
  openaiApiKey: process.env.OPENAI_API_KEY || "",

  // Opt-in feature plugins. Empty by default — a fresh install is just the
  // core vault. Personalization (setup chunk 08) edits this list.
  enabledPlugins:
    (process.env.ENABLED_PLUGINS
      ? process.env.ENABLED_PLUGINS.split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : file.enabledPlugins) || [],

  chunkSize: 800, // target tokens per chunk
  chunkOverlap: 100,
  gitSyncCooldown: 60_000, // ms between git pulls
  searchDefaults: {
    limit: 10,
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    redirectUri: process.env.GOOGLE_REDIRECT_URI || "",
  },
};
