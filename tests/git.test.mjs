import { test } from "node:test";
import assert from "node:assert/strict";
import { truncateDiff } from "../plugins/antigravity/scripts/lib/git.mjs";

function fileDiff(name, lines) {
  const body = Array.from({ length: lines }, (_, i) => `+line ${i} in ${name}`).join("\n");
  return `diff --git a/${name} b/${name}\nindex 1111111..2222222 100644\n--- a/${name}\n+++ b/${name}\n@@ -0,0 +1,${lines} @@\n${body}`;
}

const THREE_FILES = [fileDiff("a.js", 40), fileDiff("b.js", 40), fileDiff("c.js", 40)].join("\n");

test("a diff inside the budget is returned untouched", () => {
  const r = truncateDiff(THREE_FILES, 1024 * 1024);
  assert.equal(r.truncated, false);
  assert.equal(r.diff, THREE_FILES);
  assert.equal(r.totalFiles, 3);
  assert.equal(r.shownFiles, 3);
});

test("an oversized diff is cut at a file boundary, never mid-hunk", () => {
  // Enough room for roughly one file.
  const r = truncateDiff(THREE_FILES, Math.floor(Buffer.byteLength(THREE_FILES, "utf8") / 2));
  assert.equal(r.truncated, true);
  assert.equal(r.totalFiles, 3);
  assert.ok(r.shownFiles >= 1 && r.shownFiles < 3, `shownFiles was ${r.shownFiles}`);
  // Whatever survived must end at the close of a file, not part way through one.
  assert.ok(!r.diff.endsWith("diff --git"), "cut left a dangling header");
  const headers = r.diff.match(/^diff --git /gm) || [];
  assert.equal(headers.length, r.shownFiles);
});

test("the reported byte size actually respects the budget", () => {
  const budget = 400;
  const r = truncateDiff(THREE_FILES, budget);
  assert.ok(Buffer.byteLength(r.diff, "utf8") <= budget, "truncated diff still exceeds the budget");
});

test("a single file larger than the budget still yields something", () => {
  const one = fileDiff("huge.js", 500);
  const r = truncateDiff(one, 300);
  assert.equal(r.truncated, true);
  assert.ok(r.diff.length > 0, "dropped everything instead of keeping a partial file");
});

test("empty and missing diffs are handled", () => {
  for (const value of ["", null, undefined]) {
    const r = truncateDiff(value, 100);
    assert.equal(r.truncated, false);
    assert.equal(r.diff, "");
    assert.equal(r.totalFiles, 0);
  }
});
