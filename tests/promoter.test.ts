/**
 * Unit tests for promoter CORRECTION-line preservation.
 */
import {
  CORRECTION_LINE_RE,
  extractCorrectionLines,
  buildSynthesisPrompt,
} from "../src/core/promoter.js";
import type { Entry } from "../src/core/scratchpad.js";

let passed = 0;
let failed = 0;

function ok(label: string, condition: boolean): void {
  if (condition) {
    console.log(`PASS: ${label}`);
    passed++;
  } else {
    console.log(`FAIL: ${label}`);
    failed++;
  }
}

// ─── CORRECTION_LINE_RE ──────────────────────────────────────────────────────

ok("matches bare CORRECTION", CORRECTION_LINE_RE.test("CORRECTION 2026-08-17: recant"));
ok("matches bolded CORRECTION", CORRECTION_LINE_RE.test("- **CORRECTION 2026-08-17:** recant"));
ok("matches lowercase correction", CORRECTION_LINE_RE.test("correction: recant"));
ok("does not match unrelated line", !CORRECTION_LINE_RE.test("This is a normal line"));
ok("does not match mid-word", !CORRECTION_LINE_RE.test("INCORRECT data"));

// ─── extractCorrectionLines ──────────────────────────────────────────────────

{
  const block = `### Some Pattern
- **First noticed:** 2026-01-01
- **Evidence:** does stuff
- **CORRECTION 2026-08-17:** not actually true
Some other line
CORRECTION: also retracted
`;
  const lines = extractCorrectionLines(block);
  ok("extracts both correction lines", lines.length === 2);
  ok("first correction line present", lines.some((l) => l.includes("not actually true")));
  ok("second correction line present", lines.some((l) => l.includes("also retracted")));
}

// ─── buildSynthesisPrompt: priorPatternSection ────────────────────────────────

function makeEntry(date: string): Entry {
  return {
    timestamp: `${date} 10:00`,
    date: new Date(`${date}T10:00:00`),
    type: "behavior",
    subject: "testing",
    headerLine: `### ${date} 10:00 | type: behavior | subject: testing`,
    body: "User writes lots of tests.",
  };
}

{
  const cluster = {
    type: "behavior",
    subject: "testing",
    entries: [makeEntry("2026-09-01"), makeEntry("2026-09-15")],
  };
  const prompt = buildSynthesisPrompt(cluster);
  ok("new cluster prompt has no priorPattern section", !prompt.includes("Previous version"));
  ok("new cluster prompt has entries", prompt.includes("User writes lots of tests."));
}

{
  const cluster = {
    type: "behavior",
    subject: "testing",
    entries: [makeEntry("2026-09-01"), makeEntry("2026-09-15"), makeEntry("2026-10-01")],
    resynth: {
      firstNoticed: "2026-09-01",
      synthesized: "2026-09-16",
      sinceCount: 2,
      priorPattern: "### User tests obsessively\n- **Evidence:** every session",
    },
  };
  const prompt = buildSynthesisPrompt(cluster);
  ok("resynth prompt includes previous version", prompt.includes("Previous version"));
  ok("resynth prompt includes CORRECTION binding instruction", prompt.includes("CORRECTION"));
  ok("resynth prompt includes not-authoritative caveat", prompt.includes("NOT authoritative"));
  ok("resynth prompt includes priorPattern content", prompt.includes("User tests obsessively"));
  ok("resynth prompt does not use personal name", !prompt.includes("Matt"));
}

// ─── summary ─────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
