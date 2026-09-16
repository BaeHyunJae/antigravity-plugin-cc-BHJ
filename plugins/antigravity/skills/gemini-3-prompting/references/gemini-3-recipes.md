# Antigravity prompt recipes (print mode)

Copy a template, fill the brackets, and pass it as the task to the companion. Order matters: material first, instruction last, "do NOT touch" constraints at the very end (the model can drop a negative constraint that appears too early). Print mode can't ask follow-ups, so leave no blanks.

Companion calls referenced below:
- `delegate <task...>` — write-capable; add `--read-only` or `--sandbox` to contain it.
- `review [--base <ref>] [focus...]` — read-only diff review.
- `resume <follow-up...>` — continue the last conversation.

---

## 1. Delegate a fix

Write-capable. Name the symptom, the cause if you know it, and the proof.

```
Goal: Fix the bug where [observable symptom, e.g. /login returns 500 when the email field is empty].

Where to look: [src/auth/login.ts and its test file]. The likely cause is [brief hypothesis, or "unknown — investigate first"].

Acceptance criteria:
- [Empty email returns 400 with message "email required", not 500].
- Existing tests still pass; add one test covering the empty-email case.

Output: apply the change, then give me a 2-3 line summary of root cause and fix.

Do NOT change the public response shape of any other endpoint, and do NOT reformat unrelated files.
```

---

## 2. Delegate a feature

Write-capable. Describe the outcome and the contract; let the agent design the implementation.

```
Goal: Add [feature, e.g. a --json flag to the `report` command that prints the summary as JSON].

Where to look: [src/cli/report.ts]; follow the existing flag pattern used by [--verbose].

Acceptance criteria:
- [`report --json` prints valid JSON with keys: total, passed, failed].
- [Default (no flag) behavior is unchanged].
- New behavior is covered by a test.

Output: implement it, update the command's help text, and summarize what you added.

Do NOT add new dependencies, and do NOT touch the non-CLI library code under src/core.
```

---

## 3. Cross-model code review

Use `review` (read-only, sandboxed). It embeds the git diff for you — your job is to aim it.

```
# Reviews the working-tree diff:
review focus on [correctness and edge cases in the new date-parsing logic]. Flag any [null/timezone] handling I missed and any test gaps. Be specific with file:line.

# Reviews a branch against a base:
review --base origin/main focus on [security of the new auth middleware]: missing authz checks, unvalidated input, secrets in code.
```

Keep the focus line concrete — "review this" gives a generic pass; "find missing authz checks in the new middleware" gives a useful one.

---

## 4. Investigation / root-cause

Read-only — you want understanding, not edits.

```
delegate --read-only "Investigate why [the worker hangs on large batches].

Where to look: [src/worker/queue.ts and src/worker/batch.ts].

Trace the execution path for [a 10k-item batch], identify the blocking call or unbounded loop, and explain the root cause. Propose a fix in prose but do NOT modify any files."
```

Once you have the diagnosis, apply it with `resume "now implement the fix you proposed"` (which becomes write-capable) or a fresh write-capable `delegate`.

---

## 5. Refactor

Write-capable, but fence it tightly — refactors are where scope creep bites.

```
Goal: Refactor [the duplicated validation logic in src/handlers/*] into a single shared validator.

Where to look: [the three handlers in src/handlers/ that each re-implement email/phone validation].

Acceptance criteria:
- Behavior is identical: all existing tests pass with no changes to test files.
- One shared validator, imported by all three handlers.

Output: apply the refactor, then summarize what moved where.

This is a pure refactor: do NOT change any observable behavior, do NOT alter function signatures used outside src/handlers, and do NOT touch the tests.
```

---

## 6. Test-writing

Write-capable. Point at the code under test and state the coverage you want.

```
Goal: Add unit tests for [src/utils/money.ts].

Where to look: [src/utils/money.ts]; match the existing test style in [src/utils/__tests__/].

Acceptance criteria:
- Cover [rounding, negative amounts, and zero].
- Cover the [currency-mismatch error path].
- Tests pass against the current implementation.

Output: write the tests in [the existing test file or a sibling], then tell me which behaviors are now covered and any you couldn't test.

Do NOT modify money.ts to make tests pass — if a test reveals a real bug, report it instead of changing the source.
```
