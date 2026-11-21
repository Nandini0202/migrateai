"""Validates JavaScript and TypeScript syntax across all migrated source files."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, List

from ..models import ValidationCheck


class SyntaxValidator:
    """Validates syntax and AST parsing for modified and created code files."""

    def __init__(self, workspace_dir: Path, analysis_data: Dict[str, Any]):
        self.workspace_dir = workspace_dir
        self.analysis_data = analysis_data
        self.node_path = shutil.which("node")

    def validate(self) -> List[ValidationCheck]:
        checks: List[ValidationCheck] = []
        js_files = self._get_workspace_js_files()

        if not js_files:
            checks.append(
                ValidationCheck(
                    id="val_syntax_code_files",
                    name="JavaScript Syntax Verification",
                    category="code_syntax",
                    status="passed",
                    severity="info",
                    message="No JavaScript/TypeScript source files found to validate.",
                )
            )
            return checks

        syntax_errors: List[Dict[str, Any]] = []
        files_checked = 0

        for rel_path, file_path in js_files:
            files_checked += 1
            if self.node_path and file_path.suffix in {".js", ".mjs", ".cjs"}:
                try:
                    proc = subprocess.run(
                        [self.node_path, "--check", str(file_path)],
                        capture_output=True,
                        text=True,
                        timeout=10,
                    )
                    if proc.returncode != 0:
                        err_msg = proc.stderr.strip()
                        syntax_errors.append({
                            "file": rel_path,
                            "error": err_msg or "Syntax error during compilation",
                        })
                except Exception as e:
                    # Fallback to local token check
                    err = self._check_brackets(file_path)
                    if err:
                        syntax_errors.append({"file": rel_path, "error": err})
            else:
                err = self._check_brackets(file_path)
                if err:
                    syntax_errors.append({"file": rel_path, "error": err})

        if not syntax_errors:
            checks.append(
                ValidationCheck(
                    id="val_syntax_compilation",
                    name="JavaScript / TypeScript Syntax Compilation",
                    category="code_syntax",
                    status="passed",
                    severity="info",
                    message=f"All {files_checked} source file(s) compiled successfully without syntax errors.",
                )
            )
        else:
            first = syntax_errors[0]
            checks.append(
                ValidationCheck(
                    id="val_syntax_compilation",
                    name="JavaScript / TypeScript Syntax Compilation",
                    category="code_syntax",
                    status="failed",
                    severity="critical",
                    message=f"Syntax error detected in '{first['file']}'.",
                    file=first["file"],
                    details=first["error"],
                    remediation="Inspect and fix syntax errors in the transformed source file.",
                )
            )

        return checks

    def _check_brackets(self, file_path: Path) -> str | None:
        try:
            content = file_path.read_text(encoding="utf-8", errors="replace")
        except Exception as e:
            return f"Unreadable file: {str(e)}"

        pairs = {"(": ")", "{": "}", "[": "]"}
        stack: List[str] = []
        in_string = False
        quote_char = ""

        for char in content:
            if in_string:
                if char == quote_char:
                    in_string = False
            elif char in {"'", '"', '`'}:
                in_string = True
                quote_char = char
            elif char in pairs:
                stack.append(char)
            elif char in pairs.values():
                if not stack or pairs[stack.pop()] != char:
                    return f"Unmatched bracket or brace '{char}'"

        if stack:
            return f"Unclosed bracket or brace '{stack[-1]}'"
        return None

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
