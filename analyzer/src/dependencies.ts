import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { Node, accessName, isAccess, strValue, walk } from './ast';
import { Binding, ImportRef } from './types';

export interface ExtractedImports {
  imports: ImportRef[];
  bindings: Binding[];
  dynamicCount: number;
}

/** Source specifier of `require('x')` or `await import('x')`, else null. */
function requireSource(node: Node | undefined | null): string | null {
  if (!node) return null;
  let n: Node = node;
  if (ts.isAwaitExpression(n)) n = n.expression;
  if (!ts.isCallExpression(n) || n.arguments.length < 1) return null;
  const callee = n.expression;
  if (ts.isIdentifier(callee) && callee.text === 'require') return strValue(n.arguments[0]);
  if (callee.kind === ts.SyntaxKind.ImportKeyword) return strValue(n.arguments[0]);
  return null;
}

export function extractImports(sf: ts.SourceFile): ExtractedImports {
  const imports: ImportRef[] = [];
  const bindings: Binding[] = [];
  let dynamicCount = 0;

  const pos = (n: Node) => {
    const p = sf.getLineAndCharacterOfPosition(n.getStart(sf));
    return { line: p.line + 1, column: p.character + 1 };
  };

  walk(sf, (n) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const source = n.moduleSpecifier.text;
      const p = pos(n);
      imports.push({ specifier: source, kind: 'import', ...p });
      const clause = n.importClause;
      if (clause) {
        if (clause.name) bindings.push({ local: clause.name.text, source, imported: 'default', line: p.line });
        const nb = clause.namedBindings;
        if (nb && ts.isNamespaceImport(nb)) bindings.push({ local: nb.name.text, source, imported: '*', line: p.line });
        else if (nb && ts.isNamedImports(nb)) {
          for (const el of nb.elements) {
            bindings.push({ local: el.name.text, source, imported: (el.propertyName ?? el.name).text, line: p.line });
          }
        }
      }
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      imports.push({ specifier: n.moduleSpecifier.text, kind: 'export-from', ...pos(n) });
    } else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference)) {
      const source = strValue(n.moduleReference.expression);
      if (source) {
        const p = pos(n);
        imports.push({ specifier: source, kind: 'require', ...p });
        bindings.push({ local: n.name.text, source, imported: 'default', line: p.line });
      }
    } else if (ts.isVariableDeclaration(n) && n.initializer) {
      const line = pos(n).line;
      const direct = requireSource(n.initializer);
      if (direct !== null) {
        if (ts.isIdentifier(n.name)) {
          bindings.push({ local: n.name.text, source: direct, imported: 'default', line });
        } else if (ts.isObjectBindingPattern(n.name)) {
          for (const el of n.name.elements) {
            if (el.dotDotDotToken || !ts.isIdentifier(el.name)) continue;
            const imported = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.text;
            bindings.push({ local: el.name.text, source: direct, imported, line });
          }
        }
      } else if (isAccess(n.initializer) && ts.isIdentifier(n.name)) {
        const inner = requireSource(n.initializer.expression);
        const prop = accessName(n.initializer);
        if (inner !== null && prop) bindings.push({ local: n.name.text, source: inner, imported: prop, line });
      }
    } else if (ts.isCallExpression(n)) {
      const callee = n.expression;
      if (ts.isIdentifier(callee) && callee.text === 'require' && n.arguments.length >= 1) {
        const spec = strValue(n.arguments[0]);
        if (spec) imports.push({ specifier: spec, kind: 'require', ...pos(n) });
      } else if (callee.kind === ts.SyntaxKind.ImportKeyword) {
        const spec = strValue(n.arguments[0]);
        if (spec) imports.push({ specifier: spec, kind: 'dynamic', ...pos(n) });
        else dynamicCount++;
      }
    }
  });

  return { imports, bindings, dynamicCount };
}

// ---------- path resolution ----------

const EXTS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];

export interface Resolver {
  /** Resolve an import specifier from a repo-relative file to another repo-relative file, or null. */
  resolve(from: string, specifier: string): string | null;
}

interface AliasRule {
  prefix: string;
  suffix: string;
  hasWildcard: boolean;
  targets: string[];
}

function readJsonLoose(file: string): Record<string, unknown> | null {
  try {
    const text = fs
      .readFileSync(file, 'utf8')
      .replace(/^﻿/, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function loadAliases(root: string): { baseUrl: string | null; rules: AliasRule[] } {
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    const cfg = readJsonLoose(path.join(root, name));
    const opts = cfg && (cfg.compilerOptions as Record<string, unknown> | undefined);
    if (!opts) continue;
    const baseUrl = typeof opts.baseUrl === 'string' ? path.posix.normalize(opts.baseUrl.replace(/\\/g, '/')) : null;
    const rules: AliasRule[] = [];
    const paths = opts.paths as Record<string, string[]> | undefined;
    if (paths && typeof paths === 'object') {
      for (const [pattern, targets] of Object.entries(paths)) {
        if (!Array.isArray(targets)) continue;
        const star = pattern.indexOf('*');
        rules.push({
          prefix: star === -1 ? pattern : pattern.slice(0, star),
          suffix: star === -1 ? '' : pattern.slice(star + 1),
          hasWildcard: star !== -1,
          targets,
        });
      }
    }
    if (baseUrl !== null || rules.length) return { baseUrl, rules };
  }
  return { baseUrl: null, rules: [] };
}

export function createResolver(root: string, files: Set<string>): Resolver {
  const aliases = loadAliases(root);

  const tryResolve = (basePath: string): string | null => {
    const base = path.posix.normalize(basePath);
    if (base.startsWith('..') || base.startsWith('/')) return null;
    const candidates = [base, ...EXTS.map((e) => base + e), ...EXTS.map((e) => `${base}/index${e}`)];
    // TypeScript ESM style: import './x.js' that actually refers to x.ts
    const m = base.match(/^(.*)\.(m|c)?jsx?$/);
    if (m) candidates.push(`${m[1]}.ts`, `${m[1]}.tsx`);
    for (const c of candidates) if (files.has(c)) return c;
    return null;
  };

  return {
    resolve(from: string, specifier: string): string | null {
      if (specifier.startsWith('.')) {
        return tryResolve(path.posix.join(path.posix.dirname(from), specifier));
      }
      for (const rule of aliases.rules) {
        if (!specifier.startsWith(rule.prefix) || !specifier.endsWith(rule.suffix)) continue;
        if (!rule.hasWildcard && specifier !== rule.prefix) continue;
        const star = specifier.slice(rule.prefix.length, specifier.length - rule.suffix.length);
        for (const target of rule.targets) {
          const mapped = rule.hasWildcard ? target.replace('*', star) : target;
          const hit = tryResolve(path.posix.join(aliases.baseUrl ?? '.', mapped));
          if (hit) return hit;
        }
      }
      if (aliases.baseUrl !== null) {
        const hit = tryResolve(path.posix.join(aliases.baseUrl, specifier));
        if (hit) return hit;
      }
      return null; // external package or unresolved alias
    },
  };
}
