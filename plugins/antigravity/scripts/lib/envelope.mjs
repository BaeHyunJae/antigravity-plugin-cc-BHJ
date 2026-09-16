// Parse the JSON envelope agy prints under `--output-format json`.
//
// Grounded against agy 1.2.4 and the official headless docs. Shape:
//
//   {
//     "conversation_id":  "<uuid>",
//     "status":           "SUCCESS" | "ERROR" | "CANCELED" | "INTERRUPTED"
//                       | "INVALID" | "WAITING" | "RUNNING",
//     "response":         "<final agent message>",
//     "error":            "<message>",              // only on failure
//     "duration_seconds": 12.4,
//     "num_turns":        3,
//     "usage": { "input_tokens", "output_tokens", "thinking_tokens",
//                "cache_read_tokens", "total_tokens" },
//     "structured_output": {...}, "json_schema": {...}   // only with --json-schema
//   }
//
// `denied_actions` is described in the agy 1.1.27 changelog ("report them as
// denied_actions in the JSON output") but is not on the documented envelope page.
// It belongs to agy's own permission gate (`toolPermission` in settings.json), not to
// tool failures in general: a run where `write_to_file` was refused by the OS came back
// as `status: "SUCCESS"` with no such field and the refusal only mentioned in the prose
// of `response`. So we pass it through when it is there and never depend on it — and we
// cannot treat its absence as "nothing was refused". See docs/antigravity-cli-reference.md.
//
// This module never throws: unparseable input comes back as `ok: false`.

/** Envelope statuses that mean the turn produced a usable answer. */
const SUCCESS_STATUSES = new Set(["SUCCESS"]);
/** Statuses that mean the user (or a signal) stopped the turn, not a backend failure. */
const CANCELLED_STATUSES = new Set(["CANCELED", "CANCELLED", "INTERRUPTED"]);

function coerceUsage(raw) {
  if (!raw || typeof raw !== "object") return null;
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const usage = {
    inputTokens: num(raw.input_tokens),
    outputTokens: num(raw.output_tokens),
    thinkingTokens: num(raw.thinking_tokens),
    cacheReadTokens: num(raw.cache_read_tokens),
    totalTokens: num(raw.total_tokens),
  };
  return Object.values(usage).some((v) => v !== null) ? usage : null;
}

/** Pull the outermost JSON object out of text that may carry stray leading output. */
function extractJsonObject(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

/**
 * @param {string} stdout raw stdout of an `agy -p --output-format json` run
 * @returns {{
 *   ok: boolean,
 *   status: string|null,
 *   conversationId: string|null,
 *   response: string,
 *   error: string|null,
 *   usage: object|null,
 *   durationSeconds: number|null,
 *   numTurns: number|null,
 *   structuredOutput: unknown,
 *   deniedActions: unknown[]|null,
 *   parseError: string|null,
 *   raw: object|null
 * }}
 */
export function parseEnvelope(stdout) {
  const empty = {
    ok: false,
    status: null,
    conversationId: null,
    response: "",
    error: null,
    usage: null,
    durationSeconds: null,
    numTurns: null,
    structuredOutput: undefined,
    deniedActions: null,
    parseError: null,
    raw: null,
  };

  const text = typeof stdout === "string" ? stdout.trim() : "";
  if (!text) return { ...empty, parseError: "empty stdout" };

  let obj = null;
  try {
    obj = JSON.parse(text);
  } catch {
    const slice = extractJsonObject(text);
    if (slice) {
      try {
        obj = JSON.parse(slice);
      } catch {
        /* fall through */
      }
    }
  }

  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return { ...empty, parseError: "stdout was not a JSON object" };
  }

  return {
    ok: true,
    status: typeof obj.status === "string" ? obj.status : null,
    conversationId: typeof obj.conversation_id === "string" ? obj.conversation_id : null,
    response: typeof obj.response === "string" ? obj.response : "",
    error: typeof obj.error === "string" && obj.error.trim() ? obj.error.trim() : null,
    usage: coerceUsage(obj.usage),
    durationSeconds: typeof obj.duration_seconds === "number" ? obj.duration_seconds : null,
    numTurns: typeof obj.num_turns === "number" ? obj.num_turns : null,
    structuredOutput: obj.structured_output,
    deniedActions: Array.isArray(obj.denied_actions) ? obj.denied_actions : null,
    parseError: null,
    raw: obj,
  };
}

/**
 * True when the run produced nothing because agy's permission gate refused its tools.
 *
 * Measured on 1.2.4 with `toolPermission: strict`:
 *   {"status":"SUCCESS","response":"","denied_actions":[{"action":"command",...}]}
 * No error field, and the status says SUCCESS. `denied_actions` is a failure signal in
 * its own right, independent of the exit code, the status and the error.
 */
export function isFullyDenied(envelope) {
  return Boolean(
    envelope && envelope.ok && envelope.deniedActions && envelope.deniedActions.length && !envelope.response.trim(),
  );
}

/** "RunCommand (command), WriteFile (write)" out of agy's denied_actions entries. */
export function describeDenied(denied) {
  const names = (denied || [])
    .map((d) => {
      if (!d || typeof d !== "object") return String(d);
      const label = d.display_name || d.action;
      return d.display_name && d.action && d.display_name !== d.action ? `${d.display_name} (${d.action})` : label;
    })
    .filter(Boolean);
  return `Antigravity refused ${names.length === 1 ? "a tool" : "tools"} it lacked permission for: ${names.join(", ")}.`;
}

/** True when the envelope reports a turn that produced a usable answer. */
export function isSuccess(envelope) {
  if (!envelope || !envelope.ok) return false;
  // Every caller asking "did this succeed" means "is there a usable answer", and a
  // fully denied run has none — however cheerful its status field is.
  if (isFullyDenied(envelope)) return false;
  // A missing status with a non-empty response is still a usable answer: older
  // builds and future field renames should not turn a good reply into an error.
  if (envelope.status === null) return Boolean(envelope.response.trim()) && !envelope.error;
  return SUCCESS_STATUSES.has(envelope.status) && !envelope.error;
}

/** True when the turn was stopped rather than having failed server-side. */
export function isCancelled(envelope) {
  return Boolean(envelope && envelope.ok && envelope.status && CANCELLED_STATUSES.has(envelope.status));
}

export { SUCCESS_STATUSES, CANCELLED_STATUSES };
