import { readdir, readFile, stat } from "fs/promises";
import { join, relative } from "path";
import { config } from "./config.js";

/**
 * Recursively walk a directory and return all .md file paths.
 */
export async function walkMarkdownFiles(dir?: string): Promise<string[]> {
  const root = dir || config.vaultPath;
  const results: string[] = [];

  async function walk(current: string) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        // Skip hidden dirs and _templates
        if (entry.name.startsWith(".")) continue;
        await walk(fullPath);
      } else if (entry.name.endsWith(".md")) {
        results.push(fullPath);
      }
    }
  }

  await walk(root);
  return results;
}

/**
 * Get the relative path from vault root.
 */
export function relPath(absolutePath: string): string {
  return relative(config.vaultPath, absolutePath);
}

/**
 * Get the absolute path from a vault-relative path.
 */
export function absPath(relativePath: string): string {
  return join(config.vaultPath, relativePath);
}

/**
 * Read a file and return its contents.
 */
export async function readFileContent(filePath: string): Promise<string> {
  return readFile(filePath, "utf-8");
}

/**
 * Get file modification time as ISO string.
 */
export async function getFileMtime(filePath: string): Promise<string> {
  const s = await stat(filePath);
  return s.mtime.toISOString();
}

/**
 * Simple content hash for detecting file moves.
 */
export function contentHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return hash.toString(36);
}

const TZ = "America/New_York";

/**
 * Get today's date as YYYY-MM-DD in Matt's local timezone.
 */
export function today(): string {
  // en-CA locale formats as YYYY-MM-DD.
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
}

/**
 * Get current time as HH:mm in Matt's local timezone.
 */
export function nowTime(): string {
  return new Date().toLocaleTimeString("en-US", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * Get current ISO week number (e.g., "2026-W15").
 */
export function currentWeek(): string {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const diff = now.getTime() - start.getTime();
  const oneWeek = 604800000;
  const weekNum = Math.ceil((diff / oneWeek + start.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}
