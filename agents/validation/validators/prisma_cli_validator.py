"""Validates Prisma schema syntax and model definitions."""

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, List

from ..models import ValidationCheck


class PrismaCliValidator:
    """Validates prisma/schema.prisma using Prisma CLI or AST structural checks."""

    def __init__(self, workspace_dir: Path, analysis_data: Dict[str, Any]):
        self.workspace_dir = workspace_dir
        self.analysis_data = analysis_data

    def validate(self) -> List[ValidationCheck]:
        checks: List[ValidationCheck] = []
        schema_file = self.workspace_dir / "prisma" / "schema.prisma"

        if not schema_file.is_file():
            checks.append(
                ValidationCheck(
                    id="val_prisma_schema_file",
                    name="Prisma Schema Existence",
                    category="schema",
                    status="failed",
                    severity="critical",
                    message="prisma/schema.prisma does not exist in the migration workspace.",
                    remediation="Run Agent 3 (Migration Engineering) to generate the Prisma schema.",
                )
            )
            return checks

        content = schema_file.read_text(encoding="utf-8", errors="replace")

        # 1. Structural checks
        has_datasource = "datasource db" in content and 'provider = "postgresql"' in content
        has_client = "generator client" in content and 'provider = "prisma-client-js"' in content

        if not has_datasource or not has_client:
            checks.append(
                ValidationCheck(
                    id="val_prisma_config_blocks",
                    name="Prisma Datasource & Client Config",
                    category="schema",
                    status="warning",
                    severity="high",
                    message="Prisma schema is missing required datasource or generator client blocks.",
                )
            )
        else:
            checks.append(
                ValidationCheck(
                    id="val_prisma_config_blocks",
                    name="Prisma Datasource & Client Config",
                    category="schema",
                    status="passed",
                    severity="info",
                    message="PostgreSQL datasource and prisma-client-js generator configured correctly.",
                )
            )

        # 2. Check model primary keys (@id)
        models = re.findall(r"model\s+(\w+)\s*\{([^}]+)\}", content)
        models_without_id: List[str] = []
        for model_name, model_body in models:
            if "@id" not in model_body:
                models_without_id.append(model_name)

        if models_without_id:
            checks.append(
                ValidationCheck(
                    id="val_prisma_model_ids",
                    name="Prisma Primary Key Definition",
                    category="schema",
                    status="warning",
                    severity="medium",
                    message=f"Model(s) missing '@id' primary key: {', '.join(models_without_id)}",
                    remediation="Add an '@id @default(uuid())' or '@id @default(autoincrement())' field to each model.",
                )
            )
        else:
            checks.append(
                ValidationCheck(
                    id="val_prisma_model_ids",
                    name="Prisma Primary Key Definition",
                    category="schema",
                    status="passed",
                    severity="info",
                    message=f"All {len(models)} declared Prisma models define valid primary keys.",
                )
            )

        # 3. Model relations & syntax validation
        relation_checks: List[str] = []
        for model_name, model_body in models:
            for line in model_body.splitlines():
                line = line.strip()
                if "@relation" in line and not re.search(r"@relation\(fields:\s*\[\w+\],\s*references:\s*\[\w+\]\)", line):
                    relation_checks.append(f"{model_name}: malformed relation syntax in '{line[:50]}'")

        if relation_checks:
            checks.append(
                ValidationCheck(
                    id="val_prisma_relations",
                    name="Prisma Relation Definitions",
                    category="schema",
                    status="warning",
                    severity="medium",
                    message="One or more Prisma relations require explicit fields and references.",
                    details="; ".join(relation_checks),
                )
            )
        else:
            checks.append(
                ValidationCheck(
                    id="val_prisma_relations",
                    name="Prisma Relation Definitions",
                    category="schema",
                    status="passed",
                    severity="info",
                    message="Prisma relation fields syntax verified.",
                )
            )

        return checks
