"""Agent 3 — Migration Engineering Agent.

Context-aware code transformation engine for MongoDB/Mongoose to PostgreSQL/Prisma.
Translates schemas, replaces database queries, handles relations, writes
diffs to an isolated workspace, and records file manifests.
"""

from __future__ import annotations

import sys
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

try:
    from services.file_tracker import FileTrackerService
except ImportError:
    try:
        from backend.services.file_tracker import FileTrackerService
    except ImportError:
        FileTrackerService = None

from .code_generator import CodeGenerator
from .context_builder import ContextBuilder
from .llm_client import LLMClient
from .models import EngineeringResult, FileChange, FunctionContext, ModelSchema
from .patch_applier import PatchApplier
from .schema_generator import SchemaGenerator
from .transformation_engine import TransformationEngine


def resolve_model_for_file(
    rel_file: str,
    file_code: str,
    model_schemas: List[ModelSchema],
    analysis_data: Dict[str, Any],
) -> Optional[str]:
    """Resolve the associated Mongoose model for a file without arbitrary fallbacks."""
    # 1. Check graph nodes
    graph = analysis_data.get("graph") or {}
    for node in graph.get("nodes", []):
        if node.get("id") == rel_file and node.get("models"):
            return node["models"][0]

    # 2. Check if file stem matches a known model schema
    schemas_list: List[Any] = (
        list(model_schemas.values()) if isinstance(model_schemas, dict) else (model_schemas or [])
    )
    file_stem = Path(rel_file).stem.lower()
    for clean_suffix in ["service", "controller", "routes", "route", "model"]:
        if file_stem.endswith(clean_suffix) and len(file_stem) > len(clean_suffix):
            file_stem = file_stem[: -len(clean_suffix)]
            break

    for ms in schemas_list:
        ms_name = ms.name if hasattr(ms, "name") else str(ms)
        if ms_name.lower() == file_stem or ms_name.lower() in rel_file.lower():
            return ms_name

    # 3. Check code imports or requires
    for ms in schemas_list:
        ms_name = ms.name if hasattr(ms, "name") else str(ms)
        if (
            f"models/{ms_name}" in file_code
            or f"models/{ms_name.lower()}" in file_code
            or f"'{ms_name}'" in file_code
            or f'"{ms_name}"' in file_code
        ):
            return ms_name

    return None


class MigrationEngineeringAgent:
    def __init__(
        self,
        workspace_base_dir: Optional[Path] = None,
        llm_client: Optional[LLMClient] = None,
    ):
        self.patch_applier = PatchApplier(workspace_base_dir)
        self.code_generator = CodeGenerator()
        self.llm_client = llm_client or LLMClient()

    def run(
        self,
        repo_dir: Path,
        analysis_data: Dict[str, Any],
        task_ids: Optional[List[int]] = None,
        dry_run: bool = True,
        ai_config: Optional[Any] = None,
    ) -> EngineeringResult:
        migration_id = uuid.uuid4().hex[:12]
        workspace = self.patch_applier.prepare_workspace(repo_dir, migration_id)
        context_builder = ContextBuilder(workspace)

        # 1. Extract models & generate Prisma schema
        model_schemas = context_builder.extract_models()
        schema_gen = SchemaGenerator(model_schemas)
        prisma_schema_content = schema_gen.generate()

        use_llm = ai_config is not None
        transform_engine = TransformationEngine(
            llm_client=self.llm_client,
            prisma_schema=prisma_schema_content,
            ai_config=ai_config,
        )

        # 2. Filter migration tasks
        plan = analysis_data.get("plan") or {}
        tasks = plan.get("tasks", [])
        if task_ids is not None:
            selected_task_ids = set(task_ids)
            tasks = [t for t in tasks if t.get("id") in selected_task_ids]

        # Group tasks by file
        tasks_by_file: Dict[str, List[Dict[str, Any]]] = {}
        for t in tasks:
            f = t.get("file")
            if f and f != "Unknown file":
                tasks_by_file.setdefault(f, []).append(t)

        file_changes: List[FileChange] = []
        unresolved_tasks: List[int] = []

        # 3. Apply schema.prisma
        schema_fc = self.patch_applier.apply_file_change(
            workspace_dir=workspace,
            rel_path="prisma/schema.prisma",
            new_content=prisma_schema_content,
            dry_run=dry_run,
            change_descriptions=["Generated PostgreSQL Prisma schema from Mongoose models"],
        )
        file_changes.append(schema_fc)

        # 4. Generate src/config/prisma.js
        pkg_code = context_builder.read_file("package.json") or ""
        is_esm = '"type": "module"' in pkg_code

        prisma_client_code = self.code_generator.generate_prisma_client_module(is_esm=is_esm)
        client_fc = self.patch_applier.apply_file_change(
            workspace_dir=workspace,
            rel_path="src/config/prisma.js",
            new_content=prisma_client_code,
            dry_run=dry_run,
            change_descriptions=["Created PrismaClient database connection module"],
        )
        file_changes.append(client_fc)

        # 5. Transform service files
        for rel_file, file_tasks in tasks_by_file.items():
            orig_file_code = context_builder.read_file(rel_file)
            if not orig_file_code:
                continue

            functions = context_builder.extract_functions(rel_file)
            function_replacements: Dict[str, str] = {}
            file_change_notes: List[str] = []
            file_review_required = False

            # Resolve associated model without fallback
            associated_model: Optional[str] = resolve_model_for_file(
                rel_file, orig_file_code, model_schemas, analysis_data
            )

            # 5a. Process planned tasks
            for task in file_tasks:
                t_id = task.get("id")
                t_line = task.get("line")
                task_model = task.get("model") or associated_model
                if task_model:
                    associated_model = task_model

                source_op = task.get("source_operation") or ""
                target_op = task.get("target_operation") or ""
                action = task.get("action", "")

                # If model is completely unresolved, flag as manual review needed
                if not task_model:
                    file_review_required = True
                    file_change_notes.append(
                        f"Unresolved model for task #{t_id} ({source_op or action}). Manual review required."
                    )
                    if t_id and t_id not in unresolved_tasks:
                        unresolved_tasks.append(t_id)
                    continue

                # Find matching function by line first, then by operation/keyword
                matching_fn: Optional[FunctionContext] = None
                if t_line:
                    for fn in functions:
                        if fn.line_start <= t_line <= fn.line_end:
                            matching_fn = fn
                            break

                if not matching_fn and source_op:
                    for fn in functions:
                        if f".{source_op}(" in fn.source_code:
                            matching_fn = fn
                            break

                if not matching_fn and "aggregate" in action.lower():
                    for fn in functions:
                        if "aggregate(" in fn.source_code:
                            matching_fn = fn
                            break

                if not matching_fn and "populate" in action.lower():
                    for fn in functions:
                        if "populate(" in fn.source_code:
                            matching_fn = fn
                            break

                if matching_fn:
                    current_code = function_replacements.get(matching_fn.source_code, matching_fn.source_code)
                    temp_fn = FunctionContext(
                        file_path=matching_fn.file_path,
                        function_name=matching_fn.function_name,
                        source_code=current_code,
                        model_name=task_model,
                        operation=source_op,
                    )
                    transformed_code, changes, review_needed = transform_engine.transform_function(
                        func=temp_fn,
                        model_name=task_model,
                        source_op=source_op or action,
                        target_op=target_op,
                        use_llm=use_llm,
                        ai_config=ai_config,
                    )
                    if transformed_code != matching_fn.source_code:
                        function_replacements[matching_fn.source_code] = transformed_code
                    file_change_notes.extend(changes)
                    if review_needed:
                        file_review_required = True
                        if t_id and t_id not in unresolved_tasks:
                            unresolved_tasks.append(t_id)
                else:
                    if t_id and t_id not in unresolved_tasks:
                        unresolved_tasks.append(t_id)

            # 5b. Pass remaining functions in the file through the engine if full migration (task_ids is None)
            if task_ids is None and associated_model:
                for fn in functions:
                    if fn.source_code not in function_replacements:
                        transformed_code, changes, review_needed = transform_engine.transform_function(
                            func=fn,
                            model_name=associated_model,
                            source_op="",
                            target_op="",
                            use_llm=use_llm,
                            ai_config=ai_config,
                        )
                        if transformed_code != fn.source_code:
                            function_replacements[fn.source_code] = transformed_code
                            file_change_notes.extend(changes)
                        if review_needed:
                            file_review_required = True

            if function_replacements or file_change_notes or file_review_required:
                updated_code, import_changes = self.code_generator.update_service_file(
                    code=orig_file_code,
                    function_replacements=function_replacements,
                    model_name=associated_model or "Model",
                )
                file_change_notes.extend(import_changes)

                fc = self.patch_applier.apply_file_change(
                    workspace_dir=workspace,
                    rel_path=rel_file,
                    new_content=updated_code,
                    original_content=orig_file_code,
                    dry_run=dry_run,
                    change_descriptions=file_change_notes,
                    review_required=file_review_required,
                )
                file_changes.append(fc)

        # 6. Update package.json
        if pkg_code:
            updated_pkg, pkg_changes = self.code_generator.update_package_json(pkg_code)
            if pkg_changes:
                pkg_fc = self.patch_applier.apply_file_change(
                    workspace_dir=workspace,
                    rel_path="package.json",
                    new_content=updated_pkg,
                    original_content=pkg_code,
                    dry_run=dry_run,
                    change_descriptions=pkg_changes,
                )
                file_changes.append(pkg_fc)

        created_count = sum(1 for f in file_changes if f.status == "created")
        modified_count = sum(1 for f in file_changes if f.status == "modified")
        skipped_count = len(unresolved_tasks)

        status_str = "dry_run" if dry_run else ("completed" if not unresolved_tasks else "partial")

        # 7. Generate File Manifest
        manifest = None
        findings_files = {f.get("file") for f in analysis_data.get("findings", []) if f.get("file")}
        if FileTrackerService is not None:
            manifest = FileTrackerService.generate_manifest(
                source_dir=repo_dir,
                workspace_dir=workspace if not dry_run else None,
                findings_files=findings_files,
                file_changes=file_changes,
                unresolved_tasks=unresolved_tasks,
                ai_model_name=ai_config.model if hasattr(ai_config, "model") else (ai_config.get("model") if isinstance(ai_config, dict) else None),
            )

        return EngineeringResult(
            migration_id=migration_id,
            status=status_str,
            files_modified=modified_count,
            files_created=created_count,
            files_skipped=skipped_count,
            files=file_changes,
            unresolved_tasks=unresolved_tasks,
            diff_available=any(f.diff is not None for f in file_changes),
            prisma_schema=prisma_schema_content,
            workspace_dir=str(workspace) if not dry_run else None,
            manifest=manifest.model_dump(by_alias=True) if manifest else None,
            ai_config=ai_config.model_dump() if hasattr(ai_config, "model_dump") else ai_config,
        )
