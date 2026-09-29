/**
 * Hourly nudge push evaluator.
 *
 * A cheap deterministic gate runs first and exits without thinking. Only when
 * that gate passes do we reach the Claude CLI — which spends subscription
 * quota, so 24 calls a day is not free.
 *
 * Run with --dry to print the decision without sending anything.
 *
 * Required env:
 *   NUDGE_PUSH_ENABLED=1   — must be set to activate (safe off by default)
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT   — for web push
 *
 * Optional env (overrides config.yaml plugins.ios_app.push):
 *   PUSH_DAILY_CAP, PUSH_MIN_GAP_MIN, PUSH_NO_REPEAT_DAYS
 *   PUSH_START_HOUR, PUSH_END_HOUR
 *   CLAUDE_MODEL   — override the model used for the send/no-send decision
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { sendPush } from "../src/plugins/ios_app/logic.js";
import { claudePrompt, CLAUDE_MODEL } from "../src/core/claude-cli.js";
import { parseNudgeRow, type NudgeRow } from "../src/core/nudges.js";
import { describeDue } from "../src/core/due.js";
import { frontmatterIndex } from "../src/core/frontmatter.js";
import { config } from "../src/core/config.js";
import {
  eastern,
  loadLedger,
  recordSend,
  distinctGoalsOnEasternDate,
  lastSend,
  goalsWithinDays,
  pushPolicy,
} from "../src/core/push-ledger.js";

const DRY = process.argv.includes("--dry");
const NUDGE_PUSH_MODEL = process.env.NUDGE_PUSH_MODEL ?? CLAUDE_MODEL;

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

/** Parse nudges table content into open/in_progress rows only. */
function openNudges(tableContent: string): NudgeRow[] {
  return tableContent
    .split("\n")
    .map(parseNudgeRow)
    .filter((r): r is NudgeRow => r !== null);
}

function buildPrompt(
  et: ReturnType<typeof eastern>,
  nudges: NudgeRow[],
  sentToday: number,
  ownerName: string,
): string {
  const list = nudges
    .map(
      (n) =>
        `- ${n.goal}\n  priority: ${n.priority} | status: ${n.status} | ${describeDue(n.due, et.date)}\n  note: ${n.note.slice(0, 320)}`,
    )
    .join("\n");

  return [
    `You decide whether to interrupt ${ownerName}'s phone with a single push notification right now.`,
    "",
    `It is ${et.weekday}, ${et.date}, ${et.hour}:00 Eastern.`,
    `Push notifications already sent today: ${sentToday}.`,
    "",
    "Open nudges:",
    list,
    "",
    "Rules, in order of importance:",
    "1. DEFAULT TO NOT SENDING. Silence is the right answer most hours. A notification not worth acting on immediately trains the user to swipe them away, destroying the whole system.",
    "2. Never nag, guilt, or count. No \"you haven't done X in N days\", no streaks, no scolding, no progress tallies.",
    "3. Only send if something is specific and DOABLE IN THE NEXT HOUR. An appointment-booking nudge is useless at 9pm and actionable at 10am on a weekday.",
    "4. Each nudge shows its due state: \"due today\", \"overdue by N days\", \"recurring: mon\", \"due in N days\", or \"no date\". Anything due or overdue outranks an undated item. A recurring item is live only on its own day. \"no date\" means open-ended — send one of those only if the moment genuinely fits.",
    "4b. Some rows are standing constraints or habits rather than tasks. NEVER send those — a push notification about an ongoing habit is the fastest way to get this whole system muted.",
    "5. The body names ONE concrete small action rather than restating the goal.",
    "6. Write like a friend who knows the context. Plain, quiet, lowercase-leaning. No emoji, no exclamation marks.",
    "7. Title 45 characters or fewer. Body 120 characters or fewer.",
    "",
    "Respond with ONLY a JSON object. No prose, no code fence:",
    '{"send": true, "goal": "<exact goal text copied from the list above, or empty string>", "title": "...", "body": "...", "reason": "<one short sentence, always required>"}',
  ].join("\n");
}

interface Decision {
  send?: boolean;
  goal?: string;
  title?: string;
  body?: string;
  reason?: string;
}

function parseDecision(raw: string): Decision | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as Decision;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  if (process.env.NUDGE_PUSH_ENABLED !== "1" && !DRY) {
    log("skip: disabled (NUDGE_PUSH_ENABLED != 1)");
    return;
  }

  const policy = pushPolicy();
  const now = new Date();
  const et = eastern(now);

  if (et.hour < policy.startHour || et.hour > policy.endHour) {
    log(`skip: outside window (${et.hour}:00 ET, window ${policy.startHour}-${policy.endHour})`);
    return;
  }

  const entries = await loadLedger();
  const sentToday = distinctGoalsOnEasternDate(entries, et.date).size;
  if (policy.dailyCap > 0 && sentToday >= policy.dailyCap && !DRY) {
    log(`skip: daily cap reached (${sentToday}/${policy.dailyCap} distinct goals)`);
    return;
  }

  const last = lastSend(entries);
  if (last && !DRY) {
    const mins = (now.getTime() - new Date(last.ts).getTime()) / 60_000;
    if (mins < policy.minGapMinutes) {
      log(`skip: too soon (${Math.round(mins)}m since last, need ${policy.minGapMinutes}m)`);
      return;
    }
  }

  // Find the nudges file via the frontmatter index.
  await frontmatterIndex.rebuild();
  const nudgeEntry = frontmatterIndex.findOne({ type: "ai-observation", topic: "nudges" });
  if (!nudgeEntry) {
    log("skip: no nudges file found (type=ai-observation topic=nudges)");
    return;
  }
  const raw = await readFile(nudgeEntry.path, "utf-8");
  // Strip frontmatter (gray-matter not needed — we just drop everything before the first table row)
  const tableContent = raw.split("\n").filter((l) => l.trimStart().startsWith("|")).join("\n");

  const nudges = openNudges(tableContent);
  if (!nudges.length) {
    log("skip: no open nudges found");
    return;
  }

  const recent = goalsWithinDays(entries, policy.noRepeatDays);
  const eligible = nudges.filter((n) => !recent.has(n.goal));
  if (!eligible.length) {
    log(`skip: all ${nudges.length} open nudges pushed within ${policy.noRepeatDays} days`);
    return;
  }

  log(`evaluating: ${eligible.length} eligible nudges, ${sentToday} distinct goals today`);

  const rawDecision = await claudePrompt(
    buildPrompt(et, eligible, sentToday, config.ownerName),
    NUDGE_PUSH_MODEL,
  );
  const decision = parseDecision(rawDecision);

  if (!decision) {
    log(`no send: could not parse a decision from ${rawDecision.length} chars of output`);
    return;
  }
  if (!decision.send) {
    log(`no send: ${decision.reason || "(no reason given)"}`);
    return;
  }
  if (!decision.title || !decision.body) {
    log("no send: decision was send=true but title/body missing");
    return;
  }

  if (DRY) {
    log(
      `DRY RUN would send: ${JSON.stringify({ title: decision.title, body: decision.body, goal: decision.goal, reason: decision.reason })}`,
    );
    return;
  }

  // Pre-send guard: re-read ledger AFTER the LLM call to catch sends that
  // landed during the ~20s the Claude CLI was running.
  const freshEntries = await loadLedger();
  const freshSentToday = distinctGoalsOnEasternDate(freshEntries, et.date).size;
  if (policy.dailyCap > 0 && freshSentToday >= policy.dailyCap) {
    log(`skip: superseded (daily-cap, ${freshSentToday} distinct goals on ${et.date})`);
    return;
  }
  const freshLast = lastSend(freshEntries);
  if (freshLast) {
    const ageMs = Date.now() - new Date(freshLast.ts).getTime();
    if (ageMs / 60_000 < policy.minGapMinutes) {
      log(
        `skip: superseded (min-gap, ${freshLast.source ?? "unknown"} sent "${freshLast.title ?? freshLast.goal}" ${Math.round(ageMs / 1000)}s ago)`,
      );
      return;
    }
  }
  const decisionGoal = decision.goal || decision.title || "";
  if (decisionGoal) {
    const cutoffMs = Date.now() - policy.noRepeatDays * 86_400_000;
    const blocker = freshEntries
      .slice()
      .reverse()
      .find((e) => e.goal === decisionGoal && new Date(e.ts).getTime() > cutoffMs);
    if (blocker) {
      const ageSecs = Math.round((Date.now() - new Date(blocker.ts).getTime()) / 1000);
      log(
        `skip: superseded (no-repeat, ${blocker.source ?? "unknown"} sent "${blocker.title ?? blocker.goal}" ${ageSecs}s ago)`,
      );
      return;
    }
  }

  const res = await sendPush(decision.title, decision.body, "/app");
  await recordSend({
    goal: decision.goal || decision.title || "",
    title: decision.title,
    source: "nudge-push",
  });
  log(`sent "${decision.title}" (${decision.reason || ""}) -> ${JSON.stringify(res)}`);
}

main().catch((e) => {
  log(`error: ${e?.stack || e}`);
  process.exit(1);
});
