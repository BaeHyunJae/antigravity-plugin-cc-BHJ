---
description: Hand a task to Antigravity (Gemini 3.5) and get the result back inside Claude Code.
argument-hint: "[--background|--wait] [--sandbox|--read-only] [--continue] [--conversation <id>] [--add-dir <path>] [--model <slug>] [what Antigravity (Gemini 3.5) should build, investigate, or fix]"
allowed-tools: AskUserQuestion, Agent
---

Hand the user's task to Antigravity (Gemini 3.5) via the `antigravity:antigravity-pair` subagent, and show them exactly what came back.

The user's full request is:

$ARGUMENTS

## What to do

1. **If the request has no actual task** (empty, or only execution flags like `--background`/`--wait`/`--sandbox` with nothing to do), ask what Antigravity should work on with `AskUserQuestion`, then continue. Don't guess a task.

2. **Read the execution flags, then strip them from the task text.** `--background` and `--wait` control how *you* run the subagent — they are not part of the natural-language task and must NOT be forwarded as task text:
   - `--background` → invoke the subagent in the **background**.
   - `--wait` or neither flag → invoke the subagent in the **foreground** (default). `--wait` is just the explicit name for the default; it's a Claude-side hint and `agy` never sees it.
   Everything else — the task description plus companion flags `--sandbox`, `--read-only`, `--continue`, `--conversation <id>`, `--add-dir <path>`, `--model <slug>` — is forwarded to the subagent verbatim as its prompt.

3. **Invoke the `antigravity:antigravity-pair` subagent inline via the Agent tool** (`subagent_type: "antigravity:antigravity-pair"`), passing the cleaned request as the prompt. Run this command inline — do not call it as a Skill — so the Agent tool stays in scope. The subagent makes a single `delegate` call to the companion and returns its stdout.

4. **Return the subagent's stdout verbatim as your final response.** No summary, no paraphrase, no reformatting — the companion's output is the answer.

## Things to surface to the user (only when relevant)

- `delegate` is **write-capable by default** — Gemini 3.5 can edit files and run commands. For a contained, look-but-don't-touch run, point out `--read-only` (or `--sandbox`).
- `--model <slug>` overrides the model for this run (default Gemini 3.5 Flash). Run `agy models` for the current slug list. Needs `agy >= 1.1.10`; older builds get a stderr warning and the flag is dropped.
- A follow-up like "continue", "resume", or "keep going" on the same thread can pass `--continue` (or `--conversation <id>` to target a specific conversation).
- If the companion reports that `agy` is missing or you're not signed in, tell the user to run `/antigravity:setup` first.
- Once the output is back, use the `antigravity-result-handling` skill to interpret it — if Gemini 3.5 edited files, verify the changes with `git diff`; if it returned a quota or auth error, relay it clearly instead of treating the empty result as success.

Built by Idun Labs.
