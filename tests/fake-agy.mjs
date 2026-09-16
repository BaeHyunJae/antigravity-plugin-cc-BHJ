#!/usr/bin/env node
// Test fixture imitating `agy` print-mode behavior closely enough to exercise the
// companion end-to-end without auth, quota, or a network.
//
// Grounded against agy 1.2.4: the companion always passes `--output-format json`,
// so every mode below either prints the JSON envelope or deliberately does not.
//
// Modes via FAKE_AGY_MODE env:
//   success (default) -> envelope with status SUCCESS, exit 0
//   quota             -> exit 1 + stderr `error:` marker + RESOURCE_EXHAUSTED in the log
//   auth              -> exit 1 + stderr `error:` marker + auth failure in the log
//   envelope-error    -> exit 0 but the envelope reports status ERROR
//                        (agy 1.1.20 limited exit codes to cascade-level failures,
//                         so exit 0 does NOT mean the turn succeeded)
//   silent            -> exit 0, nothing on stdout or stderr, error only in the log
//                        (reported upstream for non-TTY pipes — the log-scan fallback)
//   timeout-partial   -> exit 0, partial response + agy's print-timeout warning on stderr

import { writeFileSync } from "node:fs";

const argv = process.argv.slice(2);

if (argv.includes("--version")) {
  process.stdout.write(`${process.env.FAKE_AGY_VERSION || "1.2.4-fake"}\n`);
  process.exit(0);
}

function valueOf(flag) {
  const i = argv.indexOf(flag);
  return i !== -1 ? argv[i + 1] : null;
}

const logFile = valueOf("--log-file");
// prompt is the last token (companion always puts `-p <prompt>` last)
const prompt = argv[argv.length - 1];
const convId = "abcd1234-ef56-7890-abcd-1234567890ef";
const mode = process.env.FAKE_AGY_MODE || "success";

// Real 1.2.x logs are full of startup-race noise even when the run succeeds:
// E-severity "not logged in" lines and several lines that merely mention quota.
// The fixture reproduces it so the log scan is always exercised against the real
// signal-to-noise ratio, not a clean laboratory log.
const STARTUP_NOISE = [
  "E0101 00:00:00.000003 104 errorreport.go:224] error getting token source: You are not logged into Antigravity.",
  "E0101 00:00:00.000004 104 errorreport.go:224] Failed to poll ListExperiments: error getting token source: You are not logged into Antigravity.",
  "I0101 00:00:00.000005 1 server_oauth.go:196] applyAuthResult: email=user@example.com, authMethod=consumer, quotaProject=",
  "I0101 00:00:00.000006 285 quota_manager.go:45] doRefreshQuota: starting reload (force=true)",
  "W0101 00:00:00.000007 285 cache.go:135] Cache(retrieveUserQuotaSummary): Singleflight refresh failed: context canceled",
].join("\n");

const baseLog = `I0101 00:00:00.000000 1 server.go:755] Created conversation ${convId}\nI0101 00:00:00.000001 1 printmode.go:130] Print mode: starting (promptLength=${String(prompt || "").length}, conversationID="${convId}")\n${STARTUP_NOISE}\n`;

function writeLog(extra = "") {
  if (logFile) writeFileSync(logFile, baseLog + extra);
}

function envelope(overrides) {
  return JSON.stringify(
    {
      conversation_id: convId,
      status: "SUCCESS",
      response: "",
      duration_seconds: 12.4,
      num_turns: 1,
      usage: {
        input_tokens: 8213,
        output_tokens: 1104,
        thinking_tokens: 256,
        cache_read_tokens: 0,
        total_tokens: 9573,
      },
      ...overrides,
    },
    null,
    2,
  );
}

function replyText() {
  const echo = String(prompt || "").slice(0, 60).replace(/\s+/g, " ");
  const model = valueOf("--model");
  const effort = valueOf("--effort");
  const notes = [model ? ` model=${model}.` : "", effort ? ` effort=${effort}.` : ""].join("");
  return `Antigravity (fake) reply.${notes} I received: "${echo}". Verdict: looks good.`;
}

if (mode === "quota") {
  writeLog(
    "E0101 00:00:00.000002 1 log.go:398] agent executor error: RESOURCE_EXHAUSTED (code 429): Individual quota reached. Contact your administrator to enable overages. Resets in 152h59m39s.\n",
  );
  process.stderr.write("error: RESOURCE_EXHAUSTED (code 429): Individual quota reached.\n");
  process.exit(1);
}

if (mode === "auth") {
  writeLog(
    "E0101 00:00:00.000002 1 log.go:398] agent executor error: UNAUTHENTICATED (code 401): request is missing required authentication credential.\n",
  );
  process.stderr.write("error: UNAUTHENTICATED (code 401): request is missing required authentication credential.\n");
  process.exit(1);
}

if (mode === "denied" || mode === "denied-partial") {
  // Verbatim shape of a real agy 1.2.4 run blocked by `toolPermission: strict`:
  // status SUCCESS, an EMPTY response, no error field, refusals only in denied_actions.
  writeLog();
  const actions = [{ action: "command", display_name: "RunCommand" }];
  process.stdout.write(
    envelope({
      status: "SUCCESS",
      response: mode === "denied-partial" ? "I read the files, but could not run the tests." : "",
      denied_actions: actions,
    }) + "\n",
  );
  process.stderr.write(
    'jetski: no output produced — a tool required the "command" permission that headless mode cannot prompt for, so it was auto-denied.\n',
  );
  process.exit(0);
}

if (mode === "flag-error") {
  // Verbatim shape of a real agy 1.2.4 flag-validation failure:
  // `agy --model gemini-3.8-flash-low --effort high -p ...` exits 1 with this
  // envelope and this stderr line, and writes only startup noise to the log.
  const message =
    'invalid model selection (--model "gemini-3.8-flash-low" --effort "high"): --model gemini-3.8-flash-low conflicts with --effort=high';
  writeLog();
  process.stdout.write(envelope({ conversation_id: "", status: "ERROR", error: message, duration_seconds: 0, num_turns: 0 }) + "\n");
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}

if (mode === "envelope-error") {
  writeLog();
  process.stdout.write(
    envelope({ status: "ERROR", error: "agent executor error: INTERNAL (code 500): backend unavailable" }) + "\n",
  );
  process.exit(0); // exit code says nothing — the envelope carries the failure
}

if (mode === "silent") {
  writeLog("E0101 00:00:00.000002 1 log.go:398] agent executor error: INTERNAL (code 500): boom\n");
  process.exit(0); // no stdout, no stderr: only the log knows
}

if (mode === "timeout-partial") {
  writeLog();
  process.stdout.write(envelope({ response: "Partial answer before the timeout" }) + "\n");
  process.stderr.write("[agy] print timeout after 8s with turn in progress; returning partial output\n");
  process.exit(0);
}

// success
writeLog();
process.stdout.write(envelope({ response: replyText() }) + "\n");
process.exit(0);
