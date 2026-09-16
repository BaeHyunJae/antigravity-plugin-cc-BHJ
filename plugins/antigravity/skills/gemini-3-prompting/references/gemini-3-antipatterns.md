# Antigravity prompting anti-patterns (print mode)

The mistakes that waste a delegate run, and how to fix each. Grounded in Google's Gemini prompting guidance and the realities of `agy` print mode.

---

### 1. Vague goal

**Mistake:** "Clean up the auth code" / "make this better." The agent follows instructions literally — give it a fuzzy goal and you get a confident, fuzzy change you then have to undo.

**Fix:** State one concrete outcome. "Extract the duplicated email validation in the three handlers into one shared function, behavior unchanged."

---

### 2. No acceptance criteria

**Mistake:** Describing the work but not how "done" is verified. The agent declares victory and you can't tell if it actually worked.

**Fix:** Add a checkable bar: tests pass, endpoint returns X, build is green, this specific input now produces that specific output. Acceptance criteria are what convert a request into a verifiable task.

---

### 3. Over-stuffed context

**Mistake:** Pasting whole files, long history, and three tangents "for context." The agent handles long context well, but the real ask gets buried and the model optimizes for the wrong thing.

**Fix:** Include only what's needed. Point at files by path ("where to look: src/auth/login.ts") instead of pasting them — the agent can read the repo. Put the material first and the instruction last.

---

### 4. Critical constraints buried at the top

**Mistake:** Opening with "don't touch the public API" then writing 30 lines of detail. In a long prompt, the model can drop a negative or quantitative constraint that appears too early.

**Fix:** Put the most important restrictions — especially "do NOT change X" — as the **final** lines of the prompt, where they anchor the model's last reasoning step.

---

### 5. Naming a model in the prompt text, or guessing its slug

**Mistake:** Writing "use the Pro model for this" in the task — prompt text does not select a model. Or passing a slug from memory: there is no `gemini-3.5-*` in the catalog, and the available slugs move with each `agy` release.

**Fix:** Pass `--model <slug>` on the call, taking the slug from `agy models`. Leave it off entirely to use `agy`'s configured default. Pair it with `--effort` only when the slug is a base model name that requires one — `agy` answers `--model %s conflicts with --effort=%s` for a mismatched pair, so there is no need to guess.

---

### 6. Expecting clarifying questions

**Mistake:** Sending a half-specified task assuming the agent will ask "which file did you mean?" Print mode (`agy -p`) is non-interactive — it can't ask. Ambiguity becomes a guess.

**Fix:** Front-load every detail: goal, files, criteria, boundaries. If you genuinely don't know enough to specify, run a `--read-only` investigation first to learn, then delegate the fix with the answers in hand.

---

### 7. Writing when you meant to read (and vice versa)

**Mistake:** Running a write-capable `delegate` for "explain how X works" — now there are stray edits in your tree. Or running `--read-only` for a fix and wondering why nothing changed.

**Fix:** Investigation, planning, "how does this work" → `--read-only` (or `--sandbox` to let it run things safely). Actual fixes/features/refactors → write-capable default, then review the diff. `review` is always read-only.

---

### 8. Mixing markup styles

**Mistake:** Half XML tags, half Markdown headings in one prompt. Inconsistent structure makes it harder for the model to separate instructions from data.

**Fix:** Pick one — Markdown headings or simple labels are plenty for a delegate brief — and use it throughout.

---

### 9. Re-prompting through a quota wall

**Mistake:** The companion reports `RESOURCE_EXHAUSTED (429) ... Resets in <dur>` and you immediately fire the same task again. Preview quota is exhausted; retrying burns nothing useful.

**Fix:** Read the reset window the companion surfaced and wait for it. Use the time to tighten the prompt so the next run lands on the first try.

---

### 10. Throwing away the conversation

**Mistake:** After a `--read-only` investigation, starting a brand-new `delegate` that re-explains everything from scratch.

**Fix:** Use `resume <follow-up>` to continue the same Antigravity conversation — the agent keeps its prior reasoning and context. `result` prints the conversation id and a resume hint when a job finishes.
