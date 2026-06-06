import { exec } from "child_process";
import { promisify } from "util";
import { config } from "./config.js";

const execAsync = promisify(exec);

let lastPullTime = 0;

/**
 * Run a git command in the vault directory.
 */
async function git(command: string): Promise<string> {
  try {
    const { stdout } = await execAsync(`git ${command}`, {
      cwd: config.vaultPath,
    });
    return stdout.trim();
  } catch (err: any) {
    // Don't throw on common non-errors like "nothing to commit"
    if (err.stderr?.includes("nothing to commit")) return "";
    if (err.stderr?.includes("Already up to date")) return "";
    console.error(`git ${command} failed:`, err.stderr || err.message);
    return "";
  }
}

/**
 * Pull latest changes from remote (with cooldown).
 */
export async function gitPull(): Promise<void> {
  const now = Date.now();
  if (now - lastPullTime < config.gitSyncCooldown) return;

  lastPullTime = now;
  await git("pull --rebase 2>/dev/null || true");
}

/**
 * Commit and push changes after a write operation.
 * Always pulls first to avoid divergence.
 */
export async function gitCommitAndPush(message: string): Promise<void> {
  // Always pull before committing to avoid divergence
  await git("pull --rebase 2>/dev/null || true");
  lastPullTime = Date.now();

  await git("add -A");
  await git(`commit -m "${message.replace(/"/g, '\\"')}"`);
  await git("push 2>/dev/null || true");
}

/**
 * Check if git is initialized and has a remote.
 */
export async function hasGitRemote(): Promise<boolean> {
  const result = await git("remote -v");
  return result.length > 0;
}
