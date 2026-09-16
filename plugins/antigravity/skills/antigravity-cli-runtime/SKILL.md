---
name: antigravity-cli-runtime
description: Internal helper contract for calling the antigravity companion runtime from Claude Code
user-invocable: false
---

# antigravity-cli-runtime

Internal contract for the `antigravity:antigravity-pair` subagent. Not user-facing. This documents the one helper the subagent calls and the rule it follows.

## Primary helper

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/antigravity.mjs" delegate "<task>" [flags]
```

`delegate` hands the task to Google's Antigravity CLI (`agy`) non-interactively via `agy -p`. It is **write-capable by default** — it can edit files and run commands in this repo. Contain it with `--read-only` or `--sandbox` when the task should not mutate the working tree.

The companion requires **`agy` >= 1.1.10** and refuses to run against anything older, because those builds silently ignore `--model`/`--effort` in headless runs and predate the JSON output format it reads. If it reports that, tell the user to run `agy update`.

## The one rule: thin forwarder

The subagent makes **exactly one** Bash call to `delegate` and returns its stdout **verbatim**.

- Do not inspect the repo, read files, run git, or pre-analyze before forwarding.
- Do not reword, summarize, truncate, or reformat the companion's output.
- Do not chain calls or call any other subcommand.
- Pass the user's task and any caller-supplied flags straight through.

The companion owns binary detection, sandboxing, timeouts, the conversation id, and quota handling (on `RESOURCE_EXHAUSTED` it surfaces the reset window recovered from the log). The subagent's job is to forward and relay.

## Flags on `delegate`

| Flag | Effect |
|------|--------|
| `--background` | Spawn a background job; returns a job id instead of blocking. |
| `--sandbox` | Run contained — no host writes. |
| `--read-only` | Allow reads, block edits/commands. |
| `--continue`, `-c` | Continue the most recent Antigravity conversation. |
| `--conversation <id>` | Continue a specific conversation by id. |
| `--add-dir <path>` | Grant access to an extra directory (repeatable). |
| `--print-timeout <go-dur>` | Cap the print-mode run, e.g. `10m`, `90s`. Defaults to `10m`. |
| `--model <slug>` | Override the model for this session, e.g. `gemini-3.1-pro-high`, `claude-sonnet-4-6`. Only add it when the user names a specific model. |
| `--effort <low\|medium\|high>` | Reasoning effort. Only add it when the user asks for one. |
| `--no-slash-commands` | Stop `agy` expanding its own slash commands and skills in the prompt. Off by default. |
| `--agy-arg <token>` | Pass one raw token through to `agy`; repeat per token. Escape hatch for unwrapped flags. |

## Model and effort

Without `--model` the run uses whatever `agy`'s own settings default to (set with `/model` inside the TUI, persisted in `settings.json`). Run `agy models` for the live catalog — the slugs change between releases, so never hardcode one.

`--effort` is **not** a second way to say the same thing. Most slugs already encode a level (`gemini-3.8-flash-high`), a base model name with variants *requires* `--effort`, and a model with no effort axis (`claude-sonnet-4-6`) rejects it. `agy` validates the pair itself and returns a clear error, so forward both verbatim rather than second-guessing them.

## Slash commands and skills

`agy` expands its own slash commands and skills on the prompt text in print mode, and the companion leaves that **on** — an `agy`-side skill firing on the task is a feature, not a leak. `--no-slash-commands` is the opt-out for the rare task whose text contains a literal `/something` that must survive unexpanded.

## Other subcommands (not for this subagent)

The companion also exposes `review`, `resume`, `status`, `result`, and `cancel`. The `antigravity:antigravity-pair` subagent **only** calls `delegate`. The others are driven by their own slash commands, not from here.
