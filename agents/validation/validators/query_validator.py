"""Validates Prisma client imports, query syntax semantics, model casing, and arguments."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, List

from ..models import ValidationCheck


class QueryValidator:
    """Validates Prisma queries for correct client usage, method arguments, and casing."""

    def __init__(self, workspace_dir: Path, analysis_data: Dict[str, Any]):
        self.workspace_dir = workspace_dir
        self.analysis_data = analysis_data

    def validate(self) -> List[ValidationCheck]:
        checks: List[ValidationCheck] = []
        source_files = self._get_workspace_js_files()

        service_files_with_prisma: List[str] = []
        missing_prisma_imports: List[Dict[str, Any]] = []
        invalid_model_casing: List[Dict[str, Any]] = []
        malformed_queries: List[Dict[str, Any]] = []
        valid_queries_count = 0

        models = self.analysis_data.get("summary", {}).get("models", [])
        known_models = set(models)

        for rel_path, file_path in source_files:
            try:
                content = file_path.read_text(encoding="utf-8", errors="replace")
            except Exception:
                continue

            lines = content.splitlines()
            has_prisma_calls = bool(re.search(r"\bprisma\.\w+", content))

            if has_prisma_calls:
                service_files_with_prisma.append(rel_path)

                # Check if prisma is imported/required on active non-comment lines
                has_import = False
                for line in lines:
                    s = line.strip()
                    if s.startswith("//") or s.startswith("/*") or s.startswith("*"):
                        continue
                    if re.search(r"require\s*\(\s*['\"][^'\"]*prisma[^'\"]*['\"]\s*\)", s) or \
                       re.search(r"from\s*['\"][^'\"]*prisma[^'\"]*['\"]", s):
                        has_import = True
                        break

                if not has_import:
                    missing_prisma_imports.append({
                        "file": rel_path,
                        "line": 1,
                    })

                for idx, line in enumerate(lines, start=1):
                    clean_line = line.strip()
                    if clean_line.startswith("//") or clean_line.startswith("/*"):
                        continue

                    # Check model casing on prisma.<model>.<method>
                    # Prisma Client models are always lowerCamelCase on the prisma instance: prisma.user, not prisma.User!
                    casing_match = re.search(r"\bprisma\.([A-Z]\w+)\.", clean_line)
                    if casing_match:
                        upper_model = casing_match.group(1)
                        if upper_model in known_models:
                            invalid_model_casing.append({
                                "file": rel_path,
                                "line": idx,
                                "model": upper_model,
                                "code": clean_line,
                            })

                    # Check Prisma methods
                    prisma_call = re.search(r"\bprisma\.(\w+)\.(findUnique|findMany|findFirst|create|update|delete|deleteMany|upsert)\s*\((.*?)\)", clean_line)
                    if prisma_call:
                        valid_queries_count += 1
                        method = prisma_call.group(2)
                        args = prisma_call.group(3).strip()

                        # Check required arguments
                        if method in {"findUnique", "delete"} and args and not re.search(r"where\s*:", args):
                            malformed_queries.append({
                                "file": rel_path,
                                "line": idx,
                                "method": method,
                                "code": clean_line,
                                "issue": f"{method} requires a 'where' clause in Prisma",
                            })
                        elif method == "create" and args and not re.search(r"data\s*:", args):
                            malformed_queries.append({
                                "file": rel_path,
                                "line": idx,
                                "method": method,
                                "code": clean_line,
                                "issue": "create requires a 'data' clause in Prisma",
                            })

        # Check 1: Prisma Client Import Presence
        if not missing_prisma_imports:
            checks.append(
                ValidationCheck(
                    id="val_query_client_imported",
                    name="Prisma Client Module Imports",
                    category="database_queries",
                    status="passed",
                    severity="info",
                    message="All files executing Prisma queries correctly import the PrismaClient instance.",
                )
            )
        else:
            first = missing_prisma_imports[0]
            checks.append(
                ValidationCheck(
                    id="val_query_client_imported",
                    name="Prisma Client Module Imports",
                    category="database_queries",
                    status="failed",
                    severity="critical",
                    message=f"File '{first['file']}' executes prisma queries but does not import prisma client.",
                    file=first["file"],
                    line=first["line"],
                    remediation="Add 'const prisma = require(\"../config/prisma\");' to the top of the file.",
                )
            )

        # Check 2: Model Property Casing on Prisma Client
        if not invalid_model_casing:
            checks.append(
                ValidationCheck(
                    id="val_query_model_casing",
                    name="Prisma Model Property Casing",
                    category="database_queries",
                    status="passed",
                    severity="info",
                    message="Prisma client model accessors follow standard lowerCamelCase conventions (e.g. prisma.user).",
                )
            )
        else:
            first = invalid_model_casing[0]
            checks.append(
                ValidationCheck(
                    id="val_query_model_casing",
                    name="Prisma Model Property Casing",
                    category="database_queries",
                    status="warning",
                    severity="high",
                    message=f"Uppercase model accessor detected on Prisma Client: 'prisma.{first['model']}'.",
                    file=first["file"],
                    line=first["line"],
                    details=f"In Prisma Client, models are lowercase: 'prisma.{first['model'][:1].lower() + first['model'][1:]}'.",
                    remediation=f"Change 'prisma.{first['model']}' to 'prisma.{first['model'][:1].lower() + first['model'][1:]}'.",
                )
            )

        # Check 3: Query Arguments Structure (where, data)
        if not malformed_queries:
            checks.append(
                ValidationCheck(
                    id="val_query_arguments",
                    name="Prisma Query Method Argument Semantics",
                    category="database_queries",
                    status="passed",
                    severity="info",
                    message=f"Verified {valid_queries_count} Prisma query method(s) adhere to expected argument structures.",
                )
            )
        else:
            first = malformed_queries[0]
            checks.append(
                ValidationCheck(
                    id="val_query_arguments",
                    name="Prisma Query Method Argument Semantics",
                    category="database_queries",
                    status="warning",
                    severity="high",
                    message=f"Potential argument mismatch in '{first['file']}': {first['issue']}.",
                    file=first["file"],
                    line=first["line"],
                    details=first["code"],
                    remediation=f"Adjust {first['method']} invocation to include the expected clause.",
                )
            )

        return checks

    def _get_workspace_js_files(self) -> List[tuple[str, Path]]:
        results: List[tuple[str, Path]] = []
        if not self.workspace_dir.is_dir():
            return results

        for p in self.workspace_dir.rglob("*"):
            if p.is_file() and p.suffix in {".js", ".ts", ".mjs", ".cjs"}:
                parts = p.parts
                if any(ignored in parts for ignored in {"node_modules", ".git", "dist", "build", ".next"}):
                    continue
                rel_path = str(p.relative_to(self.workspace_dir)).replace("\\", "/")
                results.append((rel_path, p))
        return results
