import * as fs from 'fs';
import * as path from 'path';
import { createResolver, Resolver } from './dependencies';
import { buildGraph } from './graph';
import { FIND_FAMILY, MONGOOSE_CHAIN_HINTS } from './rules';
import { analyzeFile, collectFiles } from './scanner';
import { AffectedFile, AnalysisResult, CallCandidate, Category, Confidence, FileAnalysis, Finding, NodeKind, Summary } from './types';

export interface AnalyzeOptions {
  scope?: 'relevant' | 'all';
  generateGraph?: boolean;
}

function packageJsonFindings(root: string, rel: string): { findings: Finding[]; deps: string[] } {
  const findings: Finding[] = [];
  const deps: string[] = [];
  let text: string;
  try {
    text = fs.readFileSync(path.join(root, rel), 'utf8').replace(/^﻿/, '');
  } catch {
    return { findings, deps };
  }
  let json: Record<string, Record<string, string>>;
  try {
    json = JSON.parse(text);
  } catch {
    return { findings, deps };
  }
  const lines = text.split(/\r?\n/);
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const block = json[section];
    if (!block || typeof block !== 'object') continue;
    for (const name of ['mongoose', 'mongodb']) {
      if (!(name in block)) continue;
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

function resolvesToModel(
  a: FileAnalysis,
  name: string | null,
  modelFiles: Map<string, string[]>,
  resolver: Resolver,
  byPath: Map<string, FileAnalysis>,
  depth = 0,
): boolean {
  if (!name) return false;
  if (a.localModels[name]) return true;
  const via = a.docVars[name];
  if (via && via !== name && depth < 3) return resolvesToModel(a, via, modelFiles, resolver, byPath, depth + 1);
  const binding = a.bindings.find((b) => b.local === name);
  if (!binding) return false;
  const target = resolver.resolve(a.path, binding.source);
  if (!target) return false;
  if (modelFiles.has(target)) return true;
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

function confidenceFor(c: CallCandidate, a: FileAnalysis, resolved: boolean): Confidence | null {
  if (resolved || c.viaModelCall) return 'high';
  if (c.hints.includes('collection')) return a.usesMongoLib ? 'high' : 'medium';
  if (a.usesMongoLib) return 'low';
  const mongooseish = c.hints.some((h) => MONGOOSE_CHAIN_HINTS.has(h));
  const findy = c.hints.some((h) => FIND_FAMILY.has(h));
  if (mongooseish && findy) return 'medium';
  return null; // e.g. Array.prototype.find in a file with no MongoDB context
}

export function analyzeRepository(root: string, opts: AnalyzeOptions = {}): AnalysisResult {
  const started = Date.now();
  const abs = path.resolve(root);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Error(`Not a directory: ${root}`);

  const scope = opts.scope ?? 'relevant';
  const generateGraph = opts.generateGraph ?? true;
  const collected = collectFiles(abs);
  const warnings = [...collected.warnings];
  const fileSet = new Set(collected.files);
  const resolver = createResolver(abs, fileSet);

  // Pass 1: per-file AST analysis.
  const analyses: FileAnalysis[] = [];
  let parseFailures = 0;
  for (const rel of collected.files) {
    let code: string;
    try {
      code = fs.readFileSync(path.join(abs, rel), 'utf8');
    } catch {
      warnings.push(`Could not read ${rel}`);
      continue;
    }
    const a = analyzeFile(code, rel);
    if (a.parseError) {
      parseFailures++;
      warnings.push(`${rel}: ${a.parseError}; falling back to pattern matching where needed.`);
    }
    analyses.push(a);
  }
  const byPath = new Map(analyses.map((a) => [a.path, a]));

  // Model files = files that define a Mongoose model or schema.
  const modelFiles = new Map<string, string[]>();
  for (const a of analyses) {
    if (a.findings.some((f) => f.category === 'Model' || f.category === 'Schema')) modelFiles.set(a.path, a.models);
  }

  // Pass 2: resolve query/operation candidates using cross-file knowledge.
  for (const a of analyses) {
    for (const c of a.candidates) {
      const resolved = resolvesToModel(a, c.rootName, modelFiles, resolver, byPath);
      const confidence = confidenceFor(c, a, resolved);
      if (!confidence) continue;
      a.findings.push({
        file: a.path,
        line: c.line,
        column: c.column,
        category: c.category as Category,
        pattern: `${c.rootText}.${c.methods.slice(0, c.opIndex + 1).map((m) => `${m}()`).join('.')}`,
        evidence: c.evidence,
        confidence,
      });
    }
  }

  // package.json dependency findings.
  const pkgFindings: Finding[] = [];
  const declared = new Set<string>();
  for (const pkg of collected.packageJsons) {
    const r = packageJsonFindings(abs, pkg);
    pkgFindings.push(...r.findings);
    r.deps.forEach((d) => declared.add(d));
  }

  const findings: Finding[] = [...analyses.flatMap((a) => a.findings), ...pkgFindings].sort(
    (x, y) => x.file.localeCompare(y.file) || x.line - y.line || x.column - y.column,
  );
  const findingsByFile = new Map<string, Finding[]>();
  for (const f of findings) {
    if (!findingsByFile.has(f.file)) findingsByFile.set(f.file, []);
    findingsByFile.get(f.file)!.push(f);
  }

  // Agent 1: dependency graph.
  const built = buildGraph(analyses, findingsByFile, modelFiles, resolver, scope);
  warnings.push(...built.warnings);

  const affectedFiles: AffectedFile[] = Array.from(findingsByFile.entries()).map(([file, fs_]) => ({
    file,
    kind: (built.kinds.get(file) ?? 'file') as NodeKind,
    findingCount: fs_.length,
    categories: Array.from(new Set(fs_.map((f) => f.category))),
  }));

  const usesMongoose = declared.has('mongoose') || analyses.some((a) => a.imports.some((i) => i.specifier === 'mongoose' || i.specifier.startsWith('mongoose/')));
  const usesMongodb = declared.has('mongodb') || analyses.some((a) => a.imports.some((i) => i.specifier === 'mongodb' || i.specifier.startsWith('mongodb/')));

  const byCategory: Record<string, number> = {};
  const byConfidence: Record<string, number> = {};
  for (const f of findings) {
    byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
    byConfidence[f.confidence] = (byConfidence[f.confidence] ?? 0) + 1;
  }
  const modelNames = Array.from(new Set(analyses.flatMap((a) => a.models))).sort();

  const summary: Summary = {
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
