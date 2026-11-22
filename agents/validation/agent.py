"""Agent 4 — Validation Agent.

Comprehensive automated verification engine for validating MongoDB/Mongoose to
PostgreSQL/Prisma migrations. Validates schema completeness, residual code cleanup,
query semantics, dependency registration, and syntax integrity.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from .models import (
    ValidationCheck,
    ValidationResult,
    ValidationSummary,
)
from .reporter import ValidationReporter
from .validators import (
    BuildValidator,
    DependencyValidator,
    IntegrityValidator,
    PrismaCliValidator,
    QueryValidator,
    ResidualValidator,
    SchemaValidator,
    SyntaxValidator,
)


class ValidationAgent:
    """Agent 4: Validates the migrated codebase and reports readiness."""

    def __init__(self, workspace_base_dir: Optional[Path] = None):
        self.workspace_base_dir = workspace_base_dir

    def run(
        self,
        workspace_dir: Path,
        analysis_data: Dict[str, Any],
        migration_id: Optional[str] = None,
        dry_run: bool = False,
        strict_mode: bool = False,
    ) -> ValidationResult:
        validation_id = uuid.uuid4().hex[:12]
        analysis_id = analysis_data.get("id", "unknown")

        checks: List[ValidationCheck] = []

        # 1. Schema Validation
        schema_validator = SchemaValidator(workspace_dir, analysis_data)
        checks.extend(schema_validator.validate())

        # 2. Residual Code / Cleanup Validation
        residual_validator = ResidualValidator(workspace_dir, analysis_data)
        checks.extend(residual_validator.validate())

        # 3. Query Semantics Validation
        query_validator = QueryValidator(workspace_dir, analysis_data)
        checks.extend(query_validator.validate())

        # 4. Dependency & Config Validation
        dependency_validator = DependencyValidator(workspace_dir, analysis_data)
        checks.extend(dependency_validator.validate())

        # 5. Syntax & Compilation Validation
        syntax_validator = SyntaxValidator(workspace_dir, analysis_data)
        checks.extend(syntax_validator.validate())

        # 6. File Integrity & Zero-Byte Checks
        integrity_validator = IntegrityValidator(workspace_dir, analysis_data)
        checks.extend(integrity_validator.validate())

        # 7. Prisma Schema & Key Definition
        prisma_validator = PrismaCliValidator(workspace_dir, analysis_data)
        checks.extend(prisma_validator.validate())

        # 8. Build & Test Suite Declaration
        build_validator = BuildValidator(workspace_dir, analysis_data)
        checks.extend(build_validator.validate())

        # Calculate metrics
        total = len(checks)
        passed = sum(1 for c in checks if c.status == "passed")
        failed = sum(1 for c in checks if c.status == "failed")
        warnings = sum(1 for c in checks if c.status == "warning")
        skipped = sum(1 for c in checks if c.status == "skipped")

        # Calculate readiness score
        # Base 100%, deduct based on severity
        penalty = 0.0
        for c in checks:
            if c.status == "failed":
                if c.severity == "critical":
                    penalty += 25.0
                elif c.severity == "high":
                    penalty += 15.0
                else:
                    penalty += 10.0
            elif c.status == "warning":
                penalty += 5.0

        readiness_score = max(0.0, min(100.0, 100.0 - penalty))

        if failed > 0 or (strict_mode and warnings > 0):
            overall_status = "failed"
        elif warnings > 0:
            overall_status = "warnings"
        else:
            overall_status = "passed"

        summary = ValidationSummary(
            total_checks=total,
            passed=passed,
            failed=failed,
            warnings=warnings,
            skipped=skipped,
            readiness_score=round(readiness_score, 1),
            status=overall_status,
        )

        report_md = ValidationReporter.generate_report(
            summary=summary,
            checks=checks,
            analysis_id=analysis_id,
            migration_id=migration_id,
        )

        return ValidationResult(
            validation_id=validation_id,
            analysis_id=analysis_id,
            migration_id=migration_id,
            status=overall_status,
            summary=summary,
            checks=checks,
            created_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            workspace_dir=str(workspace_dir) if not dry_run else None,
            report_markdown=report_md,
        )
