'use client';

import { useMemo } from 'react';
import { Background, Controls, MarkerType, MiniMap, ReactFlow, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { layoutGraph } from '@/lib/layout';
import { EDGE_STYLE, GREEN, PURPLE } from '@/lib/theme';
import type { Graph } from '@/lib/types';
import FileNode, { type FileFlowNode } from './FileNode';

const nodeTypes = { file: FileNode };

interface Props {
  graph: Graph;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export default function DependencyGraph({ graph, selectedId, onSelect }: Props) {
  const positions = useMemo(
    () =>
      layoutGraph(
        graph.nodes.map((n) => n.id),
        graph.edges.map((e): [string, string] => [e.source, e.target]),
      ),
    [graph],
  );

  const nodes = useMemo<FileFlowNode[]>(() => {
    const neighbours = new Set<string>();
    if (selectedId) {
      neighbours.add(selectedId);
      for (const e of graph.edges) {
        if (e.source === selectedId) neighbours.add(e.target);
        if (e.target === selectedId) neighbours.add(e.source);
      }
    }
    return graph.nodes.map((n) => ({
      id: n.id,
      type: 'file',
      position: positions[n.id],
      data: { node: n, selected: n.id === selectedId, dimmed: selectedId !== null && !neighbours.has(n.id) },
    }));
  }, [graph, positions, selectedId]);

  const edges = useMemo<Edge[]>(
    () =>
      graph.edges.map((e) => {
        const style = EDGE_STYLE[e.type];
        const incident = selectedId !== null && (e.source === selectedId || e.target === selectedId);
        const dimmed = selectedId !== null && !incident;
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          type: 'smoothstep',
          animated: e.type === 'uses_model',
          label: e.label ?? undefined,
          labelStyle: { fill: '#c4b5fd', fontSize: 11 },
          labelBgStyle: { fill: '#0a0a0f' },
          style: {
            stroke: style.color,
            strokeWidth: incident ? 2.5 : 1.5,
            strokeDasharray: style.dashed ? '5 4' : undefined,
            opacity: dimmed ? 0.15 : 1,
          },
          markerEnd: { type: MarkerType.ArrowClosed, color: style.color },
        };
      }),
    [graph, selectedId],
  );

  if (graph.nodes.length === 0) {
    return (
      <div className="flex h-[560px] items-center justify-center rounded-xl border border-ink-600 bg-ink-900/60 text-sm text-zinc-500">
        No files to show in the graph.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="h-[600px] overflow-hidden rounded-xl border border-ink-600">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={(_, node) => onSelect(node.id)}
          onPaneClick={() => onSelect(null)}
          nodesConnectable={false}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.1}
          colorMode="dark"
        >
          <Background color="#1a1a25" gap={22} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable nodeColor={(n) => ((n.data as FileFlowNode['data']).node.mongo ? GREEN : PURPLE)} maskColor="rgba(5,5,7,0.7)" />
        </ReactFlow>
      </div>
      <Legend />
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-1 text-[11px] text-zinc-400">
      <span className="flex items-center gap-1.5">
        <i className="inline-block h-2.5 w-2.5 rounded-sm border border-neon/70 shadow-neon" /> contains MongoDB code
      </span>
      <span className="flex items-center gap-1.5">
        <i className="inline-block h-2.5 w-2.5 rounded-sm border border-violet/70 shadow-violet" /> depends on MongoDB code (may need changes)
      </span>
      {(['registers_route', 'calls_service', 'uses_model', 'connects_db', 'imports'] as const).map((t) => (
        <span key={t} className="flex items-center gap-1.5">
          <i className="inline-block h-0.5 w-5" style={{ background: EDGE_STYLE[t].color }} /> {EDGE_STYLE[t].label}
        </span>
      ))}
      <span className="text-zinc-600">Arrows point from the importing file to the file it imports.</span>
    </div>
  );
}
