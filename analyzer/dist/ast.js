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
exports.parseSource = parseSource;
exports.walk = walk;
exports.strValue = strValue;
exports.unwrap = unwrap;
exports.isAccess = isAccess;
exports.accessName = accessName;
exports.analyzeChain = analyzeChain;
const ts = __importStar(require("typescript"));
function scriptKind(filename) {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.tsx'))
        return ts.ScriptKind.TSX;
    if (lower.endsWith('.ts') || lower.endsWith('.mts') || lower.endsWith('.cts'))
        return ts.ScriptKind.TS;
    return ts.ScriptKind.JSX; // .js/.jsx/.mjs/.cjs — JSX is a superset that also accepts plain JS
}
function parseSource(code, filename) {
    const sf = ts.createSourceFile(filename, code, ts.ScriptTarget.Latest, true, scriptKind(filename));
    const diagnostics = (sf.parseDiagnostics ?? []).length;
    return { sf, diagnostics };
}
function walk(root, visit) {
    const go = (n, parent) => {
        visit(n, parent);
        ts.forEachChild(n, (c) => go(c, n));
    };
    go(root, undefined);
}
function strValue(n) {
    if (!n)
        return null;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n))
        return n.text;
    return null;
}
/** Strip parentheses, await, `as` casts and non-null assertions. */
function unwrap(n) {
    let cur = n ?? null;
    while (cur &&
        (ts.isParenthesizedExpression(cur) ||
            ts.isAwaitExpression(cur) ||
            ts.isAsExpression(cur) ||
            ts.isNonNullExpression(cur) ||
            ts.isTypeAssertionExpression(cur) ||
            ts.isSatisfiesExpression(cur))) {
        cur = cur.expression;
    }
    return cur;
}
function isAccess(n) {
    return !!n && (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n));
}
function accessName(n) {
    if (ts.isPropertyAccessExpression(n))
        return n.name.text;
    if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression))
        return n.argumentExpression.text;
    return null;
}
/** Unwind `a.b().c().d()` style chains down to the root expression. */
function analyzeChain(expr) {
    const methods = [];
    let cur = expr;
    for (let i = 0; i < 300 && cur; i++) {
        cur = unwrap(cur);
        if (!cur)
            break;
        if (ts.isCallExpression(cur)) {
            const callee = cur.expression;
            if (isAccess(callee)) {
                const name = accessName(callee);
                if (name) {
                    methods.unshift({ name, call: cur, nameNode: ts.isPropertyAccessExpression(callee) ? callee.name : callee.argumentExpression });
                }
            }
            cur = callee;
        }
        else if (isAccess(cur)) {
            cur = cur.expression;
        }
        else {
            break;
        }
    }
    return { root: cur, methods };
}
