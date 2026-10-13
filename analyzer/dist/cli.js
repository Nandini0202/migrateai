#!/usr/bin/env node
"use strict";
// Usage: node dist/cli.js --root <dir> [--scope relevant|all] [--no-graph] [--out file.json] [--pretty]
// Prints the analysis JSON to stdout. Reads source files only; never executes them.
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
const fs = __importStar(require("fs"));
const analyze_1 = require("./analyze");
function main() {
    const args = process.argv.slice(2);
    let root = '';
    let scope = 'relevant';
    let generateGraph = true;
    let out = '';
    let pretty = false;
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--root')
            root = args[++i] ?? '';
        else if (a === '--scope') {
            const v = args[++i];
            if (v !== 'relevant' && v !== 'all')
                fail('--scope must be "relevant" or "all"');
            scope = v;
        }
        else if (a === '--no-graph')
            generateGraph = false;
        else if (a === '--out')
            out = args[++i] ?? '';
        else if (a === '--pretty')
            pretty = true;
        else
            fail(`Unknown argument: ${a}`);
    }
    if (!root)
        fail('Missing --root <directory>');
    try {
        const result = (0, analyze_1.analyzeRepository)(root, { scope, generateGraph });
        const json = JSON.stringify(result, null, pretty ? 2 : undefined);
        if (out)
            fs.writeFileSync(out, json);
        else
            process.stdout.write(json);
    }
    catch (err) {
        fail(err instanceof Error ? err.message : String(err));
    }
}
function fail(message) {
    process.stderr.write(JSON.stringify({ error: message }) + '\n');
    process.exit(1);
}
main();
