#!/usr/bin/env node
// Usage: node dist/cli.js --root <dir> [--scope relevant|all] [--no-graph] [--out file.json] [--pretty]
// Prints the analysis JSON to stdout. Reads source files only; never executes them.

import * as fs from 'fs';
import { analyzeRepository } from './analyze';

function main(): void {
  const args = process.argv.slice(2);
  let root = '';
  let scope: 'relevant' | 'all' = 'relevant';
  let generateGraph = true;
  let out = '';
  let pretty = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--root') root = args[++i] ?? '';
    else if (a === '--scope') {
      const v = args[++i];
      if (v !== 'relevant' && v !== 'all') fail('--scope must be "relevant" or "all"');
      scope = v as 'relevant' | 'all';
    } else if (a === '--no-graph') generateGraph = false;
    else if (a === '--out') out = args[++i] ?? '';
    else if (a === '--pretty') pretty = true;
    else fail(`Unknown argument: ${a}`);
  }
  if (!root) fail('Missing --root <directory>');

  try {
    const result = analyzeRepository(root, { scope, generateGraph });
    const json = JSON.stringify(result, null, pretty ? 2 : undefined);
    if (out) fs.writeFileSync(out, json);
    else process.stdout.write(json);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

function fail(message: string): never {
  process.stderr.write(JSON.stringify({ error: message }) + '\n');
  process.exit(1);
}

main();
