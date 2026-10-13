# Agents

* `dependency_graph/` — Agent 1. Implemented in `analyzer/src/graph.ts` (+ `dependencies.ts`), run through `analyzer/dist/cli.js`.
* `migration_planner/` — Agent 2 (MongoDB → PostgreSQL/Prisma Migration Planner). Implemented in `migration_planner/migration/planner.py`, with rules in `mapping_rules.py` and connected through `backend/` and `frontend/`.
* `migration_engineering/` — Agent 3. Not started. Will consume Agent 1's graph, Agent 2's plan and its blocker list.
* `validation/` — Not started.
