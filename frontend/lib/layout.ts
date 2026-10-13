import dagre from '@dagrejs/dagre';

export const NODE_WIDTH = 230;
export const NODE_HEIGHT = 84;

export interface Position {
  x: number;
  y: number;
}

/** Top-to-bottom layered layout: importers above the files they depend on. */
export function layoutGraph(ids: string[], links: [string, string][]): Record<string, Position> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 90 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const id of ids) g.setNode(id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const [source, target] of links) g.setEdge(source, target);
  dagre.layout(g);

  const positions: Record<string, Position> = {};
  for (const id of ids) {
    const n = g.node(id);
    positions[id] = { x: n.x - NODE_WIDTH / 2, y: n.y - NODE_HEIGHT / 2 };
  }
  return positions;
}
