'use client';

import { useMemo, useState } from 'react';
import { CATEGORIES, CATEGORY_CLASS, CONFIDENCE_CLASS } from '@/lib/theme';
import type { Category, Confidence, Finding } from '@/lib/types';

interface Props {
  findings: Finding[];
  onOpenFile: (file: string) => void;
}

const PAGE = 200;

export default function FindingsTable({ findings, onOpenFile }: Props) {
  const [category, setCategory] = useState<Category | 'all'>('all');
  const [confidence, setConfidence] = useState<Confidence | 'all'>('all');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of findings) c[f.category] = (c[f.category] ?? 0) + 1;
    return c;
  }, [findings]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return findings.filter(
      (f) =>
        (category === 'all' || f.category === category) &&
        (confidence === 'all' || f.confidence === confidence) &&
        (!q || f.file.toLowerCase().includes(q) || f.pattern.toLowerCase().includes(q) || f.evidence.toLowerCase().includes(q)),
    );
  }, [findings, category, confidence, query]);

  return (
    <div className="rounded-xl border border-ink-600 bg-ink-900/80">
      <div className="flex flex-wrap items-center gap-2 border-b border-ink-700 p-3">
        <Chip active={category === 'all'} onClick={() => setCategory('all')}>
          All · {findings.length}
        </Chip>
        {CATEGORIES.filter((c) => counts[c]).map((c) => (
          <Chip key={c} active={category === c} onClick={() => setCategory(c)}>
            {c} · {counts[c]}
          </Chip>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <select
            value={confidence}
            onChange={(e) => setConfidence(e.target.value as Confidence | 'all')}
            className="rounded-md border border-ink-600 bg-ink-950 px-2 py-1 text-xs text-zinc-200 focus:border-violet focus:outline-none"
            aria-label="Filter by confidence"
          >
            <option value="all">Any confidence</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search file, pattern, code…"
            className="w-56 rounded-md border border-ink-600 bg-ink-950 px-2.5 py-1 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-violet focus:outline-none"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[11px] uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-3 py-2 font-medium">Location</th>
              <th className="px-3 py-2 font-medium">Category</th>
              <th className="px-3 py-2 font-medium">Pattern</th>
              <th className="px-3 py-2 font-medium">Confidence</th>
              <th className="px-3 py-2 font-medium">Evidence</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-700/70">
            {filtered.slice(0, limit).map((f, i) => (
              <tr key={`${f.file}:${f.line}:${f.column}:${f.pattern}:${i}`} className="hover:bg-ink-800/70">
                <td className="whitespace-nowrap px-3 py-2 font-mono">
                  <button onClick={() => onOpenFile(f.file)} className="text-violet-soft hover:underline" title="Show in dependency graph">
                    {f.file}
                  </button>
                  <span className="text-zinc-500">:{f.line}</span>
                </td>
                <td className="px-3 py-2">
                  <span className={`rounded border px-1.5 py-0.5 ${CATEGORY_CLASS[f.category]}`}>{f.category}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-zinc-200">{f.pattern}</td>
                <td className={`px-3 py-2 ${CONFIDENCE_CLASS[f.confidence]}`}>{f.confidence}</td>
                <td className="max-w-md truncate px-3 py-2 font-mono text-zinc-500" title={f.evidence}>
                  {f.evidence}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-zinc-500">
                  No findings match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {filtered.length > limit && (
        <div className="border-t border-ink-700 p-3 text-center">
          <button onClick={() => setLimit((l) => l + PAGE)} className="text-xs text-violet-soft hover:underline">
            Show more ({filtered.length - limit} remaining)
          </button>
        </div>
      )}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={[
        'rounded-full border px-2.5 py-1 text-xs transition',
        active ? 'border-neon/60 bg-neon-faint text-neon' : 'border-ink-600 text-zinc-400 hover:border-violet/60 hover:text-zinc-200',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
