"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const node_test_1 = require("node:test");
const analyze_1 = require("../analyze");
const scanner_1 = require("../scanner");
// dist/__tests__ -> analyzer -> migrateai
const sample = path.resolve(__dirname, '../../../tests/fixtures/sample-app');
const result = (0, analyze_1.analyzeRepository)(sample);
const at = (file) => result.findings.filter((f) => f.file === file);
const has = (file, category, pattern) => at(file).some((f) => f.category === category && f.pattern.includes(pattern));
(0, node_test_1.describe)('scanner', () => {
    (0, node_test_1.it)('finds dependencies in package.json and imports', () => {
        strict_1.default.ok(at('package.json').some((f) => f.pattern.endsWith('.mongoose')));
        strict_1.default.ok(at('package.json').some((f) => f.pattern.endsWith('.mongodb')));
        strict_1.default.ok(has('src/models/User.js', 'Dependencies', "require('mongoose')"));
        strict_1.default.ok(has('src/models/Post.js', 'Dependencies', "import 'mongoose'"));
        strict_1.default.equal(result.summary.driver, 'both');
    });
    (0, node_test_1.it)('detects connection, schema, model and relationships', () => {
        strict_1.default.ok(has('src/config/db.js', 'Connection', 'mongoose.connect()'));
        strict_1.default.ok(has('src/models/User.js', 'Schema', 'new Schema()'));
        strict_1.default.ok(has('src/models/Post.js', 'Schema', 'new mongoose.Schema()'));
        strict_1.default.ok(has('src/models/User.js', 'Model', 'mongoose.model()'));
        strict_1.default.ok(has('src/models/User.js', 'Relationships', "ref: 'Post'"));
        strict_1.default.ok(has('src/models/Post.js', 'Relationships', "ref: 'User'"));
        strict_1.default.deepEqual(result.summary.models, ['Post', 'User']);
    });
    (0, node_test_1.it)('detects queries and operations with high confidence when the model is resolved', () => {
        const q = at('src/services/userService.js');
        strict_1.default.equal(q.find((f) => f.pattern === 'User.find()')?.confidence, 'high');
        strict_1.default.ok(q.some((f) => f.pattern === 'User.findById()'));
        strict_1.default.ok(q.some((f) => f.category === 'Relationships' && f.pattern.includes('populate()')));
        strict_1.default.equal(q.find((f) => f.pattern === 'user.save()')?.confidence, 'high'); // const user = new User(...)
        strict_1.default.ok(q.some((f) => f.category === 'Database operations' && f.pattern === 'User.deleteOne()'));
        strict_1.default.ok(has('src/services/postService.js', 'Database operations', 'Post.aggregate()')); // ES import ending in .js
        strict_1.default.ok(has('src/reports/nativeReport.js', 'Connection', 'new MongoClient()'));
        strict_1.default.ok(has('src/reports/nativeReport.js', 'Database operations', 'insertOne()'));
        strict_1.default.ok(has('src/reports/nativeReport.js', 'Queries', 'find()'));
    });
    (0, node_test_1.it)('reports the line of the method, not the start of a multi-line chain', () => {
        const f = at('src/services/userService.js').find((x) => x.pattern === 'User.findById().populate()');
        strict_1.default.ok(f);
        strict_1.default.equal(f.evidence.includes('populate'), true);
    });
    (0, node_test_1.it)('does not report Array.prototype.find as a MongoDB query', () => {
        strict_1.default.equal(at('src/utils/helpers.js').length, 0);
    });
    (0, node_test_1.it)('keeps unresolvable calls low confidence when the file imports mongoose', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrateai-test-'));
        try {
            fs.writeFileSync(path.join(dir, 'x.js'), "const m = require('mongoose');\nfunction f(list){ return list.find(x => x); }\n");
            fs.writeFileSync(path.join(dir, 'y.js'), 'function g(list){ return list.find(x => x); }\n');
            const r = (0, analyze_1.analyzeRepository)(dir);
            const q = r.findings.filter((f) => f.category === 'Queries');
            strict_1.default.equal(q.length, 1);
            strict_1.default.equal(q[0].file, 'x.js');
            strict_1.default.equal(q[0].confidence, 'low');
        }
        finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
    (0, node_test_1.it)('falls back to patterns when a file is badly broken', () => {
        const a = (0, scanner_1.analyzeFile)('@@@ ((( {{{ mongoose.connect(', 'broken.js');
        strict_1.default.ok(a.parseError);
        strict_1.default.ok(a.findings.some((f) => f.category === 'Connection' && f.confidence === 'low'));
    });
    (0, node_test_1.it)('handles TypeScript files', () => {
        const a = (0, scanner_1.analyzeFile)("import mongoose, { Schema, Document } from 'mongoose';\ninterface IU extends Document { name: string }\nconst s = new Schema<IU>({ name: String });\nexport const U = mongoose.model<IU>('U', s);\n", 'u.ts');
        strict_1.default.ok(a.findings.some((f) => f.category === 'Schema'));
        strict_1.default.ok(a.findings.some((f) => f.category === 'Model' && f.detail === 'U'));
    });
});
(0, node_test_1.describe)('Agent 1 dependency graph', () => {
    const g = result.graph;
    const edge = (s, t) => g.edges.find((e) => e.source === s && e.target === t);
    (0, node_test_1.it)('extracts the real server -> routes -> services -> models chain', () => {
        strict_1.default.equal(edge('src/server.js', 'src/routes/userRoutes.js')?.type, 'registers_route');
        strict_1.default.equal(edge('src/routes/userRoutes.js', 'src/services/userService.js')?.type, 'calls_service');
        strict_1.default.equal(edge('src/services/userService.js', 'src/models/User.js')?.type, 'uses_model');
        strict_1.default.equal(edge('src/services/postService.js', 'src/models/Post.js')?.type, 'uses_model');
        strict_1.default.equal(edge('src/services/postService.js', 'src/services/userService.js')?.type, 'calls_service');
        strict_1.default.equal(edge('src/server.js', 'src/config/db.js')?.type, 'connects_db');
    });
    (0, node_test_1.it)('labels edges with real route paths and model names', () => {
        strict_1.default.equal(edge('src/server.js', 'src/routes/userRoutes.js')?.label, '/users');
        strict_1.default.equal(edge('src/services/userService.js', 'src/models/User.js')?.label, 'User');
    });
    (0, node_test_1.it)('classifies files', () => {
        const kind = (id) => g.nodes.find((n) => n.id === id)?.kind;
        strict_1.default.equal(kind('src/server.js'), 'entry');
        strict_1.default.equal(kind('src/routes/userRoutes.js'), 'route');
        strict_1.default.equal(kind('src/services/userService.js'), 'service');
        strict_1.default.equal(kind('src/models/User.js'), 'model');
        strict_1.default.equal(kind('src/config/db.js'), 'database');
    });
    (0, node_test_1.it)('reports which files are affected if a model changes', () => {
        const affected = g.impact['src/models/User.js'];
        strict_1.default.ok(affected.includes('src/services/userService.js'));
        strict_1.default.ok(affected.includes('src/routes/userRoutes.js'));
        strict_1.default.ok(affected.includes('src/server.js'));
        strict_1.default.ok(affected.includes('src/services/postService.js')); // via userService
    });
    (0, node_test_1.it)('omits unrelated files in "relevant" scope but keeps them in "all"', () => {
        strict_1.default.equal(g.nodes.some((n) => n.id === 'src/utils/helpers.js'), false);
        const all = (0, analyze_1.analyzeRepository)(sample, { scope: 'all' }).graph;
        strict_1.default.equal(all.nodes.some((n) => n.id === 'src/utils/helpers.js'), true);
    });
    (0, node_test_1.it)('marks impact levels', () => {
        const imp = (id) => g.nodes.find((n) => n.id === id)?.impact;
        strict_1.default.equal(imp('src/models/User.js'), 'direct');
        strict_1.default.equal(imp('src/routes/userRoutes.js'), 'indirect');
    });
    (0, node_test_1.it)('survives import cycles', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrateai-cycle-'));
        try {
            fs.writeFileSync(path.join(dir, 'a.js'), "const b = require('./b');\nconst mongoose = require('mongoose');\nmodule.exports = mongoose.model('A', new mongoose.Schema({}));\n");
            fs.writeFileSync(path.join(dir, 'b.js'), "const a = require('./a');\nmodule.exports = a;\n");
            const r = (0, analyze_1.analyzeRepository)(dir);
            strict_1.default.equal(r.graph.nodes.length, 2);
        }
        finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
