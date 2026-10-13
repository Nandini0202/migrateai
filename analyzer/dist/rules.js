"use strict";
// Detection rules and scan limits. These are evidence patterns, not proof of MongoDB usage.
Object.defineProperty(exports, "__esModule", { value: true });
exports.FALLBACK_PATTERNS = exports.LIMITS = exports.GENERATED_PATTERNS = exports.SOURCE_EXTS = exports.SKIP_DIRS = exports.ROUTE_METHODS = exports.MONGOOSE_CHAIN_HINTS = exports.FIND_FAMILY = exports.DB_OP_METHODS = exports.QUERY_METHODS = exports.MONGO_PACKAGES = void 0;
exports.MONGO_PACKAGES = ['mongoose', 'mongodb'];
// Mongoose / driver query-style methods.
exports.QUERY_METHODS = new Set([
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
exports.DB_OP_METHODS = new Set([
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
exports.FIND_FAMILY = new Set([
    'find',
    'findOne',
    'findById',
    'findOneAndUpdate',
    'findOneAndDelete',
    'findByIdAndUpdate',
    'findByIdAndDelete',
]);
// Chain methods that are strongly Mongoose-flavoured when combined with find*.
exports.MONGOOSE_CHAIN_HINTS = new Set(['populate', 'lean', 'exec']);
exports.ROUTE_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'all']);
exports.SKIP_DIRS = new Set([
    'node_modules',
    'dist',
    'build',
    'coverage',
    'out',
    'vendor',
    '__pycache__',
    'venv',
]);
exports.SOURCE_EXTS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
exports.GENERATED_PATTERNS = [/\.min\.js$/, /\.bundle\.js$/, /\.d\.ts$/, /\.chunk\.js$/];
exports.LIMITS = {
    maxFiles: 5000,
    maxFileBytes: 1000000,
    maxTotalBytes: 100000000,
    timeMs: 60000,
    maxGraphNodes: 400,
};
// Last-resort line patterns for files that cannot be parsed. Always low confidence.
exports.FALLBACK_PATTERNS = [
    { category: 'Dependencies', pattern: "require/import 'mongoose' or 'mongodb'", regex: /(?:require\(\s*|from\s+)['"](?:mongoose|mongodb)['"]/ },
    { category: 'Connection', pattern: 'mongoose.connect()', regex: /\bmongoose\.(?:connect|createConnection)\s*\(/ },
    { category: 'Connection', pattern: 'MongoClient', regex: /\bMongoClient\b/ },
    { category: 'Schema', pattern: 'new Schema()', regex: /\bnew\s+(?:mongoose\.)?Schema\s*\(/ },
    { category: 'Model', pattern: 'mongoose.model()', regex: /\bmongoose\.model\s*\(/ },
    { category: 'Relationships', pattern: 'populate()', regex: /\.populate\s*\(/ },
];
