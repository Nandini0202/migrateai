# Agents

* `dependency_graph/` — Agent 1. Implemented in `analyzer/src/graph.ts` (+ `dependencies.ts`), run through `analyzer/dist/cli.js`.
* `migration/` — Agent 2 (MongoDB → Prisma). Not started.
* `migration_engineering/` — Agent 3. Not started. Will consume Agent 1's graph, Agent 2's output and its error list.
* `validation/` — Not started.
