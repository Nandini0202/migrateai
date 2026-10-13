// Agent 1 — Dependency Graph.
// Builds file-level nodes and directed "depends on" edges from real import/require statements,
// then marks which files contain MongoDB code and which files are affected if those change.

import * as path from 'path';
import { Resolver } from './dependencies';
import { LIMITS } from './rules';
import { EdgeType, FileAnalysis, Finding, Graph, GraphEdge, GraphNode, Impact, NodeKind } from './types';

export interface GraphBuildResult {
  graph: Graph;
  kinds: Map<string, NodeKind>;
  warnings: string[];
}

export function buildGraph(
  analyses: FileAnalysis[],
  findingsByFile: Map<string, Finding[]>,
  modelFiles: Map<string, string[]>,
  resolver: Resolver,
  scope: 'relevant' | 'all',
): GraphBuildResult {
  const warnings: string[] = [];
  const byPath = new Map(analyses.map((a) => [a.path, a]));

  // 1. Resolve imports into file -> file dependencies.
  const deps = new Map<string, Set<string>>(); // importer -> imported
  const reverse = new Map<string, Set<string>>(); // imported -> importers
  const routeLabels = new Map<string, Set<string>>(); // "src->dst" -> route paths registered
  const registered = new Set<string>(); // "src->dst" that are app.use(...) registrations
  let unresolved = 0;

  for (const a of analyses) {
    const out = new Set<string>();
    for (const imp of a.imports) {
      const target = resolver.resolve(a.path, imp.specifier);
      if (target && target !== a.path) out.add(target);
      else if (!target && imp.specifier.startsWith('.')) unresolved++;
    }
    deps.set(a.path, out);
    for (const t of out) {
      if (!reverse.has(t)) reverse.set(t, new Set());
      reverse.get(t)!.add(a.path);
    }
    for (const r of a.registrations) {
      let spec = r.specifier;
      if (!spec && r.binding) spec = a.bindings.find((b) => b.local === r.binding)?.source ?? null;
      if (!spec) continue;
      const target = resolver.resolve(a.path, spec);
      if (!target) continue;
      const key = `${a.path}->${target}`;
      if (r.kind === 'use') registered.add(key);
      if (r.path) {
        if (!routeLabels.has(key)) routeLabels.set(key, new Set());
        routeLabels.get(key)!.add(r.path);
      }
    }
  }
  if (unresolved > 0) warnings.push(`${unresolved} relative import(s) could not be resolved to a source file (non-JS/TS targets or dynamic paths).`);
  const dynamicTotal = analyses.reduce((s, a) => s + a.dynamicImports, 0);
  if (dynamicTotal > 0) warnings.push(`${dynamicTotal} dynamic import(s) with non-literal paths were not followed. The graph is a static approximation, not a complete dependency list.`);

  // 2. Classify each file.
  const kinds = new Map<string, NodeKind>();
  for (const a of analyses) {
    const findings = findingsByFile.get(a.path) ?? [];
    const importsModel = Array.from(deps.get(a.path) ?? []).some((t) => modelFiles.has(t));
    let kind: NodeKind = 'file';
    if (modelFiles.has(a.path)) kind = 'model';
    else if (a.flags.listen || a.flags.expressCall) kind = 'entry';
    else if (a.flags.routerCall || a.flags.routeCalls > 0) kind = 'route';
    else if (findings.some((f) => f.category === 'Connection')) kind = 'database';
    else if (/(^|\/)controllers?\//i.test(a.path) || /controller\.[jt]sx?$/i.test(a.path)) kind = 'controller';
    else if (/(^|\/)services?\//i.test(a.path) || /service\.[jt]sx?$/i.test(a.path) || importsModel) kind = 'service';
    kinds.set(a.path, kind);
  }

  // 3. Impact analysis: which files depend (transitively) on Mongo-touching files?
  const mongoFiles = new Set(analyses.filter((a) => (findingsByFile.get(a.path) ?? []).length > 0).map((a) => a.path));
  const bfsReverse = (starts: Iterable<string>, limit = Infinity): string[] => {
    const seen = new Set<string>(starts);
    const order: string[] = [];
    let frontier = Array.from(seen);
    while (frontier.length && order.length < limit) {
      const next: string[] = [];
      for (const f of frontier) {
        for (const importer of reverse.get(f) ?? []) {
          if (!seen.has(importer)) {
            seen.add(importer);
            order.push(importer);
            next.push(importer);
          }
        }
      }
      frontier = next;
    }
    return order;
  };
  const indirect = new Set(bfsReverse(mongoFiles));
  const impactOf = (p: string): Impact => (mongoFiles.has(p) ? 'direct' : indirect.has(p) ? 'indirect' : 'none');

  const impact: Record<string, string[]> = {};
  for (const [file, kind] of kinds) {
    if (kind === 'model') impact[file] = bfsReverse([file], 200);
  }

  // 4. Choose which files become nodes.
  let included: string[];
  if (scope === 'all') {
    included = analyses.map((a) => a.path);
  } else {
    included = analyses.filter((a) => impactOf(a.path) !== 'none').map((a) => a.path);
    if (included.length === 0) {
      included = analyses.map((a) => a.path);
      warnings.push('No MongoDB usage was detected, so the full import graph is shown.');
    }
  }
  if (included.length > LIMITS.maxGraphNodes) {
    const rank = (p: string) => (impactOf(p) === 'direct' ? 0 : impactOf(p) === 'indirect' ? 1 : 2);
    included = included.sort((x, y) => rank(x) - rank(y) || x.localeCompare(y)).slice(0, LIMITS.maxGraphNodes);
    warnings.push(`Graph limited to ${LIMITS.maxGraphNodes} nodes; MongoDB-related files were kept first.`);
  }
  const includedSet = new Set(included);

  // 5. Nodes.
  const nodes: GraphNode[] = included
    .sort((x, y) => x.localeCompare(y))
    .map((p) => {
      const f = findingsByFile.get(p) ?? [];
      return {
        id: p,
        label: path.posix.basename(p),
        path: p,
        kind: kinds.get(p) ?? 'file',
        mongo: f.length > 0,
        impact: impactOf(p),
        categories: Array.from(new Set(f.map((x) => x.category))),
        findingCount: f.length,
        models: byPath.get(p)?.models ?? [],
      };
    });

  // 6. Edges (importer -> imported), typed from what each side is.
  const edges: GraphEdge[] = [];
  for (const [src, targets] of deps) {
    if (!includedSet.has(src)) continue;
    for (const dst of targets) {
      if (!includedSet.has(dst)) continue;
      const sk = kinds.get(src) ?? 'file';
      const tk = kinds.get(dst) ?? 'file';
      const key = `${src}->${dst}`;
      let type: EdgeType = 'imports';
      let label: string | undefined;
      if (tk === 'model' && sk !== 'model') {
        type = 'uses_model';
        label = (modelFiles.get(dst) ?? []).slice(0, 3).join(', ') || undefined;
      } else if (tk === 'route' && registered.has(key)) {
        type = 'registers_route';
        label = Array.from(routeLabels.get(key) ?? []).slice(0, 3).join(', ') || undefined;
      } else if (tk === 'database' && sk !== 'database') {
        type = 'connects_db';
      } else if ((sk === 'route' || sk === 'controller' || sk === 'service') && (tk === 'service' || tk === 'controller')) {
        type = 'calls_service';
      }
      edges.push({ id: key, source: src, target: dst, type, label });
    }
  }
  edges.sort((x, y) => x.id.localeCompare(y.id));

  return { graph: { nodes, edges, impact }, kinds, warnings };
}
