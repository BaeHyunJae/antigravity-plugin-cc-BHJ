# Antigravity CLI (`agy`) — grounded reference

> Originally verified against `agy --version 1.0.3` and the live `agy` runtime on
> macOS (May 2026); the `--model`/`--effort` section below was re-verified against
> `1.1.11` on Windows (Aug 2026), plus the official docs at
> <https://antigravity.google/docs/cli-overview> and `agy changelog`. This is the
> contract the plugin is built against. If a future `agy` release changes a flag,
> update this file and `plugins/antigravity/scripts/lib/agy.mjs` together.

## What `agy` is

The **Antigravity CLI** (binary: **`agy`**) is the terminal surface of Google
Antigravity 2.0, powered by the Gemini 3.5 agent harness. It shares config, auth,
and the agent core with the Antigravity IDE. It descends from Gemini CLI — config
lives under `~/.gemini/antigravity-cli/`.

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

## Non-interactive / headless invocation (the core the plugin uses)

From `agy --help` (verbatim flag set, v1.0.3):

| Flag | Meaning |
| --- | --- |
| `-p`, `--print`, `--prompt` | **Run a single prompt non-interactively and print the response.** This is the headless mode. Invocation: `agy -p "<task>"`. |
| `--print-timeout <dur>` | Timeout for print mode wait. Default `5m0s`. Go duration format (`90s`, `10m`). |
| `--dangerously-skip-permissions` | Auto-approve all tool permission requests without prompting (YOLO). Required for `agy` to actually read/edit files or run commands non-interactively. |
| `--sandbox` | Run with terminal/OS sandbox restrictions (nsjail / sandbox-exec / AppContainer). Good for read-only review runs. |
| `--add-dir <path>` | Add a directory to the workspace. Repeatable. |
| `-c`, `--continue` | Continue the most recent conversation. |
| `--conversation <id>` | Resume a specific conversation by ID. |
| `-i`, `--prompt-interactive` | Run an initial prompt, then stay interactive (not used by the plugin — needs a TTY). |
| `--log-file <path>` | Override the CLI log file path. The plugin uses this to capture the conversation ID and surface backend errors. |
| `--model <slug>` | Model for this session, e.g. `gemini-3.1-pro-high`. Added in `1.1.5`; run `agy models` for the current slug list. **Requires `>= 1.1.10`** — see the version note below. |

> Note: `agy`'s native `--print-timeout` default is `5m0s`, but the companion always
> passes `--print-timeout 10m` (and adds a +60s process watchdog on top) unless the
> caller overrides it — so the **effective default the plugin gives you is 10m**.

Subcommands: `changelog`, `help`, `install`, `plugin`/`plugins`, `update`, `models`.

**`--model` needs `agy >= 1.1.10`.** The flag itself landed in `1.1.5`, but through
`1.1.9` it was silently ignored in headless `-p` runs and in interactive sessions —
the run would fall back to the persisted/default model with no error (fixed in
`1.1.10`, per `agy changelog`). The plugin checks `agy --version` before forwarding
`--model` and drops it with a stderr note on older builds rather than passing a flag
that would quietly do nothing. Below `1.1.5` the flag doesn't exist at all. Either
way, the fallback is `/model` inside the TUI, persisted in `settings.json`.

## Critical runtime behavior (verified live)

1. **Print mode exits 0 even when the model call fails.** On quota exhaustion the
   process returns exit code `0` with **empty stdout**. A naive wrapper would
   silently return nothing. The plugin therefore always writes `--log-file` and
   scans it for errors.
2. **The conversation ID is in the log**, as `Created conversation <uuid>` and
   `conversation=<uuid>`. The plugin extracts it so you can resume later
   (`--conversation <id>`).
3. **Conversations persist** as `~/.gemini/antigravity-cli/conversations/<id>.pb`.
4. **Backend errors appear as `E...` log lines.** Patterns the plugin recognises:
   - `RESOURCE_EXHAUSTED (code 429): Individual quota reached. ... Resets in <dur>` → quota exhausted.
   - auth / `UNAUTHENTICATED` / `login` → not signed in.
   - `agent executor error: ...` → generic backend failure.
5. **Default model** (no override) is `Gemini 3.5 Flash`. Override per-session with
   `--model <slug>` (see above; needs `agy >= 1.1.10`).

## Config layout

```
~/.gemini/antigravity-cli/
  settings.json          # colorScheme, toolPermission, model defaults, trustedWorkspaces, ...
  keybindings.json
  conversations/<id>.pb  # persisted threads
  log/cli-*.log          # rotating logs (cli.log symlinks to newest)
  plugins/<name>/         # staged Antigravity-CLI plugins
```

Notable `settings.json` keys (see official Reference): `toolPermission`
(`request-review` | `proceed-in-sandbox` | `always-proceed` | `strict`),
`artifactReviewPolicy`, `enableTerminalSandbox`, `allowNonWorkspaceAccess`,
`colorScheme`, `verbosity`.

## Cross-compatibility note (viral, and real)

`agy plugin import claude` imports Claude Code plugins into Antigravity, and
`agy plugin install <plugin@marketplace>` / `agy plugin link` use a
Claude-Code-compatible marketplace format. So the two ecosystems interoperate —
this plugin lives on the Claude Code side (Claude Code → `agy`).
