import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPrintArgs,
  goDurationToMs,
  isVersionAtLeast,
  MIN_AGY_VERSION,
  RESERVED_AGY_FLAGS,
  promptBudget,
} from "../plugins/antigravity/scripts/lib/agy.mjs";

test("buildPrintArgs puts -p <prompt> LAST", () => {
  const args = buildPrintArgs({
    prompt: "do the thing",
    yolo: true,
    logFile: "/tmp/x.log",
    printTimeout: "10m",
    addDirs: ["/repo"],
  });
  assert.equal(args[args.length - 2], "-p");
  assert.equal(args[args.length - 1], "do the thing");
});

test("buildPrintArgs includes expected flags in order (flags before prompt)", () => {
  const args = buildPrintArgs({
    prompt: "p",
    sandbox: true,
    yolo: true,
    addDirs: ["/a", "/b"],
    conversationId: "conv-1",
    logFile: "/l",
    printTimeout: "5m",
  });
  assert.deepEqual(args, [
    "--sandbox",
    "--dangerously-skip-permissions",
    "--add-dir",
    "/a",
    "--add-dir",
    "/b",
    "--conversation",
    "conv-1",
    "--log-file",
    "/l",
    "--print-timeout",
    "5m",
    "--output-format",
    "json",
    "-p",
    "p",
  ]);
});

test("buildPrintArgs always requests the JSON envelope", () => {
  const args = buildPrintArgs({ prompt: "x" });
  const i = args.indexOf("--output-format");
  assert.notEqual(i, -1);
  assert.equal(args[i + 1], "json");
});

test("continueLast adds --continue", () => {
  const args = buildPrintArgs({ prompt: "x", continueLast: true });
  assert.ok(args.includes("--continue"));
});

test("model and effort are forwarded verbatim", () => {
  const args = buildPrintArgs({ prompt: "x", model: "gemini-3.1-pro-high", effort: "high" });
  assert.equal(args[args.indexOf("--model") + 1], "gemini-3.1-pro-high");
  assert.equal(args[args.indexOf("--effort") + 1], "high");
});

test("slash command expansion stays on unless explicitly disabled", () => {
  assert.ok(!buildPrintArgs({ prompt: "x" }).includes("--disable-slash-commands"));
  assert.ok(buildPrintArgs({ prompt: "x", noSlashCommands: true }).includes("--disable-slash-commands"));
});

test("extraArgs pass through immediately before the prompt", () => {
  const args = buildPrintArgs({ prompt: "x", extraArgs: ["--mode", "plan"] });
  assert.deepEqual(args.slice(-4), ["--mode", "plan", "-p", "x"]);
});

test("RESERVED_AGY_FLAGS covers the flags the companion owns", () => {
  for (const flag of ["-p", "--print", "--prompt", "--log-file", "--output-format", "--input-format"]) {
    assert.ok(RESERVED_AGY_FLAGS.has(flag), `${flag} should be reserved`);
  }
});

test("isVersionAtLeast compares semver and fails closed on garbage", () => {
  assert.equal(isVersionAtLeast("1.2.3", MIN_AGY_VERSION), true);
  assert.equal(isVersionAtLeast("1.1.10", MIN_AGY_VERSION), true);
  assert.equal(isVersionAtLeast("1.1.9", MIN_AGY_VERSION), false);
  assert.equal(isVersionAtLeast("not-a-version", MIN_AGY_VERSION), false);
  assert.equal(isVersionAtLeast(null, MIN_AGY_VERSION), false);
});

// --- command-line budget ---------------------------------------------------

test("promptBudget leaves POSIX alone", () => {
  const args = buildPrintArgs({ prompt: "", logFile: "/tmp/x.log", addDirs: ["/repo"] });
  assert.equal(promptBudget({ bin: "/usr/local/bin/agy", args, platform: "linux", ceiling: 100 * 1024 }), 100 * 1024);
});

test("promptBudget keeps a Windows command line under the OS limit", () => {
  // Measured: 32,648 bytes of prompt is the most that spawns on Windows 11; past
  // that the run dies with ENAMETOOLONG before agy starts. The whole command line,
  // not just the prompt, has to fit in 32,767.
  const bin = "C:\\Users\\someone\\AppData\\Local\\agy\\bin\\agy.exe";
  const args = buildPrintArgs({
    prompt: "",
    logFile: "C:\\Users\\someone\\.antigravity-cc\\jobs\\agy-abcdefgh-123456\\agy.log",
    addDirs: ["C:\\Users\\someone\\Repos\\03. AX\\antigravity-plugin-cc"],
    yolo: true,
    sandbox: true,
    printTimeout: "10m",
  });
  const budget = promptBudget({ bin, args, platform: "win32", ceiling: 100 * 1024 });
  const overhead = [bin, ...args].reduce((n, a) => n + Buffer.byteLength(a, "utf8") + 3, 0);

  assert.ok(budget < 100 * 1024, "Windows budget should be below the generic ceiling");
  assert.ok(budget + overhead < 32767, `budget ${budget} + overhead ${overhead} must fit the OS limit`);
});

test("promptBudget never returns a useless budget, however long the flags get", () => {
  const args = buildPrintArgs({ prompt: "", addDirs: Array.from({ length: 400 }, (_, i) => `C:\\dir\\${"x".repeat(60)}\\${i}`) });
  const budget = promptBudget({ bin: "C:\\agy.exe", args, platform: "win32", ceiling: 100 * 1024 });
  assert.ok(budget >= 1024, `budget collapsed to ${budget}`);
});

test("goDurationToMs parses composite and simple durations", () => {
  assert.equal(goDurationToMs("5m0s"), 300000);
  assert.equal(goDurationToMs("90s"), 90000);
  assert.equal(goDurationToMs("10m"), 600000);
  assert.equal(goDurationToMs("1h"), 3600000);
});

test("goDurationToMs falls back on garbage", () => {
  assert.equal(goDurationToMs("not-a-duration", 123), 123);
  assert.equal(goDurationToMs("", 456), 456);
});
