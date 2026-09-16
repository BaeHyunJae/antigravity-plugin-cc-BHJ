// Path + binary resolution for the Antigravity companion.
// Pure Node stdlib, no dependencies.

import { existsSync, accessSync, constants } from "node:fs";
import { homedir, platform } from "node:os";
import { join, delimiter } from "node:path";

const IS_WINDOWS = platform() === "win32";
const AGY_BIN_NAME = IS_WINDOWS ? "agy.exe" : "agy";

function isExecutableFile(path) {
  try {
    if (!existsSync(path)) return false;
    accessSync(path, IS_WINDOWS ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the `agy` binary. Resolution order:
 *  1. ANTIGRAVITY_CC_AGY_BIN env override (absolute path) — also used by tests.
 *  2. A directory on PATH containing `agy`.
 *  3. Well-known install locations (~/.local/bin/agy, %LOCALAPPDATA%\agy\bin).
 *
 * @returns {{path: string, source: string} | null}
 */
export function resolveAgyBinary(env = process.env) {
  const override = env.ANTIGRAVITY_CC_AGY_BIN;
  if (override && isExecutableFile(override)) {
    return { path: override, source: "env (ANTIGRAVITY_CC_AGY_BIN)" };
  }

  const pathValue = env.PATH || env.Path || "";
  for (const dir of pathValue.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, AGY_BIN_NAME);
    if (isExecutableFile(candidate)) {
      return { path: candidate, source: "PATH" };
    }
  }

  const home = homedir();
  const wellKnown = IS_WINDOWS
    ? [
        join(env.LOCALAPPDATA || join(home, "AppData", "Local"), "agy", "bin", AGY_BIN_NAME),
        join(home, ".local", "bin", AGY_BIN_NAME),
      ]
    : [join(home, ".local", "bin", AGY_BIN_NAME)];

  for (const candidate of wellKnown) {
    if (isExecutableFile(candidate)) {
      return { path: candidate, source: "well-known location" };
    }
  }

  return null;
}

/**
 * Root of the agy config/state directory.
 *
 * agy resolves this from the OS home directory and offers no env override, so
 * neither do we — the parameter this used to accept was always ignored.
 */
export function agyConfigDir() {
  return join(homedir(), ".gemini", "antigravity-cli");
}

/**
 * Directory where agy persists conversation threads.
 *
 * Threads are SQLite databases (`<id>.db`, alongside `-shm`/`-wal` siblings) as of
 * agy 1.2.x. Older builds wrote protobuf (`<id>.pb`).
 */
export function agyConversationsDir() {
  return join(agyConfigDir(), "conversations");
}

/** Root for this plugin's own job state. Override with ANTIGRAVITY_CC_HOME (tests). */
export function jobsRoot(env = process.env) {
  const base = env.ANTIGRAVITY_CC_HOME || join(homedir(), ".antigravity-cc");
  return join(base, "jobs");
}

export function jobDir(id, env = process.env) {
  return join(jobsRoot(env), id);
}

export { IS_WINDOWS, AGY_BIN_NAME };
