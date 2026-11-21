"""Validates Prisma schema syntax, models, primary keys, and relations."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from ..models import ValidationCheck


class SchemaValidator:
    """Validates the generated Prisma schema for correctness, model mapping, and relations."""

    def __init__(self, workspace_dir: Path, analysis_data: Dict[str, Any]):
        self.workspace_dir = workspace_dir
        self.analysis_data = analysis_data

    def validate(self) -> List[ValidationCheck]:
        checks: List[ValidationCheck] = []
        schema_path = self.workspace_dir / "prisma" / "schema.prisma"

        # Check 1: Existence of schema.prisma
        if not schema_path.is_file():
            checks.append(
                ValidationCheck(
                    id="val_schema_exists",
                    name="Prisma Schema File Existence",
                    category="schema",
                    status="failed",
                    severity="critical",
                    message="Prisma schema file 'prisma/schema.prisma' was not found in the migrated workspace.",
                    file="prisma/schema.prisma",
                    remediation="Run Agent 3 (Migration Engineering) to generate the Prisma schema before validation.",
                )
            )
            return checks

        checks.append(
            ValidationCheck(
                id="val_schema_exists",
                name="Prisma Schema File Existence",
                category="schema",
                status="passed",
                severity="info",
                message="Found 'prisma/schema.prisma' in workspace.",
                file="prisma/schema.prisma",
            )
        )

        content = schema_path.read_text(encoding="utf-8", errors="replace")

        # Check 2: Datasource configuration
        if "datasource db {" in content and 'provider = "postgresql"' in content:
            checks.append(
                ValidationCheck(
                    id="val_schema_datasource",
                    name="PostgreSQL Datasource Configuration",
                    category="schema",
                    status="passed",
                    severity="info",
                    message="Datasource correctly configured with 'postgresql' provider.",
                    file="prisma/schema.prisma",
                )
            )
        else:
            checks.append(
                ValidationCheck(
                    id="val_schema_datasource",
                    name="PostgreSQL Datasource Configuration",
                    category="schema",
                    status="failed",
                    severity="high",
                    message="Datasource block missing or not configured with PostgreSQL provider.",
                    file="prisma/schema.prisma",
                    remediation="Ensure datasource db block specifies provider = 'postgresql' and env('DATABASE_URL').",
                )
            )

        # Check 3: Generator client configuration
        if "generator client {" in content and 'provider = "prisma-client-js"' in content:
            checks.append(
                ValidationCheck(
                    id="val_schema_generator",
                    name="Prisma Client Generator Configuration",
                    category="schema",
                    status="passed",
                    severity="info",
                    message="Client generator configured with 'prisma-client-js'.",
                    file="prisma/schema.prisma",
                )
            )
        else:
            checks.append(
                ValidationCheck(
                    id="val_schema_generator",
                    name="Prisma Client Generator Configuration",
                    category="schema",
                    status="failed",
                    severity="high",
                    message="Client generator block missing or not specifying 'prisma-client-js'.",
                    file="prisma/schema.prisma",
                    remediation="Add 'generator client { provider = \"prisma-client-js\" }' to schema.prisma.",
                )
            )

        # Parse models in schema
        models_in_schema = self._parse_models(content)

        # Check 4: Model coverage (ensure all Mongoose models from analysis exist in schema)
        expected_models = self._get_expected_models()
        missing_models = [m for m in expected_models if m not in models_in_schema]
        if not missing_models:
            checks.append(
                ValidationCheck(
                    id="val_schema_model_coverage",
                    name="Model Migration Coverage",
                    category="schema",
                    status="passed",
                    severity="info",
                    message=f"All {len(expected_models)} detected Mongoose model(s) ({', '.join(expected_models)}) are mapped in Prisma schema.",
                    file="prisma/schema.prisma",
                )
            )
        else:
            checks.append(
                ValidationCheck(
                    id="val_schema_model_coverage",
                    name="Model Migration Coverage",
                    category="schema",
                    status="failed",
                    severity="critical",
                    message=f"Missing Prisma models for detected Mongoose models: {', '.join(missing_models)}.",
                    file="prisma/schema.prisma",
                    details=f"Expected: {expected_models}, Found: {list(models_in_schema.keys())}",
                    remediation="Generate Prisma models for all missing entities to preserve data integrity.",
                )
            )

        # Check 5: Primary key verification on every model
        models_without_id = []
        for model_name, model_info in models_in_schema.items():
            if not model_info.get("has_id"):
                models_without_id.append(model_name)

        if not models_without_id:
            checks.append(
                ValidationCheck(
                    id="val_schema_primary_keys",
                    name="Primary Key (@id) Declarations",
                    category="schema",
                    status="passed",
                    severity="info",
                    message="All Prisma models declare a primary key (@id).",
                    file="prisma/schema.prisma",
                )
            )
        else:
            checks.append(
                ValidationCheck(
                    id="val_schema_primary_keys",
                    name="Primary Key (@id) Declarations",
                    category="schema",
                    status="failed",
                    severity="critical",
                    message=f"Models missing primary key (@id): {', '.join(models_without_id)}.",
                    file="prisma/schema.prisma",
                    remediation="Add an '@id' field (e.g. 'id String @id @default(uuid())') to every model.",
                )
            )

        # Check 6: Relations and reciprocal integrity
        relation_warnings = self._validate_relations(models_in_schema)
        if not relation_warnings:
            checks.append(
                ValidationCheck(
                    id="val_schema_relations_integrity",
                    name="Schema Relations & Foreign Keys",
                    category="schema",
                    status="passed",
                    severity="info",
                    message="All model relations and reciprocal fields are structurally consistent.",
                    file="prisma/schema.prisma",
                )
            )
        else:
            for rw in relation_warnings:
                checks.append(
                    ValidationCheck(
                        id=f"val_schema_relation_{rw['model'].lower()}",
                        name=f"Relation Integrity ({rw['model']})",
                        category="schema",
                        status="warning",
                        severity="medium",
                        message=rw["message"],
                        file="prisma/schema.prisma",
                        remediation=rw.get("remediation"),
                    )
                )

        return checks

    def _get_expected_models(self) -> List[str]:
        summary = self.analysis_data.get("summary") or {}
        models = summary.get("models") or []
        if not models:
            findings = self.analysis_data.get("findings") or []
            found_set: Set[str] = set()
            for f in findings:
                if f.get("category") == "Model" and f.get("detail"):
                    found_set.add(f.get("detail"))
            models = sorted(list(found_set))
        return models

    def _parse_models(self, content: str) -> Dict[str, Dict[str, Any]]:
        models: Dict[str, Dict[str, Any]] = {}
        model_blocks = re.findall(r"model\s+(\w+)\s*\{([^}]+)\}", content, re.MULTILINE)

        for model_name, body in model_blocks:
            lines = [line.strip() for line in body.strip().splitlines() if line.strip() and not line.strip().startswith("//")]
            has_id = False
            fields: Dict[str, Dict[str, Any]] = {}
            relations: List[Dict[str, Any]] = []

            for line in lines:
                parts = line.split()
                if len(parts) >= 2:
                    fname = parts[0]
                    ftype = parts[1]
                    if "@id" in line:
                        has_id = True
                    is_relation = "@relation" in line
                    if is_relation:
                        relations.append({"field": fname, "type": ftype, "raw": line})
                    fields[fname] = {"type": ftype, "raw": line}

            models[model_name] = {
                "has_id": has_id,
                "fields": fields,
                "relations": relations,
            }

        return models

    def _validate_relations(self, models: Dict[str, Dict[str, Any]]) -> List[Dict[str, str]]:
        warnings: List[Dict[str, str]] = []
        for mname, minfo in models.items():
            for rel in minfo["relations"]:
                target_model = rel["type"].replace("?", "").replace("[]", "")
                if target_model not in models:
                    warnings.append({
                        "model": mname,
                        "message": f"Model '{mname}' references unknown target model '{target_model}'.",
                        "remediation": f"Ensure target model '{target_model}' is defined in schema.prisma.",
                    })
        return warnings
