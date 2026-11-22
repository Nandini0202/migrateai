"""Transformation Engine for Agent 3.

Applies deterministic AST-grounded code transformations for recognized operations,
and uses LLM or manual review flags for complex/blocker patterns.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

try:
    from services.llm_provider import LLMTransformationService
except ImportError:
    try:
        from backend.services.llm_provider import LLMTransformationService
    except ImportError:
        LLMTransformationService = None

from .llm_client import LLMClient
from .models import FunctionContext

BLOCKER_KEYWORDS = [
    "aggregate(",
    "$lookup",
    "$unwind",
    "$facet",
    "$bucket",
    "$geoNear",
    "$graphLookup",
    "watch(",
    "createCollection(",
]


class TransformationEngine:
    def __init__(
        self,
        llm_client: Optional[LLMClient] = None,
        prisma_schema: str = "",
        ai_config: Optional[Any] = None,
    ):
        self.llm = llm_client or LLMClient()
        self.prisma_schema = prisma_schema
        self.ai_config = ai_config

    def transform_function(
        self,
        func: FunctionContext,
        model_name: Optional[str],
        source_op: str,
        target_op: str,
        use_llm: bool = False,
        ai_config: Optional[Any] = None,
    ) -> Tuple[str, List[str], bool]:
        """
        Transform a function body from Mongoose to Prisma.
        Returns: (transformed_code, changes_applied, review_required)
        """
        code = func.source_code
        changes: List[str] = []
        review_required = False
        effective_ai_config = ai_config or self.ai_config

        # 1. Blocker / Unsupported Pattern Check
        for blocker in BLOCKER_KEYWORDS:
            if blocker in code or blocker in source_op.lower():
                return (
                    code,
                    [f"Review required: Complex/unsupported pattern '{blocker}' in {func.function_name} cannot be automatically migrated."],
                    True,
                )

        # 2. Try Multi-Provider LLM if configured or requested
        if (use_llm or effective_ai_config is not None) and LLMTransformationService is not None and effective_ai_config:
            transformed_code, ai_notes, review_needed = LLMTransformationService.transform_function_with_retry(
                config=effective_ai_config,
                source_code=code,
                source_operation=source_op,
                target_operation=target_op,
                model_name=model_name or "UnknownModel",
                file_path=func.file_path,
                prisma_schema=self.prisma_schema,
            )
            if transformed_code and transformed_code != code:
                return transformed_code, ai_notes, review_needed

        # 3. Fallback to LLMClient (Ollama legacy) if requested and available
        if use_llm and self.llm.is_available():
            llm_res = self.llm.transform_code(
                source_code=code,
                source_operation=source_op,
                target_operation=target_op,
                model_name=model_name or "UnknownModel",
                file_path=func.file_path,
                prisma_schema=self.prisma_schema,
            )
            if llm_res and llm_res.get("replacement"):
                return (
                    llm_res["replacement"],
                    [f"LLM migrated {source_op} to {target_op} in {func.function_name}"],
                    bool(llm_res.get("review_required", False)),
                )

        # 4. Deterministic Transformations
        if not model_name:
            return (
                code,
                [f"Review required: Unresolved model in {func.function_name}. Manual conversion required."],
                True,
            )

        transformed, op_changes, needs_review = self._apply_deterministic_rules(
            code, model_name, source_op, target_op
        )
        changes.extend(op_changes)
        if needs_review:
            review_required = True

        return transformed, changes, review_required

    def _apply_deterministic_rules(
        self, code: str, model_name: str, source_op: str, target_op: str
    ) -> Tuple[str, List[str], bool]:
        changes = []
        if not model_name or not model_name.strip():
            return code, ["Model unresolved for this function. Review required."], True
        model_prop = model_name.lower()
        new_code = code
        escaped_name = re.escape(model_name)

        def where_clause(match_id: str) -> str:
            return "{ id }" if match_id == "id" else f"{{ id: {match_id} }}"

        def data_clause(data_arg: str) -> str:
            return "{ data }" if data_arg == "data" else f"{{ data: {data_arg} }}"

        # Pattern 1: Model.find({}).sort({ ... }).lean()
        sort_lean_pattern = re.compile(
            escaped_name + r"\.find\(\s*(?:\{\})?\s*\)\.sort\(\s*\{\s*(\w+)\s*:\s*-1\s*\}\s*\)\.lean\(\)"
        )
        if sort_lean_pattern.search(new_code):
            repl = r"prisma." + model_prop + r".findMany({ orderBy: { \1: 'desc' } })"
            new_code = sort_lean_pattern.sub(repl, new_code)
            changes.append(f"Converted {model_name}.find().sort().lean() to prisma.{model_prop}.findMany(orderBy)")

        # Pattern 2: Model.findById(id).populate('field')
        find_populate_pattern = re.compile(
            escaped_name + r"\.findById\(\s*(\w+)\s*\)\.populate\(\s*['\"](\w+)['\"]\s*\)"
        )
        m2 = find_populate_pattern.search(new_code)
        if m2:
            arg = m2.group(1)
            pop = m2.group(2)
            wc = where_clause(arg)
            repl = f"prisma.{model_prop}.findUnique({{ where: {wc}, include: {{ {pop}: true }} }})"
            new_code = find_populate_pattern.sub(repl, new_code)
            changes.append(f"Converted {model_name}.findById().populate() to prisma.{model_prop}.findUnique(include)")

        # Pattern 3: Model.find().populate('field')
        find_many_populate_pattern = re.compile(
            escaped_name + r"\.find\(\s*(?:\{\})?\s*\)\.populate\(\s*['\"](\w+)['\"]\s*\)"
        )
        if find_many_populate_pattern.search(new_code):
            repl = r"prisma." + model_prop + r".findMany({ include: { \1: true } })"
            new_code = find_many_populate_pattern.sub(repl, new_code)
            changes.append(f"Converted {model_name}.find().populate() to prisma.{model_prop}.findMany(include)")

        # Pattern 4: Model.findById(id)
        find_by_id_pattern = re.compile(escaped_name + r"\.findById\(\s*(\w+)\s*\)")
        m4 = find_by_id_pattern.search(new_code)
        if m4:
            arg = m4.group(1)
            wc = where_clause(arg)
            repl = f"prisma.{model_prop}.findUnique({{ where: {wc} }})"
            new_code = find_by_id_pattern.sub(repl, new_code)
            changes.append(f"Converted {model_name}.findById() to prisma.{model_prop}.findUnique()")

        # Pattern 5: Model.findOne({ ... })
        find_one_pattern = re.compile(escaped_name + r"\.findOne\(\s*(.*?)\s*\)")
        if find_one_pattern.search(new_code):
            repl = r"prisma." + model_prop + r".findFirst({ where: \1 })"
            new_code = find_one_pattern.sub(repl, new_code)
            changes.append(f"Converted {model_name}.findOne() to prisma.{model_prop}.findFirst()")

        # Pattern 6: Model.find({ ... })
        find_pattern = re.compile(escaped_name + r"\.find\(\s*(?:\{\})?\s*\)")
        if find_pattern.search(new_code):
            repl = r"prisma." + model_prop + r".findMany()"
            new_code = find_pattern.sub(repl, new_code)
            changes.append(f"Converted {model_name}.find() to prisma.{model_prop}.findMany()")

        # Pattern 7: const user = new Model(data); return user.save();
        save_pattern = re.compile(
            r"const\s+(\w+)\s*=\s*new\s+" + escaped_name + r"\((\w+)\);\s*return\s+\1\.save\(\);",
            re.MULTILINE
        )
        m7 = save_pattern.search(new_code)
        if m7:
            arg = m7.group(2)
            dc = data_clause(arg)
            repl = f"return prisma.{model_prop}.create({dc});"
            new_code = save_pattern.sub(repl, new_code)
            changes.append(f"Converted new {model_name}().save() to prisma.{model_prop}.create()")

        # Pattern 8: Model.create(data)
        create_pattern = re.compile(escaped_name + r"\.create\(\s*(\w+)\s*\)")
        m8 = create_pattern.search(new_code)
        if m8:
            arg = m8.group(1)
            dc = data_clause(arg)
            repl = f"prisma.{model_prop}.create({dc})"
            new_code = create_pattern.sub(repl, new_code)
            changes.append(f"Converted {model_name}.create() to prisma.{model_prop}.create()")

        # Pattern 9: Model.deleteOne({ _id: id })
        delete_one_pattern = re.compile(
            escaped_name + r"\.deleteOne\(\s*\{\s*(?:_id|id)\s*:\s*(\w+)\s*\}\s*\)"
        )
        m9 = delete_one_pattern.search(new_code)
        if m9:
            arg = m9.group(1)
            wc = where_clause(arg)
            repl = f"prisma.{model_prop}.delete({{ where: {wc} }})"
            new_code = delete_one_pattern.sub(repl, new_code)
            changes.append(f"Converted {model_name}.deleteOne() to prisma.{model_prop}.delete()")

        # Pattern 10: Model.findByIdAndDelete(id)
        delete_by_id_pattern = re.compile(escaped_name + r"\.findByIdAndDelete\(\s*(\w+)\s*\)")
        m10 = delete_by_id_pattern.search(new_code)
        if m10:
            arg = m10.group(1)
            wc = where_clause(arg)
            repl = f"prisma.{model_prop}.delete({{ where: {wc} }})"
            new_code = delete_by_id_pattern.sub(repl, new_code)
            changes.append(f"Converted {model_name}.findByIdAndDelete() to prisma.{model_prop}.delete()")

        # Pattern 11: Model.findByIdAndUpdate(id, data)
        update_by_id_pattern = re.compile(escaped_name + r"\.findByIdAndUpdate\(\s*(\w+)\s*,\s*(\w+)\s*\)")
        m11 = update_by_id_pattern.search(new_code)
        if m11:
            arg = m11.group(1)
            data_arg = m11.group(2)
            wc = where_clause(arg)
            repl = f"prisma.{model_prop}.update({{ where: {wc}, data: {data_arg} }})"
            new_code = update_by_id_pattern.sub(repl, new_code)
            changes.append(f"Converted {model_name}.findByIdAndUpdate() to prisma.{model_prop}.update()")

        needs_review = len(changes) == 0 and bool(source_op)
        return new_code, changes, needs_review
