import { unified } from "unified";
import remarkParse from "remark-parse";
import type { FileEntry } from "./frontmatter.js";

export interface Chunk {
  /** Unique ID: filePath#headerBreadcrumb */
  id: string;
  /** Text content of this chunk */
  text: string;
  /** Absolute file path */
  filePath: string;
  /** Relative file path */
  relPath: string;
  /** Header breadcrumb (e.g., "Health > Fitness > Running") */
  headers: string;
  /** All frontmatter fields from the source file */
  frontmatter: Record<string, unknown>;
  /** Frontmatter type field for easy filtering */
  type: string;
  /** Frontmatter tags */
  tags: string[];
}

interface Section {
  headers: string[];
  lines: string[];
}

/**
 * Hard cap on the characters in a single chunk.
 *
 * This is a load-bearing safety limit, not a tuning knob. A chunk becomes one
 * embedding call, and the local ONNX embedder holds the whole thing in memory.
 * One giant markdown table (a metrics log, a nudge table) parses as a SINGLE
 * section with no interior headers, so without this cap a 300KB table becomes
 * a 300KB chunk, blows the embedder past ~3.5GB, and OOM-kills every reindex
 * from then on — on the 4GB box this setup recommends. Do not raise or remove
 * it casually.
 */
export const MAX_CHUNK_CHARS = 4000;

/**
 * Split an oversized section on line boundaries so no chunk exceeds the cap.
 * Sections at or under the cap pass through untouched (the common case), so
 * ordinary prose notes chunk exactly as they did before.
 */
function capChunkSize(text: string): string[] {
  if (text.length <= MAX_CHUNK_CHARS) return [text];

  const out: string[] = [];
  let current: string[] = [];
  let currentLen = 0;

  for (const line of text.split("\n")) {
    // +1 for the newline we will rejoin with.
    if (currentLen + line.length + 1 > MAX_CHUNK_CHARS && current.length > 0) {
      out.push(current.join("\n"));
      current = [];
      currentLen = 0;
    }
    current.push(line);
    currentLen += line.length + 1;
  }

  if (current.length > 0) out.push(current.join("\n"));
  return out.filter((t) => t.trim().length > 0);
}

/**
 * Split markdown content into sections based on headers.
 */
function splitByHeaders(content: string): Section[] {
  const lines = content.split("\n");
  const sections: Section[] = [];
  let currentHeaders: string[] = [];
  let currentLines: string[] = [];

  for (const line of lines) {
    const headerMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headerMatch) {
      // Save previous section if it has content
      if (currentLines.some((l) => l.trim().length > 0)) {
        sections.push({
          headers: [...currentHeaders],
          lines: [...currentLines],
        });
      }

      const level = headerMatch[1].length;
      const title = headerMatch[2].trim();

      // Adjust header stack based on level
      currentHeaders = currentHeaders.slice(0, level - 1);
      currentHeaders[level - 1] = title;
      currentHeaders = currentHeaders.filter(Boolean);
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  // Don't forget the last section
  if (currentLines.some((l) => l.trim().length > 0)) {
    sections.push({
      headers: [...currentHeaders],
      lines: [...currentLines],
    });
  }

  return sections;
}

/**
 * Chunk a file entry into searchable pieces.
 */
export function chunkFile(entry: FileEntry): Chunk[] {
  const sections = splitByHeaders(entry.content);
  const chunks: Chunk[] = [];
  const type = (entry.frontmatter.type as string) || "unknown";
  const tags = Array.isArray(entry.frontmatter.tags)
    ? (entry.frontmatter.tags as string[])
    : [];

  if (sections.length === 0) {
    // File has no headers — treat the whole content as one chunk
    const text = entry.content.trim();
    if (text.length > 0) {
      const parts = capChunkSize(text);
      parts.forEach((part, i) => {
        chunks.push({
          id: `${entry.relPath}#root${parts.length > 1 ? `~${i + 1}` : ""}`,
          text: part,
          filePath: entry.path,
          relPath: entry.relPath,
          headers: "",
          frontmatter: entry.frontmatter,
          type,
          tags,
        });
      });
    }
    return chunks;
  }

  for (const section of sections) {
    const text = section.lines.join("\n").trim();
    if (text.length === 0) continue;

    const headerBreadcrumb = section.headers.join(" > ");
    const base = `${entry.relPath}#${headerBreadcrumb || "root"}`;

    // A section with no interior headers can be arbitrarily long (a whole
    // metrics table). Cap it so one section never becomes one huge embedding.
    const parts = capChunkSize(text);
    parts.forEach((part, i) => {
      chunks.push({
        id: parts.length > 1 ? `${base}~${i + 1}` : base,
        text: part,
        filePath: entry.path,
        relPath: entry.relPath,
        headers: headerBreadcrumb,
        frontmatter: entry.frontmatter,
        type,
        tags,
      });
    });
  }

  return chunks;
}
