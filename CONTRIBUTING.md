# Contributing to antigravity-plugin-cc

Thanks for helping out. This plugin lets Claude Code users drive Google's
Antigravity CLI (`agy`) without leaving Claude Code.
Contributions that keep it thin, honest, and dependency-free are very welcome.

## Repo layout

```
.claude-plugin/marketplace.json      # marketplace "idun-antigravity" -> the plugin
plugins/antigravity/
  commands/                          # /antigravity:<name> slash commands (.md)
  agents/                            # antigravity:antigravity-pair subagent (.md)
  skills/                            # internal skills (SKILL.md, user-invocable: false)
  scripts/antigravity.mjs            # the Node companion (entry point)
  scripts/lib/agy.mjs                # the agy contract: flags, version gate, spawning
  scripts/lib/envelope.mjs           # agy's --output-format json envelope
  scripts/lib/logscan.mjs            # log + stderr fallback when stdout comes back empty
  scripts/lib/jobs.mjs               # background job state
scripts/gen-cli-reference.mjs        # regenerates the flag tables from `agy --help`
docs/antigravity-cli-reference.md    # the companion contract, written down
tests/                               # npm test, with a fake `agy` fixture
```

The plugin is intentionally thin. Commands forward to the companion; the
`antigravity-pair` subagent makes exactly one Bash call to
`antigravity.mjs delegate` and returns stdout verbatim.

## Running tests

```bash
npm test
```

Tests run against a fake `agy` fixture, so you do **not** need a real install,
a Google account, or any network access. Everything is offline.

## Testing against real agy locally

1. Install the CLI:
   - macOS/Linux: `curl -fsSL https://antigravity.google/cli/install.sh | bash`
     (lands in `~/.local/bin/agy`)
   - Windows: `irm https://antigravity.google/cli/install.ps1 | iex`
2. Sign in once, interactively. Auth is keyring/browser OAuth — there is no API
   key for the preview tier. In Claude Code, type `! agy` and complete the
   Google login. The plugin never authenticates for you.
3. Add this checkout as a local marketplace:
   `/plugin marketplace add /absolute/path/to/antigravity-plugin-cc`
4. Try `/antigravity:setup`, then `/antigravity:delegate`, `/antigravity:review`,
   and `/antigravity:resume`.

Heads up: the preview tier has a quota. When it's exhausted the run fails and the
companion surfaces the `RESOURCE_EXHAUSTED (429)` line with its reset window.
That's expected behavior, not a bug.

## Keep the contract in sync

`docs/antigravity-cli-reference.md` and `scripts/lib/agy.mjs` describe the same
thing: how we invoke `agy` and parse its output. If `agy` changes a flag, the
output format, or its quota behavior, update **both** in the same PR. A drift
between the doc and the code is the one thing that will quietly break this
plugin for everyone — it has happened once already, which is why the flag tables
in that doc are now generated:

```bash
npm run gen:cli-ref            # rewrite the generated blocks from `agy --help`
npm run gen:cli-ref -- --check # what CI runs
```

A few facts that must stay true (don't contradict them):

- The binary is `agy`. Print mode is `agy -p`, always with `--output-format json`.
- **Minimum supported `agy` is 1.1.10** (`MIN_AGY_VERSION` in `lib/agy.mjs`).
  Below it, `--model` and `--effort` are accepted and silently discarded and
  there is no JSON output format. The companion refuses rather than carrying a
  second code path — don't add per-flag version gates back.
- **A zero exit code does not mean the run succeeded.** `agy` 1.1.20 narrowed
  exit codes to cascade-level failures. Non-zero is a confirmed failure; zero
  means "ask the envelope".
- **Don't delete the log scan.** The envelope covers the normal path, but stdout
  can still come back empty on a non-TTY pipe, which is exactly how we spawn
  `agy`. That fallback is the only thing standing between that case and a blank
  answer presented as success.
- **Never pin a model name in prose.** The catalog moves between releases and
  there is no `gemini-3.5-*` in it. Point at `agy models` instead. The one
  exception is the reference doc, which states the observed default and says
  when it was observed.
- `delegate` is write-capable by default; `--read-only` / `--sandbox` contain it.
- `review` is always read-only and sandboxed.
- `agy`'s own slash commands and skills stay **enabled** in print mode so an
  `agy`-side skill can fire; `--no-slash-commands` is the opt-out.

## Code style

- Node ESM (`.mjs`), targeting the Node bundled with Claude Code.
- **Stdlib only.** No runtime dependencies, no `package.json` `dependencies`.
  If you reach for a package, find another way.
- Match the surrounding style: small functions, early returns, clear names.
- Command/agent/skill files follow the Claude Code conventions already in the
  repo — copy the frontmatter shape from an existing file rather than inventing.
- Voice in user-facing text: crisp and concrete, lead with what the user gets,
  honest about limits (preview quota, browser auth), no hype words.

## Opening a PR

1. Fork and branch off `main` (`git checkout -b fix/clearer-quota-message`).
2. Make the change. Run `npm test`. Add or update a test when behavior changes.
3. If you touched the `agy` contract, update the doc and `lib/agy.mjs` together,
   and run `npm run gen:cli-ref`.
4. Bumping the version? It lives in four files. `tests/version-sync.test.mjs`
   fails until they agree.
5. Keep the PR focused — one concern per PR is easiest to review.
6. Open the PR with a short description of what changed and why. Mention whether
   you tested against real `agy` or only the fixture.

Questions or ideas? Open an issue first — happy to talk it through.

Licensed MIT. Built and maintained by [Idun Labs](https://idunplatform.com).
