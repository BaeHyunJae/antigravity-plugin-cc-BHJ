import { test } from "node:test";
import assert from "node:assert/strict";
import { renderResponse, renderError } from "../plugins/antigravity/scripts/lib/render.mjs";

const USAGE = { inputTokens: 30951, outputTokens: 44, thinkingTokens: 41, cacheReadTokens: 0, totalTokens: 30995 };

test("a fresh run reports how long it took", () => {
  const out = renderResponse("ok", { title: "t", conversationId: "c1", usage: USAGE, durationSeconds: 6.0, numTurns: 1 });
  assert.match(out, /6\.0s/);
  assert.match(out, /31k in \/ 44 out/);
});

test("a resumed run reports the turn instead of a misleading duration", () => {
  // Measured on agy 1.2.4: a 2-turn resume reported duration_seconds 2258.87 — wall
  // time since the conversation was created, not this turn. Printed next to this
  // turn's token counts it reads as "this took 38 minutes".
  const out = renderResponse("ok", { title: "t", conversationId: "c1", usage: USAGE, durationSeconds: 2258.87, numTurns: 2 });
  assert.doesNotMatch(out, /2258/);
  assert.match(out, /turn 2/);
  assert.match(out, /31k in \/ 44 out/);
});

test("a run that never reached the model prints no cost line", () => {
  const out = renderError(
    { kind: "backend", message: "invalid model selection", resetsIn: null },
    { title: "t", usage: { inputTokens: 0, outputTokens: 0, thinkingTokens: 0, cacheReadTokens: 0, totalTokens: 0 }, durationSeconds: 0 },
  );
  assert.doesNotMatch(out, /0\.0s/);
  assert.doesNotMatch(out, /0 in \/ 0 out/);
});

test("a truncated prompt is flagged above the answer", () => {
  const out = renderResponse("a review", {
    title: "review",
    promptNote: "Only 6 of 36 changed files fit in one prompt.",
  });
  const beforeAnswer = out.slice(0, out.indexOf("a review"));
  assert.match(beforeAnswer, /Only 6 of 36 changed files/);
  assert.match(beforeAnswer, /⚠️/);
});

test("a partly denied run flags the refusal next to the answer", () => {
  const out = renderResponse("partial answer", {
    title: "t",
    deniedActions: [{ action: "command", display_name: "RunCommand" }],
  });
  assert.match(out, /refused on permission grounds/i);
  assert.match(out, /RunCommand/);
  assert.match(out, /partial answer/);
});

test("permission failures explain how to unblock the run", () => {
  const out = renderError(
    { kind: "permission", message: "Antigravity refused a tool it lacked permission for: RunCommand (command).", resetsIn: null },
    { title: "t" },
  );
  assert.match(out, /RunCommand/);
  assert.match(out, /--no-yolo/);
  assert.match(out, /permissions\.allow/);
});

test("quota errors keep the reset window and do not repeat themselves", () => {
  const out = renderError({ kind: "quota", message: "Antigravity quota exhausted (RESOURCE_EXHAUSTED 429).", resetsIn: "152h59m39s" }, { title: "t" });
  assert.match(out, /152h59m39s/);
  // The heading already says it; the classifier's sentence should not be echoed too.
  assert.equal(out.match(/quota/gi).length <= 3, true, `quota repeated too often:\n${out}`);
});
