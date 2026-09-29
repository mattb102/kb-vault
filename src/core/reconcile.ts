/**
 * Nightly vault reconcile.
 *
 * Reads the last N days of scratchpad observations, asks Claude which canonical
 * files they affect (triage), then for each file proposes a full rewrite that
 * is applied only when it passes mechanical guards. Every applied change —
 * including its diff — lands in AI-Observations/reconcile/<date>.md so the
 * morning report can surface "changed X: Y" and a revert is one git command.
 *
 * Requires the claude CLI on PATH with subscription auth.
 * Disabled by default (reconcile.enabled: false in config).
 */
import { readFile, writeFile, mkdir, readdir, stat } from "fs/promises";
import { join, relative } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import matter from "gray-matter";
import { config } from "./config.js";
import { readScratchpad, renderEntry, type Entry } from "./scratchpad.js";
import { claudePrompt, CLAUDE_MODEL } from "./claude-cli.js";
import { today } from "./utils.js";

const execFileP = promisify(execFile);

export const RECONCILE_DIR_REL = "AI-Observations/reconcile";

// Default routing manifest path. Override with reconcile.routingFile in config.
const DEFAULT_ROUTING_REL = "Core/routing.md";

/** Paths the reconciler must never write, expressed as regexes on vault-relative paths. */
const BASE_NEVER_TOUCH: RegExp[] = [
  /^AI-Observations\//,
  /^Reports\//,
  /^_templates\//,
  /^Core\/core-identity\.md$/,
  /^Core\/routing\.md$/,
  /^CLAUDE\.md$/,
];

const MAX_FILE_BYTES = 24_000;
const MAX_FILES_PER_RUN = 8;

export interface TriageItem {
  file: string;
  reason: string;
  facts: string[];
}

export interface FileResult {
  file: string;
  status: "applied" | "no-change" | "skipped" | "rejected" | "error";
  reason: string;
  facts: string[];
  diff?: string;
}

export interface ReconcileResult {
  date: string;
  days: number;
  entries: number;
  triage: TriageItem[];
  results: FileResult[];
  logPath?: string;
}

export interface ReconcileOptions {
  days?: number;
  dryRun?: boolean;
  only?: string;
  max?: number;
  model?: string;
}

export function isNeverTouch(rel: string): boolean {
  return BASE_NEVER_TOUCH.some((re) => re.test(rel));
}

async function listCanonicalFiles(): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.name.endsWith(".md")) {
        const rel = relative(config.vaultPath, full);
        if (!isNeverTouch(rel)) out.push(rel);
      }
    }
  }
  await walk(config.vaultPath);
  return out.sort();
}

function recentEntries(entries: Entry[], days: number): Entry[] {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  return entries.filter((e) => e.date >= cutoff);
}

/** Pull the first JSON array/object out of a model reply that may be fenced or chatty. */
export function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.search(/[\[{]/);
  if (start === -1) throw new Error("no JSON in reply");
  return JSON.parse(candidate.slice(start).trim()) as T;
}

/**
 * Mechanical guards between "Claude proposed this" and "we wrote it".
 * Returns the content to write (with `updated:` stamped) or a rejection reason.
 */
export function applyGuards(
  oldRaw: string,
  proposed: string,
  date: string,
): { ok: true; content: string } | { ok: false; reason: string } {
  const p = proposed.trim();
  if (!p || /^NO[ _-]?CHANGE\b/i.test(p)) return { ok: false, reason: "no change" };
  if (!p.startsWith("---\n")) return { ok: false, reason: "proposal lost frontmatter" };
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(p);
  } catch (e) {
    return {
      ok: false,
      reason: `frontmatter unparseable: ${(e as Error).message}`,
    };
  }
  const oldParsed = matter(oldRaw);
  if ((oldParsed.data.type ?? null) !== (parsed.data.type ?? null)) {
    return { ok: false, reason: "proposal changed frontmatter type" };
  }
  const ratio = p.length / Math.max(oldRaw.length, 1);
  if (ratio < 0.6)
    return { ok: false, reason: `proposal shrank file to ${Math.round(ratio * 100)}%` };
  if (ratio > 2.5)
    return { ok: false, reason: `proposal grew file to ${Math.round(ratio * 100)}%` };
  if (
    /```/.test(oldRaw) &&
    oldRaw.match(/```/g)!.length !== (p.match(/```/g) ?? []).length
  ) {
    return { ok: false, reason: "code-fence count changed" };
  }
  if (p.replace(/\s+/g, " ") === oldRaw.trim().replace(/\s+/g, " ")) {
    return { ok: false, reason: "no change" };
  }
  const stamped = matter.stringify(parsed.content, { ...parsed.data, updated: date });
  return { ok: true, content: stamped };
}

function triagePrompt(
  observations: string,
  routing: string,
  files: string[],
  days: number,
  owner: string,
): string {
  const routingSection = routing
    ? `=== ROUTING MANIFEST ===\n${routing}\n\n`
    : "(no routing manifest — use the file list to infer where each fact belongs)\n\n";
  return `You are the nightly reconciler for ${owner}'s Obsidian vault. Below are the last ${days} day(s) of AI observations logged during conversations, the vault's routing manifest (which file each kind of fact belongs in), and the list of canonical files that may be edited.

Your job in this step is TRIAGE ONLY: decide which canonical files contain facts that the observations show to be stale, wrong, or missing. Be conservative. A file qualifies only if an observation states a concrete fact (a status changed, a thing happened, a number moved, a plan died) that the file's purpose covers. Mood, speculation, and AI meta-observations do not qualify.

Return ONLY a JSON array, at most ${MAX_FILES_PER_RUN} items, most important first:
[{"file": "<exact path from the list>", "reason": "<one line>", "facts": ["<concrete fact to write, with its date>", ...]}]
Return [] if nothing qualifies.

${routingSection}=== CANONICAL FILES ===
${files.join("\n")}

=== OBSERVATIONS (last ${days} day(s)) ===
${observations}`;
}

function rewritePrompt(
  rel: string,
  content: string,
  item: TriageItem,
  observations: string,
  owner: string,
): string {
  return `You are updating one canonical file in ${owner}'s Obsidian vault so it reflects facts from recent observations. Today is ${today()}.

FILE: ${rel}
WHY IT WAS SELECTED: ${item.reason}
FACTS TO REFLECT:
${item.facts.map((f) => `- ${f}`).join("\n")}

Rules:
- Return the COMPLETE new file, frontmatter included, and nothing else. If after reading you conclude nothing should change, return exactly: NO CHANGE
- Keep the file's structure, headers, voice (terse, dated, factual) and every fact that is still true. Edit the specific lines the facts touch; do not rewrite unrelated sections. Do not add commentary about this process.
- Prefer a dated line ("${today()}: ...") over rewriting history. Never delete a section; never change the frontmatter \`type\`; leave \`updated:\` alone (it is stamped automatically).
- If a fact contradicts the file and you cannot tell which is right, do not guess — leave the line and add "(conflicting report <date>; unresolved)".

=== CURRENT FILE ===
${content}

=== OBSERVATIONS FOR CONTEXT ===
${observations}`;
}

export async function reconcileVault(
  opts: ReconcileOptions = {},
): Promise<ReconcileResult> {
  const days = opts.days ?? 1;
  const date = today();
  const model = opts.model ?? CLAUDE_MODEL;
  const max = opts.max ?? MAX_FILES_PER_RUN;
  const owner = config.ownerName;
  const routingRel =
    (config as any).reconcileConfig?.routingFile ?? DEFAULT_ROUTING_REL;

  const { entries } = await readScratchpad();
  const recent = recentEntries(entries, days);
  const result: ReconcileResult = {
    date,
    days,
    entries: recent.length,
    triage: [],
    results: [],
  };
  if (recent.length === 0) return result;

  const observations = recent.map(renderEntry).join("\n\n");

  let routing = "";
  try {
    routing = matter(
      await readFile(join(config.vaultPath, routingRel), "utf-8"),
    ).content;
  } catch {
    // Missing routing manifest is fine — the triage prompt adapts.
  }

  const files = await listCanonicalFiles();

  let triage: TriageItem[];
  if (opts.only) {
    triage = [{ file: opts.only, reason: "--only", facts: ["(see observations)"] }];
  } else {
    const reply = await claudePrompt(
      triagePrompt(observations, routing, files, days, owner),
      model,
      240_000,
    );
    triage = extractJson<TriageItem[]>(reply)
      .filter((t) => t && typeof t.file === "string")
      .slice(0, max);
  }
  result.triage = triage;

  for (const item of triage) {
    const rel = item.file.replace(/^\/+/, "");
    const abs = join(config.vaultPath, rel);
    const fr: FileResult = {
      file: rel,
      status: "skipped",
      reason: "",
      facts: item.facts ?? [],
    };
    result.results.push(fr);

    if (!files.includes(rel)) {
      fr.reason = "not a canonical file (or never-touch)";
      continue;
    }
    let size = 0;
    try {
      size = (await stat(abs)).size;
    } catch {
      fr.reason = "file missing";
      continue;
    }
    if (size > MAX_FILE_BYTES) {
      fr.reason = `file is ${size} bytes (> ${MAX_FILE_BYTES}); reported, not rewritten`;
      continue;
    }
    const oldRaw = await readFile(abs, "utf-8");
    let proposed: string;
    try {
      proposed = await claudePrompt(
        rewritePrompt(rel, oldRaw, item, observations, owner),
        model,
        240_000,
      );
    } catch (e) {
      fr.status = "error";
      fr.reason = (e as Error).message;
      continue;
    }
    const guarded = applyGuards(oldRaw, proposed, date);
    if (!guarded.ok) {
      fr.status = guarded.reason === "no change" ? "no-change" : "rejected";
      fr.reason = guarded.reason;
      continue;
    }
    fr.diff = await unifiedDiff(oldRaw, guarded.content, rel);
    if (opts.dryRun) {
      fr.status = "applied";
      fr.reason = "dry run — not written";
      continue;
    }
    await writeFile(abs, guarded.content);
    fr.status = "applied";
    fr.reason = item.reason;
  }

  if (!opts.dryRun) result.logPath = await writeLog(result);
  return result;
}

async function unifiedDiff(a: string, b: string, label: string): Promise<string> {
  const dir = join(config.vaultPath, ".git", "reconcile-tmp");
  await mkdir(dir, { recursive: true });
  const pa = join(dir, "a.md");
  const pb = join(dir, "b.md");
  await writeFile(pa, a);
  await writeFile(pb, b);
  try {
    await execFileP("diff", [
      "-u",
      "--label",
      `a/${label}`,
      "--label",
      `b/${label}`,
      pa,
      pb,
    ]);
    return "";
  } catch (e: any) {
    // diff exits 1 when files differ — that is the normal success path
    const out: string = e.stdout ?? "";
    const lines = out.split("\n");
    return lines.length > 120
      ? lines.slice(0, 120).join("\n") + "\n... (truncated)"
      : out;
  }
}

async function writeLog(r: ReconcileResult): Promise<string> {
  const dir = join(config.vaultPath, RECONCILE_DIR_REL);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${r.date}.md`);
  const applied = r.results.filter((x) => x.status === "applied");
  const others = r.results.filter((x) => x.status !== "applied");
  const summary = applied.length
    ? applied.map((x) => `- **${x.file}** — ${x.reason}`).join("\n")
    : "- (no files changed)";
  const body = [
    `# Vault reconcile — ${r.date}`,
    "",
    `${r.entries} observation(s) over ${r.days} day(s); ${r.triage.length} file(s) triaged; ${applied.length} applied.`,
    "",
    "## Changed",
    summary,
    "",
    ...(others.length
      ? [
          "## Not changed",
          ...others.map((x) => `- ${x.file} — ${x.status}: ${x.reason}`),
          "",
        ]
      : []),
    ...applied.flatMap((x) => [
      `## ${x.file}`,
      x.facts.length ? x.facts.map((f) => `- ${f}`).join("\n") : "",
      "```diff",
      x.diff ?? "",
      "```",
      "",
    ]),
  ].join("\n");
  const fm = {
    type: "ai-reconcile-log",
    date: r.date,
    tags: ["ai", "reconcile", "kb-system"],
    applied: applied.map((x) => x.file),
  };
  await writeFile(path, matter.stringify(`\n${body}`, fm));
  return path;
}

/**
 * One-liner-per-file summary of the most recent reconcile log.
 * Returns null when no recent log exists (used by the morning report).
 */
export async function latestReconcileSummary(
  maxAgeHours = 30,
): Promise<string | null> {
  const dir = join(config.vaultPath, RECONCILE_DIR_REL);
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
  if (Date.now() - s.mtimeMs > maxAgeHours * 3_600_000) return null;
  const { content } = matter(await readFile(latest, "utf-8"));
  const m = content.match(/## Changed\n([\s\S]*?)(?:\n## |\n*$)/);
  return m ? m[1].trim() : null;
}
