"""Validates that deprecated MongoDB/Mongoose imports and calls are not lingering in migrated code."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, List, Set

from ..models import ValidationCheck


class ResidualValidator:
    """Scans workspace source files for lingering MongoDB and Mongoose constructs."""

    def __init__(self, workspace_dir: Path, analysis_data: Dict[str, Any]):
        self.workspace_dir = workspace_dir
        self.analysis_data = analysis_data

    def validate(self) -> List[ValidationCheck]:
        checks: List[ValidationCheck] = []
        source_files = self._get_workspace_js_files()

        residual_imports: List[Dict[str, Any]] = []
        residual_queries: List[Dict[str, Any]] = []
        residual_connections: List[Dict[str, Any]] = []

        models = self.analysis_data.get("summary", {}).get("models", [])
        model_names_pattern = "|".join(re.escape(m) for m in models) if models else r"[A-Z]\w+"

        for rel_path, file_path in source_files:
            try:
                content = file_path.read_text(encoding="utf-8", errors="replace")
            except Exception:
                continue

            lines = content.splitlines()

            # Skip the legacy models/ directory if it was kept for reference
            is_service_or_route = "services" in rel_path.lower() or "routes" in rel_path.lower() or "controllers" in rel_path.lower()

            for idx, line in enumerate(lines, start=1):
                clean_line = line.strip()
                if clean_line.startswith("//") or clean_line.startswith("/*"):
                    continue

                # 1. Imports
                if is_service_or_route:
                    if re.search(r"require\s*\(\s*['\"](?:mongoose|mongodb)['\"]\s*\)", clean_line) or \
                       re.search(r"from\s*['\"](?:mongoose|mongodb)['\"]", clean_line):
                        residual_imports.append({
                            "file": rel_path,
                            "line": idx,
                            "code": clean_line,
                        })

                # 2. Residual Mongoose queries in services
                if is_service_or_route and models:
                    query_match = re.search(
                        rf"\b({model_names_pattern})\.(findById|find|findOne|findByIdAndUpdate|findByIdAndDelete|deleteMany|updateMany|countDocuments)\s*\(",
                        clean_line,
                    )
                    if query_match:
                        residual_queries.append({
                            "file": rel_path,
                            "line": idx,
                            "model": query_match.group(1),
                            "op": query_match.group(2),
                            "code": clean_line,
                        })

                # 3. Connection calls
                if re.search(r"mongoose\.connect\s*\(", clean_line) or re.search(r"new\s+MongoClient\s*\(", clean_line):
                    residual_connections.append({
                        "file": rel_path,
                        "line": idx,
                        "code": clean_line,
                    })

        # Check 1: Residual Imports Check
        if not residual_imports:
            checks.append(
                ValidationCheck(
                    id="val_residual_imports",
                    name="Residual Mongoose / MongoDB Imports",
                    category="database_queries",
                    status="passed",
                    severity="info",
                    message="No active Mongoose or MongoDB driver imports detected in migrated services or routes.",
                )
            )
        else:
            first = residual_imports[0]
            checks.append(
                ValidationCheck(
                    id="val_residual_imports",
                    name="Residual Mongoose / MongoDB Imports",
                    category="database_queries",
                    status="warning",
                    severity="high",
                    message=f"Found {len(residual_imports)} lingering Mongoose/MongoDB import(s) in migrated code.",
                    file=first["file"],
                    line=first["line"],
                    details="\n".join([f"{item['file']}:{item['line']} -> {item['code']}" for item in residual_imports[:5]]),
                    remediation="Replace legacy ORM imports with the Prisma Client database instance (e.g. require('../config/prisma')).",
                )
            )

        # Check 2: Residual Queries Check
        if not residual_queries:
            checks.append(
                ValidationCheck(
                    id="val_residual_queries",
                    name="Residual Mongoose Query Methods",
                    category="database_queries",
                    status="passed",
                    severity="info",
                    message="All active database service calls have been converted from Mongoose model methods to Prisma Client queries.",
                )
            )
        else:
            first = residual_queries[0]
            checks.append(
                ValidationCheck(
                    id="val_residual_queries",
                    name="Residual Mongoose Query Methods",
                    category="database_queries",
                    status="warning",
                    severity="high",
                    message=f"Found {len(residual_queries)} untransformed Mongoose query call(s) in service layer.",
                    file=first["file"],
                    line=first["line"],
                    details="\n".join([f"{item['file']}:{item['line']} -> {item['code']}" for item in residual_queries[:5]]),
                    remediation=f"Transform '{first['model']}.{first['op']}' into its corresponding 'prisma.{first['model'].lower()}.*' method.",
                )
            )

        # Check 3: Residual Connection Calls
        if not residual_connections:
            checks.append(
                ValidationCheck(
                    id="val_residual_connection",
                    name="Legacy Database Connection Handlers",
                    category="configuration",
                    status="passed",
                    severity="info",
                    message="No legacy mongoose.connect() or MongoClient connections detected in main runtime flow.",
                )
            )
        else:
            first = residual_connections[0]
            checks.append(
                ValidationCheck(
                    id="val_residual_connection",
                    name="Legacy Database Connection Handlers",
                    category="configuration",
                    status="warning",
                    severity="medium",
                    message=f"Found {len(residual_connections)} legacy database connection initialization call(s).",
                    file=first["file"],
                    line=first["line"],
                    details="\n".join([f"{item['file']}:{item['line']} -> {item['code']}" for item in residual_connections[:3]]),
                    remediation="Replace mongoose.connect with Prisma client initialization or Prisma connection helper.",
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
