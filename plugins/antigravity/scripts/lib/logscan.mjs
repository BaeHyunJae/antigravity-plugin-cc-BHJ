// Scan an `agy` --log-file for what the normal path could not tell us.
//
// This is a FALLBACK, not the primary channel. Since agy 1.1.8 the companion runs
// with `--output-format json` and reads the status, the error and the conversation
// id straight off the envelope (see lib/envelope.mjs). Two cases still land here:
//
//   1. stdout comes back completely empty with exit 0. Reported upstream for
//      non-TTY pipes, which is exactly how we spawn agy
//      (stdio: ["ignore", "pipe", "pipe"]).
//   2. The envelope is present but carries no conversation id.
//
// Grounded against agy 1.2.4 (Windows, 2026-09).

/**
 * @param {string} logText raw contents of the agy log file (may be "")
 * @returns {{
 *   conversationId: string|null,
 *   error: { kind: "quota"|"auth"|"backend", message: string, resetsIn: string|null } | null,
 *   errorLines: string[]
 * }}
 */
export function scanAgyLog(logText) {
  const text = typeof logText === "string" ? logText : "";

  const conversationId = extractConversationId(text);
  const errorLines = extractErrorLines(text);
  const error = classifyError(errorLines);

  return { conversationId, error, errorLines };
}

function extractConversationId(text) {
  // "Created conversation <uuid>" is still emitted by 1.2.x. The "conversation=<uuid>"
  // form is legacy (not seen in 1.2.x logs) but costs nothing to keep for old logs.
  const created = text.match(/Created conversation ([0-9a-fA-F-]{8,})/);
  if (created) return created[1];
  const eq = text.match(/conversation=([0-9a-fA-F-]{8,})/);
  if (eq) return eq[1];
  return null;
}

/**
 * Strings that only ever appear in a genuinely failed run.
 *
 * This is an allowlist on purpose. Severity prefixes are NOT a usable signal: a
 * fully successful agy 1.2.x run writes ~36 `E`-severity lines and ~57 copies of
 * "error getting token source: You are not logged into Antigravity." to its log
 * while starting up, long before it succeeds. Anything matched loosely here turns
 * every fallback-path run into a confident, wrong diagnosis.
 *
 * Each token below was verified absent (0 hits) from the log of a successful
 * 1.2.x run. Do not add a pattern without checking that first.
 */
const ERROR_SIGNAL =
  /RESOURCE_EXHAUSTED|UNAUTHENTICATED|PERMISSION_DENIED|agent executor error|Individual quota reached|code [45]\d{2}/i;

function extractErrorLines(text) {
  const out = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line && ERROR_SIGNAL.test(line)) out.push(line);
  }
  // De-duplicate consecutive repeats (agy logs the same error twice).
  return dedupe(out);
}

function classifyError(errorLines) {
  if (errorLines.length === 0) return null;
  const joined = errorLines.join("\n");

  if (/RESOURCE_EXHAUSTED|Individual quota reached/i.test(joined)) {
    const reset = joined.match(/Resets in ([0-9hms]+)/i);
    return {
      kind: "quota",
      message: "Antigravity quota exhausted (RESOURCE_EXHAUSTED 429).",
      resetsIn: reset ? reset[1] : null,
    };
  }

  if (/UNAUTHENTICATED|PERMISSION_DENIED/i.test(joined)) {
    return {
      kind: "auth",
      message: "Antigravity is not authenticated. Run `! agy` once to sign in.",
      resetsIn: null,
    };
  }

  // Generic backend failure: surface the most informative line.
  const informative =
    errorLines.find((l) => /agent executor error|code \d{3}/i.test(l)) || errorLines[errorLines.length - 1];
  return {
    kind: "backend",
    message: stripGlogPrefix(informative),
    resetsIn: null,
  };
}

function stripGlogPrefix(line) {
  // Turn "E0531 16:30:43.195032 38848 log.go:398] message" into "message".
  return String(line)
    .replace(/^[EFIW]\d{4}\s[\d:.]+\s+\d+\s+\S+\]\s*/, "")
    .trim();
}

function dedupe(lines) {
  // Strip glog prefixes, then drop any line whose message is a substring of a
  // longer kept line. agy logs the same error twice — once wrapped in
  // "agent executor error: <X>" and once as the bare "<X>" — so exact-key
  // de-duplication is not enough; we collapse to the most informative line.
  const keyed = lines.map((line) => ({ line, key: stripGlogPrefix(line) }));
  keyed.sort((a, b) => b.key.length - a.key.length);
  const kept = [];
  for (const item of keyed) {
    if (kept.some((k) => k.key === item.key || k.key.includes(item.key))) continue;
    kept.push(item);
  }
  return kept.map((k) => k.line);
}

/** Extract the stable `error:` marker agy writes to stderr for fatal headless errors. */
export function scanStderr(stderrText) {
  const text = typeof stderrText === "string" ? stderrText : "";
  if (!text.trim()) return { error: null, truncated: false, timedOut: false };

  // Literal format strings in the agy binary:
  //   "error: %s (response may be truncated)"
  //   "[agy] print timeout after %s with turn in progress; returning partial output"
  const timedOut = /print timeout after .* returning partial output/i.test(text);
  const marker = text.match(/^\s*error:\s*(.+?)\s*(\(response may be truncated\))?\s*$/im);

  // Not everything agy refuses carries that marker. Argument parsing happens before the
  // marker exists, so a bad flag prints `flags provided but not defined: -base` followed
  // by the whole usage block and exits 2. Keeping only the first line turns a bare
  // "agy exited with code 2" into the sentence agy already wrote.
  const firstLine =
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !/^usage of/i.test(l) && !/^\[agy\] print timeout/i.test(l)) || null;

  return {
    error: marker ? marker[1].trim() : null,
    firstLine,
    truncated: Boolean(marker && marker[2]) || timedOut,
    timedOut,
  };
}

export { stripGlogPrefix, extractConversationId };
