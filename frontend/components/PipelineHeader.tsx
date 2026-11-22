import React from 'react';

type StageStatus = 'idle' | 'running' | 'completed' | 'warning' | 'failed' | 'disabled';

interface Props {
  loading: boolean;
  hasResult: boolean;
  migrating: boolean;
  hasPlan: boolean;
  engineeringLoading: boolean;
  hasEngineering: boolean;
  validating: boolean;
  hasValidation: boolean;
}

function statusBadge(status: StageStatus) {
  const colors: Record<StageStatus, string> = {
    idle: 'bg-slate-500',
    running: 'bg-violet-500 animate-pulse',
    completed: 'bg-emerald-500',
    warning: 'bg-amber-500',
    failed: 'bg-rose-500',
    disabled: 'bg-slate-300',
  };
  return <span className={`inline-block h-2 w-2 rounded-full ${colors[status]}`} />;
}

export default function PipelineHeader({
  loading,
  hasResult,
  migrating,
  hasPlan,
  engineeringLoading,
  hasEngineering,
  validating,
  hasValidation,
}: Props) {
  // Derive stage statuses simplisticly based on flags
  const repoStatus: StageStatus = loading ? 'running' : hasResult ? 'completed' : 'idle';
  const scanStatus: StageStatus = loading ? 'running' : hasResult ? 'completed' : 'idle';
  const planStatus: StageStatus = migrating ? 'running' : hasPlan ? 'completed' : 'idle';
  const engStatus: StageStatus = engineeringLoading ? 'running' : hasEngineering ? 'completed' : 'idle';
  const valStatus: StageStatus = validating ? 'running' : hasValidation ? 'completed' : 'idle';

  return (
    <div className="mb-4 flex flex-wrap items-center gap-4 text-sm text-zinc-400">
      <div className="flex items-center gap-2">
        {statusBadge(repoStatus)} Repository
      </div>
      <div className="flex items-center gap-2">
        {statusBadge(scanStatus)} Scanner
      </div>
      <div className="flex items-center gap-2">
        {statusBadge(planStatus)} Plan (Agent 2)
      </div>
      <div className="flex items-center gap-2">
        {statusBadge(engStatus)} Engineering (Agent 3)
      </div>
      <div className="flex items-center gap-2">
        {statusBadge(valStatus)} Validation (Agent 4)
      </div>
    </div>
  );
}
