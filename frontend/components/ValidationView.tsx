'use client';

import { useMemo, useState } from 'react';
import type { ValidationCheck, ValidationResult, ValidationStatus } from '@/lib/types';

interface Props {
  result: ValidationResult | null;
  loading: boolean;
  onRunValidation: (strictMode?: boolean) => void;
  onOpenFile?: (file: string) => void;
}

export default function ValidationView({
  result,
  loading,
  onRunValidation,
  onOpenFile,
}: Props) {
  const [activeTab, setActiveTab] = useState<'checks' | 'report'>('checks');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [strictMode, setStrictMode] = useState<boolean>(false);
  const [expandedCheckId, setExpandedCheckId] = useState<string | null>(null);
  const [copiedReport, setCopiedReport] = useState<boolean>(false);

  const categories = [
    { id: 'all', label: 'All Categories' },
    { id: 'schema', label: 'Prisma Schema' },
    { id: 'database_queries', label: 'Query Semantics' },
    { id: 'code_syntax', label: 'Code Syntax' },
    { id: 'dependencies', label: 'Dependencies' },
    { id: 'configuration', label: 'Configuration' },
  ];

  const filteredChecks = useMemo(() => {
    if (!result?.checks) return [];
    return result.checks.filter((c) => {
      if (selectedCategory !== 'all' && c.category !== selectedCategory) return false;
      if (selectedStatus !== 'all' && c.status !== selectedStatus) return false;
      return true;
    });
  }, [result, selectedCategory, selectedStatus]);

  function handleCopyReport() {
    if (!result?.reportMarkdown) return;
    navigator.clipboard.writeText(result.reportMarkdown);
    setCopiedReport(true);
    setTimeout(() => setCopiedReport(false), 2000);
  }

  function handleDownloadReport() {
    if (!result?.reportMarkdown) return;
    const blob = new Blob([result.reportMarkdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `migration-validation-${result.analysisId}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!result && !loading) {
    return (
      <div className="rounded-xl border border-ink-600 bg-ink-900/80 p-8 text-center space-y-4">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-neon-faint border border-neon/40 text-neon text-2xl">
          🛡️
        </div>
        <div>
          <h3 className="text-base font-semibold text-zinc-100">Agent 4 — Automated Validation</h3>
          <p className="mt-1 text-xs text-zinc-400 max-w-xl mx-auto leading-relaxed">
            Verifies migration integrity across five deterministic quality gates: Prisma schema model coverage,
            residual MongoDB/Mongoose cleanup, Prisma query argument semantics, dependency declarations, and JavaScript/TypeScript syntax compilation.
          </p>
        </div>

        <div className="flex items-center justify-center gap-4 pt-2">
          <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
            <input
              type="checkbox"
              checked={strictMode}
              onChange={(e) => setStrictMode(e.target.checked)}
              className="rounded border-ink-600 bg-ink-950 text-neon focus:ring-neon"
            />
            Strict mode (treat warnings as failures)
          </label>
        </div>

        <div className="pt-2">
          <button
            onClick={() => onRunValidation(strictMode)}
            className="rounded-lg bg-neon px-6 py-2.5 text-xs font-semibold text-ink-950 transition hover:brightness-110 shadow-neon"
          >
            Run Agent 4 Validation Checks
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-neon/40 bg-neon-faint p-8 text-center space-y-3 animate-pulse">
        <div className="font-medium text-sm text-neon">
          Agent 4 is running automated validation checks on migrated workspace…
        </div>
        <p className="text-xs text-zinc-400">
          Checking Prisma schema, scanning for residual queries, verifying syntax compilation, and auditing dependencies.
        </p>
      </div>
    );
  }

  if (!result) return null;

  const { summary } = result;
  const isHealthy = summary.status === 'passed';
  const hasWarningsOnly = summary.status === 'warnings';

  return (
    <div className="space-y-4">
      {/* Header and readiness gauge */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="rounded-xl border border-ink-600 bg-ink-900/80 p-3 sm:col-span-1">
          <div className="text-xs text-zinc-400">Readiness Score</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span
              className={`font-mono text-2xl font-bold ${
                summary.readinessScore >= 90
                  ? 'text-neon'
                  : summary.readinessScore >= 70
                  ? 'text-amber-400'
                  : 'text-red-400'
              }`}
            >
              {summary.readinessScore}%
            </span>
          </div>
          <div className="mt-1 text-[10px] text-zinc-500 uppercase tracking-wide font-mono">
            {isHealthy ? 'Production Ready' : hasWarningsOnly ? 'Review Advised' : 'Blockers Detected'}
          </div>
        </div>

        <div className="rounded-xl border border-ink-600 bg-ink-900/80 p-3">
          <div className="text-xs text-zinc-400">Total Checks</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-zinc-100">{summary.totalChecks}</div>
          <div className="mt-1 text-[10px] text-zinc-500 font-mono">5 verification suites</div>
        </div>

        <div className="rounded-xl border border-ink-600 bg-ink-900/80 p-3">
          <div className="text-xs text-zinc-400">Checks Passed</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-neon">{summary.passed}</div>
          <div className="mt-1 text-[10px] text-zinc-500 font-mono">verified compliant</div>
        </div>

        <div className="rounded-xl border border-ink-600 bg-ink-900/80 p-3">
          <div className="text-xs text-zinc-400">Review Items</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-amber-400">{summary.warnings}</div>
          <div className="mt-1 text-[10px] text-zinc-500 font-mono">warnings / caveats</div>
        </div>

        <div className="rounded-xl border border-ink-600 bg-ink-900/80 p-3">
          <div className="text-xs text-zinc-400">Checks Failed</div>
          <div
            className={`mt-1 font-mono text-2xl font-semibold ${
              summary.failed > 0 ? 'text-red-400' : 'text-zinc-500'
            }`}
          >
            {summary.failed}
          </div>
          <div className="mt-1 text-[10px] text-zinc-500 font-mono">critical issues</div>
        </div>
      </div>

      {/* Action and Subtab Navigation Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-600 bg-ink-900/80 p-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('checks')}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              activeTab === 'checks' ? 'bg-neon text-ink-950 font-semibold' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Validation Checks ({result.checks.length})
          </button>
          <button
            onClick={() => setActiveTab('report')}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              activeTab === 'report' ? 'bg-neon text-ink-950 font-semibold' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Full Report (.md)
          </button>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer">
            <input
              type="checkbox"
              checked={strictMode}
              onChange={(e) => setStrictMode(e.target.checked)}
              className="rounded border-ink-600 bg-ink-950 text-neon focus:ring-neon text-xs"
            />
            Strict mode
          </label>

          <button
            onClick={() => onRunValidation(strictMode)}
            className="rounded-lg border border-neon/50 bg-neon-faint px-3 py-1.5 font-mono text-xs text-neon hover:bg-neon/20 transition"
          >
            Re-run Validation
          </button>
        </div>
      </div>

      {activeTab === 'checks' ? (
        <div className="space-y-3">
          {/* Filters */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            {/* Category Filter Pills */}
            <div className="flex flex-wrap gap-1">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`rounded-md px-2.5 py-1 transition text-xs ${
                    selectedCategory === cat.id
                      ? 'bg-violet text-ink-950 font-medium'
                      : 'border border-ink-700 bg-ink-950 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* Status Filter */}
            <div className="flex items-center gap-1">
              <span className="text-zinc-500 text-xs mr-1">Status:</span>
              {['all', 'failed', 'warning', 'passed'].map((st) => (
                <button
                  key={st}
                  onClick={() => setSelectedStatus(st)}
                  className={`rounded-md px-2 py-0.5 uppercase text-[10px] font-mono transition ${
                    selectedStatus === st
                      ? 'bg-zinc-200 text-ink-950 font-bold'
                      : 'border border-ink-700 bg-ink-950 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          {/* Checks List */}
          <div className="space-y-2">
            {filteredChecks.length === 0 ? (
              <div className="rounded-xl border border-ink-700 bg-ink-950 p-8 text-center text-xs text-zinc-500">
                No checks match the selected filter criteria.
              </div>
            ) : (
              filteredChecks.map((check) => {
                const isExpanded = expandedCheckId === check.id;
                const isFailed = check.status === 'failed';
                const isWarning = check.status === 'warning';
                const isPassed = check.status === 'passed';

                return (
                  <div
                    key={check.id}
                    className={`rounded-xl border transition p-4 ${
                      isFailed
                        ? 'border-red-500/40 bg-red-950/10'
                        : isWarning
                        ? 'border-amber-500/30 bg-amber-950/10'
                        : 'border-ink-700 bg-ink-900/60'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <span className="text-base leading-none mt-0.5">
                          {isPassed ? '✅' : isWarning ? '⚠️' : '❌'}
                        </span>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-xs text-zinc-100">{check.name}</span>
                            <span
                              className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded ${
                                isPassed
                                  ? 'bg-neon-faint text-neon'
                                  : isWarning
                                  ? 'bg-amber-500/20 text-amber-300'
                                  : 'bg-red-500/20 text-red-300'
                              }`}
                            >
                              {check.status}
                            </span>
                            <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-ink-800 text-zinc-400">
                              {check.category.replace('_', ' ')}
                            </span>
                            {check.severity && check.severity !== 'info' && (
                              <span
                                className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded ${
                                  check.severity === 'critical'
                                    ? 'bg-red-500/30 text-red-200'
                                    : 'bg-zinc-800 text-zinc-300'
                                }`}
                              >
                                {check.severity}
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-zinc-300">{check.message}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {check.file && (
                          <button
                            onClick={() => onOpenFile?.(check.file!)}
                            className="text-[11px] font-mono text-violet-soft hover:underline flex items-center gap-1"
                          >
                            <span>{check.file}</span>
                            {check.line && <span className="text-zinc-500">:{check.line}</span>}
                          </button>
                        )}
                        {(check.details || check.remediation) && (
                          <button
                            onClick={() => setExpandedCheckId(isExpanded ? null : check.id)}
                            className="rounded px-2 py-1 text-[11px] border border-ink-700 bg-ink-950 text-zinc-400 hover:text-zinc-200"
                          >
                            {isExpanded ? 'Hide' : 'Details'}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Expandable details and remediation */}
                    {isExpanded && (
                      <div className="mt-3 pt-3 border-t border-ink-700/60 space-y-2 text-xs">
                        {check.details && (
                          <div>
                            <div className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">
                              Context & Details
                            </div>
                            <pre className="font-mono text-xs bg-ink-950 p-2.5 rounded-lg border border-ink-700 text-zinc-300 overflow-x-auto whitespace-pre-wrap">
                              {check.details}
                            </pre>
                          </div>
                        )}
                        {check.remediation && (
                          <div className="rounded-lg border border-neon/30 bg-neon-faint p-2.5 text-xs text-zinc-200">
                            <span className="font-semibold text-neon mr-1">Remediation:</span>
                            {check.remediation}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : (
        /* Markdown Report View */
        <div className="rounded-xl border border-ink-600 bg-ink-950 p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-ink-700 pb-2">
            <span className="font-mono text-xs text-zinc-300">Validation Report — Markdown Format</span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopyReport}
                className="rounded px-3 py-1 text-xs border border-ink-700 bg-ink-900 text-zinc-300 hover:text-zinc-100 transition"
              >
                {copiedReport ? '✓ Copied' : 'Copy Report'}
              </button>
              <button
                onClick={handleDownloadReport}
                className="rounded px-3 py-1 text-xs bg-neon text-ink-950 font-semibold hover:brightness-110 transition shadow-neon"
              >
                Download (.md)
              </button>
            </div>
          </div>
          <pre className="text-xs font-mono p-4 rounded-lg bg-ink-900 border border-ink-700 overflow-x-auto text-zinc-200 leading-relaxed max-h-[550px] whitespace-pre-wrap">
            {result.reportMarkdown || 'No report available.'}
          </pre>
        </div>
      )}
    </div>
  );
}
