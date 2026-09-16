// Resolve the code-review target and produce a diff to hand to agy.
// Stdlib only (spawns git synchronously).

import { spawnSync } from "node:child_process";

function git(args, cwd) {
  const res = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  return {
    ok: res.status === 0,
    stdout: (res.stdout || "").trim(),
    stderr: (res.stderr || "").trim(),
  };
}

export function isGitRepo(cwd) {
  return git(["rev-parse", "--is-inside-work-tree"], cwd).stdout === "true";
}

function countFiles(diff) {
  const m = String(diff).match(/^diff --git /gm);
  return m ? m.length : 0;
}

/**
 * Trim a diff to a byte budget at a file boundary.
 *
 * A real working tree outgrows the prompt budget easily — this repo's own review diff
 * is 160 KB against a 100 KiB cap. Cutting blindly leaves the model staring at half a
 * hunk with the closing fence and the trailing instructions gone, and nothing tells the
 * caller their review only covered part of the change.
 *
 * @returns {{ diff: string, truncated: boolean, shownFiles: number, totalFiles: number }}
 */
export function truncateDiff(diff, maxBytes) {
  const text = String(diff || "");
  const totalFiles = countFiles(text);
  if (Buffer.byteLength(text, "utf8") <= maxBytes) {
    return { diff: text, truncated: false, shownFiles: totalFiles, totalFiles };
  }

  const kept = [];
  let bytes = 0;
  let lastBoundary = 0;
  for (const line of text.split("\n")) {
    const size = Buffer.byteLength(line, "utf8") + 1;
    if (bytes + size > maxBytes) break;
    kept.push(line);
    bytes += size;
    if (line.startsWith("diff --git ")) lastBoundary = kept.length - 1;
  }

  // Drop the half-included trailing file, unless that would leave nothing at all.
  const cut = lastBoundary > 0 ? kept.slice(0, lastBoundary) : kept;
  const out = cut.join("\n");
  return { diff: out, truncated: true, shownFiles: countFiles(out), totalFiles };
}

/**
 * Resolve what to review.
 *  - base provided  -> diff base...HEAD (branch review) + any uncommitted changes
 *  - no base        -> uncommitted changes (staged + unstaged) vs HEAD
 *
 * @returns {{ ok: boolean, label: string, diff: string, stat: string, reason?: string }}
 */
export function resolveReviewTarget(cwd, base) {
  if (!isGitRepo(cwd)) {
    return { ok: false, label: "(not a git repo)", diff: "", stat: "", reason: "not a git repository" };
  }

  if (base) {
    const exists = git(["rev-parse", "--verify", "--quiet", base], cwd).ok;
    if (!exists) {
      return { ok: false, label: base, diff: "", stat: "", reason: `base ref "${base}" not found` };
    }
    const range = `${base}...HEAD`;
    const diff = git(["diff", "--no-color", range], cwd).stdout;
    const stat = git(["diff", "--stat", range], cwd).stdout;
    const working = git(["diff", "--no-color", "HEAD"], cwd).stdout;
    const combined = [diff, working ? `\n# Uncommitted working-tree changes:\n${working}` : ""].join("");
    return {
      ok: combined.trim().length > 0,
      label: `${base}...HEAD (+ working tree)`,
      diff: combined,
      stat,
      reason: combined.trim().length === 0 ? "no changes against base" : undefined,
    };
  }

  // Uncommitted changes against HEAD (staged + unstaged), plus untracked file names.
  const tracked = git(["diff", "--no-color", "HEAD"], cwd).stdout;
  const staged = git(["diff", "--no-color", "--cached"], cwd).stdout;
  const stat = git(["diff", "--stat", "HEAD"], cwd).stdout;
  const untracked = git(["ls-files", "--others", "--exclude-standard"], cwd).stdout;

  const parts = [];
  if (tracked) parts.push(tracked);
  if (staged && staged !== tracked) parts.push(`\n# Staged changes:\n${staged}`);
  if (untracked) parts.push(`\n# Untracked files (not shown in diff):\n${untracked}`);
  const diff = parts.join("\n");

  return {
    ok: diff.trim().length > 0,
    label: "uncommitted changes (HEAD)",
    diff,
    stat,
    reason: diff.trim().length === 0 ? "no uncommitted changes to review" : undefined,
  };
}
