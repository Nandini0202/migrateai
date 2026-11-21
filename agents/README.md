# Agents

* `dependency_graph/` — Agent 1, implemented in `analyzer/src/graph.ts` and `analyzer/src/dependencies.ts`.
* `migration_planner/` — Agent 2, implemented in `migration_planner/migration/`.
* `migration_engineering/` — Agent 3, with context building, transformation, schema generation and patch application in `agents/migration_engineering/`.
* `validation/` — Agent 4, with automated verification of schema integrity, residual code, query semantics, package dependencies, and syntax in `agents/validation/`.
