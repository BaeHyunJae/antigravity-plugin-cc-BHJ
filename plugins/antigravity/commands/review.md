---
description: Cross-model code review of your changes by Gemini 3.5 (read-only, contained).
argument-hint: "[--base <ref>] [--background] [--model <slug>] [focus text]"
allowed-tools: Bash(node:*)
disable-model-invocation: true
---

Get a second pair of eyes on your work. This runs a **read-only** review of your current changes through Antigravity (Gemini 3.5) and brings the findings straight back into Claude Code. It is sandboxed — it reads the diff and reports, it never edits files or runs commands against your tree.

Run the companion and present its output:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/antigravity.mjs" review $ARGUMENTS
```

Then show the review verbatim, then add a one-line summary of the most important finding (if any). Use the `antigravity-result-handling` skill to interpret the companion output first — distinguish a real review from a quota/auth/backend error so you never present an empty result as a clean review.

## What the arguments do

- **No `--base`** — reviews your **uncommitted changes** (working tree vs HEAD). This is the default and the common case.
- **`--base <ref>`** — reviews `<ref>...HEAD` instead. Use `--base main` to review the whole branch, `--base HEAD~3` for the last three commits.
- **Trailing focus text** — anything after the flags steers the review. Point Gemini at what you care about: `security`, `error handling`, `the new retry logic`, `concurrency bugs`.
- **`--background`** — for large diffs, run it as a job and keep working. You get a job id back; check progress with `/antigravity:status` and pull the finished review with `/antigravity:result`.
- **`--model <slug>`** — review with a specific model instead of the default. Run `agy models` for slugs. Needs `agy >= 1.1.10`, otherwise it's dropped with a stderr note.

## Examples

```
/antigravity:review
/antigravity:review --base main security and input validation
/antigravity:review --background race conditions in the worker pool
```

## Notes

- The review is contained and read-only — Gemini sees the git diff embedded in the prompt and reports back. Nothing in your repo changes.
- Antigravity is in preview with a quota. If the review comes back empty, you're likely rate-limited — the companion surfaces the reset time when it can. Wait it out and rerun.
- First time? You need to be signed in to Antigravity once. Run `/antigravity:setup` to check, and if it reports you're not authed, type `! agy` to do the one-time Google OAuth in your browser.

_Powered by Google Antigravity (`agy`, Gemini 3.5). Plugin by Idun Labs._
