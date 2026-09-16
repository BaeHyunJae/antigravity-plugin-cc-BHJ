// Build and run `agy` print-mode invocations.
//
// Flag ordering matters: we place ALL flags first and `-p <prompt>` LAST. This is
// robust whether agy treats `-p/--print` as a boolean mode flag (prompt is then a
// trailing positional) or as a string flag (prompt is its value). Either way,
// `... <flags> -p "<prompt>"` is parsed correctly.
//
// Grounded against agy 1.2.4 (Windows, 2026-09). See docs/antigravity-cli-reference.md.

import { spawn, spawnSync } from "node:child_process";
import { openSync, readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

import { jobsRoot } from "./paths.mjs";

/**
 * Minimum `agy` this companion supports.
 *
 * 1.1.10 is the release where `--model` and `--effort` are actually applied in
 * headless `-p` runs. Both flags existed from 1.1.5 but were silently ignored
 * through 1.1.9 — the run fell back to the persisted default with no error.
 * Supporting anything older would mean carrying a second output-parsing path
 * (`--output-format json` only landed in 1.1.8) plus per-flag version gates, so
 * the companion refuses instead. See docs/antigravity-cli-reference.md.
 */
export const MIN_AGY_VERSION = "1.1.10";

/** Flags the companion owns. Passing these through --agy-arg would break its contract. */
export const RESERVED_AGY_FLAGS = new Set([
  "-p",
  "--print",
  "--prompt",
  "-i",
  "--prompt-interactive",
  "--log-file",
  "--output-format",
  "--input-format",
]);

/**
 * @param {object} opts
 * @param {string} opts.prompt
 * @param {string[]} [opts.addDirs]
 * @param {boolean} [opts.yolo]              --dangerously-skip-permissions
 * @param {boolean} [opts.sandbox]           --sandbox
 * @param {boolean} [opts.continueLast]      --continue
 * @param {string}  [opts.conversationId]    --conversation <id>
 * @param {string}  [opts.logFile]           --log-file <path>
 * @param {string}  [opts.printTimeout]      --print-timeout <go-dur>, e.g. "10m"
 * @param {string}  [opts.model]             --model <slug>, e.g. "gemini-3.1-pro-high"
 * @param {string}  [opts.effort]            --effort <low|medium|high>
 * @param {boolean} [opts.noSlashCommands]   --disable-slash-commands
 * @param {string[]} [opts.extraArgs]        raw passthrough tokens (--agy-arg)
 * @returns {string[]}
 */
export function buildPrintArgs(opts) {
  const args = [];
  if (opts.sandbox) args.push("--sandbox");
  if (opts.yolo) args.push("--dangerously-skip-permissions");
  for (const dir of opts.addDirs || []) {
    if (dir) args.push("--add-dir", dir);
  }
  if (opts.continueLast) args.push("--continue");
  if (opts.conversationId) args.push("--conversation", opts.conversationId);
  if (opts.logFile) args.push("--log-file", opts.logFile);
  if (opts.printTimeout) args.push("--print-timeout", opts.printTimeout);
  // Always structured. The JSON envelope carries the status, the error and the
  // conversation id; the log scan is only a fallback for when stdout comes back empty.
  args.push("--output-format", "json");
  if (opts.model) args.push("--model", opts.model);
  if (opts.effort) args.push("--effort", opts.effort);
  // agy expands its own slash commands and skills in print mode. That stays ON by
  // default so an agy-side skill can fire; this turns it off on request.
  if (opts.noSlashCommands) args.push("--disable-slash-commands");
  for (const token of opts.extraArgs || []) {
    if (token !== undefined && token !== null) args.push(String(token));
  }
  args.push("-p", opts.prompt);
  return args;
}

/**
 * Windows caps an entire command line at 32,767 characters (CreateProcessW), and the
 * prompt rides in argv as `-p <prompt>` — `-p` is a string flag, so there is no plain
 * stdin path to fall back on. Measured on Windows 11: a prompt of 32,648 bytes is the
 * largest that spawns; anything past it dies with ENAMETOOLONG before agy ever starts.
 *
 * A 100 KiB review prompt therefore did not "get truncated" on Windows — it failed the
 * whole run. POSIX ARG_MAX is megabytes, so there the model's context is the real limit.
 */
const WINDOWS_COMMAND_LINE_MAX = 32767;
const COMMAND_LINE_SAFETY_MARGIN = 512;

/**
 * How many bytes of prompt can actually be spawned, given everything else on the
 * command line.
 *
 * @param {{ bin: string, args: string[], platform?: string, ceiling?: number }} opts
 * @returns {number}
 */
export function promptBudget({ bin, args, platform = process.platform, ceiling = 100 * 1024 }) {
  if (platform !== "win32") return ceiling;
  // +3 per argument covers the separating space and the quoting the OS layer adds.
  const overhead = [bin, ...(args || [])].reduce((n, a) => n + Buffer.byteLength(String(a), "utf8") + 3, 0);
  const room = WINDOWS_COMMAND_LINE_MAX - overhead - COMMAND_LINE_SAFETY_MARGIN;
  return Math.max(1024, Math.min(ceiling, room));
}

/** Parse a leading "X.Y.Z" out of an agy --version string (tolerates "-fake"/"-dev" suffixes). */
function parseVersion(value) {
  const m = typeof value === "string" ? value.match(/(\d+)\.(\d+)\.(\d+)/) : null;
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/**
 * True when `version` is parseable and >= `minVersion` (both "X.Y.Z" strings).
 * An unparseable/missing `version` (agy's own `--version` probe failed, or a
 * future build changed the output format) fails CLOSED — false, not >= — so we
 * never assume a build we could not verify.
 */
export function isVersionAtLeast(version, minVersion) {
  const v = parseVersion(version);
  const min = parseVersion(minVersion);
  if (!v || !min) return false;
  for (let i = 0; i < 3; i += 1) {
    if (v[i] !== min[i]) return v[i] > min[i];
  }
  return true;
}

/** Parse a Go duration string ("5m0s", "90s", "10m") to milliseconds. Fallback 5m. */
export function goDurationToMs(value, fallbackMs = 5 * 60 * 1000) {
  if (typeof value !== "string" || !value.trim()) return fallbackMs;
  let total = 0;
  let matched = false;
  const re = /(\d+(?:\.\d+)?)(h|m|s|ms)/g;
  let m;
  while ((m = re.exec(value)) !== null) {
    matched = true;
    const n = parseFloat(m[1]);
    const unit = m[2];
    if (unit === "h") total += n * 3600000;
    else if (unit === "m") total += n * 60000;
    else if (unit === "s") total += n * 1000;
    else if (unit === "ms") total += n;
  }
  return matched ? total : fallbackMs;
}

function readLogSafe(logFile) {
  try {
    if (logFile && existsSync(logFile)) return readFileSync(logFile, "utf8");
  } catch {
    /* ignore */
  }
  return "";
}

function prepareSpawn(bin, args) {
  if (typeof bin === "string" && (bin.endsWith(".mjs") || bin.endsWith(".js"))) {
    return { bin: process.execPath, args: [bin, ...args] };
  }
  return { bin, args };
}

/**
 * Run agy print mode synchronously (foreground) with a hard watchdog timeout in
 * addition to agy's own --print-timeout.
 *
 * @returns {{ stdout: string, stderr: string, code: number|null, signal: string|null,
 *             timedOut: boolean, logText: string, logFile: string|undefined, error?: string }}
 */
export function runForeground({ bin, args, cwd, logFile, watchdogMs }) {
  const target = prepareSpawn(bin, args);
  const res = spawnSync(target.bin, target.args, {
    cwd,
    encoding: "utf8",
    timeout: watchdogMs,
    killSignal: "SIGKILL",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  const timedOut = res.error && /ETIMEDOUT/i.test(String(res.error.code || res.error.message || ""));
  return {
    stdout: res.stdout || "",
    stderr: res.stderr || "",
    code: res.status,
    signal: res.signal || null,
    timedOut: Boolean(timedOut),
    logText: readLogSafe(logFile),
    logFile,
    error: res.error && !timedOut ? String(res.error.message || res.error.code) : undefined,
  };
}

/**
 * Spawn agy print mode detached for background execution.
 * stdout -> outputFile, stderr -> errFile, agy log -> (its own --log-file).
 *
 * @returns {{ pid: number }}
 */
export function spawnBackground({ bin, args, cwd, outputFile, errFile }) {
  const target = prepareSpawn(bin, args);
  const out = openSync(outputFile, "a");
  const err = openSync(errFile, "a");
  const child = spawn(target.bin, target.args, {
    cwd,
    detached: true,
    windowsHide: true,
    stdio: ["ignore", out, err],
  });
  child.unref();
  return { pid: child.pid };
}

/** Quick `agy --version`. Returns version string or null. */
export function agyVersion(bin) {
  try {
    const target = prepareSpawn(bin, ["--version"]);
    const res = spawnSync(target.bin, target.args, { encoding: "utf8", timeout: 15000, windowsHide: true });
    if (res.status === 0) return (res.stdout || res.stderr || "").trim().split(/\r?\n/)[0] || null;
  } catch {
    /* ignore */
  }
  return null;
}

function versionCacheFile(env = process.env) {
  return join(jobsRoot(env), ".version-cache.json");
}

function binaryMtime(bin) {
  try {
    return statSync(bin).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * `agyVersion` with an on-disk cache keyed by binary path + mtime.
 *
 * The probe is a full spawn with a 15s timeout, and every delegate/review/resume
 * needs the version for the MIN_AGY_VERSION gate — without a cache that is one
 * extra process per run. The cache is invalidated when the binary's mtime changes,
 * which covers an in-place `agy update`.
 */
export function agyVersionCached(bin, env = process.env) {
  const mtimeMs = binaryMtime(bin);
  const file = versionCacheFile(env);
  if (mtimeMs !== null) {
    try {
      const cache = JSON.parse(readFileSync(file, "utf8"));
      if (cache && cache.binPath === bin && cache.mtimeMs === mtimeMs) return cache.version ?? null;
    } catch {
      /* cache miss */
    }
  }

  const version = agyVersion(bin);
  if (mtimeMs !== null) {
    try {
      mkdirSync(jobsRoot(env), { recursive: true });
      writeFileSync(file, JSON.stringify({ binPath: bin, mtimeMs, version }, null, 2));
    } catch {
      /* caching is best-effort */
    }
  }
  return version;
}

export { readLogSafe };
