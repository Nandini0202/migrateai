import * as ts from 'typescript';

// Parsing uses the TypeScript Compiler API. Source text is only parsed, never executed.

export type Node = ts.Node;

export interface Parsed {
  sf: ts.SourceFile;
  diagnostics: number; // number of syntax errors the parser recovered from
}

function scriptKind(filename: string): ts.ScriptKind {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (lower.endsWith('.ts') || lower.endsWith('.mts') || lower.endsWith('.cts')) return ts.ScriptKind.TS;
  return ts.ScriptKind.JSX; // .js/.jsx/.mjs/.cjs — JSX is a superset that also accepts plain JS
}

export function parseSource(code: string, filename: string): Parsed {
  const sf = ts.createSourceFile(filename, code, ts.ScriptTarget.Latest, true, scriptKind(filename));
  const diagnostics = ((sf as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics ?? []).length;
  return { sf, diagnostics };
}

export function walk(root: Node, visit: (n: Node, parent: Node | undefined) => void): void {
  const go = (n: Node, parent: Node | undefined): void => {
    visit(n, parent);
    ts.forEachChild(n, (c) => go(c, n));
  };
  go(root, undefined);
}

export function strValue(n: Node | undefined | null): string | null {
  if (!n) return null;
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  return null;
}

/** Strip parentheses, await, `as` casts and non-null assertions. */
export function unwrap(n: Node | undefined | null): Node | null {
  let cur: Node | null = n ?? null;
  while (
    cur &&
    (ts.isParenthesizedExpression(cur) ||
      ts.isAwaitExpression(cur) ||
      ts.isAsExpression(cur) ||
      ts.isNonNullExpression(cur) ||
      ts.isTypeAssertionExpression(cur) ||
      ts.isSatisfiesExpression(cur))
  ) {
    cur = cur.expression;
  }
  return cur;
}

export type Access = ts.PropertyAccessExpression | ts.ElementAccessExpression;

export function isAccess(n: Node | undefined | null): n is Access {
  return !!n && (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n));
}

export function accessName(n: Node): string | null {
  if (ts.isPropertyAccessExpression(n)) return n.name.text;
  if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression)) return n.argumentExpression.text;
  return null;
}

export interface ChainMethod {
  name: string;
  call: ts.CallExpression;
  nameNode: Node; // the property-name token, used for accurate line numbers
}

export interface ChainInfo {
  root: Node | null;
  methods: ChainMethod[]; // called methods, root -> outermost
}

/** Unwind `a.b().c().d()` style chains down to the root expression. */
export function analyzeChain(expr: Node): ChainInfo {
  const methods: ChainMethod[] = [];
  let cur: Node | null = expr;
  for (let i = 0; i < 300 && cur; i++) {
    cur = unwrap(cur);
    if (!cur) break;
    if (ts.isCallExpression(cur)) {
      const callee: ts.Expression = cur.expression;
      if (isAccess(callee)) {
        const name = accessName(callee);
        if (name) {
          methods.unshift({ name, call: cur, nameNode: ts.isPropertyAccessExpression(callee) ? callee.name : callee.argumentExpression });
        }
      }
      cur = callee;
    } else if (isAccess(cur)) {
      cur = cur.expression;
    } else {
      break;
    }
  }
  return { root: cur, methods };
}
