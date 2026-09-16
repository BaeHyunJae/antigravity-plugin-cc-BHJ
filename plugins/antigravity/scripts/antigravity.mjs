#!/usr/bin/env node
// Antigravity companion for Claude Code.
//
// Thin, dependency-free runtime that drives the `agy` CLI (Google Antigravity) in
// print mode and manages background jobs. Each subcommand prints
// Markdown that the calling slash command / subagent relays to the user verbatim.
//
// Subcommands: setup | delegate | review | resume | status | result | cancel
//   (aliases: run -> delegate)

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { parseArgs, hasFlag, validateExtraArgs } from "./lib/args.mjs";
import { resolveAgyBinary, agyConfigDir } from "./lib/paths.mjs";
import {
  buildPrintArgs,
  runForeground,
  spawnBackground,
  goDurationToMs,
  agyVersionCached,
  readLogSafe,
  isVersionAtLeast,
  MIN_AGY_VERSION,
  RESERVED_AGY_FLAGS,
  promptBudget,
} from "./lib/agy.mjs";
import { scanAgyLog, scanStderr } from "./lib/logscan.mjs";
import { parseEnvelope, isSuccess, isCancelled, isFullyDenied, describeDenied } from "./lib/envelope.mjs";
import { resolveReviewTarget, truncateDiff } from "./lib/git.mjs";
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

/**
 * Last-resort byte cap on the prompt. Callers that can trim intelligently (review cuts
 * at a file boundary) do so first; this only stops an oversized prompt reaching agy,
 * and it reports the cut so the caller can tell the user rather than silently handing
 * back an answer about half their input.
 *
 * @returns {{ prompt: string, truncated: boolean }}
 */
function clampPrompt(prompt, maxBytes = MAX_PROMPT_BYTES) {
  const buf = Buffer.from(prompt, "utf8");
  if (buf.length <= maxBytes) return { prompt, truncated: false };
  const cut = buf.subarray(0, maxBytes).toString("utf8");
  return {
    prompt: `${cut}\n\n[...truncated by antigravity-plugin-cc: prompt exceeded ${maxBytes} bytes...]`,
    truncated: true,
  };
}

// ---------------------------------------------------------------------------
// setup
// ---------------------------------------------------------------------------
function cmdSetup(parsed) {
  const bin = resolveAgyBinary();
  const configDir = agyConfigDir();
  const configExists = existsSync(configDir);
  const installationId = existsSync(join(configDir, "installation_id"));
  // agy 1.2.x stores threads as SQLite (`<id>.db`); older builds used protobuf.
  const hasConversations =
    existsSync(join(configDir, "conversations")) &&
    safeReaddir(join(configDir, "conversations")).some((f) => f.endsWith(".db") || f.endsWith(".pb"));

  const version = bin ? agyVersionCached(bin.path) : null;
  const versionOk = isVersionAtLeast(version, MIN_AGY_VERSION);
  // Best-effort auth signal: we never log you in. Presence of prior threads or an
  // installation id strongly suggests a completed sign-in.
  const authedGuess = configExists && (installationId || hasConversations);

  const report = {
    ready: Boolean(bin) && versionOk,
    binary: { found: Boolean(bin), detail: bin ? `${bin.path} (${bin.source})` : "not found" },
    version,
    minVersion: MIN_AGY_VERSION,
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
  } else if (!versionOk) {
    report.nextSteps.push(
      `Run \`agy update\` — this plugin needs agy >= ${MIN_AGY_VERSION} (found ${version || "unknown"}). ` +
        "Older builds silently ignore --model/--effort in headless runs and predate the JSON output format.",
    );
  } else if (!authedGuess) {
    report.nextSteps.push("Run `! agy` once to complete the browser sign-in, then you're ready.");
  } else {
    report.nextSteps.push("You're set. Try `/antigravity:review` or `/antigravity:delegate <task>`.");
  }

  if (hasFlag(parsed, "json")) {
    out(
      JSON.stringify(
        {
          ready: report.ready,
          installed: report.binary.found,
          binaryPath: bin?.path ?? null,
          version,
          minVersion: MIN_AGY_VERSION,
          versionOk,
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
function runAgyTask(parsed, { kind, title, prompt, buildPrompt, readOnly, resume }) {
  const bin = requireBinaryOrExit();
  const cwd = process.cwd();

  // One version gate for the whole companion. Below MIN_AGY_VERSION the headless
  // contract is a different one (no JSON envelope, --model/--effort silently
  // ignored), so we refuse rather than carry a second code path.
  const version = agyVersionCached(bin.path);
  if (!isVersionAtLeast(version, MIN_AGY_VERSION)) {
    out(render.renderVersionTooOld(version, MIN_AGY_VERSION));
    return;
  }

  const extraArgs = parsed.repeated["agy-arg"] || [];
  const guard = validateExtraArgs(extraArgs, RESERVED_AGY_FLAGS);
  if (!guard.ok) {
    out(render.renderRejectedArgs(guard.rejected));
    return;
  }

  const sandbox = hasFlag(parsed, "sandbox") || Boolean(readOnly);
  const yolo = !hasFlag(parsed, "no-yolo"); // write-capable by default; contained if sandbox
  const continueLast = resume && !parsed.valued.conversation ? true : hasFlag(parsed, "continue");
  const conversationId = parsed.valued.conversation || null;
  const printTimeout = parsed.valued["print-timeout"] || "10m";
  const addDirs = [cwd, ...(parsed.repeated["add-dir"] || [])];
  const model = parsed.valued.model || null;
  const effort = parsed.valued.effort || null;
  // agy's own slash commands and skills stay enabled by default so an agy-side
  // skill can fire on the prompt; --no-slash-commands is the opt-out.
  const noSlashCommands = hasFlag(parsed, "no-slash-commands");

  const background = hasFlag(parsed, "background");
  const job = createJob({ kind, title, prompt: "", cwd, conversationId });

  // Everything except the prompt is known now, so measure what the command line has
  // left. On Windows that ceiling is the OS's, not ours, and blowing it fails the run
  // outright rather than degrading.
  const flagShape = {
    addDirs,
    yolo,
    sandbox,
    continueLast,
    conversationId,
    logFile: job.paths.log,
    printTimeout,
    model,
    effort,
    noSlashCommands,
    extraArgs,
  };
  const budget = promptBudget({
    bin: bin.path,
    args: buildPrintArgs({ ...flagShape, prompt: "" }),
    ceiling: MAX_PROMPT_BYTES,
  });

  const built = buildPrompt ? buildPrompt(budget) : { prompt, warning: null };
  const clamped = clampPrompt(built.prompt, budget);
  const finalPrompt = clamped.prompt;
  const promptNote =
    built.warning ||
    (clamped.truncated
      ? `The prompt did not fit and was cut at ${Math.floor(budget / 1024)} KiB — this answer is based on part of your input.`
      : null);

  job.prompt = finalPrompt;
  writeJob(job);
  const args = buildPrintArgs({ ...flagShape, prompt: finalPrompt });

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

  // Persist exactly what a background run would have written. A background job's stdout
  // lands in output.txt and `/antigravity:result` replays it from there; a foreground run
  // used to keep its stdout in memory only, so asking for the result afterwards found an
  // empty job and reported "no output and no recognizable error" — for successful runs too.
  try {
    writeFileSync(job.paths.output, result.stdout || "");
    if (result.stderr) writeFileSync(job.paths.err, result.stderr);
  } catch {
    /* replay is a convenience; never fail the run over it */
  }

  const outcome = classifyRun(result);

  job.conversationId = outcome.conversationId || job.conversationId;
  job.usage = outcome.usage || null;
  job.durationSeconds = outcome.durationSeconds ?? null;

  const meta = {
    title,
    conversationId: job.conversationId,
    logFile: job.paths.log,
    usage: outcome.usage,
    durationSeconds: outcome.durationSeconds,
    numTurns: outcome.numTurns,
    truncated: outcome.truncated,
    deniedActions: outcome.deniedActions,
    promptNote,
  };

  if (outcome.kind === "success") {
    job.status = "done";
    job.error = null;
    writeJob(job);
    out(render.renderResponse(outcome.response, meta));
    return;
  }

  if (outcome.kind === "cancelled") {
    job.status = "cancelled";
    job.error = null;
    writeJob(job);
    out(render.renderResponse(outcome.response, { ...meta, cancelled: true }));
    return;
  }

  job.status = "failed";
  // Keep the reset window in the stored message, the way reconcile() does for background
  // jobs — otherwise replaying a quota failure from the job record loses the one detail
  // the user actually needs.
  job.error = outcome.error
    ? outcome.error.message + (outcome.error.resetsIn ? ` (resets in ${outcome.error.resetsIn})` : "")
    : null;
  writeJob(job);
  out(render.renderError(outcome.error, meta));
}

/**
 * Decide what a finished foreground run actually did.
 *
 * Three signals, checked in order of how much they prove:
 *
 *   1. Exit code. Non-zero is a confirmed failure (agy 1.1.1+ returns non-zero on
 *      server-side failures). Zero proves nothing — since 1.1.20 the exit code
 *      reflects only cascade-level failures.
 *   2. The JSON envelope on stdout. This is the normal path.
 *   3. The agy log. Only reached when stdout came back empty, which has been
 *      reported for non-TTY pipes — exactly how we spawn agy.
 */
function classifyRun(result) {
  const envelope = parseEnvelope(result.stdout);
  const stderrInfo = scanStderr(result.stderr);
  const scan = scanAgyLog(result.logText);
  const conversationId = envelope.conversationId || scan.conversationId || null;
  const denied = envelope.deniedActions || [];
  const base = {
    conversationId,
    usage: envelope.usage,
    durationSeconds: envelope.durationSeconds,
    numTurns: envelope.numTurns,
    truncated: stderrInfo.truncated,
    response: envelope.response,
    deniedActions: denied.length ? denied : null,
  };

  // Could not even start the process.
  if (result.error) {
    return { ...base, kind: "failed", error: { kind: "backend", message: `Could not run agy: ${result.error}`, resetsIn: null } };
  }

  // Our own watchdog fired (agy's --print-timeout plus 60s). Distinct from agy's
  // internal timeout, which returns partial output and exits 0.
  if (result.timedOut) {
    return {
      ...base,
      kind: "failed",
      error: {
        kind: "backend",
        message: `Antigravity timed out. Try a longer --print-timeout, or run with --background.`,
        resetsIn: null,
      },
    };
  }

  const reportedError = envelope.error || stderrInfo.error || null;

  if (result.code !== 0) {
    const error =
      pickError(scan, reportedError) ||
      { kind: "backend", message: `agy exited with code ${result.code}.`, resetsIn: null };
    return { ...base, kind: "failed", error };
  }

  // A run blocked by agy's permission gate comes back as status SUCCESS with an EMPTY
  // response and no error field — the refusals live only in denied_actions. Measured:
  //   {"status":"SUCCESS","response":"","denied_actions":[{"action":"command",...}]}
  // Rendering that as a successful empty answer is the exact silent failure this
  // companion exists to prevent.
  if (isFullyDenied(envelope)) {
    return {
      ...base,
      kind: "failed",
      error: { kind: "permission", message: describeDenied(denied), resetsIn: null, deniedActions: denied },
    };
  }

  if (isSuccess(envelope)) return { ...base, kind: "success" };
  if (isCancelled(envelope)) return { ...base, kind: "cancelled" };

  const error = pickError(scan, reportedError);
  if (error) return { ...base, kind: "failed", error };

  // Envelope parsed but reports neither success nor an error, or stdout was empty
  // and the log held nothing: render the "no output, no recognizable error" case.
  return { ...base, kind: "failed", error: null };
}

/**
 * Choose what to show the user out of the signals we have.
 *
 * `agy`'s own words come first. When it reports `invalid model selection (--model
 * "gemini-3.8-flash-low" --effort "high"): ... conflicts with --effort=high`, that
 * sentence is the answer — a classification derived from the log is a worse
 * version of it, and an earlier revision of this function showed that exact error
 * as "quota exhausted, wait for the reset".
 *
 * The log only decides when it recognizes something agy's message did not say.
 */
function pickError(scan, reportedMessage) {
  // Reuse the log classifier on the bare message so an envelope-only quota or
  // auth error still renders with the right next steps.
  const fromReport = reportedMessage ? scanAgyLog(reportedMessage).error : null;
  if (fromReport && fromReport.kind !== "backend") {
    // The log usually carries the reset window; agy's one-line message does not.
    if (scan.error && scan.error.kind === fromReport.kind && scan.error.resetsIn && !fromReport.resetsIn) {
      return { ...fromReport, resetsIn: scan.error.resetsIn };
    }
    return fromReport;
  }
  if (scan.error && scan.error.kind !== "backend") return scan.error;
  if (reportedMessage) return { kind: "backend", message: reportedMessage, resetsIn: null };
  return scan.error || null;
}


function cmdDelegate(parsed) {
  const task = parsed.text;
  if (!task) {
    out("# 🛰️ Antigravity — delegate\n\nWhat should Antigravity work on? Pass the task, e.g.\n`/antigravity:delegate investigate why the auth tests fail and propose a fix`.");
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

  // Reviews are contained + read-capable but should not modify the tree.
  const reviewParsed = { ...parsed, flags: { ...parsed.flags, sandbox: true } };
  runAgyTask(reviewParsed, {
    kind: "review",
    title: `review ${target.label}`,
    readOnly: true,
    // The diff has to be trimmed against the real command-line budget, which is only
    // known once every other flag is decided — so build the prompt from inside the run.
    buildPrompt: (budget) => {
      const built = buildReviewPrompt(target, focus, budget);
      return {
        prompt: built.prompt,
        warning: built.truncated
          ? `Only ${built.shownFiles} of ${built.totalFiles} changed files fit in one prompt. This review does NOT cover the rest — narrow it with \`--base <ref>\`, or review the remaining files separately.`
          : null,
      };
    },
  });
}

/**
 * @returns {{ prompt: string, truncated: boolean, shownFiles: number, totalFiles: number }}
 */
function buildReviewPrompt(target, focus, budget = MAX_PROMPT_BYTES) {
  const head = [
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
  ]
    .filter(Boolean)
    .join("\n");

  // Reserve room for the fence, the closing constraint and a safety margin, then give
  // the diff whatever is left — cut at a file boundary rather than mid-hunk.
  const overhead = Buffer.byteLength(head, "utf8") + 1024;
  const cut = truncateDiff(target.diff, Math.max(0, budget - overhead));

  const tail = ["```"];
  if (cut.truncated) {
    // Last position, deliberately: a constraint this important should anchor the
    // model's final reasoning step rather than get lost in a long prompt.
    tail.push(
      "",
      `NOTE: this diff is INCOMPLETE. It covers ${cut.shownFiles} of ${cut.totalFiles} changed files;` +
        " the rest did not fit in one prompt. Review only what is shown, and say plainly at the top" +
        " of your review that the remaining files were not seen.",
    );
  }

  return {
    prompt: [head, cut.diff, ...tail].join("\n"),
    truncated: cut.truncated,
    shownFiles: cut.shownFiles,
    totalFiles: cut.totalFiles,
  };
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

  // A background run wrote agy's stdout straight to output.txt, so that file holds
  // the same JSON envelope a foreground run parses.
  const envelope = parseEnvelope(readLogSafe(job.paths.output));
  const scan = scanAgyLog(readLogSafe(job.paths.log));
  const conversationId = job.conversationId || envelope.conversationId || scan.conversationId;
  const meta = {
    title: job.title,
    conversationId,
    logFile: job.paths.log,
    usage: envelope.usage || job.usage || null,
    durationSeconds: envelope.durationSeconds ?? job.durationSeconds ?? null,
    numTurns: envelope.numTurns,
    deniedActions: envelope.deniedActions,
  };

  if (isSuccess(envelope)) {
    out(render.renderResponse(envelope.response, meta));
    return;
  }
  if (isCancelled(envelope)) {
    out(render.renderResponse(envelope.response, { ...meta, cancelled: true }));
    return;
  }
  if (isFullyDenied(envelope)) {
    out(
      render.renderError(
        { kind: "permission", message: describeDenied(envelope.deniedActions), resetsIn: null },
        meta,
      ),
    );
    return;
  }

  // A job we cancelled ourselves has no envelope saying so — `cancelJob` just marks the
  // record. Without this it falls through to the generic error and reports a backend
  // failure for something the user deliberately stopped.
  if (job.status === "cancelled") {
    out(
      render.renderResponse(envelope.response || "_This run was cancelled before it produced output._", {
        ...meta,
        cancelled: true,
      }),
    );
    return;
  }

  // Jobs recorded before foreground runs persisted their stdout have no envelope to
  // replay. The job record still knows how the run ended, so use it rather than
  // claiming nothing recognizable happened — and put it through the same classifier, so
  // a stored quota or auth failure still renders with its reset window and next steps
  // instead of a bare backend message.
  const error = pickError(scan, envelope.error || job.error);
  if (error) {
    out(render.renderError(error, meta));
    return;
  }
  if (job.status === "done") {
    out(
      render.renderResponse(
        "_This run finished, but its output was not retained — it predates the companion storing foreground results. Re-run the task, or reopen the thread with `agy --conversation <id>`._",
        meta,
      ),
    );
    return;
  }
  out(render.renderError(null, meta));
}

function cmdCancel(parsed) {
  const id = parsed.positionals.find((p) => p.startsWith("agy-"));
  const job = id ? readJob(id) : listJobs(process.cwd()).find((j) => j.status === "running");
  if (!job) {
    out(`# 🛰️ Antigravity — cancel\n\nNo running job${id ? ` \`${id}\`` : ""} to cancel.`);
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
      "antigravity companion — drive the Antigravity CLI (agy) from Claude Code",
      "",
      "Usage: node antigravity.mjs <subcommand> [args]",
      "  setup [--json]",
      "  delegate <task> [--background] [--sandbox] [--read-only] [--continue] [--conversation <id>]",
      "                  [--add-dir <p>] [--print-timeout <dur>] [--model <slug>] [--effort <level>]",
      "                  [--no-slash-commands] [--agy-arg <token>]",
      "  review [--base <ref>] [--background] [--model <slug>] [--effort <level>] [focus text...]",
      "  resume <follow-up> [--conversation <id>] [--background] [--model <slug>] [--effort <level>]",
      "  status [job-id]",
      "  result [job-id]",
      "  cancel [job-id]",
      "",
      `Requires agy >= ${MIN_AGY_VERSION}. Run \`agy models\` for the current model slugs.`,
      "--agy-arg passes one raw token per occurrence to agy, e.g. --agy-arg --mode --agy-arg plan.",
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
