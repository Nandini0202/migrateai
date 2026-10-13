// Shared JSON contract between the analyzer, the FastAPI backend and the dashboard.

export type Category =
  | 'Dependencies'
  | 'Connection'
  | 'Schema'
  | 'Model'
  | 'Queries'
  | 'Relationships'
  | 'Database operations';

export type Confidence = 'high' | 'medium' | 'low';

export interface Finding {
  file: string; // repo-relative, forward slashes
  line: number;
  column: number;
  category: Category;
  pattern: string; // what was matched, e.g. "User.find()"
  evidence: string; // the source line
  confidence: Confidence;
  detail?: string; // e.g. model name or referenced model
}

export type NodeKind = 'entry' | 'route' | 'controller' | 'service' | 'model' | 'database' | 'file';
export type EdgeType = 'imports' | 'registers_route' | 'calls_service' | 'uses_model' | 'connects_db';
export type Impact = 'direct' | 'indirect' | 'none';

export interface GraphNode {
  id: string; // repo-relative path
  label: string; // file name
  path: string;
  kind: NodeKind;
  mongo: boolean; // contains MongoDB/Mongoose code
  impact: Impact; // direct = has Mongo code, indirect = depends on a file that does
  categories: Category[];
  findingCount: number;
  models: string[]; // Mongoose model names defined in this file
}

export interface GraphEdge {
  id: string;
  source: string; // the importing file
  target: string; // the imported file
  type: EdgeType;
  label?: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  // model file -> files that (transitively) depend on it, nearest first
  impact: Record<string, string[]>;
}

export interface AffectedFile {
  file: string;
  kind: NodeKind;
  findingCount: number;
  categories: Category[];
}

export interface Summary {
  filesScanned: number;
  filesWithFindings: number;
  totalFindings: number;
  byCategory: Record<string, number>;
  byConfidence: Record<string, number>;
  modelCount: number;
  models: string[];
  driver: 'mongoose' | 'mongodb' | 'both' | 'none';
  parseFailures: number;
  truncated: boolean;
  nodeCount: number;
  edgeCount: number;
  durationMs: number;
}

export interface AnalysisResult {
  summary: Summary;
  findings: Finding[];
  affectedFiles: AffectedFile[];
  graph: Graph | null;
  warnings: string[];
}

// ---- internal types ----

export interface ImportRef {
  specifier: string;
  kind: 'import' | 'require' | 'dynamic' | 'export-from';
  line: number;
  column: number;
}

export interface Binding {
  local: string;
  source: string;
  imported: string; // 'default' | '*' | named export
  line: number;
}

export interface CallCandidate {
  rootName: string | null;
  rootText: string;
  methods: string[];
  opIndex: number;
  op: string;
  category: 'Queries' | 'Database operations' | 'Relationships';
  line: number;
  column: number;
  evidence: string;
  hints: string[];
  viaModelCall: boolean;
}

export interface Registration {
  kind: 'use' | 'handler';
  binding: string | null;
  specifier: string | null;
  path: string | null;
  method: string | null;
  line: number;
}

export interface FileAnalysis {
  path: string;
  imports: ImportRef[];
  bindings: Binding[];
  findings: Finding[];
  candidates: CallCandidate[];
  registrations: Registration[];
  localModels: Record<string, string>;
  docVars: Record<string, string>;
  flags: { listen: boolean; expressCall: boolean; routerCall: boolean; routeCalls: number };
  usesMongoLib: boolean;
  models: string[];
  dynamicImports: number;
  parseError?: string;
}
