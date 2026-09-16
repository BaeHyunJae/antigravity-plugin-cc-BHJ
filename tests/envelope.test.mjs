import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEnvelope, isSuccess, isCancelled } from "../plugins/antigravity/scripts/lib/envelope.mjs";

const SUCCESS = JSON.stringify({
  conversation_id: "d112284b-3fbb-40bc-b559-5770aa771494",
  status: "SUCCESS",
  response: "Here is the answer.",
  duration_seconds: 12.4,
  num_turns: 2,
  usage: {
    input_tokens: 8213,
    output_tokens: 1104,
    thinking_tokens: 256,
    cache_read_tokens: 64,
    total_tokens: 9637,
  },
});

test("parses a successful envelope", () => {
  const e = parseEnvelope(SUCCESS);
  assert.equal(e.ok, true);
  assert.equal(e.status, "SUCCESS");
  assert.equal(e.conversationId, "d112284b-3fbb-40bc-b559-5770aa771494");
  assert.equal(e.response, "Here is the answer.");
  assert.equal(e.durationSeconds, 12.4);
  assert.equal(e.usage.inputTokens, 8213);
  assert.equal(e.usage.totalTokens, 9637);
  assert.equal(isSuccess(e), true);
});

test("an ERROR status is not a success even with a response", () => {
  const e = parseEnvelope(
    JSON.stringify({ status: "ERROR", response: "partial", error: "INTERNAL (code 500): boom" }),
  );
  assert.equal(e.ok, true);
  assert.equal(e.error, "INTERNAL (code 500): boom");
  assert.equal(isSuccess(e), false);
});

test("an error field beats a SUCCESS status", () => {
  const e = parseEnvelope(JSON.stringify({ status: "SUCCESS", response: "x", error: "quota gone" }));
  assert.equal(isSuccess(e), false);
});

test("CANCELED and INTERRUPTED are distinguished from failure", () => {
  for (const status of ["CANCELED", "CANCELLED", "INTERRUPTED"]) {
    const e = parseEnvelope(JSON.stringify({ status, response: "half an answer" }));
    assert.equal(isCancelled(e), true, status);
    assert.equal(isSuccess(e), false, status);
  }
});

test("a missing status with a response still counts as success", () => {
  // Guards against a field rename turning a good reply into an error.
  const e = parseEnvelope(JSON.stringify({ response: "an answer" }));
  assert.equal(isSuccess(e), true);
});

test("empty stdout is a parse failure, not a throw", () => {
  const e = parseEnvelope("");
  assert.equal(e.ok, false);
  assert.equal(e.parseError, "empty stdout");
  assert.equal(isSuccess(e), false);
});

test("non-JSON stdout is a parse failure, not a throw", () => {
  const e = parseEnvelope("this is not json at all");
  assert.equal(e.ok, false);
  assert.match(e.parseError, /not a JSON object/);
});

test("non-string input is handled", () => {
  assert.equal(parseEnvelope(undefined).ok, false);
  assert.equal(parseEnvelope(null).ok, false);
});

test("a JSON array is rejected", () => {
  const e = parseEnvelope("[1,2,3]");
  assert.equal(e.ok, false);
});

test("recovers an envelope wrapped in stray output", () => {
  const e = parseEnvelope(`warning: something\n${SUCCESS}\n`);
  assert.equal(e.ok, true);
  assert.equal(e.response, "Here is the answer.");
});

test("usage is null when the field is absent or empty", () => {
  assert.equal(parseEnvelope(JSON.stringify({ status: "SUCCESS", response: "x" })).usage, null);
  assert.equal(parseEnvelope(JSON.stringify({ status: "SUCCESS", usage: {} })).usage, null);
});

test("denied_actions passes through when present", () => {
  const e = parseEnvelope(JSON.stringify({ status: "SUCCESS", response: "x", denied_actions: ["Bash"] }));
  assert.deepEqual(e.deniedActions, ["Bash"]);
});
