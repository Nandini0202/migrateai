
"""
Mapping rules for MongoDB/Mongoose to PostgreSQL/Prisma migration.
"""

MIGRATION_MAPPINGS = {
    "findById": {
        "target_operation": "findUnique",
        "description": "Find one record using a unique ID field.",
        "risk": "Verify that the Prisma ID field is unique and has a compatible type.",
        "manual_review": True,
    },
    "findOne": {
        "target_operation": "findFirst",
        "description": "Find the first record matching a filter.",
        "risk": "Verify filter conditions, sorting, and uniqueness.",
        "manual_review": True,
    },
    "find": {
        "target_operation": "findMany",
        "description": "Retrieve multiple records matching a filter.",
        "risk": "Verify filter operators, pagination, and sorting.",
        "manual_review": True,
    },
    "create": {
        "target_operation": "create",
        "description": "Create a record using Prisma.",
        "risk": "Verify required fields, defaults, and data types.",
        "manual_review": True,
    },
    "findByIdAndUpdate": {
        "target_operation": "update",
        "description": "Update a record identified by its ID.",
        "risk": "Verify update operators and behavior when the record is missing.",
        "manual_review": True,
    },
    "findByIdAndDelete": {
        "target_operation": "delete",
        "description": "Delete a record identified by its ID.",
        "risk": "Verify deletion behavior and related-record constraints.",
        "manual_review": True,
    },
}

BLOCKER_RULES = {
    "aggregate": {
        "reason": (
            "MongoDB aggregation pipelines may require substantial "
            "rewriting for PostgreSQL/Prisma."
        ),
        "severity": "high",
    },
    "populate": {
        "reason": (
            "Mongoose populate relationships must be mapped to "
            "appropriate Prisma relations and queries."
        ),
        "severity": "medium",
    },
    "ObjectId": {
        "reason": (
            "ObjectId values may require conversion to a compatible "
            "Prisma and PostgreSQL ID representation."
        ),
        "severity": "medium",
    },
}


def get_mapping(operation: str) -> dict | None:
    """Return a mapping for a recognized Mongoose operation."""
    return MIGRATION_MAPPINGS.get(operation)


def get_blocker_rules(pattern: str) -> list[dict]:
    """Return every blocker rule matching a detected code pattern."""
    matches = []

    if not isinstance(pattern, str):
        return matches

    for keyword, rule in BLOCKER_RULES.items():
        if keyword.lower() in pattern.lower():
            matches.append({
                "keyword": keyword,
                **rule,
            })

    return matches


def get_blocker_rule(pattern: str) -> dict | None:
    """Return the first matching blocker, for backward compatibility."""
    matches = get_blocker_rules(pattern)
    return matches[0] if matches else None
