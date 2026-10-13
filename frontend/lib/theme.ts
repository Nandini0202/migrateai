import type { Category, Confidence, EdgeType, NodeKind } from './types';

export const GREEN = '#22ff88';
export const PURPLE = '#a855f7';
export const PURPLE_SOFT = '#c4b5fd';
export const MUTED = '#71717a';

export const KIND_LABEL: Record<NodeKind, string> = {
  entry: 'Entry point',
  route: 'Route',
  controller: 'Controller',
  service: 'Service',
  model: 'Model',
  database: 'Database',
  file: 'File',
};

export const EDGE_STYLE: Record<EdgeType, { color: string; label: string; dashed?: boolean }> = {
  registers_route: { color: PURPLE, label: 'registers route' },
  calls_service: { color: PURPLE, label: 'calls service' },
  uses_model: { color: GREEN, label: 'uses model' },
  connects_db: { color: GREEN, label: 'connects to database', dashed: true },
  imports: { color: '#52525b', label: 'imports' },
};

export const CATEGORY_CLASS: Record<Category, string> = {
  Dependencies: 'border-ink-500 text-zinc-300 bg-ink-800',
  Connection: 'border-neon/40 text-neon bg-neon-faint',
  Schema: 'border-neon/40 text-neon bg-neon-faint',
  Model: 'border-neon/40 text-neon bg-neon-faint',
  Queries: 'border-violet/40 text-violet-soft bg-violet-faint',
  Relationships: 'border-violet/40 text-violet-soft bg-violet-faint',
  'Database operations': 'border-violet/40 text-violet-soft bg-violet-faint',
};

export const CONFIDENCE_CLASS: Record<Confidence, string> = {
  high: 'text-neon',
  medium: 'text-violet-soft',
  low: 'text-zinc-500',
};

export const CATEGORIES: Category[] = [
  'Dependencies',
  'Connection',
  'Schema',
  'Model',
  'Queries',
  'Relationships',
  'Database operations',
];
