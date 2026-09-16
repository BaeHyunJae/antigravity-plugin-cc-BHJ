---
description: Hand a task to Antigravity and get the result back inside Claude Code.
argument-hint: "[--background|--wait] [--sandbox|--read-only] [--continue|--fresh] [--conversation <id>] [--add-dir <path>] [--model <slug>] [--effort <level>] [--no-slash-commands] [--agy-arg <token>] [what Antigravity should build, investigate, or fix]"
allowed-tools: Bash(node:*), AskUserQuestion, Agent
---

Hand the user's task to Antigravity via the `antigravity:antigravity-pair` subagent, and show them exactly what came back.

The user's full request is:

$ARGUMENTS

## What to do

1. **If the request has no actual task** (empty, or only execution flags like `--background`/`--wait`/`--sandbox` with nothing to do), ask what Antigravity should work on with `AskUserQuestion`, then continue. Don't guess a task.

2. **Read the execution flags, then strip them from the task text.** `--background` and `--wait` control how *you* run the subagent — they are not part of the natural-language task and must NOT be forwarded as task text:
   - `--background` → invoke the subagent in the **background**.
   - `--wait` or neither flag → invoke the subagent in the **foreground** (default). `--wait` is just the explicit name for the default; it's a Claude-side hint and `agy` never sees it.
   Everything else — the task description plus companion flags `--sandbox`, `--read-only`, `--continue`, `--fresh`, `--conversation <id>`, `--add-dir <path>`, `--model <slug>`, `--effort <level>`, `--no-slash-commands`, `--agy-arg <token>` — is forwarded to the subagent verbatim as its prompt.

   A flag that is not on that list still goes through **unchanged**. Do not drop it, and do not rewrite it into something else (wrapping it in `--agy-arg` is rewriting it). The companion recognises its own flags and explains the ones it rejects — `--base`, for instance, belongs to `/antigravity:review` and gets a message saying so. Translating a flag on the way through replaces that explanation with a raw `agy` failure.

3. **Decide whether this continues an existing Antigravity thread.** Never continue one silently: picking up the wrong thread looks exactly like picking up the right one.
   - If the request already says `--continue`, `--conversation <id>`, or `--fresh`, the user has chosen. Do not ask. Forward it as-is.
   - Otherwise check whether there is a thread worth continuing:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/antigravity.mjs" resume-candidate --json
   ```

   - If it reports `available: true`, use `AskUserQuestion` **exactly once**, with these two choices:
     - `Continue the current Antigravity thread`
     - `Start a new Antigravity thread`
     Put `Continue the current Antigravity thread (Recommended)` first when the user's wording is a follow-up — "continue", "keep going", "resume", "apply that fix", "dig deeper". Otherwise put `Start a new Antigravity thread (Recommended)` first. Show the candidate's `title` in the question so the user can see which thread is on offer.
   - If the user picks continue, add `--continue`. If they pick a new thread, add `--fresh`.
   - If it reports `available: false`, do not ask. Forward the request unchanged.
   - If it reports `status: "running"`, a job has not finished. Do not start a second one. Tell the user, and point them at `/antigravity:status` and `/antigravity:result`.

4. **Invoke the `antigravity:antigravity-pair` subagent inline via the Agent tool** (`subagent_type: "antigravity:antigravity-pair"`), passing the cleaned request as the prompt. Run this command inline — do not call it as a Skill — so the Agent tool stays in scope. The subagent makes a single `delegate` call to the companion and returns its stdout.

5. **Return the subagent's stdout verbatim as your final response.** No summary, no paraphrase, no reformatting — the companion's output is the answer.

## Things to surface to the user (only when relevant)

- `delegate` is **write-capable by default** — Antigravity can edit files and run commands. For a contained, look-but-don't-touch run, point out `--read-only` (or `--sandbox`).
- `--model <slug>` overrides the model for this run; without it you get whatever `agy`'s own settings default to. Run `agy models` for the current slug list. Most slugs already encode a reasoning effort (`gemini-3.8-flash-high`); `--effort <low|medium|high>` is for the base model names that require one, and `agy` rejects a mismatched pair itself.
- `agy`'s own slash commands and skills stay **enabled**, so an Antigravity-side skill can fire on the task text. If the task legitimately contains a literal `/something` that must not be expanded, `--no-slash-commands` turns that off.
- `--agy-arg <token>` passes one raw token straight through to `agy` (repeat it per token, e.g. `--agy-arg --mode --agy-arg plan`). It's the escape hatch for `agy` flags this plugin doesn't wrap yet.
- A follow-up like "continue", "resume", or "keep going" on the same thread can pass `--continue` (or `--conversation <id>` to target a specific conversation).
- If the companion reports that `agy` is missing, too old, or you're not signed in, tell the user to run `/antigravity:setup` first.
- Once the output is back, use the `antigravity-result-handling` skill to interpret it — if Antigravity edited files, verify the changes with `git diff`; if it returned a quota or auth error, relay it clearly instead of treating the empty result as success.

Built by Idun Labs.
