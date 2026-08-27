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

`delegate` hands the task to Google's Antigravity CLI (`agy`, Gemini 3.5) non-interactively via `agy -p`. It is **write-capable by default** — it can edit files and run commands in this repo. Contain it with `--read-only` or `--sandbox` when the task should not mutate the working tree.

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
| `--print-timeout <go-dur>` | Cap the print-mode run, e.g. `10m`, `90s`. |
| `--model <slug>` | Override the model for this session, e.g. `gemini-3.1-pro-high`, `claude-sonnet-4-6`. Only add it when the user names a specific model. |

## Model flag

The default model (Gemini 3.5 Flash, or whatever `/model` set inside the `agy` TUI, persisted in `settings.json`) is used unless the caller passes `--model`. The companion itself checks the installed `agy` version and silently drops `--model` with a stderr note on builds too old to honor it (pre-`1.1.10`) — the subagent does not need to know the version, just forward the flag when the user asked for a specific model.

## Other subcommands (not for this subagent)

The companion also exposes `review`, `resume`, `status`, `result`, and `cancel`. The `antigravity:antigravity-pair` subagent **only** calls `delegate`. The others are driven by their own slash commands, not from here.
