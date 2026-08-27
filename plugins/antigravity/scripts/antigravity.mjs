#!/usr/bin/env node
// Antigravity companion for Claude Code.
//
// Thin, dependency-free runtime that drives the `agy` CLI (Google Antigravity,
// Gemini 3) in print mode and manages background jobs. Each subcommand prints
// Markdown that the calling slash command / subagent relays to the user verbatim.
//
// Subcommands: setup | delegate | review | resume | status | result | cancel
//   (aliases: run -> delegate)

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { parseArgs, hasFlag } from "./lib/args.mjs";
import { resolveAgyBinary, agyConfigDir } from "./lib/paths.mjs";
import {
  buildPrintArgs,
  runForeground,
  spawnBackground,
  goDurationToMs,
  agyVersion,
  readLogSafe,
  isVersionAtLeast,
  MIN_MODEL_FLAG_VERSION,
} from "./lib/agy.mjs";
import { scanAgyLog } from "./lib/logscan.mjs";
import { resolveReviewTarget } from "./lib/git.mjs";
import {
  createJob,
  writeJob,
  readJob,
  reconcile,
  listJobs,
  latestJob,
  cancelJob,
} from "./lib/jobs.mjs";
import * as render from "./lib/render.mjs";

const MAX_PROMPT_BYTES = 100 * 1024;

function out(text) {
  process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
}

function requireBinaryOrExit() {
  const bin = resolveAgyBinary();
  if (!bin) {
    out(render.renderNotInstalled());
    process.exit(0);
  }
  return bin;
}

function clampPrompt(prompt) {
  const buf = Buffer.from(prompt, "utf8");
  if (buf.length <= MAX_PROMPT_BYTES) return prompt;
  return `${buf.subarray(0, MAX_PROMPT_BYTES).toString("utf8")}\n\n[...truncated by antigravity-plugin-cc: prompt exceeded ${MAX_PROMPT_BYTES} bytes...]`;
}

// ---------------------------------------------------------------------------
// setup
// ---------------------------------------------------------------------------
function cmdSetup(parsed) {
  const bin = resolveAgyBinary();
  const configDir = agyConfigDir();
  const configExists = existsSync(configDir);
  const installationId = existsSync(join(configDir, "installation_id"));
  const hasConversations =
    existsSync(join(configDir, "conversations")) &&
    safeReaddir(join(configDir, "conversations")).some((f) => f.endsWith(".pb"));

  const version = bin ? agyVersion(bin.path) : null;
  // Best-effort auth signal: we never log you in. Presence of prior threads or an
  // installation id strongly suggests a completed sign-in.
  const authedGuess = configExists && (installationId || hasConversations);

  const report = {
    ready: Boolean(bin),
    binary: { found: Boolean(bin), detail: bin ? `${bin.path} (${bin.source})` : "not found" },
    version,
    configDir: { exists: configExists, detail: configExists ? configDir : `${configDir} (missing)` },
    auth: {
      detail: !bin
        ? "n/a (install agy first)"
        : authedGuess
          ? "looks configured (a prior signed-in session was found)"
          : "no prior session detected — run `! agy` once to sign in",
    },
    nextSteps: [],
  };

  if (!bin) {
    report.nextSteps.push("Install agy (see the install block below), then rerun `/antigravity:setup`.");
  } else if (!authedGuess) {
    report.nextSteps.push("Run `! agy` once to complete the browser sign-in, then you're ready.");
  } else {
    report.nextSteps.push("You're set. Try `/antigravity:review` or `/antigravity:delegate <task>`.");
    if (!isVersionAtLeast(version, MIN_MODEL_FLAG_VERSION)) {
      report.nextSteps.push(
        `Run \`agy update\` to use --model overrides (found ${version || "unknown"}, need >= ${MIN_MODEL_FLAG_VERSION}).`,
      );
    }
  }

  if (hasFlag(parsed, "json")) {
    out(
      JSON.stringify(
        {
          ready: report.ready,
          installed: report.binary.found,
          binaryPath: bin?.path ?? null,
          version,
          authedGuess,
          configDir,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (!bin) {
    out(render.renderNotInstalled());
    return;
  }
  out(render.renderSetup(report));
}

function safeReaddir(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// delegate / resume (shared core)
// ---------------------------------------------------------------------------
function runAgyTask(parsed, { kind, title, prompt, readOnly, resume }) {
  const bin = requireBinaryOrExit();
  const cwd = process.cwd();

  const sandbox = hasFlag(parsed, "sandbox") || Boolean(readOnly);
  const yolo = !hasFlag(parsed, "no-yolo"); // write-capable by default; contained if sandbox
  const continueLast = resume && !parsed.valued.conversation ? true : hasFlag(parsed, "continue");
  const conversationId = parsed.valued.conversation || null;
  const printTimeout = parsed.valued["print-timeout"] || "10m";
  const addDirs = [cwd, ...(parsed.repeated["add-dir"] || [])];

  let model = parsed.valued.model || null;
  if (model) {
    const version = agyVersion(bin.path);
    if (!isVersionAtLeast(version, MIN_MODEL_FLAG_VERSION)) {
      process.stderr.write(
        `[antigravity-plugin-cc] note: --model needs agy >= ${MIN_MODEL_FLAG_VERSION} (found ${version || "unknown"}); ` +
          "older builds silently ignore it in headless runs. Run `agy update`, or set the default with `/model` inside agy. Ignoring --model.\n",
      );
      model = null;
    }
  }

  const finalPrompt = clampPrompt(prompt);
  const background = hasFlag(parsed, "background");

  const job = createJob({ kind, title, prompt: finalPrompt, cwd, conversationId });
  const args = buildPrintArgs({
    prompt: finalPrompt,
    addDirs,
    yolo,
    sandbox,
    continueLast,
    conversationId,
    logFile: job.paths.log,
    printTimeout,
    model,
  });

  if (background) {
    const { pid } = spawnBackground({
      bin: bin.path,
      args,
      cwd,
      outputFile: job.paths.output,
      errFile: job.paths.err,
    });
    job.pid = pid;
    writeJob(job);
    out(render.renderBackgroundStarted(job));
    return;
  }

  const watchdogMs = goDurationToMs(printTimeout) + 60_000;
  const result = runForeground({ bin: bin.path, args, cwd, logFile: job.paths.log, watchdogMs });
  const scan = scanAgyLog(result.logText);
  job.conversationId = scan.conversationId || job.conversationId;

  const responseText = result.stdout.trim();
  if (responseText) {
    job.status = "done";
    writeJob(job);
    out(render.renderResponse(responseText, { title, conversationId: job.conversationId }));
    return;
  }

  if (result.timedOut) {
    job.status = "failed";
    job.error = `timed out after ${printTimeout}`;
    writeJob(job);
    out(
      render.renderError(
        { kind: "backend", message: `Antigravity timed out after ${printTimeout}. Try --print-timeout 20m or run with --background.` },
        { title, conversationId: job.conversationId, logFile: job.paths.log },
      ),
    );
    return;
  }

  if (result.error) {
    job.status = "failed";
    job.error = result.error;
    writeJob(job);
    out(
      render.renderError(
        { kind: "backend", message: `Could not run agy: ${result.error}` },
        { title, conversationId: job.conversationId, logFile: job.paths.log },
      ),
    );
    return;
  }

  job.status = scan.error ? "failed" : "done";
  job.error = scan.error ? scan.error.message : null;
  writeJob(job);
  out(render.renderError(scan.error, { title, conversationId: job.conversationId, logFile: job.paths.log }));
}

function cmdDelegate(parsed) {
  const task = parsed.text;
  if (!task) {
    out("# 🛰️ Antigravity — delegate\n\nWhat should Antigravity (Gemini 3) work on? Pass the task, e.g.\n`/antigravity:delegate investigate why the auth tests fail and propose a fix`.");
    return;
  }
  runAgyTask(parsed, { kind: "delegate", title: truncate(task, 80), prompt: task, readOnly: hasFlag(parsed, "read-only") });
}

function cmdResume(parsed) {
  const followUp = parsed.text || "Continue from where you left off.";
  runAgyTask(parsed, {
    kind: "delegate",
    title: truncate(followUp, 80),
    prompt: followUp,
    resume: true,
  });
}

// ---------------------------------------------------------------------------
// review
// ---------------------------------------------------------------------------
function cmdReview(parsed) {
  requireBinaryOrExit();
  const cwd = process.cwd();
  const base = parsed.valued.base || null;
  const focus = parsed.text;

  const target = resolveReviewTarget(cwd, base);
  if (!target.ok) {
    out(`# 🛰️ Antigravity — review\n\nNothing to review: ${target.reason}.`);
    return;
  }

  const prompt = buildReviewPrompt(target, focus);
  // Reviews are contained + read-capable but should not modify the tree.
  const reviewParsed = { ...parsed, flags: { ...parsed.flags, sandbox: true } };
  runAgyTask(reviewParsed, {
    kind: "review",
    title: `review ${target.label}`,
    prompt,
    readOnly: true,
  });
}

function buildReviewPrompt(target, focus) {
  return [
    "You are a meticulous senior code reviewer. Review ONLY the changes below. Do not modify any files.",
    focus ? `\nReviewer focus: ${focus}` : "",
    "\nReturn a concise review with:",
    "1. Verdict (ship / ship with nits / needs work).",
    "2. The most important issues first, each as: severity (critical/high/medium/low), file:line, what's wrong, and a concrete fix.",
    "3. Anything risky around correctness, security, error handling, concurrency, or data loss.",
    "4. A short list of suggested next steps.",
    `\nReview target: ${target.label}`,
    target.stat ? `\nDiffstat:\n${target.stat}` : "",
    "\nUnified diff:\n",
    "```diff",
    target.diff,
    "```",
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------
// status / result / cancel
// ---------------------------------------------------------------------------
function cmdStatus(parsed) {
  const id = parsed.positionals.find((p) => p.startsWith("agy-"));
  if (id) {
    const job = readJob(id);
    if (!job) {
      out(`# 🛰️ Antigravity — status\n\nNo job \`${id}\` found.`);
      return;
    }
    reconcile(job);
    out(render.renderJobStatus(job));
    return;
  }
  out(render.renderStatus(listJobs(process.cwd())));
}

function cmdResult(parsed) {
  const id = parsed.positionals.find((p) => p.startsWith("agy-"));
  let job = id ? readJob(id) : latestJob(process.cwd());
  if (!job) {
    out(`# 🛰️ Antigravity — result\n\nNo ${id ? `job \`${id}\`` : "recent jobs"} found for this repository.`);
    return;
  }
  reconcile(job);
  if (job.status === "running") {
    out(render.renderJobStatus(job));
    return;
  }

  const output = readLogSafe(job.paths.output).trim();
  const scan = scanAgyLog(readLogSafe(job.paths.log));
  const conversationId = job.conversationId || scan.conversationId;
  if (output) {
    out(render.renderResponse(output, { title: job.title, conversationId }));
  } else {
    out(render.renderError(scan.error, { title: job.title, conversationId, logFile: job.paths.log }));
  }
}

function cmdCancel(parsed) {
  const id = parsed.positionals.find((p) => p.startsWith("agy-"));
  const job = id ? readJob(id) : listJobs(process.cwd()).find((j) => j.status === "running");
  if (!job) {
    out(`# 🛰️ Antigravity — cancel\n\nNo running job ${id ? `\`${id}\`` : ""} to cancel.`);
    return;
  }
  const result = cancelJob(job);
  out(render.renderCancel(result, job));
}

// ---------------------------------------------------------------------------
function truncate(s, n) {
  const t = String(s).replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function usage() {
  out(
    [
      "antigravity companion — drive the Antigravity CLI (agy / Gemini 3) from Claude Code",
      "",
      "Usage: node antigravity.mjs <subcommand> [args]",
      "  setup [--json]",
      "  delegate <task> [--background] [--sandbox] [--read-only] [--continue] [--conversation <id>] [--add-dir <p>] [--print-timeout <dur>]",
      "  review [--base <ref>] [--background] [focus text...]",
      "  resume <follow-up> [--conversation <id>] [--background]",
      "  status [job-id]",
      "  result [job-id]",
      "  cancel [job-id]",
    ].join("\n"),
  );
}

function main() {
  const [, , sub, ...rest] = process.argv;
  const parsed = parseArgs(rest);
  switch (sub) {
    case "setup":
      return cmdSetup(parsed);
    case "delegate":
    case "run":
    case "task":
      return cmdDelegate(parsed);
    case "review":
      return cmdReview(parsed);
    case "resume":
      return cmdResume(parsed);
    case "status":
      return cmdStatus(parsed);
    case "result":
      return cmdResult(parsed);
    case "cancel":
      return cmdCancel(parsed);
    default:
      return usage();
  }
}

main();
