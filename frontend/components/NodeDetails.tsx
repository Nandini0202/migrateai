import { CATEGORY_CLASS, CONFIDENCE_CLASS, KIND_LABEL } from '@/lib/theme';
import type { Finding, Graph, GraphNode } from '@/lib/types';

interface Props {
  node: GraphNode | null;
  graph: Graph;
  findings: Finding[];
  onSelect: (id: string) => void;
}

export default function NodeDetails({ node, graph, findings, onSelect }: Props) {
  if (!node) {
    return (
      <aside className="rounded-xl border border-ink-600 bg-ink-900/80 p-4 text-sm text-zinc-500">
        <h3 className="mb-2 text-sm font-semibold text-zinc-200">File details</h3>
        Click a file in the graph to see its MongoDB findings and which other files may need changes if it is migrated.
      </aside>
    );
  }

  const here = findings.filter((f) => f.file === node.path);
  const dependents = graph.impact[node.id] ?? [];
  const imports = graph.edges.filter((e) => e.source === node.id);
  const importedBy = graph.edges.filter((e) => e.target === node.id);

  return (
    <aside className="max-h-[680px] space-y-4 overflow-y-auto rounded-xl border border-ink-600 bg-ink-900/80 p-4">
      <div>
        <div className="break-all font-mono text-sm text-zinc-100">{node.path}</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
          <span className="rounded bg-ink-700 px-1.5 py-0.5 text-zinc-300">{KIND_LABEL[node.kind]}</span>
          <span
            className={[
              'rounded px-1.5 py-0.5',
              node.impact === 'direct' ? 'bg-neon-faint text-neon' : node.impact === 'indirect' ? 'bg-violet-faint text-violet-soft' : 'bg-ink-700 text-zinc-400',
            ].join(' ')}
          >
            {node.impact === 'direct' ? 'contains MongoDB code' : node.impact === 'indirect' ? 'depends on MongoDB code' : 'not affected'}
          </span>
        </div>
      </div>

      {dependents.length > 0 && (
        <Section title={`If this model changes, review (${dependents.length})`}>
          <ul className="space-y-1">
            {dependents.map((d) => (
              <li key={d}>
                <button onClick={() => onSelect(d)} className="break-all text-left font-mono text-[11px] text-violet-soft hover:underline">
                  {d}
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={`Imports (${imports.length})`}>
        <FileList edges={imports.map((e) => e.target)} onSelect={onSelect} />
      </Section>
      <Section title={`Imported by (${importedBy.length})`}>
        <FileList edges={importedBy.map((e) => e.source)} onSelect={onSelect} />
      </Section>

      <Section title={`Findings in this file (${here.length})`}>
        {here.length === 0 ? (
          <p className="text-xs text-zinc-500">No MongoDB patterns detected.</p>
        ) : (
          <ul className="space-y-2">
            {here.map((f, i) => (
              <li key={i} className="rounded-lg border border-ink-700 bg-ink-950 p-2">
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className={`rounded border px-1.5 py-0.5 ${CATEGORY_CLASS[f.category]}`}>{f.category}</span>
                  <span className="font-mono text-zinc-500">line {f.line}</span>
                  <span className={`ml-auto ${CONFIDENCE_CLASS[f.confidence]}`}>{f.confidence}</span>
                </div>
                <div className="mt-1 font-mono text-xs text-zinc-200">{f.pattern}</div>
                <div className="mt-0.5 truncate font-mono text-[11px] text-zinc-500" title={f.evidence}>
                  {f.evidence}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{title}</h4>
      {children}
    </section>
  );
}

function FileList({ edges, onSelect }: { edges: string[]; onSelect: (id: string) => void }) {
  if (edges.length === 0) return <p className="text-xs text-zinc-600">None in this graph.</p>;
  return (
    <ul className="space-y-1">
      {edges.map((id) => (
        <li key={id}>
          <button onClick={() => onSelect(id)} className="break-all text-left font-mono text-[11px] text-zinc-300 hover:text-violet-soft hover:underline">
            {id}
          </button>
        </li>
      ))}
    </ul>
  );
}
