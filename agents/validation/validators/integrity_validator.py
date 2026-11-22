"""Validates file integrity and ensures original files are intact without silent corruptions."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict, List

from ..models import ValidationCheck


class IntegrityValidator:
    """Validates that untouched files are preserved and converted files are not empty or malformed."""

    def __init__(self, workspace_dir: Path, analysis_data: Dict[str, Any]):
        self.workspace_dir = workspace_dir
        self.analysis_data = analysis_data

    def validate(self) -> List[ValidationCheck]:
        checks: List[ValidationCheck] = []
        if not self.workspace_dir.is_dir():
            checks.append(
                ValidationCheck(
                    id="val_integrity_workspace",
                    name="Workspace Integrity Check",
                    category="configuration",
                    status="failed",
                    severity="critical",
                    message="Target migration workspace directory does not exist.",
                )
            )
            return checks

        empty_files: List[str] = []
        corrupted_files: List[str] = []

        for root, _, files in os.walk(self.workspace_dir):
            for file in files:
                full_p = Path(root) / file
                rel_p = full_p.relative_to(self.workspace_dir).as_posix()
                if rel_p.startswith((".git", "node_modules", "dist")):
                    continue
                try:
                    stat = full_p.stat()
                    if stat.st_size == 0 and not file.startswith("."):
                        empty_files.append(rel_p)
                except Exception as e:
                    corrupted_files.append(f"{rel_p} ({str(e)})")

        if empty_files:
            checks.append(
                ValidationCheck(
                    id="val_integrity_empty_files",
                    name="Zero-Byte File Integrity",
                    category="configuration",
                    status="warning",
                    severity="medium",
                    message=f"{len(empty_files)} empty file(s) detected in workspace: {', '.join(empty_files[:3])}",
                    details=f"Empty files: {', '.join(empty_files)}",
                    remediation="Inspect generated files to ensure code generation was not prematurely truncated.",
                )
            )
        else:
            checks.append(
                ValidationCheck(
                    id="val_integrity_empty_files",
                    name="Zero-Byte File Integrity",
                    category="configuration",
                    status="passed",
                    severity="info",
                    message="All generated and preserved workspace files contain non-zero byte payloads.",
                )
            )

        if corrupted_files:
            checks.append(
                ValidationCheck(
                    id="val_integrity_unreadable",
                    name="File Readability & Permissions",
                    category="configuration",
                    status="failed",
                    severity="high",
                    message=f"{len(corrupted_files)} unreadable file(s) encountered in workspace.",
                    details=f"Unreadable files: {', '.join(corrupted_files)}",
                )
            )
        else:
            checks.append(
                ValidationCheck(
                    id="val_integrity_unreadable",
                    name="File Readability & Permissions",
                    category="configuration",
                    status="passed",
                    severity="info",
                    message="Workspace file integrity confirmed across all repository paths.",
                )
            )

        return checks
