"""File-level migration tracking and reconciliation service for MigrateAI."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from schemas import FileRecord, FileStatus, RepositoryManifest

IGNORED_DIRS = {
    ".git",
    "node_modules",
    "dist",
    "build",
    ".next",
    ".pytest_cache",
    "__pycache__",
    ".venv",
    "venv",
    ".turbo",
    "coverage",
}

IGNORED_EXTS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".svg",
    ".ico",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
    ".map",
    ".lock",
    ".pyc",
}


def compute_sha256(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def compute_file_sha256(file_path: Path) -> str:
    hasher = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


class FileTrackerService:
    @staticmethod
    def scan_repository_files(repo_dir: Path) -> List[Path]:
        """Collect all relevant source files in the repository."""
        collected: List[Path] = []
        for root, dirs, files in os.walk(repo_dir):
            dirs[:] = [d for d in dirs if d not in IGNORED_DIRS]
            for file in files:
                ext = os.path.splitext(file)[1].lower()
                if ext in IGNORED_EXTS or file.startswith("."):
                    continue
                collected.append(Path(root) / file)
        return collected

    @classmethod
    def generate_manifest(
        cls,
        source_dir: Path,
        workspace_dir: Optional[Path],
        findings_files: Set[str],
        file_changes: List[Any],
        unresolved_tasks: List[int],
        ai_model_name: Optional[str] = None,
    ) -> RepositoryManifest:
        """
        Build a comprehensive, reconciled manifest for all files in the repository.
        Formula: Total = Converted + Unchanged + Skipped + Pending + Failed
        Verified Progress = (S / T) * 100
        """
        source_files = cls.scan_repository_files(source_dir)
        changes_map: Dict[str, Any] = {
            getattr(fc, "file", ""): fc for fc in file_changes if getattr(fc, "file", None)
        }

        records: List[FileRecord] = []
        converted_count = 0
        warning_count = 0
        failed_count = 0
        unchanged_count = 0
        skipped_count = 0
        manual_count = 0
        verified_count = 0

        # Set of relative paths discovered in source
        seen_paths: Set[str] = set()

        for sf in source_files:
            rel_str = sf.relative_to(source_dir).as_posix()
            seen_paths.add(rel_str)

            try:
                orig_text = sf.read_text(encoding="utf-8", errors="replace")
                orig_hash = compute_sha256(orig_text)
                orig_lines = len(orig_text.splitlines())
                orig_size = sf.stat().st_size
            except Exception:
                orig_hash = None
                orig_lines = 0
                orig_size = 0

            requires_conv = rel_str in findings_files
            fc = changes_map.get(rel_str)

            if fc:
                has_diff = bool(getattr(fc, "diff", None))
                conv_text = getattr(fc, "converted_code", None) or ""
                conv_hash = compute_sha256(conv_text) if conv_text else orig_hash
                conv_lines = len(conv_text.splitlines()) if conv_text else orig_lines
                conv_size = len(conv_text.encode("utf-8")) if conv_text else orig_size
                is_review = bool(getattr(fc, "review_required", False))

                if is_review:
                    status: FileStatus = "warnings"
                    warning_count += 1
                    manual_count += 1
                else:
                    status: FileStatus = "converted"
                    converted_count += 1
                    verified_count += 1

                records.append(
                    FileRecord(
                        path=rel_str,
                        original_hash=orig_hash,
                        converted_hash=conv_hash,
                        original_lines=orig_lines,
                        converted_lines=conv_lines,
                        original_size=orig_size,
                        converted_size=conv_size,
                        status=status,
                        conversion_method="hybrid" if ai_model_name else "rule_based",
                        model_used=ai_model_name,
                        errors=[],
                        warnings=getattr(fc, "changes", []),
                        retry_count=0,
                        has_diff=has_diff,
                        requires_conversion=requires_conv,
                    )
                )
            else:
                if requires_conv:
                    status: FileStatus = "failed" if unresolved_tasks else "skipped"
                    if status == "failed":
                        failed_count += 1
                    else:
                        skipped_count += 1
                    errors = ["Contained MongoDB queries but could not be transformed automatically."]
                else:
                    status: FileStatus = "unchanged"
                    unchanged_count += 1
                    errors = []

                records.append(
                    FileRecord(
                        path=rel_str,
                        original_hash=orig_hash,
                        converted_hash=orig_hash,
                        original_lines=orig_lines,
                        converted_lines=orig_lines,
                        original_size=orig_size,
                        converted_size=orig_size,
                        status=status,
                        conversion_method="none",
                        model_used=None,
                        errors=errors,
                        warnings=[],
                        retry_count=0,
                        has_diff=False,
                        requires_conversion=requires_conv,
                    )
                )

        # Include newly created files (e.g. prisma/schema.prisma, src/config/prisma.js)
        for rel_str, fc in changes_map.items():
            if rel_str not in seen_paths:
                conv_text = getattr(fc, "converted_code", None) or ""
                conv_hash = compute_sha256(conv_text) if conv_text else ""
                records.append(
                    FileRecord(
                        path=rel_str,
                        original_hash=None,
                        converted_hash=conv_hash,
                        original_lines=0,
                        converted_lines=len(conv_text.splitlines()) if conv_text else 0,
                        original_size=0,
                        converted_size=len(conv_text.encode("utf-8")) if conv_text else 0,
                        status="converted",
                        conversion_method="rule_based",
                        model_used=ai_model_name,
                        errors=[],
                        warnings=getattr(fc, "changes", []),
                        retry_count=0,
                        has_diff=False,
                        requires_conversion=True,
                    )
                )
                converted_count += 1
                verified_count += 1

        total_files = len(records)
        req_conv = len(findings_files)
        verified_progress = round((verified_count / req_conv * 100.0), 1) if req_conv > 0 else 100.0

        return RepositoryManifest(
            total_files=total_files,
            scanned_files=len(source_files),
            files_requiring_conversion=req_conv,
            converted_count=converted_count,
            warning_count=warning_count,
            failed_count=failed_count,
            unchanged_count=unchanged_count,
            skipped_count=skipped_count,
            manual_count=manual_count,
            verified_count=verified_count,
            verified_progress=verified_progress,
            files=records,
        )
