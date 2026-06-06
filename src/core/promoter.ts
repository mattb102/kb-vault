import { readFile, writeFile, appendFile, access } from "fs/promises";
import { join } from "path";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";
import {
  readScratchpad,
  renderEntry,
  PATTERNS_REL,
  type Entry,
} from "./scratchpad.js";
import { today } from "./utils.js";

const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-4-8";

const CLUSTER_WINDOW_DAYS = 30;
const MIN_CLUSTER_SIZE = 3;
const FRESHNESS_DAYS = 14;

interface Cluster {
  type: string;
  subject: string;
  entries: Entry[];
  resynth?: { firstNoticed: string; synthesized: string; sinceCount: number };
}

export interface PromoteOptions {
  dryRun?: boolean;
  minClusterSize?: number;
  windowDays?: number;
  only?: string; // "type/subject" — restrict to a single cluster
}

interface PromotedRecord {
  synthesized: Date;
  firstNoticed: string;
}

function clusterKey(type: string, subject: string): string {
  return `${type}::${subject}`;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseDateSafe(s: string | undefined): Date | null {
  if (!s) return null;
  const d = new Date(`${s}T00:00:00`);
  return isNaN(d.getTime()) ? null : d;
}

async function loadPromoted(): Promise<Map<string, PromotedRecord>> {
  const out = new Map<string, PromotedRecord>();
  const path = join(config.vaultPath, PATTERNS_REL);
  let raw: string;
  try {
    await access(path);
    raw = await readFile(path, "utf-8");
  } catch {
    return out;
  }

  // Walk block-by-block so we can pull "First noticed:" from the same block as the marker.
  const blockRe = /\n### [^\n]*\n([\s\S]*?)(?=\n### |\n*$)/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(raw)) !== null) {
    const body = m[1];
    const marker = body.match(
      /<!--\s*source:\s*type=([^\s]+)\s+subject=([^\s]+?)(?:\s+synthesized=(\d{4}-\d{2}-\d{2}))?\s*-->/,
    );
    if (!marker) continue;
    const [, type, subject, synthDate] = marker;
    const firstMatch = body.match(/\*\*First noticed:\*\*\s*(\d{4}-\d{2}-\d{2})/);
    const firstNoticed = firstMatch?.[1] ?? today();
    const synthesized =
      parseDateSafe(synthDate) ??
      parseDateSafe(firstNoticed) ??
      new Date(0);
    out.set(clusterKey(type, subject), { synthesized, firstNoticed });
  }
  return out;
}

function findCandidates(
  entries: Entry[],
  promoted: Map<string, PromotedRecord>,
  windowDays: number,
  minSize: number,
): Cluster[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);

  const groups = new Map<string, Entry[]>();
  for (const e of entries) {
    const k = clusterKey(e.type, e.subject);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(e);
  }

  const clusters: Cluster[] = [];
  for (const [key, es] of groups) {
    const sorted = [...es].sort((a, b) => a.date.getTime() - b.date.getTime());
    const prev = promoted.get(key);
    if (prev) {
      // Re-synthesis path: count entries newer than the last synthesis.
      const sinceCount = sorted.filter((e) => e.date > prev.synthesized).length;
      if (sinceCount < minSize) continue;
      clusters.push({
        type: sorted[0].type,
        subject: sorted[0].subject,
        entries: sorted, // pass full history; pattern should reflect all of it
        resynth: {
          firstNoticed: prev.firstNoticed,
          synthesized: prev.synthesized.toLocaleDateString("en-CA"),
          sinceCount,
        },
      });
    } else {
      // First-time path: keep windowDays gate to avoid spurious ancient clusters.
      const recent = sorted.filter((e) => e.date >= cutoff);
      if (recent.length < minSize) continue;
      clusters.push({
        type: sorted[0].type,
        subject: sorted[0].subject,
        entries: recent,
      });
    }
  }
  // Largest clusters first — most signal per LLM call.
  clusters.sort((a, b) => b.entries.length - a.entries.length);
  return clusters;
}

function buildSynthesisPrompt(cluster: Cluster): string {
  const entryText = cluster.entries.map(renderEntry).join("\n\n");
  const resynthNote = cluster.resynth
    ? `\nNote: this updates an earlier pattern on the same subject. ${cluster.resynth.sinceCount} new entries have accumulated since the last synthesis. Reflect the full history below, with weight on the recent entries.\n`
    : "";
  return `You are reviewing recurring AI observations about Matt on a single subject. Synthesize them into one *pattern* — a single sentence that captures the underlying recurring truth, not just a summary of any one entry.

Subject: ${cluster.subject} (type: ${cluster.type})
Entry count: ${cluster.entries.length}${resynthNote}

Entries:
${entryText}

Respond with EXACTLY this format, nothing else:

PATTERN: <one sentence, present-tense, direct, no hedging>
EVIDENCE: <1-3 sentences citing the strongest supporting entries by date>`;
}

interface Synthesis {
  pattern: string;
  evidence: string;
}

function parseSynthesis(text: string): Synthesis | null {
  const patternMatch = text.match(/^PATTERN:\s*(.+?)(?=\nEVIDENCE:|$)/ims);
  const evidenceMatch = text.match(/^EVIDENCE:\s*([\s\S]+?)$/im);
  if (!patternMatch || !evidenceMatch) return null;
  return {
    pattern: patternMatch[1].trim(),
    evidence: evidenceMatch[1].trim(),
  };
}

function formatPatternEntry(
  cluster: Cluster,
  synth: Synthesis,
  firstNoticed: string,
): string {
  return [
    "",
    `### ==${synth.pattern}==`,
    `<!-- source: type=${cluster.type} subject=${cluster.subject} synthesized=${today()} -->`,
    `- **First noticed:** ${firstNoticed}`,
    `- **Evidence:** ${synth.evidence}`,
    "",
  ].join("\n");
}

async function syncHighlights(
  patternsPath: string,
): Promise<{ wrapped: number; stripped: number }> {
  let raw: string;
  try {
    raw = await readFile(patternsPath, "utf-8");
  } catch {
    return { wrapped: 0, stripped: 0 };
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - FRESHNESS_DAYS);

  let wrapped = 0;
  let stripped = 0;

  // Strip stale ==wrapped== headings.
  raw = raw.replace(
    /^### ==(.+?)==[ \t]*$\n(<!--\s*source:[^>]*?synthesized=(\d{4}-\d{2}-\d{2})[^>]*?-->)/gm,
    (match, text, marker, dateStr) => {
      const d = parseDateSafe(dateStr);
      if (d && d < cutoff) {
        stripped++;
        return `### ${text}\n${marker}`;
      }
      return match;
    },
  );

  // Wrap fresh unwrapped headings.
  raw = raw.replace(
    /^### (?!==)(.+?)[ \t]*$\n(<!--\s*source:[^>]*?synthesized=(\d{4}-\d{2}-\d{2})[^>]*?-->)/gm,
    (match, text, marker, dateStr) => {
      const d = parseDateSafe(dateStr);
      if (d && d >= cutoff) {
        wrapped++;
        return `### ==${text}==\n${marker}`;
      }
      return match;
    },
  );

  if (wrapped + stripped > 0) {
    await writeFile(patternsPath, raw, "utf-8");
  }
  return { wrapped, stripped };
}

async function rewritePatternBlock(
  patternsPath: string,
  type: string,
  subject: string,
  replacement: string,
): Promise<boolean> {
  const raw = await readFile(patternsPath, "utf-8");
  const markerRe = new RegExp(
    `<!--\\s*source:\\s*type=${escapeRegex(type)}\\s+subject=${escapeRegex(subject)}(?:\\s+synthesized=\\d{4}-\\d{2}-\\d{2})?\\s*-->`,
  );
  const m = markerRe.exec(raw);
  if (!m) return false;

  // Walk back to the start of the containing "### " line.
  const blockStart = raw.lastIndexOf("\n### ", m.index);
  if (blockStart < 0) return false;

  // Walk forward to the start of the next "### " line (or EOF).
  const nextRe = /\n### /g;
  nextRe.lastIndex = m.index;
  const next = nextRe.exec(raw);
  const blockEnd = next ? next.index : raw.length;

  const before = raw.slice(0, blockStart);
  const after = raw.slice(blockEnd);
  await writeFile(patternsPath, before + replacement + after, "utf-8");
  return true;
}

export async function promotePatterns(
  options: PromoteOptions = {},
): Promise<string> {
  const windowDays = options.windowDays ?? CLUSTER_WINDOW_DAYS;
  const minSize = options.minClusterSize ?? MIN_CLUSTER_SIZE;

  const patternsPath = join(config.vaultPath, PATTERNS_REL);
  const highlightSync = await syncHighlights(patternsPath);

  const { entries } = await readScratchpad();
  const promoted = await loadPromoted();
  let clusters = findCandidates(entries, promoted, windowDays, minSize);
  if (options.only) {
    clusters = clusters.filter(
      (c) => `${c.type}/${c.subject}` === options.only,
    );
  }

  const highlightLine =
    highlightSync.wrapped + highlightSync.stripped > 0
      ? `Synced highlights: ${highlightSync.wrapped} wrapped, ${highlightSync.stripped} stripped.`
      : null;

  if (clusters.length === 0) {
    const base = `No new or stale clusters with ≥${minSize} qualifying entries.`;
    return highlightLine ? `${highlightLine}\n${base}` : base;
  }

  const lines: string[] = [
    ...(highlightLine ? [highlightLine] : []),
    `Found ${clusters.length} candidate cluster(s):`,
    ...clusters.map((c) => {
      const tag = c.resynth
        ? `re-synth, ${c.resynth.sinceCount} new since ${c.resynth.synthesized}`
        : "new";
      return `  - ${c.type}/${c.subject}  (${c.entries.length} entries, ${tag})`;
    }),
    "",
  ];

  if (options.dryRun) {
    return lines.join("\n");
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return (
      lines.join("\n") +
      "\nANTHROPIC_API_KEY is not set — cannot synthesize patterns."
    );
  }

  const anthropic = new Anthropic();
  const written: string[] = [];
  const failed: string[] = [];

  for (const cluster of clusters) {
    try {
      const result = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 400,
        system:
          "You synthesize recurring behavioral/identity observations into single-sentence patterns. Be direct and specific. No hedging, no sugarcoating.",
        messages: [
          { role: "user", content: buildSynthesisPrompt(cluster) },
        ],
      });

      const textBlock = result.content.find((b) => b.type === "text");
      const text = textBlock && textBlock.type === "text" ? textBlock.text : "";
      const synth = parseSynthesis(text);
      if (!synth) {
        failed.push(`${cluster.type}/${cluster.subject} (unparseable response)`);
        continue;
      }

      const firstNoticed = cluster.resynth?.firstNoticed ?? today();
      const block = formatPatternEntry(cluster, synth, firstNoticed);

      if (cluster.resynth) {
        const ok = await rewritePatternBlock(
          patternsPath,
          cluster.type,
          cluster.subject,
          block,
        );
        if (!ok) {
          failed.push(
            `${cluster.type}/${cluster.subject} (re-synth: marker not found in patterns.md)`,
          );
          continue;
        }
        written.push(`${cluster.type}/${cluster.subject} (re-synth): ${synth.pattern}`);
      } else {
        await appendFile(patternsPath, block);
        written.push(`${cluster.type}/${cluster.subject}: ${synth.pattern}`);
      }
    } catch (err: any) {
      failed.push(`${cluster.type}/${cluster.subject}: ${err?.message || err}`);
    }
  }

  lines.push(`Wrote ${written.length} patterns to ${PATTERNS_REL}.`);
  if (written.length) lines.push(...written.map((w) => `  ✓ ${w}`));
  if (failed.length) {
    lines.push(`Failed ${failed.length}:`);
    lines.push(...failed.map((f) => `  ! ${f}`));
  }
  return lines.join("\n");
}
