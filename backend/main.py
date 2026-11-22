"""MigrateAI API. Run from this folder: uvicorn main:app --reload --port 8001"""

from __future__ import annotations

import os
import sys
import sys
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

BACKEND_DIR = Path(__file__).resolve().parent
REPO_ROOT = BACKEND_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from fastapi import BackgroundTasks, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

import orchestrator

from schemas import (
    AIConfig,
    AIModelsResponse,
    AITestRequest,
    AITestResponse,
    AnalysisResponse,
    AnalyzeRequest,
    BranchesRequest,
    BranchesResponse,
    EngineeringRequest,
    EngineeringResult,
    Graph,
    MigrationPlan,
    RepositoryManifest,
    RetryRequest,
    ValidationRequest,
    ValidationResult,
)
from services.export_service import ExportService
from services.git_service import GitService
from services.llm_provider import get_llm_provider

app = FastAPI(title="MigrateAI API", version="0.3.0")

_origins = [
    o.strip()
    for o in os.environ.get("MIGRATEAI_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
    if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

_current_ai_config: Optional[AIConfig] = None


def _fail(err: orchestrator.OrchestratorError) -> HTTPException:
    return HTTPException(status_code=err.status_code, detail=err.message)


def _normalize_manifest(raw: Any) -> Optional[RepositoryManifest]:
    """Coerce a manifest that may be a dict or RepositoryManifest object into RepositoryManifest."""
    if raw is None:
        return None
    if isinstance(raw, RepositoryManifest):
        return raw
    if isinstance(raw, dict):
        try:
            return RepositoryManifest.model_validate(raw)
        except Exception:
            return None
    return None


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Repository & Branch Endpoints
# ---------------------------------------------------------------------------


@app.post("/repository/branches", response_model=BranchesResponse)
def get_branches(request: BranchesRequest) -> BranchesResponse:
    """Fetch remote git branches for a given GitHub repository URL."""
    try:
        return GitService.get_remote_branches(request.repository_url)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/analyze", response_model=AnalysisResponse)
def analyze(request: AnalyzeRequest) -> AnalysisResponse:
    """Fetch a GitHub repository, scan it for MongoDB/Mongoose code and build the dependency graph."""
    try:
        return orchestrator.analyze_repository(request)
    except orchestrator.OrchestratorError as err:
        raise _fail(err)


@app.post("/analyze/sample", response_model=AnalysisResponse)
def analyze_sample(scope: Literal["relevant", "all"] = "relevant") -> AnalysisResponse:
    """Analyze the bundled sample app. Needs no network access."""
    try:
        return orchestrator.analyze_sample(scope=scope)
    except orchestrator.OrchestratorError as err:
        raise _fail(err)


@app.get("/analysis/{analysis_id}", response_model=AnalysisResponse)
def get_analysis(analysis_id: str) -> AnalysisResponse:
    found = orchestrator.get_analysis(analysis_id)
    if not found:
        raise HTTPException(status_code=404, detail="Analysis not found (results are kept in memory only).")
    return found


@app.get("/analysis/{analysis_id}/graph", response_model=Graph)
def get_graph(analysis_id: str) -> Graph:
    found = orchestrator.get_analysis(analysis_id)
    if not found:
        raise HTTPException(status_code=404, detail="Analysis not found (results are kept in memory only).")
    if found.graph is None:
        raise HTTPException(status_code=404, detail="This analysis was run without a dependency graph.")
    return found.graph


# ---------------------------------------------------------------------------
# AI Configuration & Test Endpoints
# ---------------------------------------------------------------------------


@app.get("/ai/config", response_model=AIConfig)
def get_ai_config() -> AIConfig:
    global _current_ai_config
    if _current_ai_config is None:
        return AIConfig(
            provider="ollama",
            model=os.environ.get("MIGRATEAI_LLM_MODEL", "qwen2.5-coder:7b"),
            base_url=os.environ.get("OLLAMA_HOST", "http://localhost:11434"),
            api_key=os.environ.get("GEMINI_API_KEY") or os.environ.get("OPENAI_API_KEY"),
        )
    return _current_ai_config


@app.post("/ai/config", response_model=AIConfig)
def set_ai_config(config: AIConfig) -> AIConfig:
    global _current_ai_config
    _current_ai_config = config
    return _current_ai_config


@app.post("/ai/test", response_model=AITestResponse)
def test_ai_connection(request: AITestRequest) -> AITestResponse:
    try:
        provider = get_llm_provider(request.config.provider)
        return provider.test_connection(request.config)
    except Exception as e:
        return AITestResponse(
            success=False,
            provider=request.config.provider,
            model=request.config.model,
            message=str(e),
            available_models=[],
        )


@app.get("/ai/models", response_model=AIModelsResponse)
def get_ai_models(provider: str = "ollama") -> AIModelsResponse:
    try:
        p = get_llm_provider(provider)
        models = p.list_models(_current_ai_config)
        return AIModelsResponse(provider=provider, models=models)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---------------------------------------------------------------------------
# Agent 2 (Migration Planner)
# ---------------------------------------------------------------------------


@app.post("/analysis/{analysis_id}/migrate", response_model=MigrationPlan)
def migrate(analysis_id: str) -> MigrationPlan:
    """Run Agent 2 (Migration Planner) to create a migration plan for this analysis."""
    found = orchestrator.get_analysis(analysis_id)
    if not found:
        raise HTTPException(status_code=404, detail="Analysis not found (results are kept in memory only).")
    if not found.plan:
        found.plan = orchestrator.generate_migration_plan(found)
    return found.plan


@app.get("/analysis/{analysis_id}/plan", response_model=MigrationPlan)
def get_plan(analysis_id: str) -> MigrationPlan:
    """Retrieve the Agent 2 migration plan for this analysis."""
    found = orchestrator.get_analysis(analysis_id)
    if not found:
        raise HTTPException(status_code=404, detail="Analysis not found (results are kept in memory only).")
    if not found.plan:
        found.plan = orchestrator.generate_migration_plan(found)
    return found.plan


# ---------------------------------------------------------------------------
# Agent 3 (Migration Engineering)
# ---------------------------------------------------------------------------


@app.post("/analysis/{analysis_id}/engineer", response_model=EngineeringResult)
def engineer(
    analysis_id: str,
    request: Optional[EngineeringRequest] = None,
) -> EngineeringResult:
    """Run Agent 3 (Migration Engineering) to generate Prisma schema and code changes."""
    task_ids = request.task_ids if request else None
    dry_run = request.dry_run if request else True
    ai_config = request.ai_config if (request and request.ai_config) else _current_ai_config
    try:
        return orchestrator.run_migration_engineering(
            analysis_id=analysis_id,
            task_ids=task_ids,
            dry_run=dry_run,
            ai_config=ai_config,
        )
    except orchestrator.OrchestratorError as err:
        raise _fail(err)


@app.get("/migration/{migration_id}", response_model=EngineeringResult)
def get_migration(migration_id: str) -> EngineeringResult:
    """Retrieve the migration engineering result by migration ID."""
    result = orchestrator.get_migration(migration_id)
    if not result:
        raise HTTPException(status_code=404, detail=f"Migration '{migration_id}' not found.")
    return result


@app.get("/migration/{migration_id}/diff")
def get_migration_diff(migration_id: str) -> Dict[str, Optional[str]]:
    """Retrieve file-level unified diffs for a migration."""
    result = orchestrator.get_migration(migration_id)
    if not result:
        raise HTTPException(status_code=404, detail=f"Migration '{migration_id}' not found.")
    return {f.file: f.diff for f in result.files if f.diff}


@app.get("/migration/{migration_id}/files")
def get_migration_files(migration_id: str):
    """Retrieve the full file manifest for this migration."""
    result = orchestrator.get_migration(migration_id)
    if not result:
        raise HTTPException(status_code=404, detail=f"Migration '{migration_id}' not found.")
    return result.manifest or {"files": []}


@app.post("/migration/{migration_id}/retry", response_model=EngineeringResult)
def retry_migration_endpoint(
    migration_id: str,
    request: Optional[RetryRequest] = None,
) -> EngineeringResult:
    """Re-run migration only on failed or selected files."""
    mig = orchestrator.get_migration(migration_id)
    if not mig:
        raise HTTPException(status_code=404, detail=f"Migration '{migration_id}' not found.")

    target_analysis_id = None
    with orchestrator._store_lock:
        for a_id, a_resp in orchestrator._store.items():
            if a_resp.engineering and a_resp.engineering.migration_id == migration_id:
                target_analysis_id = a_id
                break

    if not target_analysis_id:
        raise HTTPException(status_code=404, detail="Parent analysis for this migration not found.")

    task_ids = request.task_ids if (request and request.task_ids) else mig.unresolved_tasks
    ai_config = request.ai_config if (request and request.ai_config) else _current_ai_config
    try:
        return orchestrator.retry_migration(
            analysis_id=target_analysis_id,
            task_ids=task_ids,
            ai_config=ai_config,
        )
    except orchestrator.OrchestratorError as err:
        raise _fail(err)


# ---------------------------------------------------------------------------
# Export & ZIP Endpoints
# ---------------------------------------------------------------------------


@app.get("/migration/{migration_id}/export/zip")
def export_project_zip(
    migration_id: str,
    background_tasks: BackgroundTasks,
    export_type: Literal["full", "converted", "original"] = "full",
):
    """Generate and download a validated project ZIP package."""
    mig = orchestrator.get_migration(migration_id)
    if not mig or not mig.workspace_dir or not Path(mig.workspace_dir).is_dir():
        raise HTTPException(
            status_code=404, detail="Active migration workspace not found for this migration ID."
        )

    analysis_data: Dict[str, Any] = {}
    with orchestrator._store_lock:
        for a_id, a_resp in orchestrator._store.items():
            if a_resp.engineering and a_resp.engineering.migration_id == migration_id:
                analysis_data = a_resp.model_dump(by_alias=True)
                break

    try:
        zip_path = ExportService.create_project_zip(
            workspace_dir=Path(mig.workspace_dir),
            analysis_data=analysis_data,
            manifest=_normalize_manifest(mig.manifest),
            engineering_data=mig.model_dump(by_alias=True),
            validation_data=analysis_data.get("validation"),
            export_type=export_type,
        )
        background_tasks.add_task(lambda p: os.remove(p) if os.path.exists(p) else None, str(zip_path))
        filename = f"migrateai-{migration_id}-{export_type}.zip"
        return FileResponse(
            path=str(zip_path),
            filename=filename,
            media_type="application/zip",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate project archive: {str(e)}")


@app.get("/analysis/{analysis_id}/export")
@app.get("/analysis/{analysis_id}/export/zip")
def export_analysis_zip(
    analysis_id: str,
    background_tasks: BackgroundTasks,
    export_type: Literal["full", "converted", "original"] = "full",
    type: Optional[str] = None,
):
    """Generate and download a validated project ZIP package directly from analysis ID."""
    selected_type: Literal["full", "converted", "original"] = "full"
    if type in ("full", "converted", "original"):
        selected_type = type  # type: ignore
    elif export_type in ("full", "converted", "original"):
        selected_type = export_type

    found = orchestrator.get_analysis(analysis_id)
    if not found:
        raise HTTPException(status_code=404, detail="Analysis not found.")

    if not found.engineering:
        found.engineering = orchestrator.run_migration_engineering(
            analysis_id=analysis_id,
            dry_run=False,
        )

    mig = found.engineering
    if not mig or not mig.workspace_dir or not Path(mig.workspace_dir).is_dir():
        raise HTTPException(
            status_code=400,
            detail="Engineering workspace snapshot is missing or unavailable.",
        )

    analysis_data = found.model_dump(by_alias=True)
    try:
        zip_path = ExportService.create_project_zip(
            workspace_dir=Path(mig.workspace_dir),
            analysis_data=analysis_data,
            manifest=_normalize_manifest(mig.manifest),
            engineering_data=mig.model_dump(by_alias=True),
            validation_data=analysis_data.get("validation"),
            export_type=selected_type,
        )
        background_tasks.add_task(lambda p: os.remove(p) if os.path.exists(p) else None, str(zip_path))
        filename = f"migrateai-{analysis_id}-{selected_type}.zip"
        return FileResponse(
            path=str(zip_path),
            filename=filename,
            media_type="application/zip",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate project archive: {str(e)}")


@app.get("/migration/{migration_id}/export/report/{fmt}")
def export_report(
    migration_id: str,
    fmt: Literal["markdown", "json", "csv"],
):
    """Download migration report in Markdown, JSON, or CSV format."""
    mig = orchestrator.get_migration(migration_id)
    if not mig:
        raise HTTPException(status_code=404, detail="Migration not found.")

    analysis_data: Dict[str, Any] = {}
    with orchestrator._store_lock:
        for a_id, a_resp in orchestrator._store.items():
            if a_resp.engineering and a_resp.engineering.migration_id == migration_id:
                analysis_data = a_resp.model_dump(by_alias=True)
                break

    if fmt == "markdown":
        content = ExportService.generate_markdown_report(
            analysis_data=analysis_data,
            manifest=_normalize_manifest(mig.manifest),
            engineering_data=mig.model_dump(by_alias=True),
            validation_data=analysis_data.get("validation"),
        )
        return Response(content=content, media_type="text/markdown")
    elif fmt == "csv":
        content = ExportService.generate_csv_manifest(manifest=_normalize_manifest(mig.manifest))
        return Response(content=content, media_type="text/csv")
    else:
        manifest_norm = _normalize_manifest(mig.manifest)
        return {
            "analysis": analysis_data,
            "engineering": mig.model_dump(by_alias=True),
            "manifest": manifest_norm.model_dump(by_alias=True) if manifest_norm else None,
        }


# ---------------------------------------------------------------------------
# Agent 4 (Validation)
# ---------------------------------------------------------------------------


@app.post("/analysis/{analysis_id}/validate", response_model=ValidationResult)
def validate(
    analysis_id: str,
    request: Optional[ValidationRequest] = None,
) -> ValidationResult:
    """Run Agent 4 (Validation Agent) to verify schema, residual code, queries, and syntax."""
    dry_run = request.dry_run if request else False
    strict_mode = request.strict_mode if request else False
    try:
        return orchestrator.run_validation(
            analysis_id=analysis_id,
            dry_run=dry_run,
            strict_mode=strict_mode,
        )
    except orchestrator.OrchestratorError as err:
        raise _fail(err)


@app.get("/analysis/{analysis_id}/validation", response_model=ValidationResult)
def get_analysis_validation(analysis_id: str) -> ValidationResult:
    """Retrieve the validation result for an analysis without triggering auto-engineering."""
    found = orchestrator.get_analysis(analysis_id)
    if not found:
        raise HTTPException(status_code=404, detail="Analysis not found (results are kept in memory only).")
    if not found.validation:
        raise HTTPException(
            status_code=400,
            detail="Validation has not been executed yet for this analysis. Call POST /analysis/{analysis_id}/validate first.",
        )
    return found.validation


@app.get("/validation/{validation_id}", response_model=ValidationResult)
def get_validation(validation_id: str) -> ValidationResult:
    """Retrieve the validation result by validation ID."""
    result = orchestrator.get_validation(validation_id)
    if not result:
        raise HTTPException(status_code=404, detail=f"Validation '{validation_id}' not found.")
    return result
