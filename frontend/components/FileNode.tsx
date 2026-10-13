'use client';

import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { KIND_LABEL } from '@/lib/theme';
import type { GraphNode } from '@/lib/types';

export type FileNodeData = {
  node: GraphNode;
  selected: boolean;
  dimmed: boolean;
};

export type FileFlowNode = Node<FileNodeData, 'file'>;

export default function FileNode({ data }: NodeProps<FileFlowNode>) {
  const { node, selected, dimmed } = data;
  const dir = node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : '.';

  const ring =
    node.impact === 'direct'
      ? 'border-neon/70 shadow-neon'
      : node.impact === 'indirect'
        ? 'border-violet/70 shadow-violet'
        : 'border-ink-600';

  return (
    <div
      className={[
        'w-[230px] rounded-lg border bg-ink-900 px-3 py-2 transition-opacity',
        ring,
        selected ? 'ring-2 ring-white/70' : '',
        dimmed ? 'opacity-30' : 'opacity-100',
      ].join(' ')}
    >
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-0 !bg-violet" />
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-[13px] font-medium text-zinc-100" title={node.path}>
          {node.label}
        </span>
        {node.findingCount > 0 && (
          <span className="shrink-0 rounded bg-neon-faint px-1.5 py-0.5 font-mono text-[10px] text-neon">{node.findingCount}</span>
        )}
      </div>
      <div className="truncate font-mono text-[10px] text-zinc-500">{dir}</div>
      <div className="mt-1.5 flex items-center gap-1.5 text-[10px]">
        <span className="rounded bg-ink-700 px-1.5 py-0.5 uppercase tracking-wide text-zinc-300">{KIND_LABEL[node.kind]}</span>
        {node.models.length > 0 && <span className="truncate text-neon">{node.models.join(', ')}</span>}
      </div>
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-0 !bg-violet" />
    </div>
  );
}
