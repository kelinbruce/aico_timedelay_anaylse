import { getLogger, type AgentId, type AgentVersion, type SubjectId, type TenantId } from '@nextagent/agent-common';
import type {
  RagRetrievalChunk,
  RagRetrievalGateway,
  RagRetrievalReason,
  RagRetrievalRequest,
  RagRetrievalResult,
  RagRetrievalStatus,
  WorkflowRagRetrievalGateway,
} from '@nextagent/agent-contracts/gateway';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createLocalWorkflowRagGateway } from './local-workflow-rag-retrieval.js';

export interface LocalRagWorkspacePolicy {
  readonly readDirectories?: readonly string[];
  readonly maxTextBytes: number;
}

export interface LocalRagKnowledgeGovernanceOptions {
  readonly sqliteFile: string;
  readonly workspaceRoot: string;
  readonly workspacePolicy: LocalRagWorkspacePolicy;
  readonly tenantId: TenantId;
  readonly subjectId: SubjectId;
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
}

export interface LocalRagKnowledgeGovernance {
  readonly gateway: RagRetrievalGateway;
  readonly workflowGateway: WorkflowRagRetrievalGateway;
  build: (signal?: AbortSignal) => Promise<void>;
  cleanup: () => Promise<void>;
  close: () => void;
}

interface IndexedChunk {
  readonly chunkId: string;
  readonly content: string;
  readonly source: string;
  readonly fileType: string;
  readonly startLine: number;
  readonly endLine: number;
}

interface ChunkRow {
  readonly chunk_id: string;
  readonly content: string;
  readonly source: string;
  readonly file_type: string;
  readonly start_line: number;
  readonly end_line: number;
  readonly rank_score?: number;
}

const ragTableName = 'rag_temp_chunks';
const allowedExtensions = new Set(['.md', '.mdx', '.txt', '.json', '.yaml', '.yml', '.ts', '.tsx', '.js', '.jsx']);
const deniedDirectoryNames = new Set([
  '.git',
  '.nextagent',
  '.turbo',
  '.cache',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'data',
  'execution',
  'logs',
]);
const maxChunks = 5_000;
const maxChunksPerFile = 200;
const maxChunkChars = 3_000;
const logger = getLogger({ component: 'agent-platform-gateway-local', source: 'local-rag-governance' });
const maxChunkLines = 60;
const degradedStatus = 'DEGRADED' as const;

export function createLocalRagKnowledgeGovernance(options: LocalRagKnowledgeGovernanceOptions): LocalRagKnowledgeGovernance {
  const db = new DatabaseSync(options.sqliteFile);
  const workspaceRoot = realpathSync(resolve(options.workspaceRoot));
  let availability: { readonly status: 'READY' | 'UNAVAILABLE' | 'DEGRADED'; readonly reason?: RagRetrievalReason } = {
    status: 'UNAVAILABLE',
    reason: 'NO_INDEX',
  };
  let closed = false;

  // RAG data is intentionally temporary: cleanup drops the FTS table and makes retrieval explicit NO_INDEX.
  const cleanup = async (): Promise<void> => {
    if (closed) {
      return;
    }
    try {
      db.prepare(`DROP TABLE IF EXISTS ${ragTableName}`).run();
      availability = { status: 'UNAVAILABLE', reason: 'NO_INDEX' };
    } catch {
      availability = { status: degradedStatus, reason: 'EXECUTION_FAILED' };
    }
  };

  // Startup builds one governed snapshot from trusted workspace policy; request-time file changes do not rebuild it.
  const build = async (signal?: AbortSignal): Promise<void> => {
    const startedAt = Date.now();
    if (isSignalAborted(signal)) {
      availability = { status: 'UNAVAILABLE', reason: 'CANCELED' };
      logIndexBuildCompleted(availability, 0, startedAt);
      return;
    }
    try {
      await cleanup();
      db.prepare(
        `CREATE VIRTUAL TABLE ${ragTableName} USING fts5(
          chunk_id UNINDEXED,
          content,
          source UNINDEXED,
          file_type UNINDEXED,
          start_line UNINDEXED,
          end_line UNINDEXED
        )`,
      ).run();
      const chunks = collectChunks({
        workspaceRoot,
        policy: options.workspacePolicy,
        ...(signal === undefined ? {} : { signal }),
      });
      const insert = db.prepare(`INSERT INTO ${ragTableName}(chunk_id, content, source, file_type, start_line, end_line) VALUES (?, ?, ?, ?, ?, ?)`);
      db.prepare('BEGIN').run();
      try {
        for (const chunk of chunks) {
          insert.run(chunk.chunkId, chunk.content, chunk.source, chunk.fileType, chunk.startLine, chunk.endLine);
        }
        db.prepare('COMMIT').run();
      } catch (error) {
        db.prepare('ROLLBACK').run();
        throw error;
      }
      availability = { status: 'READY' };
      logIndexBuildCompleted(availability, chunks.length, startedAt);
    } catch {
      availability = isSignalAborted(signal) ? { status: 'UNAVAILABLE', reason: 'CANCELED' } : { status: 'UNAVAILABLE', reason: 'INDEX_NOT_READY' };
      logIndexBuildCompleted(availability, 0, startedAt);
    }
  };

  const gateway: RagRetrievalGateway = {
    async retrieve(request: RagRetrievalRequest, signal?: AbortSignal): Promise<RagRetrievalResult> {
      const startedAt = Date.now();
      const topK = clampTopK(request.options?.topK);
      if (isSignalAborted(signal)) {
        return completeRetrieval(retrievalResult('CANCELED', [], 'CANCELED'), request.indexes.length, topK, startedAt);
      }
      if (!matchesTrustedScope(options, request)) {
        return completeRetrieval(retrievalResult('FAILED', [], 'SCOPE_MISMATCH'), request.indexes.length, topK, startedAt);
      }
      if (availability.status !== 'READY') {
        const status = availability.status === 'DEGRADED' ? 'DEGRADED' : 'NO_INDEX';
        return completeRetrieval(retrievalResult(status, [], availability.reason ?? 'NO_INDEX'), request.indexes.length, topK, startedAt);
      }
      const expression = toFtsExpression(request.query);
      if (expression === undefined) {
        return completeRetrieval(retrievalResult('FAILED', [], 'INVALID_INPUT'), request.indexes.length, topK, startedAt);
      }
      try {
        const rows = db
          .prepare(
            `SELECT chunk_id, content, source, file_type, start_line, end_line, bm25(${ragTableName}) AS rank_score
           FROM ${ragTableName}
           WHERE content MATCH ?
           ORDER BY rank_score ASC
           LIMIT ?`,
          )
          .all(expression, topK) as unknown as ChunkRow[];
        const results = rows.map((row, index): RagRetrievalChunk => {
          const score = normalizeScore(row.rank_score);
          return {
            content: row.content,
            source: row.source,
            ...(score === undefined ? {} : { score }),
            rankHint: String(index + 1),
          };
        });
        return completeRetrieval({ status: 'OK', results }, request.indexes.length, topK, startedAt);
      } catch {
        return completeRetrieval(retrievalResult('FAILED', [], 'EXECUTION_FAILED'), request.indexes.length, topK, startedAt);
      }
    },
  };

  return {
    gateway,
    workflowGateway: createLocalWorkflowRagGateway(gateway),
    build,
    cleanup,
    close() {
      if (closed) {
        return;
      }
      try {
        db.prepare(`DROP TABLE IF EXISTS ${ragTableName}`).run();
      } finally {
        closed = true;
        db.close();
      }
    },
  };
}

// Scan only trusted workspace-relative read roots and keep the indexed chunk set bounded.
function collectChunks(input: {
  readonly workspaceRoot: string;
  readonly policy: LocalRagWorkspacePolicy;
  readonly signal?: AbortSignal;
}): readonly IndexedChunk[] {
  const roots =
    input.policy.readDirectories?.length === undefined || input.policy.readDirectories.length === 0 ? ['.'] : input.policy.readDirectories;
  const chunks: IndexedChunk[] = [];
  for (const root of roots) {
    if (isSignalAborted(input.signal) || chunks.length >= maxChunks) {
      break;
    }
    const physicalRoot = resolveWorkspaceRelative(input.workspaceRoot, root);
    if (physicalRoot === undefined || !existsSync(physicalRoot) || !statSync(physicalRoot).isDirectory()) {
      continue;
    }
    scanDirectory(input.workspaceRoot, physicalRoot, input.policy.maxTextBytes, chunks, input.signal);
  }
  return chunks.slice(0, maxChunks);
}

// Recursion deliberately skips symlinks and runtime/generated directories to avoid scope escape and noisy indexes.
function scanDirectory(workspaceRoot: string, directory: string, maxTextBytes: number, chunks: IndexedChunk[], signal?: AbortSignal): void {
  if (isSignalAborted(signal) || chunks.length >= maxChunks) {
    return;
  }
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (isSignalAborted(signal) || chunks.length >= maxChunks) {
      return;
    }
    if (entry.isSymbolicLink()) {
      continue;
    }
    const physicalPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!deniedDirectoryNames.has(entry.name)) {
        scanDirectory(workspaceRoot, physicalPath, maxTextBytes, chunks, signal);
      }
      continue;
    }
    if (!entry.isFile() || !allowedExtensions.has(extname(entry.name).toLowerCase())) {
      continue;
    }
    const relativePath = toWorkspaceRelative(workspaceRoot, physicalPath);
    if (relativePath === undefined || basename(relativePath).startsWith('.')) {
      continue;
    }
    chunks.push(...chunkFile(physicalPath, relativePath, maxTextBytes).slice(0, maxChunksPerFile));
  }
}

// Files are decoded as bounded UTF-8 text; binary-looking inputs are skipped instead of indexed.
function chunkFile(physicalPath: string, source: string, maxTextBytes: number): readonly IndexedChunk[] {
  const stats = lstatSync(physicalPath);
  if (!stats.isFile() || stats.size <= 0 || stats.size > maxTextBytes) {
    return [];
  }
  const bytes = readFileSync(physicalPath);
  if (bytes.includes(0)) {
    return [];
  }
  const text = bytes.toString('utf8').replace(/^\uFEFF/u, '');
  const lines = text.split(/\r?\n/u);
  const chunks: IndexedChunk[] = [];
  let startLine = 1;
  let pending: string[] = [];
  let pendingChars = 0;
  for (const line of lines) {
    const lineChars = line.length + 1;
    if (pending.length > 0 && (pending.length >= maxChunkLines || pendingChars + lineChars > maxChunkChars)) {
      chunks.push(toChunk(source, pending, startLine));
      startLine += pending.length;
      pending = [];
      pendingChars = 0;
    }
    pending.push(line);
    pendingChars += lineChars;
  }
  if (pending.length > 0) {
    chunks.push(toChunk(source, pending, startLine));
  }
  return chunks.filter((chunk) => chunk.content.trim().length > 0);
}

// The chunk id is stable for the same source, line window, and content.
function toChunk(source: string, lines: readonly string[], startLine: number): IndexedChunk {
  const content = lines.join('\n');
  const endLine = startLine + lines.length - 1;
  const hash = createHash('sha256').update(source).update('\0').update(String(startLine)).update('\0').update(content).digest('hex').slice(0, 16);
  return {
    chunkId: `${source}:${startLine}-${endLine}:${hash}`,
    content,
    source,
    fileType: extname(source).slice(1).toLowerCase() || 'text',
    startLine,
    endLine,
  };
}

function resolveWorkspaceRelative(workspaceRoot: string, candidate: string): string | undefined {
  if (candidate.trim().length === 0 || isAbsolute(candidate)) {
    return undefined;
  }
  const resolved = resolve(workspaceRoot, candidate);
  const relativePath = relative(workspaceRoot, resolved);
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    return undefined;
  }
  return resolved;
}

function toWorkspaceRelative(workspaceRoot: string, physicalPath: string): string | undefined {
  const real = realpathSync(physicalPath);
  const relativePath = relative(workspaceRoot, real);
  if (relativePath.length === 0 || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    return undefined;
  }
  return relativePath.replaceAll('\\', '/');
}

// User query text is converted into a simple quoted FTS expression; raw FTS syntax never crosses the public contract.
function toFtsExpression(query: string): string | undefined {
  const terms = [...query.matchAll(/[\p{L}\p{N}_-]+/gu)]
    .map((match) => match[0])
    .filter((term) => term.trim().length > 0)
    .slice(0, 16);
  if (terms.length === 0) {
    return undefined;
  }
  return terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(' OR ');
}

function clampTopK(value?: number): number {
  if (value === undefined) {
    return 5;
  }
  return Math.max(1, Math.min(10, Math.trunc(value)));
}

function retrievalResult(status: RagRetrievalStatus, results: readonly RagRetrievalChunk[], reason: RagRetrievalReason): RagRetrievalResult {
  return {
    status,
    results,
    diagnostics: { reason },
  };
}

function completeRetrieval(result: RagRetrievalResult, indexCount: number, topK: number, startedAt: number): RagRetrievalResult {
  logger.info({
    event: 'local_rag_retrieval_completed',
    status: result.status,
    resultCountBucket: countBucket(result.results.length),
    indexCountBucket: countBucket(indexCount),
    topK,
    ...(result.diagnostics?.reason === undefined ? {} : { reasonCode: result.diagnostics.reason }),
    durationMs: Math.max(0, Date.now() - startedAt),
  });
  return result;
}

function logIndexBuildCompleted(
  status: { readonly status: 'READY' | 'UNAVAILABLE' | 'DEGRADED'; readonly reason?: RagRetrievalReason },
  chunkCount: number,
  startedAt: number,
): void {
  logger.info({
    event: 'local_rag_index_build_completed',
    status: status.status,
    chunkCountBucket: countBucket(chunkCount),
    ...(status.reason === undefined ? {} : { reasonCode: status.reason }),
    durationMs: Math.max(0, Date.now() - startedAt),
  });
}

function countBucket(rawCount: number): '0' | '1' | '2-10' | '11-100' | '101+' {
  if (rawCount === 0) {
    return '0';
  }
  if (rawCount === 1) {
    return '1';
  }
  if (rawCount <= 10) {
    return '2-10';
  }
  if (rawCount <= 100) {
    return '11-100';
  }
  return '101+';
}

function matchesTrustedScope(options: LocalRagKnowledgeGovernanceOptions, request: RagRetrievalRequest): boolean {
  return (
    request.tenantId === options.tenantId &&
    request.subjectId === options.subjectId &&
    request.knowledgeScope.scopeKind === 'AGENT_WORKSPACE' &&
    request.knowledgeScope.logicalRoot === 'workspace'
  );
}

function normalizeScore(value?: number): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.min(1, 1 / (1 + Math.abs(value))));
}

function isSignalAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}
