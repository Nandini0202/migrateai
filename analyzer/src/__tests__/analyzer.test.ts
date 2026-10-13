import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { analyzeRepository } from '../analyze';
import { analyzeFile } from '../scanner';

// dist/__tests__ -> analyzer -> migrateai
const sample = path.resolve(__dirname, '../../../tests/fixtures/sample-app');
const result = analyzeRepository(sample);
const at = (file: string) => result.findings.filter((f) => f.file === file);
const has = (file: string, category: string, pattern: string) =>
  at(file).some((f) => f.category === category && f.pattern.includes(pattern));

describe('scanner', () => {
  it('finds dependencies in package.json and imports', () => {
    assert.ok(at('package.json').some((f) => f.pattern.endsWith('.mongoose')));
    assert.ok(at('package.json').some((f) => f.pattern.endsWith('.mongodb')));
    assert.ok(has('src/models/User.js', 'Dependencies', "require('mongoose')"));
    assert.ok(has('src/models/Post.js', 'Dependencies', "import 'mongoose'"));
    assert.equal(result.summary.driver, 'both');
  });

  it('detects connection, schema, model and relationships', () => {
    assert.ok(has('src/config/db.js', 'Connection', 'mongoose.connect()'));
    assert.ok(has('src/models/User.js', 'Schema', 'new Schema()'));
    assert.ok(has('src/models/Post.js', 'Schema', 'new mongoose.Schema()'));
    assert.ok(has('src/models/User.js', 'Model', 'mongoose.model()'));
    assert.ok(has('src/models/User.js', 'Relationships', "ref: 'Post'"));
    assert.ok(has('src/models/Post.js', 'Relationships', "ref: 'User'"));
    assert.deepEqual(result.summary.models, ['Post', 'User']);
  });

  it('detects queries and operations with high confidence when the model is resolved', () => {
    const q = at('src/services/userService.js');
    assert.equal(q.find((f) => f.pattern === 'User.find()')?.confidence, 'high');
    assert.ok(q.some((f) => f.pattern === 'User.findById()'));
    assert.ok(q.some((f) => f.category === 'Relationships' && f.pattern.includes('populate()')));
    assert.equal(q.find((f) => f.pattern === 'user.save()')?.confidence, 'high'); // const user = new User(...)
    assert.ok(q.some((f) => f.category === 'Database operations' && f.pattern === 'User.deleteOne()'));
    assert.ok(has('src/services/postService.js', 'Database operations', 'Post.aggregate()')); // ES import ending in .js
    assert.ok(has('src/reports/nativeReport.js', 'Connection', 'new MongoClient()'));
    assert.ok(has('src/reports/nativeReport.js', 'Database operations', 'insertOne()'));
    assert.ok(has('src/reports/nativeReport.js', 'Queries', 'find()'));
  });

  it('reports the line of the method, not the start of a multi-line chain', () => {
    const f = at('src/services/userService.js').find((x) => x.pattern === 'User.findById().populate()');
    assert.ok(f);
    assert.equal(f.evidence.includes('populate'), true);
  });

  it('does not report Array.prototype.find as a MongoDB query', () => {
    assert.equal(at('src/utils/helpers.js').length, 0);
  });

  it('keeps unresolvable calls low confidence when the file imports mongoose', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrateai-test-'));
    try {
      fs.writeFileSync(path.join(dir, 'x.js'), "const m = require('mongoose');\nfunction f(list){ return list.find(x => x); }\n");
      fs.writeFileSync(path.join(dir, 'y.js'), 'function g(list){ return list.find(x => x); }\n');
      const r = analyzeRepository(dir);
      const q = r.findings.filter((f) => f.category === 'Queries');
      assert.equal(q.length, 1);
      assert.equal(q[0].file, 'x.js');
      assert.equal(q[0].confidence, 'low');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to patterns when a file is badly broken', () => {
    const a = analyzeFile('@@@ ((( {{{ mongoose.connect(', 'broken.js');
    assert.ok(a.parseError);
    assert.ok(a.findings.some((f) => f.category === 'Connection' && f.confidence === 'low'));
  });

  it('handles TypeScript files', () => {
    const a = analyzeFile(
      "import mongoose, { Schema, Document } from 'mongoose';\ninterface IU extends Document { name: string }\nconst s = new Schema<IU>({ name: String });\nexport const U = mongoose.model<IU>('U', s);\n",
      'u.ts',
    );
    assert.ok(a.findings.some((f) => f.category === 'Schema'));
    assert.ok(a.findings.some((f) => f.category === 'Model' && f.detail === 'U'));
  });
});

describe('Agent 1 dependency graph', () => {
  const g = result.graph!;
  const edge = (s: string, t: string) => g.edges.find((e) => e.source === s && e.target === t);

  it('extracts the real server -> routes -> services -> models chain', () => {
    assert.equal(edge('src/server.js', 'src/routes/userRoutes.js')?.type, 'registers_route');
    assert.equal(edge('src/routes/userRoutes.js', 'src/services/userService.js')?.type, 'calls_service');
    assert.equal(edge('src/services/userService.js', 'src/models/User.js')?.type, 'uses_model');
    assert.equal(edge('src/services/postService.js', 'src/models/Post.js')?.type, 'uses_model');
    assert.equal(edge('src/services/postService.js', 'src/services/userService.js')?.type, 'calls_service');
    assert.equal(edge('src/server.js', 'src/config/db.js')?.type, 'connects_db');
  });

  it('labels edges with real route paths and model names', () => {
    assert.equal(edge('src/server.js', 'src/routes/userRoutes.js')?.label, '/users');
    assert.equal(edge('src/services/userService.js', 'src/models/User.js')?.label, 'User');
  });

  it('classifies files', () => {
    const kind = (id: string) => g.nodes.find((n) => n.id === id)?.kind;
    assert.equal(kind('src/server.js'), 'entry');
    assert.equal(kind('src/routes/userRoutes.js'), 'route');
    assert.equal(kind('src/services/userService.js'), 'service');
    assert.equal(kind('src/models/User.js'), 'model');
    assert.equal(kind('src/config/db.js'), 'database');
  });

  it('reports which files are affected if a model changes', () => {
    const affected = g.impact['src/models/User.js'];
    assert.ok(affected.includes('src/services/userService.js'));
    assert.ok(affected.includes('src/routes/userRoutes.js'));
    assert.ok(affected.includes('src/server.js'));
    assert.ok(affected.includes('src/services/postService.js')); // via userService
  });

  it('omits unrelated files in "relevant" scope but keeps them in "all"', () => {
    assert.equal(g.nodes.some((n) => n.id === 'src/utils/helpers.js'), false);
    const all = analyzeRepository(sample, { scope: 'all' }).graph!;
    assert.equal(all.nodes.some((n) => n.id === 'src/utils/helpers.js'), true);
  });

  it('marks impact levels', () => {
    const imp = (id: string) => g.nodes.find((n) => n.id === id)?.impact;
    assert.equal(imp('src/models/User.js'), 'direct');
    assert.equal(imp('src/routes/userRoutes.js'), 'indirect');
  });

  it('survives import cycles', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrateai-cycle-'));
    try {
      fs.writeFileSync(path.join(dir, 'a.js'), "const b = require('./b');\nconst mongoose = require('mongoose');\nmodule.exports = mongoose.model('A', new mongoose.Schema({}));\n");
      fs.writeFileSync(path.join(dir, 'b.js'), "const a = require('./a');\nmodule.exports = a;\n");
      const r = analyzeRepository(dir);
      assert.equal(r.graph!.nodes.length, 2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
