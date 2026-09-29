/**
 * Monthly read-only vault audit.
 *
 * For each top-level folder in the vault, hands Claude the folder's files
 * plus Core/core-identity.md as ground truth and asks for per-file verdicts
 * (KEEP / CLEAN / MERGE / DELETE) with quoted evidence. Nothing is applied;
 * the report lands in AI-Observations/audits/<date>.md and the morning report
 * links it. Catches what nightly reconcile misses: dead plans, duplicates,
 * scaffolds, contradictions between files.
 *
 * Requires the claude CLI on PATH with subscription auth.
 * Disabled by default (audit.enabled: false in config).
 */
import { readFile, writeFile, mkdir, readdir, stat } from "fs/promises";
import { join, relative } from "path";
import matter from "gray-matter";
import { config } from "./config.js";
import { claudePrompt, CLAUDE_MODEL } from "./claude-cli.js";
import { today } from "./utils.js";

export const AUDIT_DIR_REL = "AI-Observations/audits";

// Dirs excluded from audit (generated artifacts, templates, audit output itself).
const SKIP_AUDIT_DIRS = new Set(["AI-Observations", "Reports", "_templates"]);

// Max bytes of file content to pass in one Claude call.
const CHUNK_BYTES = 70_000;

export interface AuditOptions {
  dryRun?: boolean;
  only?: string; // audit a single named group
  model?: string;
}

/**
 * Discover auditable top-level directories.
 * Uses config.audit.groups if set, otherwise auto-discovers from the vault.
 */
async function discoverGroups(override?: string[]): Promise<string[]> {
  if (override && override.length) return override;
  let entries;
  try {
    entries = await readdir(config.vaultPath, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(
      (e) =>
        e.isDirectory() &&
        !e.name.startsWith(".") &&
        !SKIP_AUDIT_DIRS.has(e.name),
    )
    .map((e) => e.name)
    .sort();
}

async function filesUnder(group: string): Promise<string[]> {
  const root = join(config.vaultPath, group);
  const out: string[] = [];
  async function walk(dir: string) {
    let ents;
    try {
      ents = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      if (e.name.startsWith(".")) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.name.endsWith(".md")) {
        const rel = relative(config.vaultPath, full);
        // Skip generated/manifest files that are not useful to audit.
        if (/core-identity\.md$|routing\.md$/.test(rel)) continue;
        out.push(rel);
      }
    }
  }
  await walk(root);
  return out.sort();
}

function auditPrompt(
  group: string,
  identity: string,
  files: { rel: string; content: string }[],
  owner: string,
): string {
  const date = today();
  const identityDate =
    identity.match(/generated[:\s]+(\d{4}-\d{2}-\d{2})/)?.[1] ?? "recently";
  return `You are auditing the "${group}/" folder of ${owner}'s Obsidian vault for stale, wrong, redundant, or messy content. Today is ${date}. READ-ONLY: report findings only, do not rewrite anything.

Ground truth for what is CURRENT is the auto-generated identity document below. Anything in a file that contradicts it, or that is dated and obviously overtaken (a plan for a past date with no outcome, "as of <old month>" headers, TBD placeholders, empty scaffold sections, duplicate paragraphs, facts repeated verbatim in two files, frontmatter \`updated:\` far older than the newest dated content) is a finding.

For EACH file output exactly one line:
\`path | KEEP / CLEAN / MERGE / DELETE | one-line reason | quoted stale text or mess\`
For clean files write \`path | KEEP | fine\`. Be specific and quote. Do not invent facts; if a file is stale but you don't know the current value, say "stale — current value unknown".
Then a section "## Top 3 to fix first" for this folder.

=== IDENTITY (ground truth, generated ${identityDate}) ===
${identity}

${files.map((f) => `=== FILE: ${f.rel} ===\n${f.content}`).join("\n\n")}`;
}

export async function auditVault(
  opts: AuditOptions = {},
): Promise<{ date: string; path?: string; report: string }> {
  const date = today();
  const model = opts.model ?? CLAUDE_MODEL;
  const owner = config.ownerName;
  const groupsOverride = (config as any).auditConfig?.groups as
    | string[]
    | undefined;

  let identity = "(no identity document found)";
  try {
    identity = matter(
      await readFile(join(config.vaultPath, "Core/core-identity.md"), "utf-8"),
    ).content;
  } catch {
    // Proceed without it — the prompt handles the missing case gracefully.
  }

  const allGroups = await discoverGroups(groupsOverride);
  const groups = opts.only ? [opts.only] : allGroups;
  const sections: string[] = [];

  for (const group of groups) {
    const rels = await filesUnder(group);
    if (!rels.length) continue;

    // Chunk by byte budget so one large folder spans several calls.
    const chunks: { rel: string; content: string }[][] = [[]];
    let size = 0;
    for (const rel of rels) {
      const content = await readFile(join(config.vaultPath, rel), "utf-8");
      if (size + content.length > CHUNK_BYTES && chunks[chunks.length - 1].length) {
        chunks.push([]);
        size = 0;
      }
      chunks[chunks.length - 1].push({ rel, content });
      size += content.length;
    }

    const parts: string[] = [];
    for (const chunk of chunks) {
      try {
        parts.push(
          await claudePrompt(
            auditPrompt(group, identity, chunk, owner),
            model,
            300_000,
          ),
        );
      } catch (e) {
        parts.push(
          `(audit call failed for ${chunk.map((c) => c.rel).join(", ")}: ${(e as Error).message})`,
        );
      }
    }
    sections.push(`## ${group}/ (${rels.length} files)\n\n${parts.join("\n\n")}`);
  }

  const report = [
    `# Vault audit — ${date}`,
    "",
    "Read-only. Nothing was applied. Verdict format: `path | KEEP/CLEAN/MERGE/DELETE | reason | evidence`.",
    "",
    ...sections,
  ].join("\n");

  if (opts.dryRun) return { date, report };

  const dir = join(config.vaultPath, AUDIT_DIR_REL);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${date}.md`);
  await writeFile(
    path,
    matter.stringify(`\n${report}`, {
      type: "ai-audit-report",
      date,
      tags: ["ai", "audit", "kb-system"],
    }),
  );
  return { date, path, report };
}

/**
 * Path of an audit report written in the last N hours, if any.
 * Returns a vault-relative path (for the morning report to link).
 */
export async function latestAuditPath(maxAgeHours = 30): Promise<string | null> {
  const dir = join(config.vaultPath, AUDIT_DIR_REL);
  let names: string[];
  try {
    names = (await readdir(dir))
      .filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/.test(n))
      .sort();
  } catch {
    return null;
  }
  if (!names.length) return null;
  const latest = join(dir, names[names.length - 1]);
  const s = await stat(latest);
  return Date.now() - s.mtimeMs > maxAgeHours * 3_600_000
    ? null
    : relative(config.vaultPath, latest);
}
