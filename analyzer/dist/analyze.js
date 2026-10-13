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
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeRepository = analyzeRepository;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const dependencies_1 = require("./dependencies");
const graph_1 = require("./graph");
const rules_1 = require("./rules");
const scanner_1 = require("./scanner");
function packageJsonFindings(root, rel) {
    const findings = [];
    const deps = [];
    let text;
    try {
        text = fs.readFileSync(path.join(root, rel), 'utf8').replace(/^﻿/, '');
    }
    catch {
        return { findings, deps };
    }
    let json;
    try {
        json = JSON.parse(text);
    }
    catch {
        return { findings, deps };
    }
    const lines = text.split(/\r?\n/);
    for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        const block = json[section];
        if (!block || typeof block !== 'object')
            continue;
        for (const name of ['mongoose', 'mongodb']) {
            if (!(name in block))
                continue;
            deps.push(name);
            const idx = lines.findIndex((l) => l.includes(`"${name}"`));
            findings.push({
                file: rel,
                line: idx === -1 ? 1 : idx + 1,
                column: 1,
                category: 'Dependencies',
                pattern: `${section}.${name}`,
                evidence: idx === -1 ? `"${name}": "${block[name]}"` : lines[idx].trim().slice(0, 160),
                confidence: 'high',
                detail: block[name],
            });
        }
    }
    return { findings, deps };
}
function resolvesToModel(a, name, modelFiles, resolver, byPath, depth = 0) {
    if (!name)
        return false;
    if (a.localModels[name])
        return true;
    const via = a.docVars[name];
    if (via && via !== name && depth < 3)
        return resolvesToModel(a, via, modelFiles, resolver, byPath, depth + 1);
    const binding = a.bindings.find((b) => b.local === name);
    if (!binding)
        return false;
    const target = resolver.resolve(a.path, binding.source);
    if (!target)
        return false;
    if (modelFiles.has(target))
        return true;
    // Barrel file (models/index.js) that re-exports model files.
    const barrel = byPath.get(target);
    if (barrel && /(^|\/)index\.[jt]sx?$/.test(target)) {
        return barrel.imports.some((i) => {
            const t = resolver.resolve(barrel.path, i.specifier);
            return !!t && modelFiles.has(t);
        });
    }
    return false;
}
function confidenceFor(c, a, resolved) {
    if (resolved || c.viaModelCall)
        return 'high';
    if (c.hints.includes('collection'))
        return a.usesMongoLib ? 'high' : 'medium';
    if (a.usesMongoLib)
        return 'low';
    const mongooseish = c.hints.some((h) => rules_1.MONGOOSE_CHAIN_HINTS.has(h));
    const findy = c.hints.some((h) => rules_1.FIND_FAMILY.has(h));
    if (mongooseish && findy)
        return 'medium';
    return null; // e.g. Array.prototype.find in a file with no MongoDB context
}
function analyzeRepository(root, opts = {}) {
    const started = Date.now();
    const abs = path.resolve(root);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory())
        throw new Error(`Not a directory: ${root}`);
    const scope = opts.scope ?? 'relevant';
    const generateGraph = opts.generateGraph ?? true;
    const collected = (0, scanner_1.collectFiles)(abs);
    const warnings = [...collected.warnings];
    const fileSet = new Set(collected.files);
    const resolver = (0, dependencies_1.createResolver)(abs, fileSet);
    // Pass 1: per-file AST analysis.
    const analyses = [];
    let parseFailures = 0;
    for (const rel of collected.files) {
        let code;
        try {
            code = fs.readFileSync(path.join(abs, rel), 'utf8');
        }
        catch {
            warnings.push(`Could not read ${rel}`);
            continue;
        }
        const a = (0, scanner_1.analyzeFile)(code, rel);
        if (a.parseError) {
            parseFailures++;
            warnings.push(`${rel}: ${a.parseError}; falling back to pattern matching where needed.`);
        }
        analyses.push(a);
    }
    const byPath = new Map(analyses.map((a) => [a.path, a]));
    // Model files = files that define a Mongoose model or schema.
    const modelFiles = new Map();
    for (const a of analyses) {
        if (a.findings.some((f) => f.category === 'Model' || f.category === 'Schema'))
            modelFiles.set(a.path, a.models);
    }
    // Pass 2: resolve query/operation candidates using cross-file knowledge.
    for (const a of analyses) {
        for (const c of a.candidates) {
            const resolved = resolvesToModel(a, c.rootName, modelFiles, resolver, byPath);
            const confidence = confidenceFor(c, a, resolved);
            if (!confidence)
                continue;
            a.findings.push({
                file: a.path,
                line: c.line,
                column: c.column,
                category: c.category,
                pattern: `${c.rootText}.${c.methods.slice(0, c.opIndex + 1).map((m) => `${m}()`).join('.')}`,
                evidence: c.evidence,
                confidence,
            });
        }
    }
    // package.json dependency findings.
    const pkgFindings = [];
    const declared = new Set();
    for (const pkg of collected.packageJsons) {
        const r = packageJsonFindings(abs, pkg);
        pkgFindings.push(...r.findings);
        r.deps.forEach((d) => declared.add(d));
    }
    const findings = [...analyses.flatMap((a) => a.findings), ...pkgFindings].sort((x, y) => x.file.localeCompare(y.file) || x.line - y.line || x.column - y.column);
    const findingsByFile = new Map();
    for (const f of findings) {
        if (!findingsByFile.has(f.file))
            findingsByFile.set(f.file, []);
        findingsByFile.get(f.file).push(f);
    }
    // Agent 1: dependency graph.
    const built = (0, graph_1.buildGraph)(analyses, findingsByFile, modelFiles, resolver, scope);
    warnings.push(...built.warnings);
    const affectedFiles = Array.from(findingsByFile.entries()).map(([file, fs_]) => ({
        file,
        kind: (built.kinds.get(file) ?? 'file'),
        findingCount: fs_.length,
        categories: Array.from(new Set(fs_.map((f) => f.category))),
    }));
    const usesMongoose = declared.has('mongoose') || analyses.some((a) => a.imports.some((i) => i.specifier === 'mongoose' || i.specifier.startsWith('mongoose/')));
    const usesMongodb = declared.has('mongodb') || analyses.some((a) => a.imports.some((i) => i.specifier === 'mongodb' || i.specifier.startsWith('mongodb/')));
    const byCategory = {};
    const byConfidence = {};
    for (const f of findings) {
        byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
        byConfidence[f.confidence] = (byConfidence[f.confidence] ?? 0) + 1;
    }
    const modelNames = Array.from(new Set(analyses.flatMap((a) => a.models))).sort();
    const summary = {
        filesScanned: analyses.length,
        filesWithFindings: affectedFiles.length,
        totalFindings: findings.length,
        byCategory,
        byConfidence,
        modelCount: modelNames.length,
        models: modelNames,
        driver: usesMongoose && usesMongodb ? 'both' : usesMongoose ? 'mongoose' : usesMongodb ? 'mongodb' : 'none',
        parseFailures,
        truncated: collected.truncated,
        nodeCount: generateGraph ? built.graph.nodes.length : 0,
        edgeCount: generateGraph ? built.graph.edges.length : 0,
        durationMs: Date.now() - started,
    };
    return { summary, findings, affectedFiles, graph: generateGraph ? built.graph : null, warnings };
}
