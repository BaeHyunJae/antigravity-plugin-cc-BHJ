import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, chmodSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const COMPANION = fileURLToPath(new URL("../plugins/antigravity/scripts/antigravity.mjs", import.meta.url));
const FAKE_AGY = fileURLToPath(new URL("./fake-agy.mjs", import.meta.url));

function run(args, { mode = "success", home, agyVersion } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), "agy-cwd-"));
  const env = {
    ...process.env,
    ANTIGRAVITY_CC_AGY_BIN: FAKE_AGY,
    ANTIGRAVITY_CC_HOME: home || mkdtempSync(join(tmpdir(), "agy-home-")),
    FAKE_AGY_MODE: mode,
  };
  if (agyVersion) env.FAKE_AGY_VERSION = agyVersion;
  const res = spawnSync("node", [COMPANION, ...args], { cwd, env, encoding: "utf8", windowsHide: true });
  return { stdout: res.stdout, stderr: res.stderr, cwd, home: env.ANTIGRAVITY_CC_HOME };
}

before(() => {
  chmodSync(FAKE_AGY, 0o755);
});

// --- setup -----------------------------------------------------------------

test("setup --json reports ready when the (fake) binary resolves", () => {
  const { stdout } = run(["setup", "--json"]);
  const data = JSON.parse(stdout);
  assert.equal(data.ready, true);
  assert.equal(data.installed, true);
  assert.equal(data.version, "1.2.4-fake");
  assert.equal(data.minVersion, "1.1.10");
  assert.equal(data.versionOk, true);
});

test("setup --json reports not-ready when agy is below the minimum", () => {
  const { stdout } = run(["setup", "--json"], { agyVersion: "1.1.9" });
  const data = JSON.parse(stdout);
  assert.equal(data.installed, true);
  assert.equal(data.versionOk, false);
  assert.equal(data.ready, false);
});

/** A throwaway HOME holding a fake ~/.gemini/antigravity-cli tree. */
function fakeAgyHome(conversationFiles = [], { installationId = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), "agy-fakehome-"));
  const conversations = join(home, ".gemini", "antigravity-cli", "conversations");
  mkdirSync(conversations, { recursive: true });
  for (const name of conversationFiles) writeFileSync(join(conversations, name), "x");
  if (installationId) writeFileSync(join(home, ".gemini", "antigravity-cli", "installation_id"), "id");
  return home;
}

function setupJson(home) {
  const res = spawnSync("node", [COMPANION, "setup", "--json"], {
    cwd: mkdtempSync(join(tmpdir(), "agy-cwd-")),
    env: {
      ...process.env,
      ANTIGRAVITY_CC_AGY_BIN: FAKE_AGY,
      ANTIGRAVITY_CC_HOME: mkdtempSync(join(tmpdir(), "agy-home-")),
      HOME: home,
      USERPROFILE: home,
    },
    encoding: "utf8",
    windowsHide: true,
  });
  return JSON.parse(res.stdout);
}

test("prior conversations are recognized as SQLite, which is what agy 1.2.x writes", () => {
  // 0.1.0 looked for `<id>.pb`. agy 1.2.x stores threads as SQLite, so that check was
  // dead and the auth guess fell back to installation_id alone.
  assert.equal(setupJson(fakeAgyHome(["abc.db", "abc.db-wal"])).authedGuess, true);
});

test("the older protobuf threads are still recognized", () => {
  assert.equal(setupJson(fakeAgyHome(["abc.pb"])).authedGuess, true);
});

test("an empty config dir is not mistaken for a signed-in session", () => {
  assert.equal(setupJson(fakeAgyHome([])).authedGuess, false);
});

// --- the success path ------------------------------------------------------

test("delegate returns the model response, conversation id and run cost", () => {
  const { stdout } = run(["delegate", "summarize the repo"], { mode: "success" });
  assert.match(stdout, /Antigravity \(fake\) reply/);
  assert.match(stdout, /summarize the repo/);
  assert.match(stdout, /Antigravity conversation:/);
  assert.match(stdout, /abcd1234-ef56-7890-abcd-1234567890ef/);
  assert.match(stdout, /12\.4s/);
  assert.match(stdout, /8\.2k in/);
});

test("delegate forwards --model and --effort to agy", () => {
  const { stdout } = run(
    ["delegate", "--model", "gemini-3.1-pro-high", "--effort", "high", "summarize the repo"],
    { mode: "success" },
  );
  assert.match(stdout, /model=gemini-3\.1-pro-high/);
  assert.match(stdout, /effort=high/);
});

// --- the failure ladder ----------------------------------------------------

test("tier 1: a non-zero exit surfaces quota exhaustion with the reset window", () => {
  const { stdout } = run(["delegate", "do something expensive"], { mode: "quota" });
  assert.match(stdout, /quota is exhausted/i);
  assert.match(stdout, /152h59m39s/);
});

test("tier 1: a non-zero exit surfaces an auth failure with sign-in guidance", () => {
  const { stdout } = run(["delegate", "anything"], { mode: "auth" });
  assert.match(stdout, /not authenticated/i);
  assert.match(stdout, /agy/);
});

test("tier 2: exit 0 is not trusted — an ERROR envelope still fails the run", () => {
  const { stdout } = run(["delegate", "anything"], { mode: "envelope-error" });
  assert.match(stdout, /backend error/i);
  assert.match(stdout, /backend unavailable/);
  assert.doesNotMatch(stdout, /Antigravity \(fake\) reply/);
});

test("agy's own error message wins over a guess derived from the log", () => {
  // Regression: a real `--model gemini-3.8-flash-low --effort high` run rendered as
  // "quota is exhausted, wait for the reset" because the log scan matched benign
  // lines mentioning quotaProject/doRefreshQuota and outranked agy's own sentence.
  const { stdout } = run(["delegate", "--model", "gemini-3.8-flash-low", "--effort", "high", "x"], {
    mode: "flag-error",
  });
  assert.match(stdout, /conflicts with --effort=high/);
  assert.doesNotMatch(stdout, /quota is exhausted/i);
});

test("a permission-denied run is a failure, not an empty success", () => {
  // Measured on agy 1.2.4 with `toolPermission: strict`: the envelope comes back as
  // {"status":"SUCCESS","response":"","denied_actions":[{"action":"command",...}]}
  // — no error field. Taking that at face value renders "(Antigravity returned an
  // empty response.)" under a success heading, which is the silent failure this
  // companion exists to prevent.
  const { stdout } = run(["delegate", "run the tests"], { mode: "denied" });
  assert.match(stdout, /refused/i);
  assert.match(stdout, /RunCommand/);
  assert.match(stdout, /--no-yolo|permissions\.allow/);
  assert.doesNotMatch(stdout, /returned an empty response/i);
});

test("a partly denied run keeps the answer but flags what was refused", () => {
  const { stdout } = run(["delegate", "run the tests"], { mode: "denied-partial" });
  assert.match(stdout, /I read the files, but could not run the tests\./);
  assert.match(stdout, /refused on permission grounds/i);
  assert.match(stdout, /RunCommand/);
});

test("tier 3: empty stdout with exit 0 falls back to the agy log", () => {
  const { stdout } = run(["delegate", "anything"], { mode: "silent" });
  assert.match(stdout, /backend error/i);
  assert.match(stdout, /agent executor error/);
  // The conversation id is only in the log on this path, and we still recover it.
  assert.match(stdout, /abcd1234-ef56-7890-abcd-1234567890ef/);
});

test("agy's own print timeout returns partial output, flagged as incomplete", () => {
  const { stdout } = run(["delegate", "a long one"], { mode: "timeout-partial" });
  assert.match(stdout, /Partial answer before the timeout/);
  assert.match(stdout, /may be incomplete/i);
});

// --- version gate ----------------------------------------------------------

test("delegate refuses to run against an agy below the minimum version", () => {
  const { stdout } = run(["delegate", "anything"], { mode: "success", agyVersion: "1.1.9" });
  assert.match(stdout, /agy is too old/i);
  assert.match(stdout, /1\.1\.10/);
  assert.match(stdout, /agy update/);
  assert.doesNotMatch(stdout, /Antigravity \(fake\) reply/);
});

test("delegate fails closed when agy's version cannot be parsed", () => {
  const { stdout } = run(["delegate", "anything"], { mode: "success", agyVersion: "not-a-version" });
  assert.match(stdout, /agy is too old/i);
});

test("the version probe is cached per binary, not re-run every invocation", () => {
  const home = mkdtempSync(join(tmpdir(), "agy-home-cache-"));
  // First call primes the cache with a good version.
  const first = run(["delegate", "one"], { mode: "success", home, agyVersion: "1.2.4-fake" });
  assert.match(first.stdout, /Antigravity \(fake\) reply/);
  // The binary has not changed, so a different reported version is NOT re-probed.
  const second = run(["delegate", "two"], { mode: "success", home, agyVersion: "1.1.9" });
  assert.match(second.stdout, /Antigravity \(fake\) reply/);
});

// --- prompt size -----------------------------------------------------------

test("review of a large diff runs, and says how much of it was covered", () => {
  // The prompt rides in argv as `-p <prompt>`; `-p` is a string flag with no stdin
  // fallback, and Windows caps the whole command line at 32,767 characters. review is
  // where the plugin builds a huge prompt by itself, so a real working tree used to
  // fail the run outright with ENAMETOOLONG instead of producing a review.
  const repo = mkdtempSync(join(tmpdir(), "agy-repo-"));
  const g = (...args) =>
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], {
      cwd: repo,
      encoding: "utf8",
      windowsHide: true,
    });
  g("init", "-q");
  writeFileSync(join(repo, "seed.txt"), "seed\n");
  g("add", "-A");
  g("commit", "-qm", "seed");
  // ~240 KB spread over 12 files, comfortably past any command-line limit.
  for (let f = 0; f < 12; f += 1) {
    writeFileSync(join(repo, `file${f}.txt`), Array.from({ length: 400 }, (_, i) => `file ${f} line ${i} ${"x".repeat(40)}`).join("\n"));
  }
  g("add", "-A");

  const res = spawnSync("node", [COMPANION, "review"], {
    cwd: repo,
    env: { ...process.env, ANTIGRAVITY_CC_AGY_BIN: FAKE_AGY, ANTIGRAVITY_CC_HOME: mkdtempSync(join(tmpdir(), "agy-home-")), FAKE_AGY_MODE: "success" },
    encoding: "utf8",
    windowsHide: true,
  });

  assert.ok(res.stdout, `review produced no stdout; error: ${res.error && res.error.code}`);
  assert.doesNotMatch(res.stdout, /ENAMETOOLONG/);
  assert.match(res.stdout, /Antigravity \(fake\) reply/, `review did not run:\n${res.stdout}`);
  assert.match(res.stdout, /of \d+ changed files fit in one prompt/i, "the user must be told the review was partial");
});

test("a prompt that fits is not flagged as cut", () => {
  const { stdout } = run(["delegate", "a short task"], { mode: "success" });
  assert.doesNotMatch(stdout, /cut at/i);
});

// --- escape hatch ----------------------------------------------------------

test("--agy-arg passes unknown flags through to agy", () => {
  const { stdout } = run(["delegate", "--agy-arg", "--new-project", "anything"], { mode: "success" });
  assert.match(stdout, /Antigravity \(fake\) reply/);
});

test("--agy-arg refuses flags the companion owns", () => {
  const { stdout } = run(["delegate", "--agy-arg", "--output-format", "--agy-arg", "text", "anything"], {
    mode: "success",
  });
  assert.match(stdout, /unsupported passthrough/i);
  assert.match(stdout, /--output-format/);
  assert.doesNotMatch(stdout, /Antigravity \(fake\) reply/);
});

// --- job plumbing ----------------------------------------------------------

/** Poll the companion until the job reaches a terminal state, or give up. */
function waitForJob(home, cwd, tries = 40) {
  for (let i = 0; i < tries; i += 1) {
    const res = spawnSync("node", [COMPANION, "status"], {
      cwd,
      env: { ...process.env, ANTIGRAVITY_CC_HOME: home, ANTIGRAVITY_CC_AGY_BIN: FAKE_AGY },
      encoding: "utf8",
      windowsHide: true,
    });
    if (!/·\s*running\s*·/.test(res.stdout)) return res.stdout;
    execFileSync(process.execPath, ["-e", "setTimeout(()=>{},150)"], { windowsHide: true });
  }
  return null;
}

test("a backgrounded permission-denied run is not filed as done", () => {
  // The foreground path grew an isFullyDenied branch first; reconcile() and
  // cmdResult() kept their own copies of the decision and still called this "done",
  // so /status showed a green job and /result printed an empty success.
  const home = mkdtempSync(join(tmpdir(), "agy-home-denied-"));
  const cwd = mkdtempSync(join(tmpdir(), "agy-cwd-"));
  const started = spawnSync("node", [COMPANION, "delegate", "--background", "run the tests"], {
    cwd,
    env: { ...process.env, ANTIGRAVITY_CC_HOME: home, ANTIGRAVITY_CC_AGY_BIN: FAKE_AGY, FAKE_AGY_MODE: "denied" },
    encoding: "utf8",
    windowsHide: true,
  });
  assert.match(started.stdout, /started in background/);

  const status = waitForJob(home, cwd);
  assert.ok(status, "background job never reached a terminal state");
  assert.match(status, /·\s*failed\s*·/, `expected a failed job, got:\n${status}`);

  const result = spawnSync("node", [COMPANION, "result"], {
    cwd,
    env: { ...process.env, ANTIGRAVITY_CC_HOME: home, ANTIGRAVITY_CC_AGY_BIN: FAKE_AGY },
    encoding: "utf8",
    windowsHide: true,
  });
  assert.match(result.stdout, /refused/i);
  assert.match(result.stdout, /RunCommand/);
  assert.doesNotMatch(result.stdout, /returned an empty response/i);
});

test("status + result work across invocations sharing a home", () => {
  const home = mkdtempSync(join(tmpdir(), "agy-home-shared-"));
  run(["delegate", "remember me"], { mode: "success", home });
  const status = execFileSync(
    "node",
    [COMPANION, "status"],
    { cwd: mkdtempSync(join(tmpdir(), "agy-cwd-")), env: { ...process.env, ANTIGRAVITY_CC_HOME: home, ANTIGRAVITY_CC_AGY_BIN: FAKE_AGY }, encoding: "utf8", windowsHide: true },
  );
  // jobs are filtered by cwd; with a fresh cwd there are none — assert the header renders.
  assert.match(status, /Antigravity — status/);
});

test("the empty-state messages read cleanly", () => {
  const cwd = mkdtempSync(join(tmpdir(), "agy-cwd-"));
  const env = {
    ...process.env,
    ANTIGRAVITY_CC_AGY_BIN: FAKE_AGY,
    ANTIGRAVITY_CC_HOME: mkdtempSync(join(tmpdir(), "agy-home-")),
  };
  const say = (sub) => spawnSync("node", [COMPANION, sub], { cwd, env, encoding: "utf8", windowsHide: true }).stdout;

  assert.match(say("status"), /No Antigravity jobs recorded for this repository yet\./);
  assert.match(say("result"), /No recent jobs found for this repository\./);
  // Without a job id this used to render "No running job  to cancel." — two spaces.
  assert.match(say("cancel"), /No running job to cancel\./);
  assert.doesNotMatch(say("cancel"), / {2}/);
});

test("delegate with no task prompts for input", () => {
  const { stdout } = run(["delegate"]);
  assert.match(stdout, /What should Antigravity/);
});

test("unknown subcommand prints usage", () => {
  const { stdout } = run(["frobnicate"]);
  assert.match(stdout, /Usage: node antigravity\.mjs/);
});

test("missing binary yields install guidance", () => {
  // Isolate HOME so the real ~/.local/bin/agy fallback can't be found, and keep
  // only node's dir on PATH (so neither PATH nor well-known locations resolve agy).
  const cwd = mkdtempSync(join(tmpdir(), "agy-cwd-"));
  const isolatedHome = mkdtempSync(join(tmpdir(), "agy-nohome-"));
  const res = spawnSync(process.execPath, [COMPANION, "delegate", "x"], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    env: {
      ANTIGRAVITY_CC_AGY_BIN: "/nonexistent/agy",
      PATH: dirname(process.execPath),
      HOME: isolatedHome,
      USERPROFILE: isolatedHome,
    },
  });
  assert.match(res.stdout, /not installed/);
  assert.match(res.stdout, /install\.sh/);
});
