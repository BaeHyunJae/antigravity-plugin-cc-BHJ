import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, basename } from "node:path";

const COMMANDS = fileURLToPath(new URL("../plugins/antigravity/commands/", import.meta.url));

function frontmatter(file) {
  const text = readFileSync(file, "utf8");
  const end = text.indexOf("\n---", 4);
  return text.slice(0, end === -1 ? text.length : end);
}

function commandPolicy() {
  const policy = {};
  for (const name of readdirSync(COMMANDS).filter((n) => n.endsWith(".md"))) {
    const fm = frontmatter(join(COMMANDS, name));
    policy[basename(name, ".md")] = /^disable-model-invocation:\s*true\s*$/m.test(fm) ? "blocked" : "allowed";
  }
  return policy;
}

/**
 * Which commands Claude may fire on its own, mirroring codex-plugin-cc's policy.
 *
 * codex leaves exactly two open: its delegation command (`rescue`) and `setup`. Everything
 * else — review, and the job-management commands — is typed by a person. Continuation is
 * not a command there at all; it is a flag on the delegation command, which is why
 * `resume` stays blocked here while `delegate` carries `--continue`.
 *
 * Job-management commands are blocked because there is no reason for the model to spend
 * tokens polling them, and `review` because it builds a large prompt and burns preview
 * quota on a run the user did not ask for.
 */
const EXPECTED = {
  cancel: "blocked",
  delegate: "allowed",
  result: "blocked",
  resume: "blocked",
  review: "blocked",
  setup: "allowed",
  status: "blocked",
};

test("model-invocation policy matches the one decided for this plugin", () => {
  assert.deepEqual(commandPolicy(), EXPECTED);
});

test("every command declares the tools it needs", () => {
  for (const name of readdirSync(COMMANDS).filter((n) => n.endsWith(".md"))) {
    const fm = frontmatter(join(COMMANDS, name));
    assert.match(fm, /^description:/m, `${name} has no description`);
    assert.match(fm, /^allowed-tools:/m, `${name} has no allowed-tools`);
  }
});

test("delegate can reach the subagent and ask the user, because its flow needs both", () => {
  const fm = frontmatter(join(COMMANDS, "delegate.md"));
  assert.match(fm, /allowed-tools:.*Agent/, "delegate must be able to invoke the antigravity-pair subagent");
  assert.match(fm, /allowed-tools:.*AskUserQuestion/, "delegate asks before continuing an existing thread");
});
