#!/usr/bin/env node
// Test fixture that imitates the real `agy` print-mode behavior closely enough to
// exercise the companion end-to-end without auth or quota.
//
// Modes via FAKE_AGY_MODE env:
//   success (default) -> writes conversation id to --log-file, prints a response
//   quota             -> writes conversation id + RESOURCE_EXHAUSTED error, prints NOTHING, exit 0
//                        (this mirrors the real grounded behavior on quota exhaustion)
//   auth              -> writes UNAUTHENTICATED error, prints nothing, exit 0

import { writeFileSync } from "node:fs";

const argv = process.argv.slice(2);

if (argv.includes("--version")) {
  process.stdout.write(`${process.env.FAKE_AGY_VERSION || "9.9.9-fake"}\n`);
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

const baseLog = `I0101 00:00:00.000000 1 server.go:755] Created conversation ${convId}\nI0101 00:00:00.000001 1 printmode.go:130] Print mode: conversation=${convId}, sending message\n`;

if (mode === "quota") {
  if (logFile)
    writeFileSync(
      logFile,
      baseLog +
        "E0101 00:00:00.000002 1 log.go:398] agent executor error: RESOURCE_EXHAUSTED (code 429): Individual quota reached. Contact your administrator to enable overages. Resets in 152h59m39s.\n",
    );
  process.exit(0); // empty stdout, exit 0 — exactly like the real CLI
}

if (mode === "auth") {
  if (logFile)
    writeFileSync(logFile, "E0101 00:00:00.000002 1 log.go:398] UNAUTHENTICATED (code 401): login required\n");
  process.exit(0);
}

// success
if (logFile) writeFileSync(logFile, baseLog);
const echo = String(prompt || "").slice(0, 60).replace(/\s+/g, " ");
const model = valueOf("--model");
const modelNote = model ? ` model=${model}.` : "";
process.stdout.write(`Gemini 3 (fake) reply.${modelNote} I received: "${echo}". Verdict: looks good.\n`);
process.exit(0);
