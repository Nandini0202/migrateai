
"""
Migration Planner Agent.

Converts repository analysis findings into an ordered
MongoDB/Mongoose to PostgreSQL/Prisma migration plan.
"""

from migration.mapping_rules import get_mapping, get_blocker_rules, MIGRATION_MAPPINGS


PRIORITY_ORDER = {
    "high": 0,
    "medium": 1,
    "low": 2,
}


def create_migration_plan(findings: list[dict]) -> dict:
    """
    Create a migration plan from repository analysis findings.

    Expected finding fields:
        file: source file path
        line: line number (optional)
        pattern: detected code pattern
        operation: Mongoose operation (optional)
        model: model name (optional)
    """

    if not isinstance(findings, list):
        raise TypeError("findings must be a list of dictionaries")

    tasks = []
    blockers = []
    warnings = []
    task_id = 1

    for index, finding in enumerate(findings):
        if not isinstance(finding, dict):
            warnings.append({
                "finding_index": index,
                "message": "Finding must be a dictionary; skipped.",
            })
            continue

        file_path = finding.get("file", "Unknown file")
        line = finding.get("line")
        pattern = finding.get("pattern", "")
        operation = finding.get("operation", "")
        model = finding.get("model") or finding.get("detail")

        if not isinstance(file_path, str) or not file_path.strip():
            file_path = "Unknown file"

        if not isinstance(line, int) or isinstance(line, bool) or line < 1:
            line = None

        if not isinstance(pattern, str):
            pattern = ""

        if not isinstance(operation, str):
            operation = ""

        # Auto-detect operation and model from pattern if not explicitly provided
        if not operation and pattern:
            for op_name in MIGRATION_MAPPINGS:
                if f".{op_name}(" in pattern or pattern.startswith(f"{op_name}(") or pattern == f"{op_name}()":
                    operation = op_name
                    break
            if not operation:
                for op_name in ["aggregate", "populate"]:
                    if f".{op_name}(" in pattern or pattern.startswith(f"{op_name}(") or pattern == f"{op_name}()":
                        operation = op_name
                        break

        if not model and pattern and "." in pattern:
            prefix = pattern.split(".")[0].strip()
            if prefix.isidentifier() and prefix[0].isupper():
                model = prefix

        # Find every migration blocker in this pattern.
        matched_rules = get_blocker_rules(pattern)

        for rule in matched_rules:
            blocker = {
                "file": file_path,
                "line": line,
                "pattern": pattern,
                "keyword": rule["keyword"],
                "severity": rule["severity"],
                "reason": rule["reason"],
            }
            blockers.append(blocker)

            tasks.append({
                "id": task_id,
                "file": file_path,
                "line": line,
                "model": model,
                "action": (
                    f"Review and migrate the {rule['keyword']} pattern"
                ),
                "reason": rule["reason"],
                "priority": rule["severity"],
                "status": "pending",
                "manual_review": True,
            })
            task_id += 1

        # Create a task for a recognized database operation.
        mapping = get_mapping(operation) if operation else None

        if mapping:
            tasks.append({
                "id": task_id,
                "file": file_path,
                "line": line,
                "model": model,
                "source_operation": operation,
                "target_operation": mapping["target_operation"],
                "action": (
                    f"Review conversion from {operation} "
                    f"to {mapping['target_operation']}"
                ),
                "reason": mapping["risk"],
                "priority": (
                    "medium" if mapping["manual_review"] else "low"
                ),
                "status": "pending",
                "manual_review": mapping["manual_review"],
            })
            task_id += 1

        elif operation and not any(
            rule["keyword"].lower() == operation.lower()
            for rule in matched_rules
        ):
            warnings.append({
                "file": file_path,
                "line": line,
                "operation": operation,
                "message": (
                    "No mapping rule exists for this operation. "
                    "Manual investigation is required."
                ),
            })

    # Highest-priority tasks come first.
    tasks.sort(
        key=lambda task: (
            PRIORITY_ORDER.get(task["priority"], 3),
            task["id"],
        )
    )

    return {
        "source": "MongoDB/Mongoose",
        "target": "PostgreSQL/Prisma",
        "summary": {
            "findings_received": len(findings),
            "findings_processed": (
                len(findings)
                - sum(
                    1 for warning in warnings
                    if "finding_index" in warning
                )
            ),
            "tasks_created": len(tasks),
            "blockers_found": len(blockers),
            "warnings_count": len(warnings),
        },
        "blockers": blockers,
        "warnings": warnings,
        "tasks": tasks,
    }
