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
exports.extractImports = extractImports;
exports.createResolver = createResolver;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const ts = __importStar(require("typescript"));
const ast_1 = require("./ast");
/** Source specifier of `require('x')` or `await import('x')`, else null. */
function requireSource(node) {
    if (!node)
        return null;
    let n = node;
    if (ts.isAwaitExpression(n))
        n = n.expression;
    if (!ts.isCallExpression(n) || n.arguments.length < 1)
        return null;
    const callee = n.expression;
    if (ts.isIdentifier(callee) && callee.text === 'require')
        return (0, ast_1.strValue)(n.arguments[0]);
    if (callee.kind === ts.SyntaxKind.ImportKeyword)
        return (0, ast_1.strValue)(n.arguments[0]);
    return null;
}
function extractImports(sf) {
    const imports = [];
    const bindings = [];
    let dynamicCount = 0;
    const pos = (n) => {
        const p = sf.getLineAndCharacterOfPosition(n.getStart(sf));
        return { line: p.line + 1, column: p.character + 1 };
    };
    (0, ast_1.walk)(sf, (n) => {
        if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
            const source = n.moduleSpecifier.text;
            const p = pos(n);
            imports.push({ specifier: source, kind: 'import', ...p });
            const clause = n.importClause;
            if (clause) {
                if (clause.name)
                    bindings.push({ local: clause.name.text, source, imported: 'default', line: p.line });
                const nb = clause.namedBindings;
                if (nb && ts.isNamespaceImport(nb))
                    bindings.push({ local: nb.name.text, source, imported: '*', line: p.line });
                else if (nb && ts.isNamedImports(nb)) {
                    for (const el of nb.elements) {
                        bindings.push({ local: el.name.text, source, imported: (el.propertyName ?? el.name).text, line: p.line });
                    }
                }
            }
        }
        else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
            imports.push({ specifier: n.moduleSpecifier.text, kind: 'export-from', ...pos(n) });
        }
        else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference)) {
            const source = (0, ast_1.strValue)(n.moduleReference.expression);
            if (source) {
                const p = pos(n);
                imports.push({ specifier: source, kind: 'require', ...p });
                bindings.push({ local: n.name.text, source, imported: 'default', line: p.line });
            }
        }
        else if (ts.isVariableDeclaration(n) && n.initializer) {
            const line = pos(n).line;
            const direct = requireSource(n.initializer);
            if (direct !== null) {
                if (ts.isIdentifier(n.name)) {
                    bindings.push({ local: n.name.text, source: direct, imported: 'default', line });
                }
                else if (ts.isObjectBindingPattern(n.name)) {
                    for (const el of n.name.elements) {
                        if (el.dotDotDotToken || !ts.isIdentifier(el.name))
                            continue;
                        const imported = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.text;
                        bindings.push({ local: el.name.text, source: direct, imported, line });
                    }
                }
            }
            else if ((0, ast_1.isAccess)(n.initializer) && ts.isIdentifier(n.name)) {
                const inner = requireSource(n.initializer.expression);
                const prop = (0, ast_1.accessName)(n.initializer);
                if (inner !== null && prop)
                    bindings.push({ local: n.name.text, source: inner, imported: prop, line });
            }
        }
        else if (ts.isCallExpression(n)) {
            const callee = n.expression;
            if (ts.isIdentifier(callee) && callee.text === 'require' && n.arguments.length >= 1) {
                const spec = (0, ast_1.strValue)(n.arguments[0]);
                if (spec)
                    imports.push({ specifier: spec, kind: 'require', ...pos(n) });
            }
            else if (callee.kind === ts.SyntaxKind.ImportKeyword) {
                const spec = (0, ast_1.strValue)(n.arguments[0]);
                if (spec)
                    imports.push({ specifier: spec, kind: 'dynamic', ...pos(n) });
                else
                    dynamicCount++;
            }
        }
    });
    return { imports, bindings, dynamicCount };
}
// ---------- path resolution ----------
const EXTS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];
function readJsonLoose(file) {
    try {
        const text = fs
            .readFileSync(file, 'utf8')
            .replace(/^﻿/, '')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '')
            .replace(/,\s*([}\]])/g, '$1');
        return JSON.parse(text);
    }
    catch {
        return null;
    }
}
function loadAliases(root) {
    for (const name of ['tsconfig.json', 'jsconfig.json']) {
        const cfg = readJsonLoose(path.join(root, name));
        const opts = cfg && cfg.compilerOptions;
        if (!opts)
            continue;
        const baseUrl = typeof opts.baseUrl === 'string' ? path.posix.normalize(opts.baseUrl.replace(/\\/g, '/')) : null;
        const rules = [];
        const paths = opts.paths;
        if (paths && typeof paths === 'object') {
            for (const [pattern, targets] of Object.entries(paths)) {
                if (!Array.isArray(targets))
                    continue;
                const star = pattern.indexOf('*');
                rules.push({
                    prefix: star === -1 ? pattern : pattern.slice(0, star),
                    suffix: star === -1 ? '' : pattern.slice(star + 1),
                    hasWildcard: star !== -1,
                    targets,
                });
            }
        }
        if (baseUrl !== null || rules.length)
            return { baseUrl, rules };
    }
    return { baseUrl: null, rules: [] };
}
function createResolver(root, files) {
    const aliases = loadAliases(root);
    const tryResolve = (basePath) => {
        const base = path.posix.normalize(basePath);
        if (base.startsWith('..') || base.startsWith('/'))
            return null;
        const candidates = [base, ...EXTS.map((e) => base + e), ...EXTS.map((e) => `${base}/index${e}`)];
        // TypeScript ESM style: import './x.js' that actually refers to x.ts
        const m = base.match(/^(.*)\.(m|c)?jsx?$/);
        if (m)
            candidates.push(`${m[1]}.ts`, `${m[1]}.tsx`);
        for (const c of candidates)
            if (files.has(c))
                return c;
        return null;
    };
    return {
        resolve(from, specifier) {
            if (specifier.startsWith('.')) {
                return tryResolve(path.posix.join(path.posix.dirname(from), specifier));
            }
            for (const rule of aliases.rules) {
                if (!specifier.startsWith(rule.prefix) || !specifier.endsWith(rule.suffix))
                    continue;
                if (!rule.hasWildcard && specifier !== rule.prefix)
                    continue;
                const star = specifier.slice(rule.prefix.length, specifier.length - rule.suffix.length);
                for (const target of rule.targets) {
                    const mapped = rule.hasWildcard ? target.replace('*', star) : target;
                    const hit = tryResolve(path.posix.join(aliases.baseUrl ?? '.', mapped));
                    if (hit)
                        return hit;
                }
            }
            if (aliases.baseUrl !== null) {
                const hit = tryResolve(path.posix.join(aliases.baseUrl, specifier));
                if (hit)
                    return hit;
            }
            return null; // external package or unresolved alias
        },
    };
}
