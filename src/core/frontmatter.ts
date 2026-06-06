import matter from "gray-matter";
import { walkMarkdownFiles, readFileContent, relPath, absPath } from "./utils.js";
import { config } from "./config.js";

export interface FileEntry {
  /** Absolute path */
  path: string;
  /** Relative path from vault root */
  relPath: string;
  /** Parsed frontmatter fields */
  frontmatter: Record<string, unknown>;
  /** Raw markdown content (without frontmatter) */
  content: string;
}

/**
 * In-memory index of all vault files and their frontmatter.
 * Rebuilt on startup, updated incrementally by the watcher.
 */
class FrontmatterIndex {
  private entries: Map<string, FileEntry> = new Map();

  async rebuild(): Promise<void> {
    this.entries.clear();
    const files = await walkMarkdownFiles();
    for (const filePath of files) {
      await this.indexFile(filePath);
    }
  }

  async indexFile(filePath: string): Promise<FileEntry | null> {
    try {
      const raw = await readFileContent(filePath);
      const { data, content } = matter(raw);
      const entry: FileEntry = {
        path: filePath,
        relPath: relPath(filePath),
        frontmatter: data,
        content,
      };
      this.entries.set(filePath, entry);
      return entry;
    } catch {
      return null;
    }
  }

  removeFile(filePath: string): void {
    this.entries.delete(filePath);
  }

  /**
   * Find files matching frontmatter criteria.
   * All provided fields must match (AND logic).
   */
  find(criteria: Record<string, unknown>): FileEntry[] {
    const results: FileEntry[] = [];
    for (const entry of this.entries.values()) {
      let match = true;
      for (const [key, value] of Object.entries(criteria)) {
        if (entry.frontmatter[key] !== value) {
          match = false;
          break;
        }
      }
      if (match) results.push(entry);
    }
    return results;
  }

  /**
   * Find a single file by frontmatter criteria.
   * Returns the first match.
   */
  findOne(criteria: Record<string, unknown>): FileEntry | null {
    return this.find(criteria)[0] || null;
  }

  /**
   * Find files that have any of the given tags.
   */
  findByTags(tags: string[]): FileEntry[] {
    const results: FileEntry[] = [];
    for (const entry of this.entries.values()) {
      const entryTags = entry.frontmatter.tags;
      if (Array.isArray(entryTags)) {
        if (tags.some((t) => entryTags.includes(t))) {
          results.push(entry);
        }
      }
    }
    return results;
  }

  /**
   * Get all entries.
   */
  all(): FileEntry[] {
    return Array.from(this.entries.values());
  }

  /**
   * Get a specific entry by absolute path.
   */
  get(filePath: string): FileEntry | null {
    return this.entries.get(filePath) || null;
  }

  /**
   * Get entry by relative path.
   */
  getByRelPath(rp: string): FileEntry | null {
    const ap = absPath(rp);
    return this.entries.get(ap) || null;
  }

  get size(): number {
    return this.entries.size;
  }
}

export const frontmatterIndex = new FrontmatterIndex();
