"""Validates workspace build configuration and test suites."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

from ..models import ValidationCheck


class BuildValidator:
    """Validates package.json build configurations, scripts, and runtime readiness."""

    def __init__(self, workspace_dir: Path, analysis_data: Dict[str, Any]):
        self.workspace_dir = workspace_dir
        self.analysis_data = analysis_data

    def validate(self) -> List[ValidationCheck]:
        checks: List[ValidationCheck] = []
        pkg_file = self.workspace_dir / "package.json"

        if not pkg_file.is_file():
            checks.append(
                ValidationCheck(
                    id="val_build_package_json",
                    name="package.json Verification",
                    category="configuration",
                    status="passed",
                    severity="info",
                    message="No package.json file to validate.",
                )
            )
            return checks

        try:
            pkg_data = json.loads(pkg_file.read_text(encoding="utf-8"))
        except Exception as e:
            checks.append(
                ValidationCheck(
                    id="val_build_package_json",
                    name="package.json Verification",
                    category="configuration",
                    status="failed",
                    severity="critical",
                    message=f"package.json is corrupted: {str(e)}",
                )
            )
            return checks

        deps = pkg_data.get("dependencies", {})
        dev_deps = pkg_data.get("devDependencies", {})
        scripts = pkg_data.get("scripts", {})

        # 1. Dependency checks
        has_prisma_client = "@prisma/client" in deps or "@prisma/client" in dev_deps
        has_prisma_cli = "prisma" in deps or "prisma" in dev_deps

        if has_prisma_client and has_prisma_cli:
            checks.append(
                ValidationCheck(
                    id="val_build_prisma_deps",
                    name="Prisma Runtime Dependencies",
                    category="dependencies",
                    status="passed",
                    severity="info",
                    message="PrismaClient and Prisma CLI dependencies are declared in package.json.",
                )
            )
        else:
            checks.append(
                ValidationCheck(
                    id="val_build_prisma_deps",
                    name="Prisma Runtime Dependencies",
                    category="dependencies",
                    status="warning",
                    severity="high",
                    message="Prisma dependencies are not registered in package.json.",
                    remediation="Add '@prisma/client' and 'prisma' to package.json dependencies.",
                )
            )

        # 2. Build / Test Script checks
        has_test = "test" in scripts and "no test specified" not in scripts.get("test", "")
        if has_test:
            checks.append(
                ValidationCheck(
                    id="val_build_test_script",
                    name="Automated Test Suite Declaration",
                    category="configuration",
                    status="passed",
                    severity="info",
                    message=f"Test script detected: '{scripts['test']}'",
                )
            )
        else:
            checks.append(
                ValidationCheck(
                    id="val_build_test_script",
                    name="Automated Test Suite Declaration",
                    category="configuration",
                    status="warning",
                    severity="low",
                    message="No automated test suite configured in package.json.",
                )
            )

        return checks
