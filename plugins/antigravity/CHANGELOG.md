# Changelog

All notable changes to the `antigravity` plugin are documented here.

## [0.2.0] — 2026-09-16

Resynchronized with `agy` 1.2.4. The 0.1.0 companion was built against `agy` 1.0.3,
and three of its core assumptions had since stopped being true.

### Changed
- **Failure detection is now a three-signal ladder: exit code, then the JSON envelope, then the log.**
  0.1.0 assumed `agy` always exits 0 and judged success by "was stdout empty". `agy` 1.1.1
  fixed print mode to return a non-zero exit code on server-side failures, and 1.1.20
  narrowed exit codes to cascade-level failures — so a non-zero exit is now a confirmed
  failure, while exit 0 proves nothing and the envelope decides.
- **Runs request `--output-format json` (added in `agy` 1.1.8).** The conversation id,
  status and error come from structured fields instead of log heuristics.
- **Log scanning is now a fallback, not the primary channel.** It still runs when stdout
  comes back empty — reported upstream for non-TTY pipes, which is how the companion
  spawns `agy`.
- **Minimum supported `agy` is 1.1.10**, the release where `--model` and `--effort` are
  actually applied in headless `-p` runs. Below that the companion refuses instead of
  running with flags that would be silently ignored. Replaces the old per-flag gate.
- The `agy` version probe is cached per binary path and mtime, so the version check does
  not cost a process spawn on every run.
- Auth detection recognizes SQLite conversation files (`<id>.db`); `agy` 1.2.x no longer
  writes the protobuf (`<id>.pb`) threads 0.1.0 looked for.
- Model names are no longer pinned in prose. `agy models` is the source of truth, and
  the model catalog has no "Gemini 3.5" entry.

### Added
- `--effort <low|medium|high>` on `delegate` / `review` / `resume`. Effort is part of most
  model slugs (`gemini-3.8-flash-high`), but base model names require it, and `agy`
  rejects a mismatched pair itself.
- `--agy-arg <token>` — repeatable escape hatch that passes one raw token through to `agy`,
  so a newly added `agy` flag does not need a plugin release. Tokens that would overwrite
  the flags the companion owns (`-p`, `--log-file`, `--output-format`, …) are rejected.
- `--no-slash-commands` — opt out of `agy`'s own slash-command and skill expansion. It stays
  **on** by default so an `agy`-side skill can fire on the prompt.
- Every response footer reports run cost: `6.0s · 31.7k in / 588 out / 470 thinking`. The
  thinking and cached components appear only when non-zero. Quota exhaustion is
  this plugin's most common failure and was previously invisible until it happened.
- Cancelled and interrupted turns are reported as such rather than as backend errors, with
  whatever partial output they produced.
- `disable-model-invocation` on `cancel`, `result`, `status`, `review` and `resume`, so the
  model cannot spend tokens calling them on its own.
- `/antigravity:status` shows how long ago each job ran. Without it a stale failure from days
  ago reads exactly like one from the current session, since both appear in the same list.

### Fixed
- **Failures are no longer diagnosed from log severity.** A successful `agy` 1.2.x run writes
  around 36 `E`-severity lines and 57 copies of "You are not logged into Antigravity." to its
  log while starting up, plus several benign lines mentioning `quotaProject` and
  `doRefreshQuota`. The old scan treated any `E` line, or the bare word "quota", as evidence,
  so on the fallback path every run diagnosed itself as a quota or auth failure. The scan now
  matches an allowlist of strings verified absent from a healthy run's log
  (`RESOURCE_EXHAUSTED`, `UNAUTHENTICATED`, `PERMISSION_DENIED`, `agent executor error`,
  `Individual quota reached`, `code 4xx/5xx`).
- **`agy`'s own error message now outranks anything inferred from the log.** Running
  `--model gemini-3.8-flash-low --effort high` reported "Antigravity quota is exhausted, wait
  for the reset" instead of `--model gemini-3.8-flash-low conflicts with --effort=high`.
- **A permission-denied run is no longer reported as a successful empty answer.** Under a
  restrictive `toolPermission`, `agy` returns `status: "SUCCESS"` with an empty `response`, no
  `error`, and the refusals only in `denied_actions` — a fourth failure signal independent of
  the exit code, the status and the error field. The companion now names the refused tools and
  says how to unblock them, and flags a partial answer when some tools were refused but the run
  still produced output. Reachable via `--no-yolo`; the default path passes
  `--dangerously-skip-permissions`.
- `agy`'s own print-timeout expiry returns partial output and exits 0 as of 1.1.28. That is
  now reported as an incomplete response instead of being mistaken for a clean run.
- **`/antigravity:review` no longer dies on a real working tree.** The prompt travels in argv
  as `-p <prompt>` (`-p` is a string flag — there is no plain-stdin fallback), and Windows caps
  an entire command line at 32,767 characters. The old 100 KiB clamp was three times that, so a
  review of this repo's own 160 KB diff failed with a raw `spawnSync ... ENAMETOOLONG` before
  `agy` ever started. The prompt budget is now computed from what the command line has left
  after every other flag, and the diff is trimmed **at a file boundary** rather than mid-hunk.
- **A partial review says so.** The prompt tells the model the diff is incomplete and to state
  that up front, and the output tells the user how many of the changed files were covered and
  suggests narrowing with `--base <ref>`. Previously a review of half a diff was indistinguishable
  from a review of all of it.
- **A backgrounded permission-denied run is no longer filed as `done`.** `reconcile()` and
  `cmdResult()` each carried their own copy of the success decision, so the fix above only landed
  on the foreground path; the shared check now lives in `lib/envelope.mjs`.
- **A resumed conversation no longer reports a misleading duration.** On a continued thread
  `duration_seconds` is wall time since the conversation was created (measured: 2258s on turn 2),
  not the turn — printed beside this turn's token counts it read as a 38-minute run. Continued
  threads now report `turn N` and let the token counts carry the cost.
- **`/antigravity:result` no longer loses a foreground run.** A background job's stdout lands in
  `output.txt` and `result` replays it from there; a foreground run kept its stdout in memory
  only, so asking for the result afterwards reported "no output and no recognizable error" —
  including for runs that had just succeeded, and for failures whose specific message the user
  had already seen live. Foreground runs now persist the same files a background run writes.
  A job recorded before that says its output was not retained instead of implying it failed.
- **`/antigravity:result` on a cancelled job no longer reports a backend failure.** `cancelJob`
  only marks the record — there is no envelope saying `CANCELED` — so a job the user stopped
  themselves fell through to the generic error path.
- **A failure replayed from the job record keeps its classification.** The record fallback
  hardcoded a generic backend error, so a stored quota failure lost its reset window and its
  next steps; it now goes through the same classifier as a live one. Relatedly, the reset window
  is now persisted into the stored message for foreground runs, matching what background jobs
  already did.
- A run that fails before reaching the model no longer prints `0.0s · 0 in / 0 out` under the
  error.

### Grounded against
- `agy` 1.2.4 (Antigravity CLI), Windows, September 2026. Measured on 1.2.3 and re-confirmed
  live on 1.2.4 after `agy` auto-updated mid-development; the contract was unchanged.
- Claude Code 2.1.273.

## [0.1.0] — 2026-05-31

Initial release.

### Added
- `/antigravity:setup` — detect the `agy` binary, version, and auth state; offer to install if missing.
- `/antigravity:delegate` — hand a task to Antigravity via the `antigravity-pair` subagent; foreground or `--background`.
- `/antigravity:review` — get a read-only, cross-model code review of your current diff (or a branch via `--base <ref>`).
- `/antigravity:resume` — continue the most recent Antigravity conversation, or a specific one with `--conversation <id>`.
- `/antigravity:status`, `/antigravity:result`, `/antigravity:cancel` — manage background jobs.
- `antigravity-pair` subagent for delegation.
- Skills: `antigravity-cli-runtime`, `antigravity-result-handling`, `gemini-3-prompting`.
- Node companion runtime (`scripts/antigravity.mjs`) driving `agy --print` with robust log scanning:
  recovers the conversation ID and surfaces quota/auth/backend errors that `agy` hides behind exit code 0.

### Grounded against
- `agy` 1.0.3 (Antigravity CLI), macOS, May 2026.
