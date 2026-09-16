# Antigravity CLI (`agy`) — grounded reference

> **Grounded against `agy` 1.2.4 on Windows, September 2026**, plus the official docs
> at <https://antigravity.google/docs/> and `agy changelog`. This is the contract the
> plugin is built against.
>
> Every claim below is tagged:
> **[measured]** — observed on this machine. Measurements were taken on 1.2.3 and
> re-confirmed on 1.2.4, which `agy` auto-updated to the same day; the flag surface and
> the JSON envelope were identical across both.
> **[changelog]** — stated in `agy changelog` or the official docs, not reproduced here.
> **[binary]** — read out of the `agy` binary's own format strings.
>
> The flag and subcommand tables are **generated**. If `agy` changes a flag, run
> `npm run gen:cli-ref` and update the prose and
> `plugins/antigravity/scripts/lib/agy.mjs` in the same commit.

## What `agy` is

The **Antigravity CLI** (binary: **`agy`**) is the terminal surface of Google
Antigravity. It shares config, auth, and the agent core with the Antigravity IDE.
It descends from Gemini CLI — config lives under `~/.gemini/antigravity-cli/`.

**Models are not pinned here.** Run `agy models` for the live catalog; the slugs change
between releases. As of 1.2.4 the catalog is `gemini-3.8-flash-{high,medium,low}`,
`gemini-3.7-flash-*`, `gemini-3.6-flash-*`, `gemini-3.1-pro-{high,low}`,
`claude-sonnet-4-6`, `claude-opus-4-6-thinking`, `gpt-oss-120b-medium`, and the default
model is whatever `settings.json` holds (`Gemini 3.8 Flash (Medium)` out of the box). **[measured]**

## Install

```bash
# macOS / Linux
curl -fsSL https://antigravity.google/cli/install.sh | bash      # → ~/.local/bin/agy

# Windows (PowerShell)
irm https://antigravity.google/cli/install.ps1 | iex             # → %LOCALAPPDATA%\agy\bin
```

Installer flags: `-d/--dir <path>` (custom install dir). The `agy install`
subcommand configures PATH/aliases (`--skip-aliases`, `--skip-path`, `--dir`).

## Auth (important for this plugin)

- First launch performs **silent keyring sign-in** (Apple Keychain / Linux Secret
  Service / Windows Credential Manager). If a token is found, auth is silent.
- If not, `agy` opens a **browser OAuth** flow (Google account). Over SSH it prints
  a URL + code loop.
- There is **no API-key env var** for the standard preview tier — auth is
  keyring/OAuth. (`agy` does read `~/.gemini/config/mcp_config.json` for MCP.)
- Log out with `/logout` inside the TUI.

**Consequence for the plugin:** the plugin never logs you in. If you have never
run `agy`, run it once interactively (`! agy`) to authenticate, then use the
plugin.

## Flags

<!-- generated:agy-flags -->

_Generated from `agy --help` (1.2.4) by `npm run gen:cli-ref`. Do not edit by hand._

| Flag | Meaning |
| --- | --- |
| `--add-dir` | Add a directory to the workspace (repeatable). Default: `[]`. |
| `--agent` | Agent for the current CLI session |
| `-c` | Short alias for --continue |
| `--continue` | Continue the most recent conversation |
| `--conversation` | Resume a previous conversation by ID |
| `--dangerously-skip-permissions` | Auto-approve all tool permission requests without prompting |
| `--disable-slash-commands` | Disable slash command and skill expansion in print mode |
| `--effort` | Reasoning effort for the current CLI session (low\|medium\|high) |
| `-i` | Short alias for --prompt-interactive |
| `--input-format` | Input format for print mode (text, stream-json). stream-json reads one NDJSON message per line from stdin and runs a turn for each; it requires --output-format stream-json. Default: `text`. |
| `--json-schema` | Optional JSON schema string or path to a schema file to enforce structured output (for stream-json, only applicable to the final result) |
| `--log-file` | Override CLI log file path |
| `--mode` | Set the agent execution mode for this session (accept-edits, plan) |
| `--model` | Model for the current CLI session |
| `--new-project` | Create a new project for this session |
| `--output-format` | Output format for print mode (text, json, stream-json). Default: `text`. |
| `-p` | Short alias for --print |
| `--print` | Run a single prompt non-interactively and print the response |
| `--print-timeout` | Timeout for print mode wait. Default: `5m0s`. |
| `--project` | Project ID or project name for the current CLI session |
| `--prompt` | Alias for --print |
| `--prompt-interactive` | Run an initial prompt interactively and continue the session |
| `--sandbox` | Run in a sandbox with terminal restrictions enabled |

<!-- /generated:agy-flags -->

> The companion always passes `--print-timeout 10m` (and adds a +60s process watchdog on
> top) unless the caller overrides it, so the **effective default the plugin gives you is
> 10m**, not `agy`'s own `5m0s`.

## Subcommands

<!-- generated:agy-subcommands -->

_Generated from `agy --help` (1.2.4) by `npm run gen:cli-ref`. Do not edit by hand._

| Subcommand | Meaning |
| --- | --- |
| `agent` | List available agents |
| `agents` | List available agents |
| `changelog` | Show changelog and release notes |
| `help` | Show help for subcommands |
| `install` | Configure environment paths and shell settings |
| `mcp` | Manage MCP servers (add, remove, list, enable, disable) |
| `mic-serve` | Serve this machine's microphone to a CLI on another host |
| `models` | List available models |
| `plugin` | Manage plugins (install, uninstall, list, enable, disable) |
| `plugins` | Alias for plugin |
| `remote-control` | Manage the remote-control background daemon (start, status, stop) |
| `update` | Update CLI |

<!-- /generated:agy-subcommands -->

## When each flag became usable

The flag existing is not the same as the flag working in headless `-p` mode. **[changelog]**

| Flag | Added | Usable headless from |
| --- | --- | --- |
| `--project` / `--new-project` | 1.0.12 | 1.0.12 (project *names*, not just IDs, from 1.1.18) |
| `--agent` | 1.1.1 | parsed and validated in `-p`; functional application not confirmed |
| `--effort` | 1.1.5 | **1.1.10** — silently ignored in `-p` before that |
| `--model` | 1.1.5 | **1.1.10** — silently ignored in `-p` before that |
| `--output-format` / `--json-schema` | 1.1.8 | 1.1.8 |
| `--mode` | ~1.1.0 | 1.1.12 — entirely ignored in `-p` before that |

**This is why the plugin requires `agy >= 1.1.10`** (`MIN_AGY_VERSION` in
`plugins/antigravity/scripts/lib/agy.mjs`). Below it, `--model` and `--effort` are
accepted and discarded, and there is no JSON output format to parse.

### `--model` and `--effort` together

`--effort` is not redundant with the effort suffix baked into most slugs, and a
mismatched pair is an error rather than a silent override. The binary's own format
strings: **[binary]**

```
--model %s conflicts with --effort=%s
invalid model selection (--model %q --effort %q): %w
--effort is not supported for model %q
--model %s requires --effort (available: %s)
invalid --effort %q (valid: %s)
```

So: a base model name with effort variants **requires** `--effort`; a slug that already
encodes an effort rejects a different one; a model with no effort axis
(`claude-sonnet-4-6`, `gpt-oss-120b-medium`) rejects `--effort` entirely. The companion
forwards both verbatim and surfaces `agy`'s error rather than reimplementing this.

### Flags that are unsafe to expose headlessly

`--agent <name>` is **accepted and silently discarded** in `-p` mode. Running
`agy --sandbox --output-format json --agent definitely-not-an-agent -p "x"` on 1.2.3 returned
exit 0 with a normal `SUCCESS` envelope and an ordinary model answer — no validation error, no
warning, and no indication that the named agent was never used. A typo therefore buys you the
default agent and no way to notice. This is the same failure mode as pre-1.1.10 `--model`, which
is why the companion does not wrap `--agent`; `--agy-arg --agent --agy-arg <name>` remains
available for anyone who accepts that risk knowingly. **[measured]**

### Slash commands and skills in print mode

`agy` expands its own slash commands and skills against the prompt text in print mode. When a
prompt starts with a slash command, the slash layer answers it and the model is never called: **[measured]**

```
agy --sandbox --output-format json -p "/help"
  → {"conversation_id":"", "status":"SUCCESS", "response":"/agents\tList available custom agents\n...",
     "duration_seconds":0, "num_turns":0}

agy --sandbox --output-format json --disable-slash-commands -p "/help"
  → a real conversation id, a real model call, and an answer that invents commands that do not exist
```

Two consequences. The intercepted form costs no quota but yields **no conversation id**, so there
is no thread to resume. And expansion is genuinely useful — an `agy`-side skill can fire on the
task — which is why the companion leaves it on and exposes `--no-slash-commands` as the opt-out
rather than the other way round.

The command list `/help` returns is worth knowing: `/agents`, `/changelog`, `/config`,
`/credits`, `/effort`, `/help`, `/hooks`, `/model`, `/permissions`, `/skills`, `/usage`.
`/usage` and `/credits` report quota and remaining credits for free.

### The prompt travels in argv, and that is a hard ceiling

`-p` is a **string flag that requires a value** — `echo "task" | agy -p` fails with
`flag needs an argument: -p`, and `--print` behaves the same. The only stdin path is
`--input-format stream-json`, which in turn requires `--output-format stream-json`. **[measured]**

So the prompt is an argv argument, and the operating system caps it:

| Platform | Limit | Measured |
| --- | --- | --- |
| Windows | 32,767 characters for the **entire** command line (`CreateProcessW`) | a 32,648-byte prompt spawns; 32,760 fails with `ENAMETOOLONG` |
| POSIX | `ARG_MAX`, typically megabytes | not the binding constraint |

The limit covers the binary path and every other flag too, so `--add-dir <repo>`,
`--log-file <job path>` and friends all eat into the prompt's share. This is why the companion
computes a budget from the assembled command line instead of using a fixed cap, and why
`/antigravity:review` trims the diff at a file boundary to fit it. A review of a 160 KB diff
does not get a shortened prompt on Windows — without a budget it gets no run at all.

## Headless output: the JSON envelope

The companion always runs with `--output-format json`. One object on stdout: **[changelog]**

```jsonc
{
  "conversation_id":  "<uuid>",
  "status":           "SUCCESS" | "ERROR" | "CANCELED" | "INTERRUPTED"
                    | "INVALID" | "WAITING" | "RUNNING",
  "response":         "<final agent message>",
  "error":            "<message>",            // only on failure
  "duration_seconds": 12.4,
  "num_turns":        3,
  "usage": { "input_tokens", "output_tokens", "thinking_tokens",
             "cache_read_tokens", "total_tokens" },
  "structured_output": { },                   // only with --json-schema
  "json_schema":       { }                    // only with --json-schema
}
```

`--output-format stream-json` emits NDJSON instead: one `init` message, repeated
`step_update` messages, and a final `result` message with the same shape as the envelope
above. `--input-format stream-json` reads one NDJSON message per line from stdin and
requires `--output-format stream-json`. The companion uses neither.

### `denied_actions`, and what it is not

The 1.1.27 changelog says headless runs that skip tool actions they were not permitted to take
"report them as `denied_actions` in the JSON output". The field is absent from the documented
envelope, and it is narrower than it sounds: it belongs to `agy`'s **permission gate**
(`toolPermission` in `settings.json`), not to tool failures in general.

Measured: a `--sandbox` run asked to write to `C:\Windows\System32\...` had its `write_to_file`
call refused by the OS, and the envelope came back as **[measured]**

```jsonc
{ "status": "SUCCESS", "response": "The tool call `write_to_file` was refused ... Access is denied.", ... }
```

— no `denied_actions`, no error, status SUCCESS. The refusal existed only as prose inside
`response`. A second probe with `--mode plan` produced no denial at all: headless runs
auto-approve the plan and execute (1.1.28), so plan mode is not a permission gate either.

With `toolPermission` set to `strict`, the field does appear — and its envelope is a trap: **[measured]**

```jsonc
{
  "conversation_id": "53d52079-...",
  "status": "SUCCESS",            // <- SUCCESS
  "response": "",                 // <- empty
  "duration_seconds": 9.56,
  "usage": { "input_tokens": 31772, "output_tokens": 1090, ... },
  "denied_actions": [ { "action": "command", "display_name": "RunCommand" } ]
}
```

`status` is `SUCCESS`, `response` is empty, and there is **no `error` field**. The only evidence
that the run did nothing is the `denied_actions` array. `agy` also prints an explanation ahead of
the envelope:

```
jetski: no output produced — a tool required the "command" permission that headless mode cannot
prompt for, so it was auto-denied. Add an allow-rule under permissions.allow in settings.json
(e.g. command(<target>)). Alternatively, re-run with --dangerously-skip-permissions to auto-approve
all tools.
```

So `denied_actions` is a **fourth failure signal**, independent of the exit code, the status and
the error field. The companion treats a non-empty `denied_actions` with an empty `response` as a
failure and names the refused tools; when a response *is* present it keeps the answer and flags
that part of the work was blocked.

The companion normally never reaches this, because it passes `--dangerously-skip-permissions`
unless the caller asks for `--no-yolo`. The combination `--no-yolo` plus a restrictive
`toolPermission` is what triggers it.

**The absence of the field still does not mean nothing was refused** — an OS-level refusal (the
`C:\Windows\System32` probe above) carries no `denied_actions` at all and hides in the prose of a
`SUCCESS` response. Envelope parsing cannot catch that one.

## Critical runtime behavior

1. **Exit code is meaningful, but only in one direction.**
   1.1.1 fixed print mode "silently exiting with a success code and empty output when a
   request failed server-side" — it now writes the error to stderr and returns non-zero.
   1.1.20 then narrowed exit codes so they "reflect only cascade-level failures". So a
   **non-zero exit is a confirmed failure; exit 0 proves nothing** and the envelope
   decides. **[changelog]**
2. **Fatal headless errors carry a stable stderr marker.** Format string in the binary:
   `error: %s (response may be truncated)`. **[binary]**
3. **`--print-timeout` expiry is not an error since 1.1.28.** The run returns its partial
   output and exits 0, with this on stderr: **[binary]**
   `[agy] print timeout after %s with turn in progress; returning partial output`
4. **stdout can still come back completely empty with exit 0.** Reported upstream for
   non-TTY pipes, which is exactly how the companion spawns `agy`
   (`stdio: ["ignore", "pipe", "pipe"]`). This is why `--log-file` is still always passed
   and `lib/logscan.mjs` still exists as a fallback.
5. **The conversation id is in the log too**, as `Created conversation <uuid>` — the
   fallback path's only way to recover it. **[measured]**
6. **Backend errors appear as `E...` glog lines in the log file.** Patterns the plugin
   recognises: **[measured]**
   - `RESOURCE_EXHAUSTED (code 429): Individual quota reached. ... Resets in <dur>` → quota exhausted.
   - `You are not logged into Antigravity.` / `UNAUTHENTICATED` / `PERMISSION_DENIED` → not signed in.
   - `agent executor error: ...` → generic backend failure.

## Config layout

```
~/.gemini/antigravity-cli/
  settings.json            # agentMode, model, toolPermission, trustedWorkspaces, ...
  keybindings.json
  conversations/<id>.db    # persisted threads — SQLite as of 1.2.x (was <id>.pb)
  log/cli-*.log            # rotating logs; cli.log at the root is the newest
  plugins/                 # staged Antigravity-CLI plugins
  installation_id          # present once a sign-in has completed
```

Custom agents live **outside** that tree: `~/.gemini/config/agents/<name>.md` globally,
`{workspace}/.agents/agents/<name>/agent.md` per workspace. (The 1.1.0 changelog records
the old `~/.gemini/antigravity-cli/` location as a bug.) **[changelog]**

Notable `settings.json` keys: `toolPermission`
(`request-review` | `proceed-in-sandbox` | `always-proceed` | `strict`), `agentMode`,
`model`, `artifactReviewPolicy`, `enableTerminalSandbox`, `allowNonWorkspaceAccess`,
`colorScheme`, `verbosity`, `pickerGrouping`. **[measured]**

> `unsandboxed` permission rules were deprecated in 1.2.2 in favour of `command` rules;
> `agy` warns at startup and names the files to migrate. **[changelog]**

## Cross-compatibility note (viral, and real)

`agy plugin import claude` imports Claude Code plugins into Antigravity, and
`agy plugin install <plugin@marketplace>` / `agy plugin link` use a
Claude-Code-compatible marketplace format. So the two ecosystems interoperate —
this plugin lives on the Claude Code side (Claude Code → `agy`).
