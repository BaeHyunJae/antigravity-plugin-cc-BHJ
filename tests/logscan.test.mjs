import { test } from "node:test";
import assert from "node:assert/strict";
import { scanAgyLog, stripGlogPrefix, scanStderr } from "../plugins/antigravity/scripts/lib/logscan.mjs";

const QUOTA_LOG = `I0531 16:30:42 1 server.go:755] Created conversation d112284b-3fbb-40bc-b559-5770aa771494
I0531 16:30:42 1 printmode.go:130] Print mode: conversation=d112284b-3fbb-40bc-b559-5770aa771494, sending message
E0531 16:30:43.195032 38848 log.go:398] agent executor error: RESOURCE_EXHAUSTED (code 429): Individual quota reached. Contact your administrator to enable overages. Resets in 152h59m39s.
E0531 16:30:43.196093 38848 log.go:398] RESOURCE_EXHAUSTED (code 429): Individual quota reached. Contact your administrator to enable overages. Resets in 152h59m39s.`;

test("extracts conversation id from 'Created conversation'", () => {
  const r = scanAgyLog(QUOTA_LOG);
  assert.equal(r.conversationId, "d112284b-3fbb-40bc-b559-5770aa771494");
});

test("falls back to conversation= form", () => {
  const r = scanAgyLog("blah conversation=11112222-3333-4444-5555-666677778888 more");
  assert.equal(r.conversationId, "11112222-3333-4444-5555-666677778888");
});

test("classifies quota exhaustion and parses reset window", () => {
  const r = scanAgyLog(QUOTA_LOG);
  assert.equal(r.error.kind, "quota");
  assert.equal(r.error.resetsIn, "152h59m39s");
});

test("deduplicates the repeated quota error line", () => {
  const r = scanAgyLog(QUOTA_LOG);
  assert.equal(r.errorLines.length, 1);
});

test("classifies auth errors", () => {
  const r = scanAgyLog("E0101 00:00:00 1 log.go:1] UNAUTHENTICATED (code 401): login required");
  assert.equal(r.error.kind, "auth");
});

test("classifies generic backend errors and strips glog prefix", () => {
  const r = scanAgyLog("E0101 00:00:00.0 5 log.go:9] agent executor error: INTERNAL (code 500): boom");
  assert.equal(r.error.kind, "backend");
  assert.match(r.error.message, /agent executor error/);
  assert.doesNotMatch(r.error.message, /log\.go/);
});

test("returns null error on clean log", () => {
  const r = scanAgyLog("I0101 00:00:00 1 server.go:1] all good\nCreated conversation aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  assert.equal(r.error, null);
  assert.equal(r.conversationId, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
});

test("stripGlogPrefix is a no-op on plain text", () => {
  assert.equal(stripGlogPrefix("just a message"), "just a message");
});

// Verbatim from the log of a run that SUCCEEDED on agy 1.2.x. Startup races make
// the CLI write dozens of E-severity "not logged in" lines and several lines that
// merely mention quota, before it goes on to answer normally. Treating severity or
// the bare word "quota" as an error signal turns every fallback-path run into a
// confident, wrong diagnosis.
const HEALTHY_STARTUP_NOISE = `I0916 12:58:08.340847 1 server.go:755] Created conversation 414df2a0-9983-4cbe-aae9-152f6dbe6402
E0916 12:58:08.349847 104 errorreport.go:224] error getting token source: You are not logged into Antigravity.
E0916 12:58:08.350347 104 errorreport.go:224] Failed to poll ListExperiments: error getting token source: You are not logged into Antigravity.
E0916 12:58:08.351347 85 errorreport.go:224] failed to get load code assist response: error getting token source: You are not logged into Antigravity.
I0916 12:58:08.486252 1 server_oauth.go:196] applyAuthResult: email=user@example.com, authMethod=consumer, quotaProject=
I0916 12:58:09.885489 285 quota_manager.go:45] doRefreshQuota: starting reload (force=true)
W0916 12:58:12.735946 285 cache.go:135] Cache(retrieveUserQuotaSummary): Singleflight refresh failed: Post "https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary": context canceled
I0916 12:58:13.001000 1 printmode.go:130] Print mode: done`;

test("a successful run's startup noise is not an error", () => {
  const r = scanAgyLog(HEALTHY_STARTUP_NOISE);
  assert.equal(r.error, null);
  assert.deepEqual(r.errorLines, []);
});

test("the conversation id is still recovered from a noisy log", () => {
  const r = scanAgyLog(HEALTHY_STARTUP_NOISE);
  assert.equal(r.conversationId, "414df2a0-9983-4cbe-aae9-152f6dbe6402");
});

test("a real quota failure is still caught inside the same noise", () => {
  const r = scanAgyLog(
    HEALTHY_STARTUP_NOISE +
      "\nE0916 12:58:14.0 1 log.go:398] agent executor error: RESOURCE_EXHAUSTED (code 429): Individual quota reached. Resets in 152h59m39s.",
  );
  assert.equal(r.error.kind, "quota");
  assert.equal(r.error.resetsIn, "152h59m39s");
});

// --- stderr ----------------------------------------------------------------

test("scanStderr extracts agy's stable error: marker", () => {
  const r = scanStderr("error: RESOURCE_EXHAUSTED (code 429): Individual quota reached.");
  assert.equal(r.error, "RESOURCE_EXHAUSTED (code 429): Individual quota reached.");
  assert.equal(r.truncated, false);
});

test("scanStderr flags the truncation note", () => {
  const r = scanStderr("error: stream ended early (response may be truncated)");
  assert.equal(r.error, "stream ended early");
  assert.equal(r.truncated, true);
});

test("scanStderr recognizes agy's own print-timeout partial output", () => {
  const r = scanStderr("[agy] print timeout after 8s with turn in progress; returning partial output");
  assert.equal(r.timedOut, true);
  assert.equal(r.truncated, true);
  assert.equal(r.error, null);
});

test("scanStderr keeps agy's own refusal when there is no error: marker", () => {
  // Argument parsing happens before that marker exists: a bad flag prints this and the
  // whole usage block, then exits 2. Without the fallback the companion reported only
  // "agy exited with code 2" and threw away the sentence agy had already written.
  const r = scanStderr("flags provided but not defined: -base\nUsage of agy.exe:\n  --add-dir   Add a directory\n");
  assert.equal(r.firstLine, "flags provided but not defined: -base");
  assert.equal(r.error, null, "there is no error: marker here");
});

test("scanStderr does not mistake the usage header or the timeout notice for the reason", () => {
  assert.equal(scanStderr("Usage of agy.exe:\n  --add-dir  x\n").firstLine, "--add-dir  x");
  assert.equal(scanStderr("[agy] print timeout after 8s with turn in progress; returning partial output\n").firstLine, null);
});

test("scanStderr is quiet on empty or noisy-but-fine stderr", () => {
  assert.deepEqual(scanStderr(""), { error: null, truncated: false, timedOut: false });
  assert.equal(scanStderr("loading plugins...\nready\n").error, null);
});
