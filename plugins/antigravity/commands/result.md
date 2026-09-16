---
description: Show the final output (and conversation id) of a finished Antigravity job.
argument-hint: "[job-id]"
allowed-tools: Bash(node:*)
disable-model-invocation: true
---

Print the final output of a finished background Antigravity job. Defaults to the latest job; pass a `[job-id]` to target a specific one. The output includes the conversation id and a resume hint so you can keep the thread going.

Run exactly this and show the output verbatim:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/antigravity.mjs" result $ARGUMENTS
```

Present the companion's stdout as-is. Do not summarize, reformat, or add commentary. Use the `antigravity-result-handling` skill to interpret what came back — a finished response (verify any file edits with `git diff`) versus a quota/auth/backend error. To continue the same thread, use `/antigravity:resume --conversation <id>`.
