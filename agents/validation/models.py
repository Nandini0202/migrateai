"""Data models for Agent 4 (Validation Agent)."""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


ValidationCategory = Literal[
    "schema",
    "code_syntax",
    "database_queries",
    "dependencies",
    "configuration",
]

ValidationStatus = Literal["passed", "failed", "warning", "skipped"]
ValidationSeverity = Literal["critical", "high", "medium", "low", "info"]


class ValidationCheck(CamelModel):
    id: str
    name: str
    category: ValidationCategory
    status: ValidationStatus
    severity: ValidationSeverity
    message: str
    details: Optional[str] = None
    file: Optional[str] = None
    line: Optional[int] = None
    remediation: Optional[str] = None


class ValidationSummary(CamelModel):
    total_checks: int
    passed: int
    failed: int
    warnings: int
    skipped: int
    readiness_score: float  # 0 to 100
    status: Literal["passed", "failed", "warnings"]


class ValidationRequest(BaseModel):
    dry_run: bool = False
    strict_mode: bool = False
    categories: Optional[List[str]] = None


class ValidationResult(CamelModel):
    validation_id: str
    analysis_id: str
    migration_id: Optional[str] = None
    status: Literal["passed", "failed", "warnings"]
    summary: ValidationSummary
    checks: List[ValidationCheck] = Field(default_factory=list)
    created_at: str
    workspace_dir: Optional[str] = None
    report_markdown: Optional[str] = None
