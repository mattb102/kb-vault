import { spawn } from "child_process";
import { existsSync, statSync } from "fs";
import { homedir } from "os";
import { resolve } from "path";

const DEFAULT_WORKING_DIR =
  process.env.CLAUDE_CODE_DEFAULT_DIR ||
  resolve(homedir(), "kb-mcp-server");
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_OUTPUT_BYTES = 100_000;
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";

export interface RunClaudeCodeOptions {
  task: string;
  workingDir?: string;
  timeoutMs?: number;
}

export interface RunClaudeCodeResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
  durationMs: number;
  cwd: string;
}

export async function runClaudeCode({
  task,
  workingDir,
  timeoutMs,
}: RunClaudeCodeOptions): Promise<RunClaudeCodeResult> {
  const cwd = resolve(workingDir || DEFAULT_WORKING_DIR);
  const timeout = Math.min(timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);

  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    throw new Error(`Working directory does not exist or is not a directory: ${cwd}`);
  }

  return new Promise((resolvePromise, reject) => {
    const start = Date.now();
    const child = spawn(
      CLAUDE_BIN,
      ["--print", "--dangerously-skip-permissions", task],
      // stdin from /dev/null ("ignore") gives `claude --print` an immediate EOF
      // so it doesn't hang waiting for piped stdin that we never write to.
      { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] }
    );

    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let truncated = false;
    let timedOut = false;

    const killer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeout);

    const append = (which: "stdout" | "stderr", chunk: Buffer) => {
      const bytes = which === "stdout" ? stdoutBytes : stderrBytes;
      if (bytes >= MAX_OUTPUT_BYTES) {
        if (which === "stdout") truncated = true;
        return;
      }
      const remaining = MAX_OUTPUT_BYTES - bytes;
      const piece = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      const text = piece.toString("utf-8");
      if (which === "stdout") {
        stdout += text;
        stdoutBytes += piece.length;
        if (chunk.length > remaining) truncated = true;
      } else {
        stderr += text;
        stderrBytes += piece.length;
      }
    };

    child.stdout.on("data", (c: Buffer) => append("stdout", c));
    child.stderr.on("data", (c: Buffer) => append("stderr", c));

    child.on("error", (err) => {
      clearTimeout(killer);
      reject(err);
    });

    child.on("close", (code, signal) => {
      clearTimeout(killer);
      resolvePromise({
        exitCode: code,
        signal,
        stdout,
        stderr,
        truncated,
        timedOut,
        durationMs: Date.now() - start,
        cwd,
      });
    });
  });
}

export function formatRunResult(r: RunClaudeCodeResult): string {
  const lines: string[] = [];
  lines.push(`cwd: ${r.cwd}`);
  lines.push(
    `exit: ${r.exitCode ?? "null"}${r.signal ? ` (signal ${r.signal})` : ""} · ${Math.round(r.durationMs / 1000)}s${r.timedOut ? " · TIMED OUT" : ""}${r.truncated ? " · stdout truncated" : ""}`
  );
  lines.push("");
  lines.push("── stdout ──");
  lines.push(r.stdout.trim() || "(empty)");
  if (r.stderr.trim()) {
    lines.push("");
    lines.push("── stderr ──");
    lines.push(r.stderr.trim());
  }
  return lines.join("\n");
}
