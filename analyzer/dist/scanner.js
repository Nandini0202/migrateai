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
exports.collectFiles = collectFiles;
exports.analyzeFile = analyzeFile;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const ts = __importStar(require("typescript"));
const ast_1 = require("./ast");
const dependencies_1 = require("./dependencies");
const rules_1 = require("./rules");
function collectFiles(root, limits = rules_1.LIMITS) {
    const files = [];
    const packageJsons = [];
    const warnings = [];
    let truncated = false;
    let totalBytes = 0;
    const deadline = Date.now() + limits.timeMs;
    const stack = [''];
    outer: while (stack.length) {
        const rel = stack.pop();
        let entries;
        try {
            entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
        }
        catch {
            warnings.push(`Could not read directory ${rel || '.'}`);
            continue;
        }
        for (const e of entries) {
            if (Date.now() > deadline) {
                truncated = true;
                warnings.push('Time limit reached; analysis is partial.');
                break outer;
            }
            if (e.isSymbolicLink())
                continue; // never follow symlinks out of the repo
            const childRel = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory()) {
                if (rules_1.SKIP_DIRS.has(e.name) || e.name.startsWith('.'))
                    continue;
                stack.push(childRel);
                continue;
            }
            if (!e.isFile())
                continue;
            if (e.name === 'package.json') {
                packageJsons.push(childRel);
                continue;
            }
            if (!rules_1.SOURCE_EXTS.has(path.extname(e.name).toLowerCase()))
                continue;
            if (rules_1.GENERATED_PATTERNS.some((r) => r.test(e.name)))
                continue;
            let size = 0;
            try {
                size = fs.statSync(path.join(root, childRel)).size;
            }
            catch {
                continue;
            }
            if (size > limits.maxFileBytes) {
                warnings.push(`Skipped large file ${childRel}`);
                continue;
            }
            if (files.length >= limits.maxFiles || totalBytes + size > limits.maxTotalBytes) {
                truncated = true;
                warnings.push('File limit reached; analysis is partial.');
                break outer;
            }
            files.push(childRel);
            totalBytes += size;
        }
    }
    files.sort();
    packageJsons.sort();
    return { files, packageJsons, warnings, truncated };
}
// ---------------------------------------------------------------------------
// Step 3 — detect MongoDB usage (pattern evidence + AST context)
// ---------------------------------------------------------------------------
const isPkg = (spec, name) => spec === name || spec.startsWith(`${name}/`);
function categoryOf(method) {
    if (rules_1.QUERY_METHODS.has(method))
        return 'Queries';
    if (rules_1.DB_OP_METHODS.has(method))
        return 'Database operations';
    if (method === 'populate')
        return 'Relationships';
    return null;
}
function emptyAnalysis(rel) {
    return {
        path: rel,
        imports: [],
        bindings: [],
        findings: [],
        candidates: [],
        registrations: [],
        localModels: {},
        docVars: {},
        flags: { listen: false, expressCall: false, routerCall: false, routeCalls: 0 },
        usesMongoLib: false,
        models: [],
        dynamicImports: 0,
    };
}
function analyzeFile(code, rel) {
    const text = code.replace(/^﻿/, '');
    const lines = text.split(/\r?\n/);
    let result = emptyAnalysis(rel);
    const { sf, diagnostics } = (0, ast_1.parseSource)(text, rel);
    try {
        astPass(sf, result, lines);
    }
    catch (err) {
        // e.g. stack overflow on pathologically deep code: discard partial state, use patterns only
        result = emptyAnalysis(rel);
        result.parseError = `analysis failed (${err instanceof Error ? err.message : 'unknown error'})`;
        fallbackScan(lines, result);
        return result;
    }
    if (diagnostics > 0) {
        result.parseError = `${diagnostics} syntax error(s); results for this file may be incomplete`;
        if (result.findings.length === 0 && result.imports.length === 0)
            fallbackScan(lines, result);
    }
    return result;
}
function fallbackScan(lines, a) {
    lines.forEach((text, i) => {
        for (const rule of rules_1.FALLBACK_PATTERNS) {
            if (rule.regex.test(text)) {
                a.findings.push({
                    file: a.path,
                    line: i + 1,
                    column: 1,
                    category: rule.category,
                    pattern: rule.pattern,
                    evidence: text.trim().slice(0, 160),
                    confidence: 'low',
                });
                if (rule.category === 'Dependencies' || rule.category === 'Connection')
                    a.usesMongoLib = true;
            }
        }
        // Minimal import extraction so the graph still has edges for unparsable files.
        const re = /(?:require\(\s*|from\s+)['"](\.{1,2}\/[^'"]+)['"]/g;
        let m;
        while ((m = re.exec(text)))
            a.imports.push({ specifier: m[1], kind: 'import', line: i + 1, column: m.index + 1 });
    });
}
function astPass(sf, a, lines) {
    const ev = (line) => (lines[line - 1] ?? '').trim().slice(0, 160);
    const loc = (n) => {
        const p = sf.getLineAndCharacterOfPosition(n.getStart(sf));
        return { line: p.line + 1, column: p.character + 1 };
    };
    const add = (category, pattern, n, confidence, detail) => {
        const { line, column } = loc(n);
        a.findings.push({ file: a.path, line, column, category, pattern, evidence: ev(line), confidence, detail });
    };
    const { imports, bindings, dynamicCount } = (0, dependencies_1.extractImports)(sf);
    a.imports = imports;
    a.bindings = bindings;
    a.dynamicImports = dynamicCount;
    const mongooseNs = new Set();
    const mongodbNs = new Set();
    const mongooseNamed = new Map(); // local -> exported name
    const mongodbNamed = new Map();
    for (const b of bindings) {
        if (isPkg(b.source, 'mongoose')) {
            if (b.imported === 'default' || b.imported === '*')
                mongooseNs.add(b.local);
            else
                mongooseNamed.set(b.local, b.imported);
        }
        else if (isPkg(b.source, 'mongodb')) {
            if (b.imported === 'default' || b.imported === '*')
                mongodbNs.add(b.local);
            else
                mongodbNamed.set(b.local, b.imported);
        }
    }
    a.usesMongoLib = imports.some((i) => isPkg(i.specifier, 'mongoose') || isPkg(i.specifier, 'mongodb'));
    // Dependencies: import / require of the packages.
    for (const imp of imports) {
        if (isPkg(imp.specifier, 'mongoose') || isPkg(imp.specifier, 'mongodb')) {
            a.findings.push({
                file: a.path,
                line: imp.line,
                column: imp.column,
                category: 'Dependencies',
                pattern: imp.kind === 'require' ? `require('${imp.specifier}')` : `import '${imp.specifier}'`,
                evidence: ev(imp.line),
                confidence: 'high',
                detail: imp.specifier,
            });
        }
    }
    const connVars = new Set();
    const localModels = new Map();
    const docVars = new Map();
    const refs = [];
    const seenCandidates = new Set();
    const idText = (n) => (n && ts.isIdentifier(n) ? n.text : null);
    const isConnectionFactory = (call) => {
        const c = call.expression;
        if ((0, ast_1.isAccess)(c) && ts.isIdentifier(c.expression)) {
            return mongooseNs.has(c.expression.text) && (0, ast_1.accessName)(c) === 'createConnection';
        }
        return ts.isIdentifier(c) && mongooseNamed.get(c.text) === 'createConnection';
    };
    const modelCall = (call) => {
        const callee = call.expression;
        const first = (0, ast_1.strValue)(call.arguments[0]);
        if ((0, ast_1.isAccess)(callee) && (0, ast_1.accessName)(callee) === 'model' && ts.isIdentifier(callee.expression)) {
            const o = callee.expression.text;
            if (mongooseNs.has(o) || connVars.has(o))
                return { conf: 'high', name: first ?? 'unknown' };
            if (a.usesMongoLib && first !== null && call.arguments.length >= 2)
                return { conf: 'medium', name: first };
        }
        else if (ts.isIdentifier(callee) && mongooseNamed.get(callee.text) === 'model') {
            return { conf: 'high', name: first ?? 'unknown' };
        }
        return null;
    };
    const findModelCallIn = (n) => {
        const cur = (0, ast_1.unwrap)(n);
        if (!cur)
            return null;
        if (ts.isCallExpression(cur) && modelCall(cur))
            return cur;
        if (ts.isBinaryExpression(cur))
            return findModelCallIn(cur.left) ?? findModelCallIn(cur.right);
        if (ts.isConditionalExpression(cur))
            return findModelCallIn(cur.whenTrue) ?? findModelCallIn(cur.whenFalse);
        return null;
    };
    const argRoot = (arg) => {
        const x = (0, ast_1.unwrap)(arg);
        if (!x)
            return { binding: null, specifier: null };
        if (ts.isIdentifier(x))
            return { binding: x.text, specifier: null };
        if ((0, ast_1.isAccess)(x)) {
            const r = idText((0, ast_1.analyzeChain)(x).root);
            if (r)
                return { binding: r, specifier: null };
        }
        if (ts.isCallExpression(x) && ts.isIdentifier(x.expression)) {
            if (x.expression.text === 'require')
                return { binding: null, specifier: (0, ast_1.strValue)(x.arguments[0]) };
            return { binding: x.expression.text, specifier: null };
        }
        return { binding: null, specifier: null };
    };
    const onVariable = (n) => {
        const init = n.initializer;
        if (!init)
            return;
        const target = n.name;
        if (ts.isIdentifier(init) && mongooseNs.has(init.text) && ts.isObjectBindingPattern(target)) {
            for (const el of target.elements) {
                if (el.dotDotDotToken || !ts.isIdentifier(el.name))
                    continue;
                const imported = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.text;
                mongooseNamed.set(el.name.text, imported);
            }
        }
        if ((0, ast_1.isAccess)(init) && ts.isIdentifier(init.expression) && mongooseNs.has(init.expression.text) && ts.isIdentifier(target)) {
            const prop = (0, ast_1.accessName)(init);
            if (prop === 'connection')
                connVars.add(target.text);
            else if (prop)
                mongooseNamed.set(target.text, prop);
        }
        if (!ts.isIdentifier(target))
            return;
        const inner = (0, ast_1.unwrap)(init);
        if (inner && ts.isCallExpression(inner) && isConnectionFactory(inner))
            connVars.add(target.text);
        const mc = findModelCallIn(init);
        if (mc) {
            const info = modelCall(mc);
            if (info)
                localModels.set(target.text, info.name);
        }
        if (inner && ts.isNewExpression(inner) && ts.isIdentifier(inner.expression)) {
            docVars.set(target.text, inner.expression.text); // const user = new User(...)
        }
        else if (inner) {
            const chain = (0, ast_1.analyzeChain)(inner);
            const root = idText(chain.root);
            if (root && chain.methods.some((m) => rules_1.QUERY_METHODS.has(m.name) && m.name !== 'save')) {
                docVars.set(target.text, root); // const user = await User.findById(...)
            }
        }
    };
    const onNew = (n) => {
        const c = n.expression;
        if (ts.isIdentifier(c)) {
            if (mongooseNamed.get(c.text) === 'Schema')
                add('Schema', 'new Schema()', n, 'high');
            else if (mongodbNamed.get(c.text) === 'MongoClient')
                add('Connection', 'new MongoClient()', n, 'high');
        }
        else if ((0, ast_1.isAccess)(c) && ts.isIdentifier(c.expression)) {
            const o = c.expression.text;
            const prop = (0, ast_1.accessName)(c);
            if (mongooseNs.has(o) && prop === 'Schema')
                add('Schema', `new ${o}.Schema()`, n, 'high');
            else if (mongodbNs.has(o) && prop === 'MongoClient')
                add('Connection', `new ${o}.MongoClient()`, n, 'high');
        }
    };
    const onCall = (n, parent) => {
        const callee = n.expression;
        // --- connection / model detection ---
        if ((0, ast_1.isAccess)(callee) && ts.isIdentifier(callee.expression)) {
            const obj = callee.expression.text;
            const prop = (0, ast_1.accessName)(callee);
            if (mongooseNs.has(obj) && (prop === 'connect' || prop === 'createConnection')) {
                add('Connection', `${obj}.${prop}()`, n, 'high');
            }
            else if (mongodbNamed.get(obj) === 'MongoClient' && prop === 'connect') {
                add('Connection', `${obj}.connect()`, n, 'high');
            }
            const mc = modelCall(n);
            if (mc) {
                add('Model', `${obj}.model()`, n, mc.conf, mc.name);
                a.models.push(mc.name);
            }
        }
        else if (ts.isIdentifier(callee)) {
            const named = mongooseNamed.get(callee.text);
            if (named === 'connect' || named === 'createConnection')
                add('Connection', `${callee.text}()`, n, 'high');
            const mc = modelCall(n);
            if (mc) {
                add('Model', `${callee.text}()`, n, mc.conf, mc.name);
                a.models.push(mc.name);
            }
            if (callee.text === 'express')
                a.flags.expressCall = true;
            if (callee.text === 'Router')
                a.flags.routerCall = true;
        }
        // --- route / server structure (used to classify files and label edges) ---
        if ((0, ast_1.isAccess)(callee)) {
            const prop = (0, ast_1.accessName)(callee);
            if (prop === 'Router')
                a.flags.routerCall = true;
            if (prop === 'listen' && n.arguments.length >= 1)
                a.flags.listen = true;
            const line = loc(n).line;
            if (prop === 'use' && n.arguments.length >= 1) {
                const first = (0, ast_1.strValue)(n.arguments[0]);
                for (const arg of n.arguments) {
                    const r = argRoot(arg);
                    if (r.binding || r.specifier)
                        a.registrations.push({ kind: 'use', binding: r.binding, specifier: r.specifier, path: first, method: 'USE', line });
                }
            }
            else if (prop && rules_1.ROUTE_METHODS.has(prop) && n.arguments.length >= 2) {
                const p = (0, ast_1.strValue)(n.arguments[0]);
                if (p !== null && p.startsWith('/')) {
                    a.flags.routeCalls++;
                    for (const arg of n.arguments.slice(1)) {
                        const r = argRoot(arg);
                        if (r.binding || r.specifier) {
                            a.registrations.push({ kind: 'handler', binding: r.binding, specifier: r.specifier, path: p, method: prop.toUpperCase(), line });
                        }
                    }
                }
            }
        }
        // --- query / operation / relationship candidates (outermost call of each chain) ---
        if (parent && (0, ast_1.isAccess)(parent) && parent.expression === n)
            return;
        const chain = (0, ast_1.analyzeChain)(n);
        const names = chain.methods.map((m) => m.name);
        chain.methods.forEach((m, idx) => {
            const category = categoryOf(m.name);
            if (!category)
                return;
            const { line, column } = loc(m.nameNode);
            const key = `${line}:${column}:${m.name}`;
            if (seenCandidates.has(key))
                return;
            seenCandidates.add(key);
            const rootName = idText(chain.root);
            const rootText = rootName ?? (chain.root?.kind === ts.SyntaxKind.ThisKeyword ? 'this' : '(expr)');
            a.candidates.push({
                rootName,
                rootText,
                methods: names,
                opIndex: idx,
                op: m.name,
                category,
                line,
                column,
                evidence: ev(line),
                hints: names,
                viaModelCall: !!rootName && mongooseNs.has(rootName) && names.slice(0, idx).includes('model'),
            });
        });
    };
    (0, ast_1.walk)(sf, (n, parent) => {
        if (ts.isVariableDeclaration(n))
            onVariable(n);
        else if (ts.isPropertyAssignment(n)) {
            const key = ts.isIdentifier(n.name) || ts.isStringLiteral(n.name) ? n.name.text : null;
            const target = (0, ast_1.strValue)(n.initializer);
            if (key === 'ref' && target)
                refs.push({ node: n, target });
        }
        else if (ts.isNewExpression(n))
            onNew(n);
        else if (ts.isCallExpression(n))
            onCall(n, parent);
    });
    // Relationships declared in schemas (`ref: 'User'`).
    const hasSchema = a.findings.some((f) => f.category === 'Schema');
    if (hasSchema || a.usesMongoLib) {
        for (const r of refs)
            add('Relationships', `ref: '${r.target}'`, r.node, hasSchema ? 'high' : 'medium', r.target);
    }
    a.localModels = Object.fromEntries(localModels);
    a.docVars = Object.fromEntries(docVars);
    a.models = Array.from(new Set(a.models));
}
