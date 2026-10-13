'use client';

import { useMemo, useState } from 'react';
import type { MigrationPlan, MigrationTask } from '@/lib/types';

interface Props {
  plan: MigrationPlan;
  onOpenFile?: (file: string) => void;
}

export default function MigrationPlanView({ plan, onOpenFile }: Props) {
  const [priorityFilter, setPriorityFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [search, setSearch] = useState('');

  const priorityCounts = useMemo(() => {
    const counts = { high: 0, medium: 0, low: 0 };
    for (const t of plan.tasks) {
      if (t.priority in counts) counts[t.priority as keyof typeof counts]++;
    }
    return counts;
  }, [plan.tasks]);

  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return plan.tasks.filter((t) => {
      if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false;
      if (!q) return true;
      return (
        t.file.toLowerCase().includes(q) ||
        t.action.toLowerCase().includes(q) ||
        t.reason.toLowerCase().includes(q) ||
        (t.model && t.model.toLowerCase().includes(q)) ||
        (t.sourceOperation && t.sourceOperation.toLowerCase().includes(q)) ||
        (t.targetOperation && t.targetOperation.toLowerCase().includes(q))
      );
    });
  }, [plan.tasks, priorityFilter, search]);

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        <div className="rounded-xl border border-ink-600 bg-ink-900/80 p-3 sm:p-4">
          <div className="text-[11px] uppercase tracking-wider text-zinc-400">Migration Pipeline</div>
          <div className="mt-1 flex items-center gap-1.5 font-mono text-sm font-semibold text-zinc-100">
            <span className="text-neon">{plan.source.split('/')[1] || 'Mongoose'}</span>
            <span className="text-zinc-500">→</span>
            <span className="text-violet-soft">{plan.target.split('/')[1] || 'Prisma'}</span>
          </div>
          <div className="mt-1 text-[11px] text-zinc-500">Agent 2 Migration Planner</div>
        </div>

        <div className="rounded-xl border border-ink-600 bg-ink-900/80 p-3 sm:p-4">
          <div className="text-[11px] uppercase tracking-wider text-zinc-400">Total Tasks</div>
          <div className="mt-1 font-mono text-2xl font-bold text-zinc-100">{plan.summary.tasksCreated}</div>
          <div className="mt-1 text-[11px] text-zinc-500">{plan.summary.findingsProcessed} findings analyzed</div>
        </div>

        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 sm:p-4">
          <div className="text-[11px] uppercase tracking-wider text-red-400">Migration Blockers</div>
          <div className="mt-1 font-mono text-2xl font-bold text-red-300">{plan.summary.blockersFound}</div>
          <div className="mt-1 text-[11px] text-red-400/70">Require architecture review</div>
        </div>

        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 sm:p-4">
          <div className="text-[11px] uppercase tracking-wider text-amber-400">High / Medium Tasks</div>
          <div className="mt-1 font-mono text-2xl font-bold text-amber-300">
            {priorityCounts.high + priorityCounts.medium}
          </div>
          <div className="mt-1 text-[11px] text-amber-400/70">
            {priorityCounts.high} high · {priorityCounts.medium} medium
          </div>
        </div>

        <div className="col-span-2 sm:col-span-1 rounded-xl border border-violet/40 bg-violet-faint p-3 sm:p-4">
          <div className="text-[11px] uppercase tracking-wider text-violet-soft">Manual Reviews</div>
          <div className="mt-1 font-mono text-2xl font-bold text-violet-soft">
            {plan.tasks.filter((t) => t.manualReview).length}
          </div>
          <div className="mt-1 text-[11px] text-zinc-400">Human-verified conversions</div>
        </div>
      </div>

      {/* Blockers Alert Section */}
      {plan.blockers.length > 0 && (
        <div className="rounded-xl border border-red-500/40 bg-red-950/20 p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="flex h-2 w-2 rounded-full bg-red-500 animate-pulse" />
            <h3 className="text-sm font-semibold text-red-300">
              Critical Migration Blockers Detected ({plan.blockers.length})
            </h3>
            <span className="text-xs text-zinc-400">
              Patterns that cannot be converted 1:1 and need code refactoring
            </span>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {plan.blockers.map((b, idx) => (
              <div
                key={`${b.file}-${b.line}-${idx}`}
                className="rounded-lg border border-red-500/30 bg-ink-950/80 p-3 text-xs space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase ${
                      b.severity === 'high'
                        ? 'bg-red-500/20 text-red-300 border border-red-500/40'
                        : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    }`}
                  >
                    {b.severity} severity
                  </span>
                  <span className="font-mono text-violet-soft font-semibold">{b.keyword}</span>
                </div>

                <div className="text-zinc-300 font-mono text-[11px] truncate" title={b.pattern}>
                  {b.pattern}
                </div>

                <div className="text-zinc-400 text-[11px] leading-relaxed">{b.reason}</div>

                <div className="pt-1 flex items-center justify-between border-t border-ink-800 text-[10px] text-zinc-500">
                  <span className="font-mono truncate">{b.file}{b.line ? `:${b.line}` : ''}</span>
                  {onOpenFile && (
                    <button
                      onClick={() => onOpenFile(b.file)}
                      className="text-neon hover:underline shrink-0 ml-2"
                    >
                      view in graph →
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Migration Tasks Table / List */}
      <div className="rounded-xl border border-ink-600 bg-ink-900/80">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-700 p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <FilterChip
              active={priorityFilter === 'all'}
              onClick={() => setPriorityFilter('all')}
            >
              All Tasks · {plan.tasks.length}
            </FilterChip>
            <FilterChip
              active={priorityFilter === 'high'}
              onClick={() => setPriorityFilter('high')}
              color="red"
            >
              High · {priorityCounts.high}
            </FilterChip>
            <FilterChip
              active={priorityFilter === 'medium'}
              onClick={() => setPriorityFilter('medium')}
              color="amber"
            >
              Medium · {priorityCounts.medium}
            </FilterChip>
            <FilterChip
              active={priorityFilter === 'low'}
              onClick={() => setPriorityFilter('low')}
              color="zinc"
            >
              Low · {priorityCounts.low}
            </FilterChip>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Filter tasks, operations, models…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-md border border-ink-600 bg-ink-950 px-2.5 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:border-violet focus:outline-none w-56 sm:w-64"
            />
          </div>
        </div>

        {filteredTasks.length === 0 ? (
          <div className="p-8 text-center text-sm text-zinc-500">
            No migration tasks match the current filter.
          </div>
        ) : (
          <div className="divide-y divide-ink-800 overflow-x-auto">
            {filteredTasks.map((task) => (
              <TaskRow key={task.id} task={task} onOpenFile={onOpenFile} />
            ))}
          </div>
        )}
      </div>

      {/* Warnings & Unmapped Operations (if any) */}
      {plan.warnings && plan.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <h4 className="text-xs font-semibold text-amber-300 uppercase tracking-wider mb-2">
            Planner Notices ({plan.warnings.length})
          </h4>
          <ul className="space-y-1.5 text-xs text-zinc-400">
            {plan.warnings.map((w, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-amber-400">•</span>
                <span>
                  {w.file && <span className="font-mono text-zinc-300">{w.file}{w.line ? `:${w.line}` : ''} - </span>}
                  {w.operation && <span className="font-mono text-violet-soft">[{w.operation}] </span>}
                  {w.message}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function TaskRow({ task, onOpenFile }: { task: MigrationTask; onOpenFile?: (file: string) => void }) {
  const priorityBadge = {
    high: 'border-red-500/40 bg-red-500/10 text-red-300',
    medium: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
    low: 'border-ink-500 bg-ink-800 text-zinc-400',
  }[task.priority];

  return (
    <div className="p-3 sm:p-4 hover:bg-ink-800/40 transition-colors space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-zinc-500">#{task.id}</span>
          <span className={`rounded border px-2 py-0.5 text-[10px] font-semibold uppercase ${priorityBadge}`}>
            {task.priority}
          </span>

          {task.model && (
            <span className="rounded border border-neon/40 bg-neon-faint px-2 py-0.5 font-mono text-[10px] text-neon">
              Model: {task.model}
            </span>
          )}

          {task.sourceOperation && task.targetOperation && (
            <span className="inline-flex items-center gap-1 rounded border border-violet/40 bg-violet-faint px-2 py-0.5 font-mono text-[11px] text-violet-soft">
              <span>{task.sourceOperation}</span>
              <span className="text-zinc-500">→</span>
              <span className="font-bold text-zinc-100">{task.targetOperation}</span>
            </span>
          )}

          {task.manualReview && (
            <span className="rounded border border-ink-600 bg-ink-950 px-1.5 py-0.5 text-[10px] text-zinc-400">
              Manual Review
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="rounded bg-ink-800 px-2 py-0.5 font-mono text-[10px] text-zinc-400">
            status: {task.status}
          </span>
        </div>
      </div>

      <div className="text-sm font-medium text-zinc-200">{task.action}</div>

      <div className="text-xs text-zinc-400 leading-relaxed">{task.reason}</div>

      <div className="flex items-center justify-between pt-1 text-xs text-zinc-500">
        <div className="font-mono text-[11px] truncate">
          {task.file}
          {task.line !== null && task.line !== undefined ? `:${task.line}` : ''}
        </div>
        {onOpenFile && (
          <button
            onClick={() => onOpenFile(task.file)}
            className="text-xs text-neon hover:underline shrink-0 ml-2"
          >
            Locate file in graph →
          </button>
        )}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
  color,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  color?: 'red' | 'amber' | 'zinc';
}) {
  const activeClass =
    color === 'red'
      ? 'border-red-500/60 bg-red-500/20 text-red-300'
      : color === 'amber'
      ? 'border-amber-500/60 bg-amber-500/20 text-amber-300'
      : 'border-violet text-violet-soft bg-violet-faint';

  return (
    <button
      onClick={onClick}
      className={[
        'rounded-md border px-2.5 py-1 text-xs transition-colors',
        active ? activeClass : 'border-ink-600 bg-ink-950 text-zinc-400 hover:text-zinc-200',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
