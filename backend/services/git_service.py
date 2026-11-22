"""Git operations service for MigrateAI."""

from __future__ import annotations

import os
import re
import subprocess
from typing import List, Optional, Tuple

from schemas import BranchesResponse, parse_github_url


class GitService:
    @staticmethod
    def get_remote_branches(repo_url: str, timeout_s: float = 15.0) -> BranchesResponse:
        owner, repo = parse_github_url(repo_url)
        clean_url = f"https://github.com/{owner}/{repo}.git"

        env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
        cmd = ["git", "ls-remote", "--heads", clean_url]

        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_s, env=env)
        except FileNotFoundError:
            raise RuntimeError("git is not installed on the system.")
        except subprocess.TimeoutExpired:
            raise RuntimeError(f"Fetching branches timed out after {timeout_s}s.")

        if proc.returncode != 0:
            err = proc.stderr.lower()
            if "not found" in err or "authentication" in err or "could not read username" in err:
                raise ValueError(f"Repository {owner}/{repo} was not found, or it is private.")
            raise RuntimeError(f"Failed to fetch branches: {proc.stderr[:200]}")

        branches: List[str] = []
        for line in proc.stdout.splitlines():
            line = line.strip()
            if not line:
                continue
            parts = line.split()
            if len(parts) == 2:
                ref = parts[1]
                # Format: refs/heads/<branch_name>
                if ref.startswith("refs/heads/"):
                    branch_name = ref[len("refs/heads/") :]
                    branches.append(branch_name)

        if not branches:
            branches = ["main"]

        default_branch = "main" if "main" in branches else ("master" if "master" in branches else branches[0])

        return BranchesResponse(
            repository_url=f"https://github.com/{owner}/{repo}",
            branches=branches,
            default_branch=default_branch,
        )
