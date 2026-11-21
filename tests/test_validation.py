"""Tests for Agent 4 (Validation Agent)."""

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "migration_planner"))

import orchestrator
from agents.validation import ValidationAgent
from agents.validation.validators import (
    DependencyValidator,
    QueryValidator,
    ResidualValidator,
    SchemaValidator,
    SyntaxValidator,
)


class TestValidationAgent(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sample_dir = ROOT / "tests" / "fixtures" / "sample-app"
        cls.analysis = orchestrator.analyze_sample(generate_graph=True)

    def setUp(self):
        self.temp_ws = Path(tempfile.mkdtemp(prefix="test-validation-"))
        self.agent = ValidationAgent(workspace_base_dir=self.temp_ws)

    def tearDown(self):
        if self.temp_ws.exists():
            shutil.rmtree(self.temp_ws, ignore_errors=True)

    def test_validation_on_sample_app_migration(self):
        # Run validation through orchestrator
        val_result = orchestrator.run_validation(self.analysis.id)

        self.assertIsNotNone(val_result)
        self.assertEqual(val_result.analysis_id, self.analysis.id)
        self.assertGreater(val_result.summary.total_checks, 0)
        self.assertGreater(val_result.summary.passed, 0)
        self.assertGreater(val_result.summary.readiness_score, 50.0)
        self.assertIn(val_result.status, ["passed", "warnings"])
        self.assertIn("Migration Validation Report", val_result.report_markdown)
        self.assertIn("Prisma", val_result.report_markdown)

    def test_schema_validator_catches_missing_schema(self):
        validator = SchemaValidator(self.temp_ws, self.analysis.model_dump(by_alias=True))
        checks = validator.validate()

        self.assertEqual(len(checks), 1)
        self.assertEqual(checks[0].id, "val_schema_exists")
        self.assertEqual(checks[0].status, "failed")
        self.assertEqual(checks[0].severity, "critical")
        self.assertIn("schema.prisma", checks[0].message)

    def test_schema_validator_validates_correct_schema(self):
        prisma_dir = self.temp_ws / "prisma"
        prisma_dir.mkdir(parents=True)
        schema_file = prisma_dir / "schema.prisma"
        schema_file.write_text(
            """datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id        String   @id @default(uuid())
  email     String   @unique
  name      String
  posts     Post[]
  createdAt DateTime @default(now())
}

model Post {
  id        String   @id @default(uuid())
  title     String
  authorId  String
  author    User     @relation(fields: [authorId], references: [id])
}
""",
            encoding="utf-8",
        )

        validator = SchemaValidator(self.temp_ws, self.analysis.model_dump(by_alias=True))
        checks = validator.validate()

        statuses = {c.id: c.status for c in checks}
        self.assertEqual(statuses.get("val_schema_exists"), "passed")
        self.assertEqual(statuses.get("val_schema_datasource"), "passed")
        self.assertEqual(statuses.get("val_schema_generator"), "passed")
        self.assertEqual(statuses.get("val_schema_model_coverage"), "passed")
        self.assertEqual(statuses.get("val_schema_primary_keys"), "passed")
        self.assertEqual(statuses.get("val_schema_relations_integrity"), "passed")

    def test_residual_validator_detects_unmigrated_mongoose_queries(self):
        services_dir = self.temp_ws / "src" / "services"
        services_dir.mkdir(parents=True)
        bad_service = services_dir / "badService.js"
        bad_service.write_text(
            """const mongoose = require('mongoose');

async function getUser(id) {
    return await User.findById(id);
}
""",
            encoding="utf-8",
        )

        validator = ResidualValidator(self.temp_ws, self.analysis.model_dump(by_alias=True))
        checks = validator.validate()

        statuses = {c.id: c.status for c in checks}
        self.assertEqual(statuses.get("val_residual_imports"), "warning")
        self.assertEqual(statuses.get("val_residual_queries"), "warning")

    def test_query_validator_detects_bad_casing_and_missing_import(self):
        services_dir = self.temp_ws / "src" / "services"
        services_dir.mkdir(parents=True)
        service = services_dir / "userService.js"
        service.write_text(
            """// Note: missing require('../config/prisma')
async function getUser(id) {
    return await prisma.User.findUnique({ where: { id } });
}
""",
            encoding="utf-8",
        )

        validator = QueryValidator(self.temp_ws, self.analysis.model_dump(by_alias=True))
        checks = validator.validate()

        statuses = {c.id: c.status for c in checks}
        self.assertEqual(statuses.get("val_query_client_imported"), "failed")
        self.assertEqual(statuses.get("val_query_model_casing"), "warning")

    def test_syntax_validator_catches_syntax_errors(self):
        services_dir = self.temp_ws / "src" / "services"
        services_dir.mkdir(parents=True)
        broken_file = services_dir / "broken.js"
        broken_file.write_text("function bad( { ;;; const", encoding="utf-8")

        validator = SyntaxValidator(self.temp_ws, self.analysis.model_dump(by_alias=True))
        checks = validator.validate()

        self.assertEqual(len(checks), 1)
        self.assertEqual(checks[0].status, "failed")
        self.assertEqual(checks[0].severity, "critical")


if __name__ == "__main__":
    unittest.main()
