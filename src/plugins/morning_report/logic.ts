import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";

import { config } from "../../core/config.js";
import { frontmatterIndex } from "../../core/frontmatter.js";
import { getObservations } from "../../core/observer.js";
import { gitCommitAndPush } from "../../core/sync.js";
import { today } from "../../core/utils.js";

const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5";

// ─── SETTINGS ──────────────────────────────────────────────────────

export interface ReportSettings {
  /** Where the report goes. "vault" is always on and is not listed here. */
  delivery: ("push" | "discord")[];
  /** Read the report aloud (needs OPENAI_API_KEY). Discord delivery only. */
  audio: boolean;
  /** Free-text steer for tone, e.g. "blunt, no pep talk". */
  tone?: string;
  /** City for the weather line. Omit to skip weather entirely. */
  location?: string;
  /** Tracker ids (from the ios_app plugin) to summarize. */
  trackers: string[];
}

export function settings(): ReportSettings {
  const raw = (config.pluginConfig?.morning_report as Record<string, any>) || {};
  const envDelivery = (process.env.REPORT_DELIVERY || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const delivery = (envDelivery.length ? envDelivery : raw.delivery || []).filter(
    (d: string): d is "push" | "discord" => d === "push" || d === "discord"
  );
  return {
    delivery,
    audio: Boolean(raw.audio) && Boolean(process.env.OPENAI_API_KEY),
    tone: raw.tone ? String(raw.tone) : undefined,
    location: raw.location ? String(raw.location) : undefined,
    trackers: Array.isArray(raw.trackers) ? raw.trackers.map(String) : [],
  };
}

// ─── GATHER ────────────────────────────────────────────────────────
// Every source is optional and every one degrades to a note rather than an
// exception. A missing calendar must never cost you the whole report.

async function safe<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e: any) {
    console.error(`[morning-report] ${label} failed: ${e?.message || e}`);
    return null;
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + "\n…(truncated)";
}

async function readVaultFile(rel: string, cap = 4000): Promise<string | null> {
  try {
    return truncate(await readFile(path.join(config.vaultPath, rel), "utf-8"), cap);
  } catch {
    return null;
  }
}

async function recentJournals(days = 4): Promise<string> {
  const entries = frontmatterIndex
    .find({ type: "journal" })
    .map((e) => ({ e, date: String(e.frontmatter.date || "") }))
    .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.date))
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, days);

  if (entries.length === 0) return "(no journal entries yet)";
  return entries
    .map((x) => `### ${x.date}\n${truncate(x.e.content.trim(), 1200)}`)
    .join("\n\n");
}

async function trackerSummary(ids: string[]): Promise<string> {
  if (ids.length === 0) return "(no trackers configured)";
  // Soft dependency: the phone app may not be enabled, and that is fine.
  let readEntries: (id: string, limit?: number) => Promise<any[]>;
  try {
    ({ readEntries } = await import("../ios_app/logic.js"));
  } catch {
    return "(tracker data unavailable — the ios_app plugin is not enabled)";
  }

  const parts: string[] = [];
  for (const id of ids) {
    const entries = await safe(`tracker ${id}`, () => readEntries(id, 14));
    if (!entries || entries.length === 0) {
      parts.push(`- ${id}: no entries yet`);
      continue;
    }
    const values = entries.map((e: any) => e.value);
    const avg = values.reduce((a: number, b: number) => a + b, 0) / values.length;
    parts.push(
      `- ${id}: latest ${values[0]} on ${entries[0].date}; ${entries.length}-entry average ${avg.toFixed(1)}`
    );
  }
  return parts.join("\n");
}

async function weather(location?: string): Promise<string> {
  if (!location) return "";
  // wttr.in needs no key and no account. If it is down, the report goes on.
  const res = await fetch(
    `https://wttr.in/${encodeURIComponent(location)}?format=%C+%t+(feels+%f),+high+%M`,
    { signal: AbortSignal.timeout(8000) }
  );
  if (!res.ok) throw new Error(`wttr.in ${res.status}`);
  return (await res.text()).trim();
}

async function priorReports(days = 6): Promise<string> {
  const entries = frontmatterIndex
    .find({ type: "report" })
    .map((e) => ({ e, date: String(e.frontmatter.date || "") }))
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, days);
  if (entries.length === 0) return "(none yet)";
  return entries.map((x) => `### ${x.date}\n${truncate(x.e.content, 700)}`).join("\n\n");
}

export interface Gathered {
  date: string;
  identity: string | null;
  journals: string;
  nudges: string | null;
  observations: string | null;
  patterns: string | null;
  trackers: string;
  weather: string | null;
  prior: string;
}

export async function gather(s: ReportSettings): Promise<Gathered> {
  await safe("frontmatter rebuild", () => frontmatterIndex.rebuild());

  const [identity, nudges, observations, patterns, trackers, wx, prior] =
    await Promise.all([
      safe("identity", () => readVaultFile("Core/core-identity.md", 6000)),
      safe("nudges", () => readVaultFile("AI-Observations/nudges.md", 3000)),
      safe("observations", () => getObservations("scratchpad", 3)),
      safe("patterns", () => getObservations("patterns")),
      safe("trackers", () => trackerSummary(s.trackers)),
      safe("weather", () => weather(s.location)),
      safe("prior reports", () => priorReports()),
    ]);

  return {
    date: today(),
    identity,
    journals: (await safe("journals", () => recentJournals())) || "(unavailable)",
    nudges,
    observations: observations ? truncate(String(observations), 4000) : null,
    patterns: patterns ? truncate(String(patterns), 3000) : null,
    trackers: trackers || "(no trackers configured)",
    weather: wx || null,
    prior: prior || "(none yet)",
  };
}

// ─── WRITE ─────────────────────────────────────────────────────────

export interface Report {
  date: string;
  display_text: string;
  tts_text: string;
}

function buildPrompt(g: Gathered, s: ReportSettings, owner: string): string {
  const section = (title: string, body: string | null) =>
    body ? `\n## ${title}\n${body}\n` : "";

  return [
    `Today is ${g.date}. Write ${owner}'s morning report.`,
    "",
    "You have their vault below. Use it. Be specific — name the actual thing,",
    "not a category of thing. If something has been open for a while, say how long.",
    s.tone ? `\nTone: ${s.tone}` : "",
    g.weather ? `\nWeather where they are: ${g.weather}` : "",
    section("Who they are", g.identity),
    section("Open nudges (things they said they'd do)", g.nudges),
    section("Long-term patterns", g.patterns),
    section("What you've noticed in the last 3 days", g.observations),
    `\n## Recent journal entries\n${g.journals}\n`,
    `\n## Trackers\n${g.trackers}\n`,
    `\n## Your last few reports — do NOT repeat these angles\n${g.prior}\n`,
    "",
    "Produce exactly two sections, with these headers and nothing before or after:",
    "",
    "===DISPLAY===",
    "The written report. Markdown. Short. A few tight paragraphs or bullets —",
    "what matters today, what's slipping, one thing worth their attention.",
    "No preamble, no sign-off, no 'here is your report'.",
    "",
    "===SPOKEN===",
    "The same report as it should be READ ALOUD: 60-90 seconds of natural speech.",
    "No markdown, no bullets, no headers, no emoji. Contractions. Say numbers as words",
    "where it sounds better. Open by addressing them directly.",
  ].join("\n");
}

export async function generateReport(
  g: Gathered,
  s: ReportSettings
): Promise<Report> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. The morning report needs it — add it to .env."
    );
  }

  const anthropic = new Anthropic();
  const result = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system:
      `You write a daily morning briefing for ${config.ownerName}. You know them well. ` +
      "You are candid and concrete, never generic and never a motivational poster. " +
      "You would rather say one true specific thing than five encouraging vague ones.",
    messages: [{ role: "user", content: buildPrompt(g, s, config.ownerName) }],
  });

  const text = result.content
    .filter((b) => b.type === "text")
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();

  const display = text.split("===DISPLAY===")[1] || text;
  const [displayText, spokenText] = display.split("===SPOKEN===");

  const display_text = (displayText || text).trim();
  const tts_text = (spokenText || displayText || text)
    .trim()
    // Strip anything that would be read aloud as punctuation noise.
    .replace(/[#*_`>]/g, "");

  if (!display_text) throw new Error("The model returned an empty report.");
  return { date: g.date, display_text, tts_text };
}

// ─── DELIVER ───────────────────────────────────────────────────────

/** Save the report into the vault as Reports/<date>-morning.md and commit it. */
export async function saveToVault(report: Report): Promise<string> {
  const rel = path.join("Reports", `${report.date}-morning.md`);
  const file = path.join(config.vaultPath, rel);
  const body = [
    "---",
    "type: report",
    `date: ${report.date}`,
    "tags:",
    "  - morning-report",
    "---",
    "",
    `# Morning report — ${report.date}`,
    "",
    report.display_text,
    "",
  ].join("\n");

  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, body);
  await gitCommitAndPush(`Morning report ${report.date}`);
  return rel;
}

/** Render the spoken text to mp3. Returns null when audio is off or fails. */
async function synthesize(report: Report): Promise<Buffer | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  // The TTS endpoint caps input length, so long reports go out in pieces and
  // the mp3 buffers are concatenated — mp3 frames tolerate that.
  const CHUNK = 3800;
  const chunks: string[] = [];
  for (let i = 0; i < report.tts_text.length; i += CHUNK) {
    chunks.push(report.tts_text.slice(i, i + CHUNK));
  }

  const buffers: Buffer[] = [];
  for (const chunk of chunks) {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
        voice: process.env.OPENAI_TTS_VOICE || "onyx",
        input: chunk,
      }),
    });
    if (!res.ok) throw new Error(`OpenAI TTS ${res.status}: ${await res.text()}`);
    buffers.push(Buffer.from(await res.arrayBuffer()));
  }
  return Buffer.concat(buffers);
}

async function deliverDiscord(report: Report, audio: Buffer | null): Promise<void> {
  const hook = process.env.DISCORD_WEBHOOK_URL;
  if (!hook) throw new Error("DISCORD_WEBHOOK_URL is not set");

  if (!audio) {
    const res = await fetch(hook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: report.display_text.slice(0, 1900) }),
    });
    if (!res.ok) throw new Error(`Discord ${res.status}`);
    return;
  }

  const form = new FormData();
  form.append(
    "payload_json",
    JSON.stringify({ content: `**Morning report — ${report.date}**` })
  );
  form.append(
    "files[0]",
    new Blob([new Uint8Array(audio)], { type: "audio/mpeg" }),
    `morning-${report.date}.mp3`
  );
  const res = await fetch(hook, { method: "POST", body: form });
  if (!res.ok) throw new Error(`Discord ${res.status}: ${await res.text()}`);
}

async function deliverPush(report: Report): Promise<void> {
  const { sendPush, countSubscriptions } = await import("../ios_app/logic.js");
  if ((await countSubscriptions()) === 0) {
    throw new Error("no phones subscribed — open the app and enable notifications");
  }
  // The notification is a teaser; the full text lives in the vault note.
  const firstLine =
    report.display_text
      .split("\n")
      .map((l) => l.replace(/^[#\-*\s]+/, "").trim())
      .find((l) => l.length > 0) || "Your morning report is ready.";
  await sendPush(`Morning report — ${report.date}`, firstLine.slice(0, 180), "/app");
}

export interface DeliveryOutcome {
  vaultPath: string;
  delivered: string[];
  failed: { channel: string; error: string }[];
}

export async function deliver(
  report: Report,
  s: ReportSettings
): Promise<DeliveryOutcome> {
  const vaultPath = await saveToVault(report);
  const delivered: string[] = ["vault"];
  const failed: { channel: string; error: string }[] = [];

  let audio: Buffer | null = null;
  if (s.audio && s.delivery.includes("discord")) {
    try {
      audio = await synthesize(report);
    } catch (e: any) {
      failed.push({ channel: "audio", error: String(e?.message || e) });
    }
  }

  for (const channel of s.delivery) {
    try {
      if (channel === "discord") await deliverDiscord(report, audio);
      if (channel === "push") await deliverPush(report);
      delivered.push(channel);
    } catch (e: any) {
      failed.push({ channel, error: String(e?.message || e) });
    }
  }

  return { vaultPath, delivered, failed };
}

/** Generate and deliver in one go. Used by the cron script and the MCP tool. */
export async function runMorningReport(): Promise<DeliveryOutcome & { report: Report }> {
  const s = settings();
  const g = await gather(s);
  const report = await generateReport(g, s);
  const outcome = await deliver(report, s);
  return { ...outcome, report };
}
