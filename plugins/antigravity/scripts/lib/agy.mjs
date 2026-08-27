// Build and run `agy` print-mode invocations.
//
// Flag ordering matters: we place ALL flags first and `-p <prompt>` LAST. This is
// robust whether agy treats `-p/--print` as a boolean mode flag (prompt is then a
// trailing positional) or as a string flag (prompt is its value). Either way,
// `... <flags> -p "<prompt>"` is parsed correctly.

import { spawn, spawnSync } from "node:child_process";
import { openSync, readFileSync, existsSync } from "node:fs";

/**
 * @param {object} opts
 * @param {string} opts.prompt
 * @param {string[]} [opts.addDirs]
 * @param {boolean} [opts.yolo]            --dangerously-skip-permissions
 * @param {boolean} [opts.sandbox]         --sandbox
 * @param {boolean} [opts.continueLast]    --continue
 * @param {string}  [opts.conversationId]  --conversation <id>
 * @param {string}  [opts.logFile]         --log-file <path>
 * @param {string}  [opts.printTimeout]    --print-timeout <go-dur>, e.g. "10m"
 * @param {string}  [opts.model]           --model <slug>, e.g. "gemini-3.1-pro-high"
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
  if (opts.model) args.push("--model", opts.model);
  args.push("-p", opts.prompt);
  return args;
}

// `--model`/`--effort` were silently ignored in headless `-p` runs before this
// release (fixed upstream in 1.1.10 — see docs/antigravity-cli-reference.md).
export const MIN_MODEL_FLAG_VERSION = "1.1.10";

/** Parse a leading "X.Y.Z" out of an agy --version string (tolerates "-fake"/"-dev" suffixes). */
function parseVersion(value) {
  const m = typeof value === "string" ? value.match(/(\d+)\.(\d+)\.(\d+)/) : null;
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/**
 * True when `version` is parseable and >= `minVersion` (both "X.Y.Z" strings).
 * An unparseable/missing `version` (agy's own `--version` probe failed, or a
 * future build changed the output format) fails CLOSED — false, not >= — so a
 * flag gated on this doesn't get forwarded to a build we couldn't verify.
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

export { readLogSafe };
