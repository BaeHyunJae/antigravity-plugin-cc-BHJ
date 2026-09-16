import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJob, writeJob, resolveResumeTarget, currentSessionId } from "../plugins/antigravity/scripts/lib/jobs.mjs";

function freshHome() {
  return { ANTIGRAVITY_CC_HOME: mkdtempSync(join(tmpdir(), "agy-jobs-")) };
}

/** A finished job with a conversation, as runAgyTask leaves one behind. */
function finishedJob(env, cwd, { title, conversationId, sessionId }) {
  const job = createJob({ kind: "delegate", title, prompt: title, cwd, sessionId }, env);
  job.status = "done";
  job.conversationId = conversationId;
  job.finishedAt = new Date().toISOString();
  writeJob(job);
  return job;
}

test("no jobs means nothing to continue", () => {
  const env = freshHome();
  assert.equal(resolveResumeTarget(mkdtempSync(join(tmpdir(), "agy-cwd-")), env).status, "none");
});

test("the newest finished conversation in this directory is the target", () => {
  const env = freshHome();
  const cwd = mkdtempSync(join(tmpdir(), "agy-cwd-"));
  finishedJob(env, cwd, { title: "older", conversationId: "conv-old" });
  const newer = finishedJob(env, cwd, { title: "newer", conversationId: "conv-new" });

  const t = resolveResumeTarget(cwd, env);
  assert.equal(t.status, "ok");
  assert.equal(t.conversationId, "conv-new");
  assert.equal(t.job.id, newer.id);
});

test("a job from another directory is not offered", () => {
  const env = freshHome();
  const mine = mkdtempSync(join(tmpdir(), "agy-cwd-"));
  const theirs = mkdtempSync(join(tmpdir(), "agy-cwd-"));
  finishedJob(env, theirs, { title: "elsewhere", conversationId: "conv-elsewhere" });
  assert.equal(resolveResumeTarget(mine, env).status, "none");
});

test("a job from another Claude session is not offered", () => {
  // The whole point of the session tag: without it, continuing picks up whatever thread
  // happened to run last in this directory, including another session's work.
  const env = { ...freshHome(), CLAUDE_CODE_SESSION_ID: "session-A" };
  const cwd = mkdtempSync(join(tmpdir(), "agy-cwd-"));
  finishedJob(env, cwd, { title: "other session", conversationId: "conv-B", sessionId: "session-B" });
  assert.equal(resolveResumeTarget(cwd, env).status, "none");
});

test("a job from this Claude session is offered", () => {
  const env = { ...freshHome(), CLAUDE_CODE_SESSION_ID: "session-A" };
  const cwd = mkdtempSync(join(tmpdir(), "agy-cwd-"));
  finishedJob(env, cwd, { title: "mine", conversationId: "conv-A", sessionId: "session-A" });
  const t = resolveResumeTarget(cwd, env);
  assert.equal(t.status, "ok");
  assert.equal(t.conversationId, "conv-A");
});

test("jobs recorded before session tagging stay reachable", () => {
  // Existing history has no sessionId. Filtering it out would make a user's own recent
  // work unreachable the first time they upgrade.
  const env = { ...freshHome(), CLAUDE_CODE_SESSION_ID: "session-A" };
  const cwd = mkdtempSync(join(tmpdir(), "agy-cwd-"));
  const job = finishedJob(env, cwd, { title: "legacy", conversationId: "conv-legacy" });
  const metaPath = join(job.paths.dir, "meta.json");
  const meta = JSON.parse(readFileSync(metaPath, "utf8"));
  delete meta.sessionId;
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));

  const t = resolveResumeTarget(cwd, env);
  assert.equal(t.status, "ok");
  assert.equal(t.conversationId, "conv-legacy");
});

test("a job still running blocks continuing, rather than forking the thread", () => {
  const env = freshHome();
  const cwd = mkdtempSync(join(tmpdir(), "agy-cwd-"));
  const job = finishedJob(env, cwd, { title: "in flight", conversationId: "conv-live" });
  job.status = "running";
  job.pid = process.pid; // this test's own process, so isAlive() is genuinely true
  writeJob(job);

  const t = resolveResumeTarget(cwd, env);
  assert.equal(t.status, "running");
  assert.equal(t.job.id, job.id);
});

test("a finished job with no conversation id is not a resume target", () => {
  const env = freshHome();
  const cwd = mkdtempSync(join(tmpdir(), "agy-cwd-"));
  finishedJob(env, cwd, { title: "no thread", conversationId: null });
  assert.equal(resolveResumeTarget(cwd, env).status, "none");
});

test("createJob stamps the current Claude session", () => {
  const env = { ...freshHome(), CLAUDE_CODE_SESSION_ID: "session-Z" };
  const job = createJob({ kind: "delegate", title: "t", cwd: "/x" }, env);
  assert.equal(job.sessionId, "session-Z");
  assert.equal(currentSessionId(env), "session-Z");
});
