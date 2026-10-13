// Detection rules and scan limits. These are evidence patterns, not proof of MongoDB usage.

export const MONGO_PACKAGES = ['mongoose', 'mongodb'] as const;

// Mongoose / driver query-style methods.
export const QUERY_METHODS = new Set([
  'find',
  'findOne',
  'findById',
  'findOneAndUpdate',
  'findOneAndDelete',
  'findOneAndReplace',
  'findByIdAndUpdate',
  'findByIdAndDelete',
  'findByIdAndRemove',
  'save',
  'create',
  'exists',
]);

// Write / aggregate operations typical of the native driver and Mongoose models.
export const DB_OP_METHODS = new Set([
  'insertOne',
  'insertMany',
  'updateOne',
  'updateMany',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'bulkWrite',
  'aggregate',
  'distinct',
  'countDocuments',
  'estimatedDocumentCount',
]);

export const FIND_FAMILY = new Set([
  'find',
  'findOne',
  'findById',
  'findOneAndUpdate',
  'findOneAndDelete',
  'findByIdAndUpdate',
  'findByIdAndDelete',
]);

// Chain methods that are strongly Mongoose-flavoured when combined with find*.
export const MONGOOSE_CHAIN_HINTS = new Set(['populate', 'lean', 'exec']);

export const ROUTE_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'all']);

export const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  'out',
  'vendor',
  '__pycache__',
  'venv',
]);

export const SOURCE_EXTS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);

export const GENERATED_PATTERNS = [/\.min\.js$/, /\.bundle\.js$/, /\.d\.ts$/, /\.chunk\.js$/];

export const LIMITS = {
  maxFiles: 5000,
  maxFileBytes: 1_000_000,
  maxTotalBytes: 100_000_000,
  timeMs: 60_000,
  maxGraphNodes: 400,
};

// Last-resort line patterns for files that cannot be parsed. Always low confidence.
export const FALLBACK_PATTERNS: { category: string; pattern: string; regex: RegExp }[] = [
  { category: 'Dependencies', pattern: "require/import 'mongoose' or 'mongodb'", regex: /(?:require\(\s*|from\s+)['"](?:mongoose|mongodb)['"]/ },
  { category: 'Connection', pattern: 'mongoose.connect()', regex: /\bmongoose\.(?:connect|createConnection)\s*\(/ },
  { category: 'Connection', pattern: 'MongoClient', regex: /\bMongoClient\b/ },
  { category: 'Schema', pattern: 'new Schema()', regex: /\bnew\s+(?:mongoose\.)?Schema\s*\(/ },
  { category: 'Model', pattern: 'mongoose.model()', regex: /\bmongoose\.model\s*\(/ },
  { category: 'Relationships', pattern: 'populate()', regex: /\.populate\s*\(/ },
];
