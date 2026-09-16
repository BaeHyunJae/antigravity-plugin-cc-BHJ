---
description: Show running and recent Antigravity jobs for this repo.
argument-hint: "[job-id]"
allowed-tools: Bash(node:*)
disable-model-invocation: true
---

List background Antigravity jobs for the current repo, or show one job when you pass a `[job-id]`.

Run exactly this and show the output verbatim:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/antigravity.mjs" status $ARGUMENTS
```

Present the companion's stdout as-is. Do not summarize, reformat, or add commentary. To read a finished job's output, use `/antigravity:result <job-id>`.
