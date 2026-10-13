import type { Summary } from '@/lib/types';

interface Props {
  summary: Summary;
  warnings: string[];
}

export default function SummaryCards({ summary, warnings }: Props) {
  const cards = [
    { label: 'Files scanned', value: summary.filesScanned, accent: 'text-zinc-100' },
    { label: 'Files with MongoDB code', value: summary.filesWithFindings, accent: 'text-neon' },
    { label: 'Findings', value: summary.totalFindings, accent: 'text-neon' },
    { label: 'Mongoose models', value: summary.modelCount, accent: 'text-violet-soft' },
    { label: 'Graph nodes / edges', value: `${summary.nodeCount} / ${summary.edgeCount}`, accent: 'text-violet-soft' },
  ];
  const high = summary.byConfidence.high ?? 0;
  const medium = summary.byConfidence.medium ?? 0;
  const low = summary.byConfidence.low ?? 0;

  return (
    <section className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-ink-600 bg-ink-900/80 px-4 py-3">
            <div className={`text-2xl font-semibold tabular-nums ${c.accent}`}>{c.value}</div>
            <div className="mt-0.5 text-xs text-zinc-500">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-zinc-500">
        <span>
          Driver: <span className="font-mono text-zinc-300">{summary.driver}</span>
        </span>
        <span>
          Confidence: <span className="text-neon">{high} high</span> · <span className="text-violet-soft">{medium} medium</span> ·{' '}
          <span className="text-zinc-400">{low} low</span>
        </span>
        {summary.models.length > 0 && (
          <span>
            Models: <span className="font-mono text-zinc-300">{summary.models.join(', ')}</span>
          </span>
        )}
        <span>{summary.durationMs} ms</span>
      </div>

      {(warnings.length > 0 || summary.truncated) && (
        <details className="rounded-lg border border-ink-600 bg-ink-900/60 px-4 py-2 text-xs text-zinc-400">
          <summary className="cursor-pointer text-zinc-300">
            {warnings.length} note{warnings.length === 1 ? '' : 's'} about this analysis
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}

      <p className="text-xs text-zinc-600">
        Findings are static-analysis evidence, not proof, and the graph is a static approximation: dynamic imports, runtime-generated code and dependency
        injection may not be captured.
      </p>
    </section>
  );
}
