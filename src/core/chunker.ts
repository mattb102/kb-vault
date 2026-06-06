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
      chunks.push({
        id: `${entry.relPath}#root`,
        text,
        filePath: entry.path,
        relPath: entry.relPath,
        headers: "",
        frontmatter: entry.frontmatter,
        type,
        tags,
      });
    }
    return chunks;
  }

  for (const section of sections) {
    const text = section.lines.join("\n").trim();
    if (text.length === 0) continue;

    const headerBreadcrumb = section.headers.join(" > ");

    chunks.push({
      id: `${entry.relPath}#${headerBreadcrumb || "root"}`,
      text,
      filePath: entry.path,
      relPath: entry.relPath,
      headers: headerBreadcrumb,
      frontmatter: entry.frontmatter,
      type,
      tags,
    });
  }

  return chunks;
}
