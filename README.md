# MigrateAI

AI-powered software migration workspace (MongoDB/Mongoose → Prisma/PostgreSQL).
This repository contains the first milestones of the plan:

**GitHub URL → scanner → MongoDB findings → Agent 1 dependency graph → dashboard**

```
migrateai/
├── frontend/   Next.js + TypeScript + Tailwind + React Flow dashboard
├── backend/    FastAPI + Pydantic API (clones repo, runs the analyzer)
├── analyzer/   Node.js/TypeScript: scanner (MongoDB detection) + Agent 1 (dependency graph)
├── agents/     placeholders for migration, migration_engineering, validation
└── tests/      backend tests + a sample Express/Mongoose app used as a fixture and demo
```

## Status — read this first

| Part | Status |
| --- | --- |
| Analyzer (scanner + Agent 1) | Built and tested: 15 passing tests (`npm test` in `analyzer/`) |
| Backend logic (validation, clone, orchestration) | Tested: 15 passing tests including API integration (`pytest tests` with virtualenv) |
| FastAPI routes (`backend/main.py`) | Implemented, verified, with full test coverage |
| Frontend dashboard | Fully built and verified: `next build` static export ready, 0 TypeScript/lint errors |
| Agents 2, 3, validation | Planned for Milestones 4–5 |

## Run it

Requirements: Node.js 20+, Python 3.10+, git.

```bash
# 1. Analyzer
cd analyzer
npm install
npm run build
npm test

# 2. Backend (new terminal)
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
uvicorn main:app --reload --port 8001

# 3. Frontend (new terminal)
cd frontend
npm install
npm run dev                        # http://localhost:3000
```

Click **Try the sample app** to see the whole pipeline without any network access, or paste a public GitHub URL.

Backend tests (from the repo root): `python -m unittest discover -s tests -v` or `pytest tests`.

Analyzer from the command line: `node analyzer/dist/cli.js --root path/to/repo --pretty`

## API

| Endpoint | Status |
| --- | --- |
| `POST /analyze` `{repository_url, branch?, generate_graph, graph_scope}` | implemented |
| `POST /analyze/sample` | implemented (offline demo) |
| `GET /analysis/{id}`, `GET /analysis/{id}/graph` | implemented (in-memory, last 50) |
| `POST /analysis/{id}/migrate`, `/validate` | return 501 until those agents exist |

Responses are camelCase JSON; the contract lives in `analyzer/src/types.ts`, `backend/schemas.py` and `frontend/lib/types.ts` (keep them in sync).

## How detection works

* **Scanner** parses JS/TS with the TypeScript Compiler API (source is parsed, never executed). It reports file, line, category, pattern, evidence and confidence for dependencies, connections, schemas, models, queries, relationships and database operations.
* Calls like `.find()` are `high` confidence only when the receiver resolves to a Mongoose model (local, imported, `new User()`, `db.collection()`). Otherwise they are `low` (file imports mongoose/mongodb) or dropped, so `array.find()` is not reported.
* **Agent 1** resolves relative imports, `tsconfig`/`jsconfig` aliases and `.js`→`.ts` imports, classifies files (entry, route, controller, service, model, database), types edges (`registers_route`, `calls_service`, `uses_model`, `connects_db`, `imports`) and computes which files are affected if a model changes.

## Known limits

* Static analysis only: dynamic imports with computed paths, runtime-generated code and dependency injection are not followed (the API reports counts as warnings).
* Graph nodes are files, not individual functions.
* Directories named `node_modules`, `dist`, `build`, `coverage`, `out`, `vendor` and dot-folders are skipped.
* The analyzer parser is the TypeScript Compiler API only; the plan's optional Babel parser is not used.
* The plan's Vitest/pytest are not required: analyzer tests use Node's built-in test runner, backend tests use `unittest` (pytest also runs them).

## Security

Repositories are untrusted. URLs/branches are strictly validated, `git`/`node` run without a shell, clones are shallow and time-limited and deleted afterwards, file count/size/time are capped, symlinks are ignored, and repository code is never installed, built or executed. Run any later build/test stage in an isolated sandbox.

Coordinate with Nandini before merging into the shared repository: this layout follows the plan's suggested structure, but her existing analyzer may use a different one.

# MigrateAI — AI-Powered Software Migration Agent

MigrateAI is a tool designed to assist developers in migrating existing
software applications between technologies with less manual effort.

## Initial Migration Target

- **Source:** Node.js, Express, MongoDB, and Mongoose
- **Target:** Node.js, Express, PostgreSQL, and Prisma

## Planned Features

- Repository analysis and MongoDB/Mongoose usage detection
- Identification of affected files and dependencies
- Dependency graph and migration impact analysis
- Migration planning and code transformation suggestions
- Retrieval of relevant technical documentation (RAG)
- Automated testing and migration validation
- Migration report with detected issues and proposed changes

## Technology Stack

- **Backend:** Python and FastAPI
- **Code Analysis:** Tree-sitter
- **Dependency Graph:** NetworkX
- **Agent Workflow:** LangGraph
- **LLM:** Local open-source coding model through Ollama
- **Target Database/ORM:** PostgreSQL and Prisma
- **Testing and Execution:** Existing project tests and Docker
- **Version Control:** Git and GitHub

## Development Status

Project setup is underway. Features will be implemented and tested
incrementally. Planned features are not considered implemented until
they have been verified.

## Team

Final-year academic project.
