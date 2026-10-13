'use client';

import { FormEvent, useState } from 'react';
import type { AnalyzeRequest } from '@/lib/types';

interface Props {
  loading: boolean;
  onAnalyze: (request: AnalyzeRequest) => void;
  onSample: () => void;
}

// Mirrors the backend rules so mistakes are caught immediately; the backend re-validates everything.
const GITHUB_URL = /^https:\/\/github\.com\/[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}?(\.git)?\/?$/;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;

export default function RepositoryForm({ loading, onAnalyze, onSample }: Props) {
  const [url, setUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [generateGraph, setGenerateGraph] = useState(true);
  const [scope, setScope] = useState<'relevant' | 'all'>('relevant');
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmedUrl = url.trim();
    const trimmedBranch = branch.trim();
    if (!GITHUB_URL.test(trimmedUrl)) {
      setError('Enter a GitHub repository URL like https://github.com/owner/repo');
      return;
    }
    if (trimmedBranch && (!BRANCH.test(trimmedBranch) || trimmedBranch.includes('..'))) {
      setError('That branch name is not valid.');
      return;
    }
    setError(null);
    onAnalyze({
      repository_url: trimmedUrl,
      branch: trimmedBranch || null,
      generate_graph: generateGraph,
      graph_scope: scope,
    });
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-ink-600 bg-ink-900/80 p-5 backdrop-blur">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold tracking-wide text-zinc-100">MigrateAI Workspace</h2>
        <span className="font-mono text-[11px] text-zinc-500">MongoDB → Prisma / PostgreSQL</span>
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_200px]">
        <label className="block">
          <span className="mb-1.5 block text-xs text-zinc-400">GitHub repository URL</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/owner/example-node-app"
            spellCheck={false}
            autoComplete="off"
            className="w-full rounded-lg border border-ink-600 bg-ink-950 px-3 py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-violet focus:outline-none focus:ring-1 focus:ring-violet"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs text-zinc-400">Branch (optional)</span>
          <input
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="default branch"
            spellCheck={false}
            autoComplete="off"
            className="w-full rounded-lg border border-ink-600 bg-ink-950 px-3 py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-violet focus:outline-none focus:ring-1 focus:ring-violet"
          />
        </label>
      </div>

      <fieldset className="mt-4">
        <legend className="mb-2 text-xs text-zinc-400">Choose analysis steps</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <Step checked disabled label="Scan for MongoDB/Mongoose files" />
          <Step checked={generateGraph} onChange={setGenerateGraph} label="Generate dependency graph (Agent 1)" />
          <Step disabled label="Run migration agent" future />
          <Step disabled label="Validate migrated application" future />
        </div>
      </fieldset>

      {generateGraph && (
        <div className="mt-4 flex items-center gap-3 text-xs text-zinc-400">
          <span>Graph shows</span>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as 'relevant' | 'all')}
            className="rounded-md border border-ink-600 bg-ink-950 px-2 py-1 text-zinc-200 focus:border-violet focus:outline-none"
          >
            <option value="relevant">MongoDB files and everything that depends on them</option>
            <option value="all">Every source file</option>
          </select>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-neon px-4 py-2 text-sm font-semibold text-ink-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Analyzing…' : 'Analyze repository'}
        </button>
        <button
          type="button"
          onClick={onSample}
          disabled={loading}
          className="rounded-lg border border-violet/60 px-4 py-2 text-sm font-medium text-violet-soft transition hover:bg-violet-faint disabled:cursor-not-allowed disabled:opacity-50"
        >
          Try the sample app
        </button>
        <span className="text-xs text-zinc-500">Source code is only read, never executed.</span>
      </div>
    </form>
  );
}

function Step({
  label,
  checked = false,
  disabled = false,
  future = false,
  onChange,
}: {
  label: string;
  checked?: boolean;
  disabled?: boolean;
  future?: boolean;
  onChange?: (value: boolean) => void;
}) {
  return (
    <label
      className={[
        'flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm',
        disabled ? 'cursor-not-allowed border-ink-700 text-zinc-500' : 'cursor-pointer border-ink-600 text-zinc-200 hover:border-violet/60',
      ].join(' ')}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
        className="h-4 w-4 accent-[#22ff88]"
      />
      <span>{label}</span>
      {future && <span className="ml-auto rounded bg-ink-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">future stage</span>}
    </label>
  );
}
