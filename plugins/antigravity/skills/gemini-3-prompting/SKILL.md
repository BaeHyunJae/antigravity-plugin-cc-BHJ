---
name: gemini-3-prompting
description: "How to write effective prompts for Google Antigravity / Gemini 3.5 agents (used when delegating to or reviewing with the antigravity plugin)"
---

# Prompting Gemini 3.5 through Antigravity

You drive `agy` (Antigravity, Gemini 3.5) in print mode through the companion's `delegate`, `review`, and `resume` subcommands. Print mode is headless: one prompt in, one result out. The agent cannot stop to ask you a clarifying question, so the prompt you send is the whole brief. Write it like a work order for a fast, literal junior engineer.

This guide is the short version. The depth lives in two reference files:
- **[Recipes](references/gemini-3-recipes.md)** — copy-paste templates for fixes, features, review, investigation, refactor, and tests.
- **[Anti-patterns](references/gemini-3-antipatterns.md)** — the common mistakes and their fixes.

## How Gemini 3.5 behaves (and how to prompt for it)

Based on Google's Gemini 3.5 developer/prompting guides and practitioner write-ups:

- **It follows instructions literally.** If you say "fix the bug," it fixes *a* bug its own way. If you say "make `parseDate` return `null` on empty input and add a test for it," you get exactly that. Spell out the target behavior, not the vibe.
- **It is terse by default.** Gemini 3.5 gives direct answers and skips narration unless you ask for it. If you want a written plan or an explanation of the change, request it explicitly.
- **It plans and reasons over multiple steps.** It is strong at decomposing a goal into steps and executing them. Give it the *goal* and the *constraints*; let it own the *how*. Over-scripting the steps fights the model.
- **It handles long context well, but cares about order.** Put the data/code/diff first, then your instruction last. Anchor the ask to the material ("Based on the diff above, ..."). Critical constraints — especially "do NOT touch X" — go at the **end** of the prompt; Gemini 3.5 can drop a negative constraint that appears too early in a long prompt.
- **One markup style, used consistently.** Markdown headings or simple labels are enough. Don't mix XML tags and Markdown in the same prompt.

Don't pick the model by describing it in the prompt text ("use Gemini 3.5 Pro") — it won't do anything. If the user wants a specific model, pass `--model <slug>` on the `delegate`/`resume`/`review` call instead (needs `agy >= 1.1.10`); otherwise the session uses whatever `/model` set inside the TUI, persisted in `settings.json`.

## A solid delegate prompt has five parts

1. **Goal** — one sentence, the outcome you want.
2. **Acceptance criteria** — how *you* will know it's done (tests pass, endpoint returns X, build is green). This is what turns a vague request into a checkable one.
3. **Where to look** — the files, dirs, or modules that matter. Saves the agent a blind search and keeps it on target.
4. **Scope boundaries** — what NOT to touch (other modules, public API shape, formatting of unrelated files). Put these last.
5. **Output expectation** — code change only, or also a short summary of what changed and why.

Keep it tight. A focused 8-line brief beats a 40-line essay; over-stuffed context buries the actual ask.

## Read-only vs write-capable

`delegate` is **write-capable by default** — it can edit files and run commands. Choose deliberately:

| Use | When |
|-----|------|
| `--read-only` | Investigation, root-cause, "explain how X works," planning, anything where you want analysis without touching the tree. Safe to run unattended. |
| `--sandbox` | You want it to *try* changes (run commands, scratch edits) but keep them contained from your real working tree. |
| write-capable (default) | You actually want the fix/feature applied to the repo, and you'll review the diff after. |

`review` is already read-only and sandboxed — it never edits, it just reports on the diff.

If you're unsure whether a task should write, start `--read-only` to get the plan, then re-run write-capable (or `resume` the conversation) to apply it.

## Limits to be honest about

- **Print mode won't ask you questions.** Ambiguity becomes a guess. Front-load the detail.
- **Preview quota.** On quota exhaustion `agy` exits cleanly with empty output; the companion surfaces `RESOURCE_EXHAUSTED (429) ... Resets in <dur>`. If you see that, wait for the reset — re-prompting won't help.
- **Auth is the user's job.** OAuth via Google account, no API key. The plugin never logs anyone in.
