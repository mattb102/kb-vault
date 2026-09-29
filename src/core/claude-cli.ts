import { spawn } from "child_process";

// Default model for synthesis tasks. Override with CLAUDE_MODEL in .env.
// Uses the claude CLI (subscription billing) rather than the Anthropic SDK
// (API-key billing) so AI-heavy cron tasks don't unexpectedly bill the key.
export const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-4-8";

/**
 * Send a prompt to the claude CLI via stdin and return its stdout.
 *
 * Requires `claude` to be on PATH with valid credentials (subscription OAuth
 * stored in ~/.claude, or CLAUDE_CODE_OAUTH_TOKEN in the environment).
 * ANTHROPIC_API_KEY is stripped from the child environment so the CLI falls
 * through to subscription auth rather than billing the API account.
 */
export function claudePrompt(
  prompt: string,
  model: string = CLAUDE_MODEL,
  timeoutMs = 180_000,
): Promise<string> {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;

  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["-p", "--model", model], { env });
    let out = "";
    let err = "";

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`claude CLI timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out.trim());
      else
        reject(
          new Error(
            `claude exited ${code}: ${(err || out).trim().slice(0, 300)}`,
          ),
        );
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}
