# SME ERP — Claude Code Instructions

Read `AGENTS.md` before performing development work.

Also read the relevant files under `/docs` and `/tasks/current.md`.

Treat `AGENTS.md` as the primary engineering rules for this repository.

Important priorities:

1. Security and tenant isolation
2. Correct financial/inventory behavior
3. Simple maintainable architecture
4. Scope discipline
5. Reuse existing patterns
6. Automated checks before completion

Do not:

- introduce major dependencies without approval
- modify unrelated areas
- bypass RLS or authorization
- expose secrets
- place critical business rules only in UI components
- add features outside Version 1 scope
- make destructive database changes without clearly explaining them

For each task:

1. Inspect the existing implementation first.
2. Explain the intended approach briefly.
3. Implement the smallest correct change.
4. Test it.
5. Run lint and build.
6. Summarize changes, risks, and remaining manual actions.
