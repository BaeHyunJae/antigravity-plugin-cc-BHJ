import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, hasFlag, validateExtraArgs } from "../plugins/antigravity/scripts/lib/args.mjs";
import { RESERVED_AGY_FLAGS } from "../plugins/antigravity/scripts/lib/agy.mjs";

test("parses boolean flags and positional text", () => {
  const p = parseArgs(["--background", "fix", "the", "auth", "bug"]);
  assert.equal(p.flags.background, true);
  assert.equal(p.text, "fix the auth bug");
});

test("parses valued flags", () => {
  const p = parseArgs(["--base", "main", "--print-timeout", "20m", "look", "for", "races"]);
  assert.equal(p.valued.base, "main");
  assert.equal(p.valued["print-timeout"], "20m");
  assert.equal(p.text, "look for races");
});

test("supports --flag=value form", () => {
  const p = parseArgs(["--base=develop"]);
  assert.equal(p.valued.base, "develop");
});

test("collects repeatable --add-dir", () => {
  const p = parseArgs(["--add-dir", "../shared", "--add-dir", "../proto", "do it"]);
  assert.deepEqual(p.repeated["add-dir"], ["../shared", "../proto"]);
  assert.equal(p.text, "do it");
});

test("maps short -c to continue", () => {
  const p = parseArgs(["-c", "keep going"]);
  assert.equal(p.flags.continue, true);
  assert.equal(p.text, "keep going");
});

test("-- forces remaining tokens to positional", () => {
  const p = parseArgs(["--background", "--", "--not-a-flag", "text"]);
  assert.equal(p.flags.background, true);
  assert.equal(p.text, "--not-a-flag text");
});

test("does not treat negative numbers as flags", () => {
  const p = parseArgs(["offset", "-3", "lines"]);
  assert.equal(p.text, "offset -3 lines");
});

test("hasFlag matches any alias", () => {
  const p = parseArgs(["--wait"]);
  assert.equal(hasFlag(p, "background", "wait"), true);
  assert.equal(hasFlag(p, "background"), false);
});

test("parses --effort as a valued flag", () => {
  const p = parseArgs(["--effort", "high", "think hard"]);
  assert.equal(p.valued.effort, "high");
  assert.equal(p.text, "think hard");
});

test("collects repeatable --agy-arg one token at a time", () => {
  const p = parseArgs(["--agy-arg", "--mode", "--agy-arg", "plan", "do it"]);
  assert.deepEqual(p.repeated["agy-arg"], ["--mode", "plan"]);
  assert.equal(p.text, "do it");
});

test("--no-slash-commands is a boolean flag", () => {
  const p = parseArgs(["--no-slash-commands", "run /foo literally"]);
  assert.equal(hasFlag(p, "no-slash-commands"), true);
  assert.equal(p.text, "run /foo literally");
});

test("validateExtraArgs accepts flags the companion does not own", () => {
  const r = validateExtraArgs(["--mode", "plan", "--agent", "reviewer"], RESERVED_AGY_FLAGS);
  assert.equal(r.ok, true);
  assert.deepEqual(r.rejected, []);
});

test("validateExtraArgs rejects flags that would break the companion contract", () => {
  for (const flag of ["-p", "--prompt", "--log-file", "--output-format", "--input-format"]) {
    const r = validateExtraArgs([flag, "x"], RESERVED_AGY_FLAGS);
    assert.equal(r.ok, false, flag);
    assert.deepEqual(r.rejected, [flag]);
  }
});

test("validateExtraArgs rejects the --flag=value form too", () => {
  const r = validateExtraArgs(["--output-format=text"], RESERVED_AGY_FLAGS);
  assert.equal(r.ok, false);
  assert.deepEqual(r.rejected, ["--output-format"]);
});

test("validateExtraArgs handles an empty list", () => {
  assert.equal(validateExtraArgs([], RESERVED_AGY_FLAGS).ok, true);
  assert.equal(validateExtraArgs(undefined, RESERVED_AGY_FLAGS).ok, true);
});
