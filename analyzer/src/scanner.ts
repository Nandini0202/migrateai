import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { Node, accessName, analyzeChain, isAccess, parseSource, strValue, unwrap, walk } from './ast';
import { extractImports } from './dependencies';
import {
  DB_OP_METHODS,
  FALLBACK_PATTERNS,
  GENERATED_PATTERNS,
  LIMITS,
  QUERY_METHODS,
  ROUTE_METHODS,
  SKIP_DIRS,
  SOURCE_EXTS,
} from './rules';
import { CallCandidate, Category, Confidence, FileAnalysis, Finding } from './types';

// ---------------------------------------------------------------------------
// Step 2 — collect source files (never executes anything from the repository)
// ---------------------------------------------------------------------------

export interface CollectResult {
  files: string[];
  packageJsons: string[];
  warnings: string[];
  truncated: boolean;
}

export function collectFiles(root: string, limits = LIMITS): CollectResult {
  const files: string[] = [];
  const packageJsons: string[] = [];
  const warnings: string[] = [];
  let truncated = false;
  let totalBytes = 0;
  const deadline = Date.now() + limits.timeMs;
  const stack: string[] = [''];

  outer: while (stack.length) {
    const rel = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
      warnings.push(`Could not read directory ${rel || '.'}`);
      continue;
    }
    for (const e of entries) {
      if (Date.now() > deadline) {
        truncated = true;
        warnings.push('Time limit reached; analysis is partial.');
        break outer;
      }
      if (e.isSymbolicLink()) continue; // never follow symlinks out of the repo
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        stack.push(childRel);
        continue;
      }
      if (!e.isFile()) continue;
      if (e.name === 'package.json') {
        packageJsons.push(childRel);
        continue;
      }
      if (!SOURCE_EXTS.has(path.extname(e.name).toLowerCase())) continue;
      if (GENERATED_PATTERNS.some((r) => r.test(e.name))) continue;
      let size = 0;
      try {
        size = fs.statSync(path.join(root, childRel)).size;
      } catch {
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

const isPkg = (spec: string, name: string) => spec === name || spec.startsWith(`${name}/`);

function categoryOf(method: string): CallCandidate['category'] | null {
  if (QUERY_METHODS.has(method)) return 'Queries';
  if (DB_OP_METHODS.has(method)) return 'Database operations';
  if (method === 'populate') return 'Relationships';
  return null;
}

function emptyAnalysis(rel: string): FileAnalysis {
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

export function analyzeFile(code: string, rel: string): FileAnalysis {
  const text = code.replace(/^﻿/, '');
  const lines = text.split(/\r?\n/);
  let result = emptyAnalysis(rel);
  const { sf, diagnostics } = parseSource(text, rel);
  try {
    astPass(sf, result, lines);
  } catch (err) {
    // e.g. stack overflow on pathologically deep code: discard partial state, use patterns only
    result = emptyAnalysis(rel);
    result.parseError = `analysis failed (${err instanceof Error ? err.message : 'unknown error'})`;
    fallbackScan(lines, result);
    return result;
  }
  if (diagnostics > 0) {
    result.parseError = `${diagnostics} syntax error(s); results for this file may be incomplete`;
    if (result.findings.length === 0 && result.imports.length === 0) fallbackScan(lines, result);
  }
  return result;
}

function fallbackScan(lines: string[], a: FileAnalysis): void {
  lines.forEach((text, i) => {
    for (const rule of FALLBACK_PATTERNS) {
      if (rule.regex.test(text)) {
        a.findings.push({
          file: a.path,
          line: i + 1,
          column: 1,
          category: rule.category as Category,
          pattern: rule.pattern,
          evidence: text.trim().slice(0, 160),
          confidence: 'low',
        });
        if (rule.category === 'Dependencies' || rule.category === 'Connection') a.usesMongoLib = true;
      }
    }
    // Minimal import extraction so the graph still has edges for unparsable files.
    const re = /(?:require\(\s*|from\s+)['"](\.{1,2}\/[^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) a.imports.push({ specifier: m[1], kind: 'import', line: i + 1, column: m.index + 1 });
  });
}

function astPass(sf: ts.SourceFile, a: FileAnalysis, lines: string[]): void {
  const ev = (line: number) => (lines[line - 1] ?? '').trim().slice(0, 160);
  const loc = (n: Node) => {
    const p = sf.getLineAndCharacterOfPosition(n.getStart(sf));
    return { line: p.line + 1, column: p.character + 1 };
  };
  const add = (category: Category, pattern: string, n: Node, confidence: Confidence, detail?: string) => {
    const { line, column } = loc(n);
    a.findings.push({ file: a.path, line, column, category, pattern, evidence: ev(line), confidence, detail });
  };

  const { imports, bindings, dynamicCount } = extractImports(sf);
  a.imports = imports;
  a.bindings = bindings;
  a.dynamicImports = dynamicCount;

  const mongooseNs = new Set<string>();
  const mongodbNs = new Set<string>();
  const mongooseNamed = new Map<string, string>(); // local -> exported name
  const mongodbNamed = new Map<string, string>();
  for (const b of bindings) {
    if (isPkg(b.source, 'mongoose')) {
      if (b.imported === 'default' || b.imported === '*') mongooseNs.add(b.local);
      else mongooseNamed.set(b.local, b.imported);
    } else if (isPkg(b.source, 'mongodb')) {
      if (b.imported === 'default' || b.imported === '*') mongodbNs.add(b.local);
      else mongodbNamed.set(b.local, b.imported);
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

  const connVars = new Set<string>();
  const localModels = new Map<string, string>();
  const docVars = new Map<string, string>();
  const refs: { node: Node; target: string }[] = [];
  const seenCandidates = new Set<string>();

  const idText = (n: Node | undefined | null): string | null => (n && ts.isIdentifier(n) ? n.text : null);

  const isConnectionFactory = (call: ts.CallExpression): boolean => {
    const c = call.expression;
    if (isAccess(c) && ts.isIdentifier(c.expression)) {
      return mongooseNs.has(c.expression.text) && accessName(c) === 'createConnection';
    }
    return ts.isIdentifier(c) && mongooseNamed.get(c.text) === 'createConnection';
  };

  const modelCall = (call: ts.CallExpression): { conf: Confidence; name: string } | null => {
    const callee = call.expression;
    const first = strValue(call.arguments[0]);
    if (isAccess(callee) && accessName(callee) === 'model' && ts.isIdentifier(callee.expression)) {
      const o = callee.expression.text;
      if (mongooseNs.has(o) || connVars.has(o)) return { conf: 'high', name: first ?? 'unknown' };
      if (a.usesMongoLib && first !== null && call.arguments.length >= 2) return { conf: 'medium', name: first };
    } else if (ts.isIdentifier(callee) && mongooseNamed.get(callee.text) === 'model') {
      return { conf: 'high', name: first ?? 'unknown' };
    }
    return null;
  };

  const findModelCallIn = (n: Node | undefined | null): ts.CallExpression | null => {
    const cur = unwrap(n);
    if (!cur) return null;
    if (ts.isCallExpression(cur) && modelCall(cur)) return cur;
    if (ts.isBinaryExpression(cur)) return findModelCallIn(cur.left) ?? findModelCallIn(cur.right);
    if (ts.isConditionalExpression(cur)) return findModelCallIn(cur.whenTrue) ?? findModelCallIn(cur.whenFalse);
    return null;
  };

  const argRoot = (arg: Node): { binding: string | null; specifier: string | null } => {
    const x = unwrap(arg);
    if (!x) return { binding: null, specifier: null };
    if (ts.isIdentifier(x)) return { binding: x.text, specifier: null };
    if (isAccess(x)) {
      const r = idText(analyzeChain(x).root);
      if (r) return { binding: r, specifier: null };
    }
    if (ts.isCallExpression(x) && ts.isIdentifier(x.expression)) {
      if (x.expression.text === 'require') return { binding: null, specifier: strValue(x.arguments[0]) };
      return { binding: x.expression.text, specifier: null };
    }
    return { binding: null, specifier: null };
  };

  const onVariable = (n: ts.VariableDeclaration): void => {
    const init = n.initializer;
    if (!init) return;
    const target = n.name;
    if (ts.isIdentifier(init) && mongooseNs.has(init.text) && ts.isObjectBindingPattern(target)) {
      for (const el of target.elements) {
        if (el.dotDotDotToken || !ts.isIdentifier(el.name)) continue;
        const imported = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.text;
        mongooseNamed.set(el.name.text, imported);
      }
    }
    if (isAccess(init) && ts.isIdentifier(init.expression) && mongooseNs.has(init.expression.text) && ts.isIdentifier(target)) {
      const prop = accessName(init);
      if (prop === 'connection') connVars.add(target.text);
      else if (prop) mongooseNamed.set(target.text, prop);
    }
    if (!ts.isIdentifier(target)) return;
    const inner = unwrap(init);
    if (inner && ts.isCallExpression(inner) && isConnectionFactory(inner)) connVars.add(target.text);
    const mc = findModelCallIn(init);
    if (mc) {
      const info = modelCall(mc);
      if (info) localModels.set(target.text, info.name);
    }
    if (inner && ts.isNewExpression(inner) && ts.isIdentifier(inner.expression)) {
      docVars.set(target.text, inner.expression.text); // const user = new User(...)
    } else if (inner) {
      const chain = analyzeChain(inner);
      const root = idText(chain.root);
      if (root && chain.methods.some((m) => QUERY_METHODS.has(m.name) && m.name !== 'save')) {
        docVars.set(target.text, root); // const user = await User.findById(...)
      }
    }
  };

  const onNew = (n: ts.NewExpression): void => {
    const c = n.expression;
    if (ts.isIdentifier(c)) {
      if (mongooseNamed.get(c.text) === 'Schema') add('Schema', 'new Schema()', n, 'high');
      else if (mongodbNamed.get(c.text) === 'MongoClient') add('Connection', 'new MongoClient()', n, 'high');
    } else if (isAccess(c) && ts.isIdentifier(c.expression)) {
      const o = c.expression.text;
      const prop = accessName(c);
      if (mongooseNs.has(o) && prop === 'Schema') add('Schema', `new ${o}.Schema()`, n, 'high');
      else if (mongodbNs.has(o) && prop === 'MongoClient') add('Connection', `new ${o}.MongoClient()`, n, 'high');
    }
  };

  const onCall = (n: ts.CallExpression, parent: Node | undefined): void => {
    const callee = n.expression;

    // --- connection / model detection ---
    if (isAccess(callee) && ts.isIdentifier(callee.expression)) {
      const obj = callee.expression.text;
      const prop = accessName(callee);
      if (mongooseNs.has(obj) && (prop === 'connect' || prop === 'createConnection')) {
        add('Connection', `${obj}.${prop}()`, n, 'high');
      } else if (mongodbNamed.get(obj) === 'MongoClient' && prop === 'connect') {
        add('Connection', `${obj}.connect()`, n, 'high');
      }
      const mc = modelCall(n);
      if (mc) {
        add('Model', `${obj}.model()`, n, mc.conf, mc.name);
        a.models.push(mc.name);
      }
    } else if (ts.isIdentifier(callee)) {
      const named = mongooseNamed.get(callee.text);
      if (named === 'connect' || named === 'createConnection') add('Connection', `${callee.text}()`, n, 'high');
      const mc = modelCall(n);
      if (mc) {
        add('Model', `${callee.text}()`, n, mc.conf, mc.name);
        a.models.push(mc.name);
      }
      if (callee.text === 'express') a.flags.expressCall = true;
      if (callee.text === 'Router') a.flags.routerCall = true;
    }

    // --- route / server structure (used to classify files and label edges) ---
    if (isAccess(callee)) {
      const prop = accessName(callee);
      if (prop === 'Router') a.flags.routerCall = true;
      if (prop === 'listen' && n.arguments.length >= 1) a.flags.listen = true;
      const line = loc(n).line;
      if (prop === 'use' && n.arguments.length >= 1) {
        const first = strValue(n.arguments[0]);
        for (const arg of n.arguments) {
          const r = argRoot(arg);
          if (r.binding || r.specifier) a.registrations.push({ kind: 'use', binding: r.binding, specifier: r.specifier, path: first, method: 'USE', line });
        }
      } else if (prop && ROUTE_METHODS.has(prop) && n.arguments.length >= 2) {
        const p = strValue(n.arguments[0]);
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
    if (parent && isAccess(parent) && parent.expression === n) return;
    const chain = analyzeChain(n);
    const names = chain.methods.map((m) => m.name);
    chain.methods.forEach((m, idx) => {
      const category = categoryOf(m.name);
      if (!category) return;
      const { line, column } = loc(m.nameNode);
      const key = `${line}:${column}:${m.name}`;
      if (seenCandidates.has(key)) return;
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

  walk(sf, (n, parent) => {
    if (ts.isVariableDeclaration(n)) onVariable(n);
    else if (ts.isPropertyAssignment(n)) {
      const key = ts.isIdentifier(n.name) || ts.isStringLiteral(n.name) ? n.name.text : null;
      const target = strValue(n.initializer);
      if (key === 'ref' && target) refs.push({ node: n, target });
    } else if (ts.isNewExpression(n)) onNew(n);
    else if (ts.isCallExpression(n)) onCall(n, parent);
  });

  // Relationships declared in schemas (`ref: 'User'`).
  const hasSchema = a.findings.some((f) => f.category === 'Schema');
  if (hasSchema || a.usesMongoLib) {
    for (const r of refs) add('Relationships', `ref: '${r.target}'`, r.node, hasSchema ? 'high' : 'medium', r.target);
  }

  a.localModels = Object.fromEntries(localModels);
  a.docVars = Object.fromEntries(docVars);
  a.models = Array.from(new Set(a.models));
}
