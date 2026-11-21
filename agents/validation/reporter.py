"""Markdown report generator for validation results."""

from __future__ import annotations

from typing import List

from .models import ValidationCheck, ValidationSummary


class ValidationReporter:
    """Generates structured Markdown reports from validation results."""

    @staticmethod
    def generate_report(
        summary: ValidationSummary,
        checks: List[ValidationCheck],
        analysis_id: str,
        migration_id: str | None = None,
    ) -> str:
        lines: List[str] = []

        # Title
        lines.append(f"# Migration Validation Report — MigrateAI Agent 4")
        lines.append("")
        lines.append(f"**Analysis ID:** `{analysis_id}`" + (f" | **Migration ID:** `{migration_id}`" if migration_id else ""))
        lines.append(f"**Target Stack:** Node.js + Express + PostgreSQL + Prisma")
        lines.append(f"**Overall Status:** `{summary.status.upper()}` | **Readiness Score:** **{summary.readiness_score:.1f}%**")
        lines.append("")

        # Summary Metrics Table
        lines.append("## Validation Summary")
        lines.append("")
        lines.append("| Metric | Count |")
        lines.append("| :--- | :--- |")
        lines.append(f"| **Total Checks** | {summary.total_checks} |")
        lines.append(f"| **Checks Passed** | ✅ {summary.passed} |")
        lines.append(f"| **Warnings / Review Items** | ⚠️ {summary.warnings} |")
        lines.append(f"| **Checks Failed** | ❌ {summary.failed} |")
        lines.append(f"| **Readiness Score** | **{summary.readiness_score:.1f}%** |")
        lines.append("")

        # Categorized Checks
        categories = ["schema", "database_queries", "code_syntax", "dependencies", "configuration"]
        category_titles = {
            "schema": "1. Prisma Schema & Models",
            "database_queries": "2. Database Query Semantics & Residual Code",
            "code_syntax": "3. JavaScript / TypeScript Syntax & Compilation",
            "dependencies": "4. Package Dependencies",
            "configuration": "5. Runtime Configuration & Environment",
        }

        lines.append("## Detailed Check Results")
        lines.append("")

        for cat in categories:
            cat_checks = [c for c in checks if c.category == cat]
            if not cat_checks:
                continue

            lines.append(f"### {category_titles.get(cat, cat.title())}")
            lines.append("")
            lines.append("| Status | Check | Details | File |")
            lines.append("| :---: | :--- | :--- | :--- |")

            for c in cat_checks:
                status_icon = "✅" if c.status == "passed" else ("⚠️" if c.status == "warning" else "❌")
                file_str = f"`{c.file}`" if c.file else "—"
                lines.append(f"| {status_icon} | **{c.name}** | {c.message} | {file_str} |")

            lines.append("")

        # Action Items & Remediations
        actionable_checks = [c for c in checks if c.status in {"failed", "warning"} and c.remediation]
        if actionable_checks:
            lines.append("## Recommended Remediations")
            lines.append("")
            for idx, c in enumerate(actionable_checks, start=1):
                icon = "❌" if c.status == "failed" else "⚠️"
                lines.append(f"{idx}. {icon} **{c.name}** ({c.file or 'General'}):")
                lines.append(f"   - **Issue:** {c.message}")
                lines.append(f"   - **Remediation:** {c.remediation}")
                lines.append("")
        else:
            lines.append("## Verification Verdict")
            lines.append("")
            lines.append("✨ All automated validation checks passed cleanly. The codebase is prepared for integration testing and staging deployment.")
            lines.append("")

        return "\n".join(lines)
