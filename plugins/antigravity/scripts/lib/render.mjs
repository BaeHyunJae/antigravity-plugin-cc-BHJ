// Render companion output as Markdown that Claude relays to the user verbatim.

function ensureTrailingNewline(s) {
  return s.endsWith("\n") ? s : `${s}\n`;
}

/** 8213 -> "8.2k", 940 -> "940". Keeps the usage line short enough to skim. */
function compactTokens(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/**
 * One-line run cost: `12.4s · 8.2k in / 1.1k out`.
 *
 * Quota exhaustion is this plugin's most common failure, and without this the
 * only signal you get is the run that finally fails.
 */
function usageLine({ usage, durationSeconds, numTurns } = {}) {
  // A run that failed before reaching the model reports zeros for everything.
  // "0.0s · 0 in / 0 out" is noise under an error, so say nothing.
  const spentNothing =
    !durationSeconds && (!usage || Object.values(usage).every((v) => !v));
  if (spentNothing) return null;

  const bits = [];
  // On a resumed conversation `duration_seconds` is wall time since the thread was
  // created, not this turn — measured at 2258s for a 2-turn resume. Printing that next
  // to this turn's token counts reads as "this took 38 minutes", so on a continued
  // thread we report the turn count instead and let the tokens carry the cost.
  const resumed = typeof numTurns === "number" && numTurns > 1;
  if (!resumed && typeof durationSeconds === "number" && Number.isFinite(durationSeconds)) {
    bits.push(`${durationSeconds.toFixed(1)}s`);
  } else if (resumed) {
    bits.push(`turn ${numTurns}`);
  }
  if (usage) {
    const io = [];
    const input = compactTokens(usage.inputTokens);
    const output = compactTokens(usage.outputTokens);
    if (input) io.push(`${input} in`);
    if (output) io.push(`${output} out`);
    const thinking = compactTokens(usage.thinkingTokens);
    if (thinking && usage.thinkingTokens > 0) io.push(`${thinking} thinking`);
    const cached = compactTokens(usage.cacheReadTokens);
    if (cached && usage.cacheReadTokens > 0) io.push(`${cached} cached`);
    if (io.length) bits.push(io.join(" / "));
  }
  return bits.length ? bits.join("  ·  ") : null;
}

function resumeFooter({ conversationId, jobId, usage, durationSeconds, numTurns } = {}) {
  const lines = [];
  if (conversationId) {
    lines.push("", "---", `Antigravity conversation: \`${conversationId}\``);
    lines.push("Continue this thread: `/antigravity:resume <follow-up>`  ·  reopen in the TUI: `agy --conversation " + conversationId + "`");
  }
  if (jobId) {
    lines.push(`Job: \`${jobId}\``);
  }
  const cost = usageLine({ usage, durationSeconds, numTurns });
  if (cost) {
    if (!lines.length) lines.push("", "---");
    lines.push(cost);
  }
  return lines;
}

/** "RunCommand, WriteFile" out of agy's denied_actions entries. */
function describeDeniedShort(denied) {
  return denied
    .map((d) => (d && typeof d === "object" ? d.display_name || d.action : String(d)))
    .filter(Boolean)
    .join(", ");
}

/** Successful agy response (delegate / resume). The model text leads. */
export function renderResponse(responseText, meta = {}) {
  const body = (responseText || "").trim();
  const header = meta.title ? [`# 🛰️ Antigravity — ${meta.title}`, ""] : ["# 🛰️ Antigravity", ""];
  const notes = [];
  if (meta.promptNote) {
    // The input was cut before it ever reached Antigravity. Say so above the answer:
    // a review of half a diff reads exactly like a review of all of it.
    notes.push(`> ⚠️ **${meta.promptNote}**`, "");
  }
  if (meta.cancelled) notes.push("_The turn was stopped before it finished; this is what Antigravity had produced._", "");
  else if (meta.truncated) notes.push("_Antigravity hit its print timeout — this response may be incomplete._", "");
  if (meta.resumedFrom) {
    // Say which thread got continued. A continue that silently picked the wrong one
    // otherwise looks identical to one that picked the right one.
    notes.push(`_Continued the thread from: ${meta.resumedFrom}_`, "");
  }
  if (meta.deniedActions && meta.deniedActions.length) {
    // The answer arrived, but part of the work was blocked — say so next to the answer
    // rather than letting the reader assume the task completed.
    notes.push(`_Some tools were refused on permission grounds: ${describeDeniedShort(meta.deniedActions)}. The answer below may be partial._`, "");
  }
  const lines = [
    ...header,
    ...notes,
    body || "_(Antigravity returned an empty response.)_",
    ...resumeFooter(meta),
  ];
  return ensureTrailingNewline(lines.join("\n").trimEnd());
}

/** A flag that belongs to a different subcommand was supplied. */
export function renderFlagNotForThisCommand(flag, kind, instead) {
  const lines = [
    `# 🛰️ Antigravity — \`${flag}\` is not a ${kind} flag`,
    "",
    `\`${flag}\` belongs to a different command, so running anyway would answer a question`,
    "you did not ask. Nothing was run.",
    "",
    `Did you mean: \`${instead}\``,
  ];
  return ensureTrailingNewline(lines.join("\n"));
}

/** `--fresh` was passed to `resume`, which exists to do the opposite. */
export function renderContradictoryFresh() {
  const lines = [
    "# 🛰️ Antigravity — `--fresh` does not apply here",
    "",
    "`/antigravity:resume` continues an existing thread, so `--fresh` asks for the opposite",
    "of what the command does. Nothing was run.",
    "",
    "- To start a new thread: `/antigravity:delegate <task>`",
    "- To continue this one: `/antigravity:resume <follow-up>`",
    "- To continue a specific one: `/antigravity:resume --conversation <id> <follow-up>`",
  ];
  return ensureTrailingNewline(lines.join("\n"));
}

/** A continue was asked for while a job from this directory is still running. */
export function renderResumeBlocked(job) {
  const lines = [
    "# 🛰️ Antigravity — a job is still running",
    "",
    `Job \`${job.id}\`${job.title ? ` (${job.title})` : ""} has not finished, so there is no settled thread to continue.`,
    "",
    "Continuing now would either fork the thread or pick up a different one. Wait for it:",
    "",
    `- \`/antigravity:status ${job.id}\` — check on it`,
    `- \`/antigravity:result ${job.id}\` — read it once it lands`,
    `- \`/antigravity:cancel ${job.id}\` — stop it`,
    "",
    "Or name the thread you meant with `--conversation <id>`.",
  ];
  return ensureTrailingNewline(lines.join("\n"));
}

/** Human-readable form of `resume-candidate`, for someone running it by hand. */
export function renderResumeCandidate(payload) {
  const lines = ["# 🛰️ Antigravity — resumable thread", ""];
  if (payload.status === "running") {
    lines.push(
      `A job is still running: \`${payload.running.jobId}\`${payload.running.title ? ` (${payload.running.title})` : ""}.`,
      "Nothing can be continued until it finishes.",
    );
  } else if (payload.available) {
    const c = payload.candidate;
    lines.push(
      `Ready to continue: \`${c.conversationId}\``,
      c.title ? `Last task: ${c.title}` : "",
      c.finishedAt ? `Finished: ${c.finishedAt}` : "",
      "",
      "Continue it with `/antigravity:resume <follow-up>`.",
    );
  } else {
    lines.push("No thread from this directory to continue. Start one with `/antigravity:delegate <task>`.");
  }
  return ensureTrailingNewline(lines.filter(Boolean).join("\n").trimEnd());
}

/** The installed agy predates the contract this companion is built against. */
export function renderVersionTooOld(found, required) {
  const lines = [
    "# 🛰️ Antigravity — agy is too old",
    "",
    `This plugin needs \`agy\` **>= ${required}**; the installed build reports **${found || "an unreadable version"}**.`,
    "",
    "Older builds silently ignore `--model` and `--effort` in headless runs and predate",
    "the JSON output format this companion reads, so it refuses rather than run blind.",
    "",
    "Update it:",
    "",
    "```bash",
    "agy update",
    "```",
    "",
    "Then run `/antigravity:setup` to confirm.",
  ];
  return ensureTrailingNewline(lines.join("\n"));
}

/** A --agy-arg token tried to overwrite a flag the companion owns. */
export function renderRejectedArgs(rejected) {
  const lines = [
    "# 🛰️ Antigravity — unsupported passthrough",
    "",
    `\`--agy-arg\` cannot set ${rejected.map((r) => `\`${r}\``).join(", ")}.`,
    "",
    "The companion owns those flags: they carry the prompt, the log file it reads errors",
    "from, and the JSON output format it parses. Overriding them would break the run.",
    "",
    "Everything else passes through, one token per occurrence:",
    "",
    "```bash",
    "--agy-arg --mode --agy-arg plan",
    "```",
  ];
  return ensureTrailingNewline(lines.join("\n"));
}

/** Quota / auth / backend error, with concrete next steps. */
export function renderError(error, meta = {}) {
  const lines = [`# 🛰️ Antigravity — ${meta.title || "error"}`, ""];
  if (!error) {
    lines.push("Antigravity returned no output and no recognizable error was found in the log.");
    if (meta.logFile) lines.push("", `Log: \`${meta.logFile}\``);
    return ensureTrailingNewline(lines.join("\n").trimEnd());
  }

  if (error.kind === "quota") {
    lines.push("**Antigravity quota is exhausted** (`RESOURCE_EXHAUSTED`, 429).");
    if (error.resetsIn) lines.push("", `Quota resets in **${error.resetsIn}**.`);
    lines.push(
      "",
      "What to do:",
      "- Wait for the reset, or switch the active Google account used by `agy`.",
      "- Meanwhile, Claude Code can keep handling the task itself.",
    );
  } else if (error.kind === "permission") {
    lines.push(`**${error.message}**`);
    lines.push(
      "",
      "Antigravity produced nothing because headless mode cannot prompt for approval, so",
      "every tool needing it was auto-denied. Pick one:",
      "",
      "- Drop `--no-yolo` — without it the companion already passes `--dangerously-skip-permissions`.",
      "- Or add an allow-rule under `permissions.allow` in `~/.gemini/antigravity-cli/settings.json`",
      "  (for example `command(<target>)`), or set `toolPermission` back to `always-proceed`.",
      "- Or re-run read-only with `--read-only`, which does not need those tools.",
    );
  } else if (error.kind === "auth") {
    lines.push("**Antigravity is not authenticated.**");
    lines.push("", "Run this once in your shell to sign in, then retry:", "", "```bash", "agy", "```");
    lines.push("(In Claude Code you can run it inline by typing `! agy`.)");
  } else {
    lines.push("**Antigravity backend error.**", "", "```text", error.message, "```");
  }

  if (meta.conversationId) lines.push("", `Conversation: \`${meta.conversationId}\``);
  if (meta.logFile) lines.push(`Log: \`${meta.logFile}\``);
  const cost = usageLine(meta);
  if (cost) lines.push(cost);
  return ensureTrailingNewline(lines.join("\n").trimEnd());
}

export function renderNotInstalled() {
  const lines = [
    "# 🛰️ Antigravity — not installed",
    "",
    "The `agy` binary was not found.",
    "",
    "Install it (official Google installer):",
    "",
    "```bash",
    "# macOS / Linux",
    "curl -fsSL https://antigravity.google/cli/install.sh | bash",
    "# Windows (PowerShell)",
    "irm https://antigravity.google/cli/install.ps1 | iex",
    "```",
    "",
    "Then run `/antigravity:setup` again. If `agy` is installed in a custom path, set",
    "`ANTIGRAVITY_CC_AGY_BIN=/full/path/to/agy`.",
  ];
  return ensureTrailingNewline(lines.join("\n"));
}

export function renderSetup(report) {
  const lines = [
    "# 🛰️ Antigravity — setup",
    "",
    `Status: ${report.ready ? "✅ ready" : "⚠️ needs attention"}`,
    "",
    "Checks:",
    `- agy binary: ${report.binary.detail}`,
    `- version: ${report.version || "unknown"}${report.minVersion ? ` (need >= ${report.minVersion})` : ""}`,
    `- config dir: ${report.configDir.detail}`,
    `- auth: ${report.auth.detail}`,
    "",
  ];
  if (report.nextSteps.length) {
    lines.push("Next steps:");
    for (const step of report.nextSteps) lines.push(`- ${step}`);
  }
  return ensureTrailingNewline(lines.join("\n").trimEnd());
}

export function renderBackgroundStarted(job) {
  const lines = [
    `# 🛰️ Antigravity — started in background`,
    "",
    `Job \`${job.id}\` (${job.kind}) is running in Antigravity.`,
    job.title ? `Task: ${job.title}` : "",
    "",
    "Check on it:",
    `- \`/antigravity:status ${job.id}\` — progress`,
    `- \`/antigravity:result ${job.id}\` — final output`,
    `- \`/antigravity:cancel ${job.id}\` — stop it`,
  ].filter(Boolean);
  return ensureTrailingNewline(lines.join("\n"));
}

/** "just now" / "4m ago" / "3h ago" / "2d ago". Null when the timestamp is unusable. */
function relativeAge(iso) {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

function jobLine(job) {
  const bits = [`\`${job.id}\``, job.status];
  // Without an age, a stale failure from last week reads exactly like one from this
  // run, and `status` lists both together.
  const age = relativeAge(job.finishedAt || job.startedAt);
  if (age) bits.push(age);
  if (job.kind) bits.push(job.kind);
  if (job.title) bits.push(job.title);
  return `- ${bits.join(" · ")}`;
}

export function renderStatus(jobs) {
  const lines = ["# 🛰️ Antigravity — status", ""];
  const running = jobs.filter((j) => j.status === "running");
  const finished = jobs.filter((j) => j.status !== "running");

  if (running.length) {
    lines.push("Running:");
    for (const j of running) lines.push(jobLine(j));
    lines.push("");
  }
  if (finished.length) {
    lines.push("Recent:");
    for (const j of finished.slice(0, 8)) {
      lines.push(jobLine(j) + (j.conversationId ? ` · conv \`${j.conversationId}\`` : ""));
    }
  }
  if (!running.length && !finished.length) {
    lines.push("No Antigravity jobs recorded for this repository yet.");
  }
  return ensureTrailingNewline(lines.join("\n").trimEnd());
}

export function renderJobStatus(job) {
  const lines = [
    `# 🛰️ Antigravity — job ${job.id}`,
    "",
    `Status: ${job.status}`,
    job.title ? `Task: ${job.title}` : "",
    job.conversationId ? `Conversation: \`${job.conversationId}\`` : "",
    `Started: ${job.startedAt}`,
    job.finishedAt ? `Finished: ${job.finishedAt}` : "",
    job.error ? `Error: ${job.error}` : "",
  ].filter(Boolean);
  if (job.status === "running") {
    lines.push("", `Get the result when done: \`/antigravity:result ${job.id}\``);
  } else {
    lines.push("", `See full output: \`/antigravity:result ${job.id}\``);
  }
  return ensureTrailingNewline(lines.join("\n"));
}

export function renderCancel(result, job) {
  const lines = [`# 🛰️ Antigravity — cancel`, ""];
  if (result.cancelled) lines.push(`Cancelled job \`${job.id}\`.`);
  else lines.push(`Could not cancel \`${job?.id ?? "?"}\`: ${result.reason}.`);
  return ensureTrailingNewline(lines.join("\n"));
}

export { ensureTrailingNewline };
