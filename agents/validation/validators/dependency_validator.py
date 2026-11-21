"""Validates package.json dependencies, prisma client configuration module, and environment configs."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

from ..models import ValidationCheck


class DependencyValidator:
    """Validates configuration files, dependencies, and environment setup."""

    def __init__(self, workspace_dir: Path, analysis_data: Dict[str, Any]):
        self.workspace_dir = workspace_dir
        self.analysis_data = analysis_data

    def validate(self) -> List[ValidationCheck]:
        checks: List[ValidationCheck] = []

        # Check 1: package.json inspection
        pkg_path = self.workspace_dir / "package.json"
        if not pkg_path.is_file():
            checks.append(
                ValidationCheck(
                    id="val_dep_package_json",
                    name="Package Configuration File (package.json)",
                    category="dependencies",
                    status="failed",
                    severity="critical",
                    message="package.json was not found in the workspace root.",
                    file="package.json",
                    remediation="Ensure the workspace includes a valid package.json with dependencies.",
                )
            )
        else:
            try:
                pkg_data = json.loads(pkg_path.read_text(encoding="utf-8"))
                deps = pkg_data.get("dependencies", {})
                dev_deps = pkg_data.get("devDependencies", {})
                all_deps = {**deps, **dev_deps}

                # Prisma dependencies check
                has_prisma_client = "@prisma/client" in all_deps
                has_prisma_cli = "prisma" in all_deps

                if has_prisma_client and has_prisma_cli:
                    checks.append(
                        ValidationCheck(
                            id="val_dep_prisma_packages",
                            name="Prisma Package Dependencies",
                            category="dependencies",
                            status="passed",
                            severity="info",
                            message="Both '@prisma/client' and 'prisma' CLI are registered in package.json.",
                            file="package.json",
                        )
                    )
                elif has_prisma_client:
                    checks.append(
                        ValidationCheck(
                            id="val_dep_prisma_packages",
                            name="Prisma Package Dependencies",
                            category="dependencies",
                            status="warning",
                            severity="medium",
                            message="'@prisma/client' is registered, but 'prisma' CLI devDependency is missing.",
                            file="package.json",
                            remediation="Add '\"prisma\": \"^6.0.0\"' to devDependencies in package.json.",
                        )
                    )
                else:
                    checks.append(
                        ValidationCheck(
                            id="val_dep_prisma_packages",
                            name="Prisma Package Dependencies",
                            category="dependencies",
                            status="failed",
                            severity="high",
                            message="'@prisma/client' is not declared in package.json dependencies.",
                            file="package.json",
                            remediation="Add '@prisma/client' to dependencies in package.json.",
                        )
                    )

                # Deprecated dependencies check
                legacy_present = [d for d in ["mongoose", "mongodb"] if d in deps]
                if not legacy_present:
                    checks.append(
                        ValidationCheck(
                            id="val_dep_legacy_removed",
                            name="Mongoose / MongoDB Package Cleanup",
                            category="dependencies",
                            status="passed",
                            severity="info",
                            message="Mongoose and MongoDB driver dependencies have been removed from package.json.",
                            file="package.json",
                        )
                    )
                else:
                    checks.append(
                        ValidationCheck(
                            id="val_dep_legacy_removed",
                            name="Mongoose / MongoDB Package Cleanup",
                            category="dependencies",
                            status="warning",
                            severity="low",
                            message=f"Legacy dependencies still present in package.json: {', '.join(legacy_present)}.",
                            file="package.json",
                            remediation="Uninstall legacy packages using 'npm uninstall " + " ".join(legacy_present) + "'.",
                        )
                    )

            except Exception as e:
                checks.append(
                    ValidationCheck(
                        id="val_dep_package_json",
                        name="Package Configuration File (package.json)",
                        category="dependencies",
                        status="failed",
                        severity="high",
                        message=f"Failed to parse package.json: {str(e)}",
                        file="package.json",
                        remediation="Fix JSON syntax errors in package.json.",
                    )
                )

        # Check 2: Prisma database connection module (src/config/prisma.js)
        prisma_module_path = self.workspace_dir / "src" / "config" / "prisma.js"
        if not prisma_module_path.is_file():
            # Check alternative locations
            alt_path = self.workspace_dir / "src" / "config" / "prisma.ts"
            if alt_path.is_file():
                prisma_module_path = alt_path

        if prisma_module_path.is_file():
            content = prisma_module_path.read_text(encoding="utf-8", errors="replace")
            if "new PrismaClient" in content:
                checks.append(
                    ValidationCheck(
                        id="val_dep_prisma_client_module",
                        name="PrismaClient Singleton Module",
                        category="configuration",
                        status="passed",
                        severity="info",
                        message=f"Prisma connection module is properly configured at '{prisma_module_path.name}'.",
                        file=str(prisma_module_path.relative_to(self.workspace_dir)).replace("\\", "/"),
                    )
                )
            else:
                checks.append(
                    ValidationCheck(
                        id="val_dep_prisma_client_module",
                        name="PrismaClient Singleton Module",
                        category="configuration",
                        status="warning",
                        severity="high",
                        message=f"Prisma connection module exists but does not appear to instantiate new PrismaClient().",
                        file=str(prisma_module_path.relative_to(self.workspace_dir)).replace("\\", "/"),
                        remediation="Instantiate and export 'new PrismaClient()' in src/config/prisma.js.",
                    )
                )
        else:
            checks.append(
                ValidationCheck(
                    id="val_dep_prisma_client_module",
                    name="PrismaClient Singleton Module",
                    category="configuration",
                    status="failed",
                    severity="high",
                    message="PrismaClient connection singleton module 'src/config/prisma.js' is missing.",
                    file="src/config/prisma.js",
                    remediation="Generate src/config/prisma.js to export a shared PrismaClient instance.",
                )
            )

        # Check 3: Environment Configuration (.env or DATABASE_URL mention)
        env_files = [f for f in [self.workspace_dir / ".env", self.workspace_dir / ".env.example"] if f.is_file()]
        if env_files:
            has_db_url = any("DATABASE_URL" in f.read_text(encoding="utf-8", errors="replace") for f in env_files)
            if has_db_url:
                checks.append(
                    ValidationCheck(
                        id="val_dep_env_vars",
                        name="Environment Variables (DATABASE_URL)",
                        category="configuration",
                        status="passed",
                        severity="info",
                        message="DATABASE_URL environment variable is defined in .env / .env.example.",
                        file=str(env_files[0].relative_to(self.workspace_dir)).replace("\\", "/"),
                    )
                )
            else:
                checks.append(
                    ValidationCheck(
                        id="val_dep_env_vars",
                        name="Environment Variables (DATABASE_URL)",
                        category="configuration",
                        status="warning",
                        severity="medium",
                        message="Environment file found, but DATABASE_URL for PostgreSQL connection string was not detected.",
                        file=str(env_files[0].relative_to(self.workspace_dir)).replace("\\", "/"),
                        remediation="Add DATABASE_URL='postgresql://user:password@localhost:5432/mydb?schema=public' to .env.",
                    )
                )
        else:
            checks.append(
                ValidationCheck(
                    id="val_dep_env_vars",
                    name="Environment Variables (DATABASE_URL)",
                    category="configuration",
                    status="warning",
                    severity="low",
                    message="No .env or .env.example file found. Ensure DATABASE_URL is configured in runtime environment.",
                    remediation="Create a .env file containing the PostgreSQL connection string DATABASE_URL.",
                )
            )

        return checks
