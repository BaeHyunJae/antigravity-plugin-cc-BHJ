---
description: Cancel a running background Antigravity job.
argument-hint: "[job-id]"
allowed-tools: Bash(node:*)
disable-model-invocation: true
---

Cancel a running background Antigravity job. Defaults to the latest running job; pass a `[job-id]` to target a specific one.

Run exactly this and show the output verbatim:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/antigravity.mjs" cancel $ARGUMENTS
```

Present the companion's stdout as-is. Do not summarize, reformat, or add commentary. Use `/antigravity:status` to see which jobs are still running.
