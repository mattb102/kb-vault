import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import matter from "gray-matter";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";
import { frontmatterIndex } from "./frontmatter.js";
import { readScratchpad, PATTERNS_REL, renderEntry } from "./scratchpad.js";
import { today } from "./utils.js";

const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-4-8";
const DEFAULT_SCRATCHPAD_DAYS = 30;
const IDENTITY_REL = "Core/core-identity.md";

export interface RebuildIdentityOptions {
  dryRun?: boolean;
  scratchpadDays?: number;
  model?: string;
}

export interface RebuildIdentityResult {
  doc: string;
  wrote: boolean;
  path: string;
  sources: { patterns: boolean; observationDays: number; groundTruthChars: number };
}

function extractFilledSections(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let currentHeader = "";
  let currentBody: string[] = [];

  function flush() {
    const body = currentBody.join("\n").trim();
    if (body.length > 0 && currentHeader) {
      result.push(`${currentHeader}\n${body}`);
    }
    currentBody = [];
  }

  for (const line of lines) {
    if (/^#\s+/.test(line)) continue;
    const headerMatch = line.match(/^(#{2,6})\s+(.+)/);
    if (headerMatch) {
      flush();
      currentHeader = line;
    } else {
      currentBody.push(line);
    }
  }
  flush();
  return result.join("\n\n");
}

async function gatherGroundTruth(): Promise<string> {
  await frontmatterIndex.rebuild();
  const sections: string[] = [];

  const coreFiles = frontmatterIndex.find({ type: "core" });
  for (const file of coreFiles) {
    const raw = await readFile(file.path, "utf-8");
    const { content } = matter(raw);
    const topic = (file.frontmatter.topic as string) ?? "core";
    const extracted = extractFilledSections(content);
    if (extracted.length > 0) {
      sections.push(
        `## ${topic.charAt(0).toUpperCase() + topic.slice(1)}\n${extracted}`,
      );
    }
  }

  const health = frontmatterIndex.findOne({ type: "health-overview" });
  if (health) {
    const { content } = matter(await readFile(health.path, "utf-8"));
    const extracted = extractFilledSections(content);
    if (extracted.length > 0) sections.push(`## Health\n${extracted}`);
  }

  const work = frontmatterIndex.findOne({ type: "work-overview" });
  if (work) {
    const { content } = matter(await readFile(work.path, "utf-8"));
    const extracted = extractFilledSections(content);
    if (extracted.length > 0) sections.push(`## Work\n${extracted}`);
  }

  const interests = frontmatterIndex.find({ type: "interest-overview" });
  if (interests.length > 0) {
    const interestSections: string[] = [];
    for (const interest of interests) {
      const { content } = matter(await readFile(interest.path, "utf-8"));
      const name = (interest.frontmatter.interest as string) ?? "interest";
      const extracted = extractFilledSections(content);
      if (extracted.length > 0) {
        interestSections.push(
          `### ${name.charAt(0).toUpperCase() + name.slice(1)}\n${extracted}`,
        );
      }
    }
    if (interestSections.length > 0) {
      sections.push(`## Interests\n${interestSections.join("\n\n")}`);
    }
  }

  return sections.join("\n\n");
}

async function readPatterns(): Promise<string> {
  try {
    const raw = await readFile(join(config.vaultPath, PATTERNS_REL), "utf-8");
    return raw.trim();
  } catch {
    return "";
  }
}

async function recentObservations(days: number): Promise<string> {
  const { entries } = await readScratchpad();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return entries
    .filter((e) => e.date >= cutoff)
    .map(renderEntry)
    .join("\n\n");
}

function buildPrompt(
  owner: string,
  groundTruth: string,
  patterns: string,
  observations: string,
  days: number,
): string {
  return `You are maintaining ${owner}'s Core Identity Summary — a single living document that a personal-assistant AI loads at the start of every conversation to know who ${owner} is *right now*.

You are given three sources, in increasing order of recency:

1. STRUCTURED NOTES — hand-maintained ground truth from the vault (bio, work, goals, values, health, interests). Treat hard facts here (name, date of birth, address, employer, education, dates) as authoritative and copy them faithfully.
2. DISTILLED PATTERNS — recurring, synthesized truths the assistant has observed over time. These capture ${owner}'s evolving state, behaviors, and tendencies.
3. RECENT OBSERVATIONS (last ${days} days) — raw observations. Use these to make the "current state" reflect what is true *now* (active habits, current focus, recent changes). Synthesize — do not dump raw noise, do not include one-off trivia.

Produce a complete Core Identity Summary in GitHub-flavored markdown. Requirements:
- Open with a "## Snapshot" section: 2-4 sentences capturing who ${owner} is and where they're at in life right now.
- Then well-organized H2 sections. Suggested: Bio, Work, Health, Goals & Current Focus, Habits & Tendencies, Relationships & Social, Interests, Values. Omit a section only if you genuinely have nothing for it; add one if the material calls for it.
- Hard facts (name, DOB, address, employer, education) MUST match the structured notes exactly.
- Where patterns or recent observations update or contradict an older structured note, prefer the newer signal and state the current reality.
- Be direct, specific, and candid. No hedging, no sugarcoating, no filler. This is read by ${owner}'s own assistant, so it can speak plainly about mood, mental health, and behavior.
- Write everything as settled present-tense fact. Do NOT cite observation dates inline, do NOT say "the observations note that…".
- Output ONLY the markdown body starting at "## Snapshot". No H1 title, no frontmatter, no preamble or sign-off.

=== STRUCTURED NOTES (authoritative for hard facts) ===
${groundTruth || "(none)"}

=== DISTILLED PATTERNS ===
${patterns || "(none)"}

=== RECENT OBSERVATIONS (last ${days} days) ===
${observations || "(none)"}`;
}

/**
 * Rebuild Core/core-identity.md as a rolling aggregate synthesized from the
 * hand-maintained Core notes (hard facts) + distilled patterns + recent
 * scratchpad observations (current state). Requires ANTHROPIC_API_KEY.
 *
 * Falls back to the mechanical generate-identity path if no API key is set
 * and dryRun is false — see scripts/generate-identity.ts for the no-API version.
 */
export async function rebuildIdentity(
  options: RebuildIdentityOptions = {},
): Promise<RebuildIdentityResult> {
  const days = options.scratchpadDays ?? DEFAULT_SCRATCHPAD_DAYS;
  const model = options.model ?? CLAUDE_MODEL;
  const owner = config.ownerName;

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set — cannot synthesize identity. " +
      "Add it to .env, or run `npm run generate-identity` for the no-API fallback.",
    );
  }

  const groundTruth = await gatherGroundTruth();
  const patterns = await readPatterns();
  const observations = await recentObservations(days);

  const anthropic = new Anthropic();
  const result = await anthropic.messages.create({
    model,
    max_tokens: 8000,
    system:
      "You synthesize a person's structured notes and observed patterns into a single, current, candid identity summary. Be direct and specific. No hedging.",
    messages: [
      {
        role: "user",
        content: buildPrompt(owner, groundTruth, patterns, observations, days),
      },
    ],
  });

  const textBlock = result.content.find((b) => b.type === "text");
  const body = (textBlock && textBlock.type === "text" ? textBlock.text : "").trim();
  if (!body) {
    throw new Error("LLM returned an empty identity body.");
  }

  const existing = frontmatterIndex.findOne({ type: "core-identity" });
  const targetPath = existing?.path ?? join(config.vaultPath, IDENTITY_REL);
  let created = today();
  if (existing) {
    try {
      const { data } = matter(await readFile(existing.path, "utf-8"));
      if (typeof data.created === "string" && data.created) created = data.created;
    } catch {
      // fall through to today
    }
  }

  const fm = {
    type: "core-identity",
    tags: ["core", "identity"],
    generated: true,
    created,
    updated: today(),
  };

  const doc = matter.stringify(
    `\n# Core Identity Summary\n\nAuto-generated from vault notes, patterns, and the last ${days} days of observations on ${today()}.\n\n${body}\n`,
    fm,
  );

  const sources = {
    patterns: patterns.length > 0,
    observationDays: days,
    groundTruthChars: groundTruth.length,
  };

  if (options.dryRun) {
    return { doc, wrote: false, path: targetPath, sources };
  }

  await writeFile(targetPath, doc, "utf-8");
  return { doc, wrote: true, path: targetPath, sources };
}
