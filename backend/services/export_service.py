"""Export and ZIP archiving service for MigrateAI."""

from __future__ import annotations

import csv
import io
import json
import os
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from schemas import RepositoryManifest

IGNORED_PATTERNS = {
    ".git",
    "node_modules",
    ".next",
    "__pycache__",
    ".pytest_cache",
    ".venv",
    "venv",
    ".env",
    ".env.local",
    ".env.production",
    ".DS_Store",
    "Thumbs.db",
}


class ExportService:
    @staticmethod
    def is_safe_path(rel_path: str) -> bool:
        """Prevent path traversal and inclusion of sensitive files."""
        normalized = os.path.normpath(rel_path)
        parts = normalized.replace("\\", "/").split("/")
        for part in parts:
            if part == ".." or part in IGNORED_PATTERNS:
                return False
            if part.startswith(".env"):
                return False
        return True

    @classmethod
    def generate_markdown_report(
        cls,
        analysis_data: Dict[str, Any],
        manifest: Optional[RepositoryManifest],
        engineering_data: Optional[Dict[str, Any]],
        validation_data: Optional[Dict[str, Any]],
    ) -> str:
        repo_url = analysis_data.get("repositoryUrl") or "Bundled Sample App"
        branch = analysis_data.get("branch") or "default"
        created_at = analysis_data.get("createdAt") or "N/A"

        total_files = manifest.total_files if manifest else 0
        converted_count = manifest.converted_count if manifest else 0
        warning_count = manifest.warning_count if manifest else 0
        failed_count = manifest.failed_count if manifest else 0
        unchanged_count = manifest.unchanged_count if manifest else 0
        progress = manifest.verified_progress if manifest else 0.0

        md = [
            f"# MigrateAI — Code Migration Report",
            f"",
            f"**Repository:** `{repo_url}` (Branch: `{branch}`)",
            f"**Migration Date:** `{created_at}`",
            f"**Target Architecture:** PostgreSQL + Prisma ORM",
            f"",
            f"---",
            f"",
            f"## 1. Executive Migration Summary",
            f"",
            f"- **Total Repository Files:** {total_files}",
            f"- **Successfully Converted:** {converted_count}",
            f"- **Converted with Warnings:** {warning_count}",
            f"- **Failed / Blocker Files:** {failed_count}",
            f"- **Untouched / Unchanged Files:** {unchanged_count}",
            f"- **Verified Conversion Progress:** **{progress}%**",
            f"",
            f"---",
            f"",
            f"## 2. File Conversion Manifest",
            f"",
            f"| File Path | Status | Method | Lines (Before/After) | Size (Before/After) | Notes |",
            f"|:---|:---:|:---:|:---:|:---:|:---|",
        ]

        if manifest:
            for f in manifest.files:
                notes = "; ".join(f.warnings + f.errors) or "None"
                lines = f"{f.original_lines} → {f.converted_lines}"
                sizes = f"{f.original_size}B → {f.converted_size}B"
                md.append(f"| `{f.path}` | **{f.status.upper()}** | {f.conversion_method} | {lines} | {sizes} | {notes} |")

        md.extend([
            f"",
            f"---",
            f"",
            f"## 3. Validation Assessment",
            f"",
        ])

        if validation_data:
            summary = validation_data.get("summary", {})
            md.extend([
                f"- **Overall Validation Status:** **{validation_data.get('status', 'unknown').upper()}**",
                f"- **Readiness Score:** **{summary.get('readinessScore', 0)}%**",
                f"- **Passed Checks:** {summary.get('passed', 0)} / {summary.get('totalChecks', 0)}",
                f"- **Failed Checks:** {summary.get('failed', 0)}",
                f"- **Warnings:** {summary.get('warnings', 0)}",
                f"",
                f"### Detailed Verification Checks",
                f"",
            ])
            for chk in validation_data.get("checks", []):
                icon = "✅" if chk.get("status") == "passed" else ("⚠️" if chk.get("status") == "warning" else "❌")
                md.append(f"- {icon} **[{chk.get('category')}] {chk.get('name')}**: {chk.get('message')}")
        else:
            md.append("*Validation has not yet been executed on this workspace.*")

        md.extend([
            f"",
            f"---",
            f"*Generated automatically by MigrateAI — AI-Powered Code Modernization Platform.*",
        ])

        return "\n".join(md)

    @classmethod
    def generate_csv_manifest(cls, manifest: Optional[RepositoryManifest]) -> str:
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "path",
            "status",
            "conversion_method",
            "model_used",
            "original_lines",
            "converted_lines",
            "original_size",
            "converted_size",
            "original_hash",
            "converted_hash",
            "has_diff",
            "notes",
        ])

        if manifest:
            for f in manifest.files:
                notes = "; ".join(f.warnings + f.errors)
                writer.writerow([
                    f.path,
                    f.status,
                    f.conversion_method,
                    f.model_used or "",
                    f.original_lines,
                    f.converted_lines,
                    f.original_size,
                    f.converted_size,
                    f.original_hash or "",
                    f.converted_hash or "",
                    "true" if f.has_diff else "false",
                    notes,
                ])

        return output.getvalue()

    @classmethod
    def create_project_zip(
        cls,
        workspace_dir: Path,
        analysis_data: Dict[str, Any],
        manifest: Optional[RepositoryManifest] = None,
        engineering_data: Optional[Dict[str, Any]] = None,
        validation_data: Optional[Dict[str, Any]] = None,
        export_type: str = "full",
    ) -> Path:
        """
        Package files into a validated, safe ZIP archive.
        export_type: 'full' | 'converted' | 'original'
        """
        temp_zip = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
        temp_zip.close()
        zip_path = Path(temp_zip.name)

        converted_rel_paths: Set[str] = set()
        if manifest:
            for f in manifest.files:
                if f.status in {"converted", "warnings"}:
                    converted_rel_paths.add(f.path)

        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            # 1. Walk workspace directory
            for root, dirs, files in os.walk(workspace_dir):
                # Prune ignored directories in place
                dirs[:] = [d for d in dirs if d not in IGNORED_PATTERNS]
                for file in files:
                    if file in IGNORED_PATTERNS or file.startswith(".env"):
                        continue
                    full_p = Path(root) / file
                    rel_p = full_p.relative_to(workspace_dir).as_posix()

                    if not cls.is_safe_path(rel_p):
                        continue

                    # If converted-only export requested, filter
                    if export_type == "converted":
                        if rel_p not in converted_rel_paths and not rel_p.startswith("prisma/"):
                            continue

                    zf.write(full_p, arcname=f"migrateai-project/{rel_p}")

            # 2. Add reports folder
            md_rep = cls.generate_markdown_report(analysis_data, manifest, engineering_data, validation_data)
            csv_rep = cls.generate_csv_manifest(manifest)
            json_rep = json.dumps(
                {
                    "analysis": analysis_data,
                    "manifest": manifest.model_dump(by_alias=True) if manifest else None,
                    "validation": validation_data,
                },
                indent=2,
            )

            zf.writestr("migrateai-project/migrateai-report/migration-report.md", md_rep)
            zf.writestr("migrateai-project/migrateai-report/file-manifest.csv", csv_rep)
            zf.writestr("migrateai-project/migrateai-report/migration-report.json", json_rep)

        # Integrity check
        with zipfile.ZipFile(zip_path, "r") as zf:
            corrupt = zf.testzip()
            if corrupt:
                os.remove(zip_path)
                raise RuntimeError(f"Generated ZIP failed integrity check on: {corrupt}")

        return zip_path
