## Project Domain

`Context/` holds this project's domain glossary (`CONTEXT.md`) and architectural decision records (ADRs), among other agent-facing docs. `Context/docs/agents/domain.md` is this project's map for navigating and consuming the folder — it gives the exact location of those documents for this project's layout. **Read it before working with `Context/`.**

## Memory ↔ Context

Memory holds only what an agent must already know at the moment it matters and would not think to look up: behavioral rules (preferences, feedback, recurring pitfalls), facts no document or code holds, and ideas or planned directions not yet worked on. Work state, designs, and decisions belong in `Context/`, recorded through `/sync-context`; once recorded there, they leave memory. Before saving an item, imagine it deleted and ask whether a later session would still reach the fact when it matters, through `Context/`, a rule document, or the code; if it would, do not save it. When something that must stay in mind is also recorded under `Context/`, memory keeps a short statement of the behavior, with the lines the memory format requires and without repeating the detail `Context/` holds. At each sync, `/sync-context` applies this test to every memory item.
