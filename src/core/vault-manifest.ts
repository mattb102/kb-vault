/**
 * Loads the optional vault manifest files that are prepended to server
 * instructions and the get_identity response:
 *
 *   write-checklist.md   short must-follow rules for write-back tools
 *   Core/routing.md      "where each kind of fact lives" guide
 *
 * Both files are optional. Missing files are silently skipped — a fresh vault
 * that has never created them still works; Claude just doesn't get the
 * guidance. The config path for the checklist is configurable so each owner
 * can choose their own layout.
 */
import { readFileSync } from "fs";
import { join } from "path";
import matter from "gray-matter";
import { config } from "./config.js";

function loadVaultFile(relPath: string): string | undefined {
  try {
    const raw = readFileSync(join(config.vaultPath, relPath), "utf-8");
    return matter(raw).content.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Load the write checklist from the configured vault path (default Core/write-checklist.md). */
export function loadWriteChecklist(): string | undefined {
  const rel = config.checklistFile || "Core/write-checklist.md";
  return loadVaultFile(rel);
}

/** Load the routing manifest from Core/routing.md. */
export function loadRoutingManifest(): string | undefined {
  return loadVaultFile("Core/routing.md");
}

/**
 * Build the combined server instructions string: checklist first, then
 * routing manifest. Returns undefined when both files are absent.
 */
export function buildServerInstructions(): string | undefined {
  const parts = [loadWriteChecklist(), loadRoutingManifest()].filter(Boolean);
  return parts.length > 0 ? parts.join("\n\n---\n\n") : undefined;
}
