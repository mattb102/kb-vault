import { readFile } from "fs/promises";
import { join } from "path";
import matter from "gray-matter";
import { config } from "./config.js";

export const SCRATCHPAD_REL = "AI-Observations/scratchpad.md";
export const PATTERNS_REL = "AI-Observations/patterns.md";

export interface Entry {
  timestamp: string;
  date: Date;
  type: string;
  subject: string;
  supersedes?: string;
  headerLine: string;
  body: string;
}

const HEADER_RE =
  /^### (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) \| type: ([^|]+?) \| subject: ([^|\n]+?)(?:\s*\|\s*supersedes:\s*([^\n]+?))?\s*$/;

export function parseScratchpad(body: string): { preamble: string; entries: Entry[] } {
  const lines = body.split("\n");
  const entries: Entry[] = [];
  let preambleEnd = lines.length;
  let current: Entry | null = null;
  let currentBody: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(HEADER_RE);
    if (m) {
      if (current) {
        current.body = currentBody.join("\n").replace(/\s+$/, "");
        entries.push(current);
      } else {
        preambleEnd = i;
      }
      const [, date, time, type, subject, supersedes] = m;
      current = {
        timestamp: `${date} ${time}`,
        date: new Date(`${date}T${time}:00`),
        type: type.trim(),
        subject: subject.trim(),
        supersedes: supersedes?.trim(),
        headerLine: line,
        body: "",
      };
      currentBody = [];
    } else if (current) {
      currentBody.push(line);
    }
  }
  if (current) {
    current.body = currentBody.join("\n").replace(/\s+$/, "");
    entries.push(current);
  }

  const preamble = lines.slice(0, preambleEnd).join("\n").replace(/\s+$/, "");
  return { preamble, entries };
}

export function renderEntry(e: Entry): string {
  return `${e.headerLine}\n${e.body}`.replace(/\s+$/, "");
}

export async function readScratchpad(): Promise<{
  path: string;
  frontmatter: Record<string, unknown>;
  preamble: string;
  entries: Entry[];
}> {
  const path = join(config.vaultPath, SCRATCHPAD_REL);
  const raw = await readFile(path, "utf-8");
  const parsed = matter(raw);
  const { preamble, entries } = parseScratchpad(parsed.content);
  return { path, frontmatter: parsed.data, preamble, entries };
}
