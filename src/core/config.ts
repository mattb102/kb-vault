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

interface DecayConfig {
  /** Days a P2/P3 nudge must be untouched before the decay script expires it (default: 60). */
  nudgeDecayDays?: number;
  /** Days before a scratchpad entry is moved to the monthly archive (default: 120). */
  scratchpadDecayDays?: number;
}

interface ReconcileConfig {
  /**
   * Enable the nightly reconcile cron. Requires the claude CLI on PATH with
   * subscription auth. Default: false.
   */
  enabled?: boolean;
  /** How many days of observations to read each run (default: 1). */
  days?: number;
  /** Max files to rewrite per run (default: 8). */
  maxFilesPerRun?: number;
  /**
   * Vault-relative path to the routing manifest. The manifest is a markdown
   * table telling Claude which type of fact belongs in which file. If absent,
   * the reconciler proceeds without routing guidance.
   * Default: Core/routing.md
   */
  routingFile?: string;
}

interface AuditConfig {
  /**
   * Enable the monthly audit cron. Requires the claude CLI on PATH with
   * subscription auth. Default: false.
   */
  enabled?: boolean;
  /**
   * Top-level vault folders to audit. If omitted, all non-excluded top-level
   * directories are auto-discovered (AI-Observations, Reports, _templates
   * are always skipped).
   */
  groups?: string[];
}

interface FileConfig {
  vaultPath?: string;
  ownerName?: string;
  serverName?: string;
  transport?: "stdio" | "http";
  port?: number;
  embeddingProvider?: "openai" | "local";
  embeddingModel?: string;
  enabledPlugins?: string[];
  /**
   * Per-plugin settings, keyed by plugin directory name. Opaque to the core —
   * each plugin validates its own slice. Lets a plugin take real configuration
   * (trackers, delivery channels) without every option becoming a core field.
   */
  plugins?: Record<string, any>;
  /** Retention / decay settings for the automated cleanup scripts. */
  decay?: DecayConfig;
  /** Nightly reconcile settings. Off by default (requires claude CLI). */
  reconcile?: ReconcileConfig;
  /** Monthly audit settings. Off by default (requires claude CLI). */
  audit?: AuditConfig;
  /**
   * Vault-relative path to the write checklist prepended to server instructions
   * and the get_identity response. Default: Core/write-checklist.md.
   * Create the file from config/write-checklist.example.md as a starting point.
   */
  checklistFile?: string;
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

  // Settings for individual plugins, keyed by plugin name. See config.example.yaml.
  pluginConfig: (file.plugins || {}) as Record<string, any>,

  // Retention / decay settings for the automated cleanup scripts.
  decay: {
    nudgeDecayDays: file.decay?.nudgeDecayDays ?? 60,
    scratchpadDecayDays: file.decay?.scratchpadDecayDays ?? 120,
  },

  // Nightly reconcile (requires claude CLI).
  reconcileConfig: {
    enabled: file.reconcile?.enabled ?? false,
    days: file.reconcile?.days ?? 1,
    maxFilesPerRun: file.reconcile?.maxFilesPerRun ?? 8,
    routingFile: file.reconcile?.routingFile ?? "Core/routing.md",
  },

  // Monthly audit (requires claude CLI).
  auditConfig: {
    enabled: file.audit?.enabled ?? false,
    groups: file.audit?.groups,
  },

  checklistFile: file.checklistFile || "Core/write-checklist.md",

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
