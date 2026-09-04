import { brand, type AgentId, type KnowledgeSourceType, type LongTermMemoryState, type MemoryType, type SafeError } from '@nextagent/agent-common';
import { resolveAgentIdFromHeader } from '@nextagent/agent-channel-common';
import type {
  BatchCreateLongTermMemoryManagementCommand,
  CopyPublishedMemoryManagementCommand,
  DeleteLongTermMemoryManagementCommand,
  GetLongTermMemoryDetailManagementQuery,
  GetLongTermMemoryManagementQuery,
  ListLongTermMemoryManagementQuery,
  ListPublishedLongTermMemoryManagementQuery,
  LongTermMemoryManagementPort,
  LongTermMemoryManagementScope,
  LongTermMemoryManagementView,
  LongTermMemorySummaryManagementView,
  ManualSaveLongTermMemoryManagementCommand,
  MutateLongTermMemoryManagementCommand,
  PublishedLongTermMemoryManagementView,
  PublishLongTermMemoryManagementCommand,
  SaveLongTermMemoryManagementCommand,
  SearchLongTermMemoryManagementQuery,
  UnpublishLongTermMemoryManagementCommand,
} from '@nextagent/agent-contracts/channel';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Value } from '@sinclair/typebox/value';
import type { TSchema } from '@sinclair/typebox';
import { type ValueError, ValueErrorType } from '@sinclair/typebox/value';

import type { IdentityResolver } from '../auth/identity-context.js';
import {
  batchCreateLongTermMemoryBody,
  copyPublishedMemoryBody,
  deleteLongTermMemoryQuery,
  listLongTermMemoryQuery,
  listPublishedLongTermMemoryQuery,
  manualSaveLongTermMemoryBody,
  memoryInstanceQuery,
  mutateLongTermMemoryBody,
  saveLongTermMemoryBody,
  searchLongTermMemoryBody,
  sharingLongTermMemoryBody,
} from '../schemas/memory-dto.js';
import { WEB_QUERY_MEMORY_TEXT_MAX_CODE_POINTS } from '../schemas/validation-limits.js';

const DEFAULT_ROUTE_PREFIX = '/';
const API_SEGMENT = '/api/v1';
const MEMORY_PATH_SUFFIX = '/memory/long-term-mem';

interface RestResponse<T> {
  readonly errorCode: number;
  readonly errorMsg: string;
  readonly data: T;
}

export interface MemoryRouteDependencies {
  readonly management: LongTermMemoryManagementPort;
  readonly identityResolver: IdentityResolver;
  readonly defaultAgentId: AgentId;
  // Public path prefix P (default `/` = no prefix). `/api/v1` is fixed.
  readonly routePrefix?: string;
}

export function registerMemoryRoutes(instance: FastifyInstance, dependencies: MemoryRouteDependencies): void {
  const { management } = dependencies;
  const prefix = (dependencies.routePrefix ?? DEFAULT_ROUTE_PREFIX) === '/' ? '' : (dependencies.routePrefix ?? '');
  const BASE = `${prefix}${API_SEGMENT}${MEMORY_PATH_SUFFIX}`;

  instance.get(BASE, async (request, reply) => {
    const query = asRecord(request.query);
    if (!isValidMemoryQueryText(query)) {
      return invalidInput(reply, memoryQueryTextValidationMessage('memory list'));
    }
    if (!isValidInput(query, listLongTermMemoryQuery)) {
      return invalidInput(reply, formatMemoryErrors([...Value.Errors(listLongTermMemoryQuery, query)], 'memory list'));
    }
    const command = clean({
      ...resolveScope(request, dependencies),
      memoryInstance: asString(query.memoryInstance) ?? 'defaultInstance',
      queryText: asString(query.queryText),
      memoryType: asString(query.memoryType) as MemoryType | undefined,
      knowledgeSourceType: asString(query.knowledgeSourceType) as KnowledgeSourceType | undefined,
      state: asString(query.state) as LongTermMemoryState | undefined,
      isPinned: asBoolean(query.isPinned),
      minConfidence: asNumber(query.minConfidence),
      sinceTime: asNumber(query.sinceTime),
      untilTime: asNumber(query.untilTime),
      maxLastAccessedAt: asNumber(query.maxLastAccessedAt),
      labels: asString(query.labels),
      limit: asNumber(query.limit),
      offset: asNumber(query.offset),
    }) as ListLongTermMemoryManagementQuery;
    validateListQueryRange(query.limit, asNumber(query.offset), asNumber(query.minConfidence));
    return respond(
      request,
      reply,
      (signal) => management.listLongTermMemory(command, signal),
      (page) => ({
        items: page.items.map(projectSummary),
        total: page.total,
        offset: page.offset,
        limit: page.limit,
      }),
    );
  });

  instance.post(BASE, { config: { opLog: { prefix: 'MemoryController.saveLongTermMemory', level: 'MINOR' as const } } }, async (request, reply) => {
    const body = asRecord(request.body);
    if (!isValidInput(body, saveLongTermMemoryBody)) {
      return invalidInput(reply, formatMemoryErrors([...Value.Errors(saveLongTermMemoryBody, body)], 'memory save'));
    }
    const command = clean({
      ...resolveAuditedScope(request, dependencies),
      memoryId: asMemoryId(body.memoryId),
      memoryInstance: asString(body.memoryInstance) ?? 'defaultInstance',
      memoryType: asString(body.memoryType) as MemoryType,
      knowledgeSourceType: asString(body.knowledgeSourceType) as KnowledgeSourceType,
      briefIndex: asString(body.briefIndex) ?? '',
      content: asString(body.content) ?? '',
      labels: asStringArray(body.labels),
      confidence: asNumber(body.confidence) ?? 0,
      source: asString(body.source) ?? '',
    }) as SaveLongTermMemoryManagementCommand;
    const scope = scopeFromCommand(command);
    return respond(
      request,
      reply,
      (signal) => management.saveLongTermMemory(command, signal),
      (view) => projectMemory(scope, view),
    );
  });

  instance.post(
    `${BASE}/batch`,
    { config: { opLog: { prefix: 'MemoryController.batchCreateLongTermMemory', level: 'MINOR' as const } } },
    async (request, reply) => {
      const body = asRecord(request.body);
      if (!isValidInput(body, batchCreateLongTermMemoryBody)) {
        return invalidInput(reply, formatMemoryErrors([...Value.Errors(batchCreateLongTermMemoryBody, body)], 'memory batch create'));
      }
      const items = Array.isArray(body.items) ? body.items.map(asRecord) : [];
      const command = clean({
        ...resolveAuditedScope(request, dependencies),
        memoryInstance: asString(body.memoryInstance) ?? 'defaultInstance',
        items: items.map((item) =>
          clean({
            memoryId: asMemoryId(item.memoryId),
            memoryType: asString(item.memoryType) as MemoryType,
            knowledgeSourceType: asString(item.knowledgeSourceType) as KnowledgeSourceType,
            briefIndex: asString(item.briefIndex) ?? '',
            content: asString(item.content) ?? '',
            labels: asStringArray(item.labels),
            confidence: asNumber(item.confidence),
            source: asString(item.source),
            idempotencyKey: asString(item.idempotencyKey) as BatchCreateLongTermMemoryManagementCommand['items'][number]['idempotencyKey'],
            state: asString(item.state) as LongTermMemoryState | undefined,
            archiveReason: asString(item.archiveReason),
          }),
        ),
      }) as BatchCreateLongTermMemoryManagementCommand;
      return respond(
        request,
        reply,
        (signal) => management.batchCreateLongTermMemory(command, signal),
        (result) => result,
      );
    },
  );

  instance.post(
    `${BASE}/manual`,
    { config: { opLog: { prefix: 'MemoryController.manualSaveLongTermMemory', level: 'MINOR' as const } } },
    async (request, reply) => {
      const body = asRecord(request.body);
      if (!isValidInput(body, manualSaveLongTermMemoryBody)) {
        return invalidInput(reply, manualSaveValidationMessage(body));
      }
      const command = clean({
        ...resolveAuditedScope(request, dependencies),
        memoryId: asMemoryId(body.memoryId),
        memoryInstance: asString(body.memoryInstance) ?? 'defaultInstance',
        memoryType: asString(body.memoryType) as MemoryType,
        knowledgeSourceType: asString(body.knowledgeSourceType) as KnowledgeSourceType,
        briefIndex: asString(body.briefIndex) ?? '',
        content: asString(body.content) ?? '',
        labels: asStringArray(body.labels),
        confidence: asNumber(body.confidence) ?? Number.NaN,
      }) as ManualSaveLongTermMemoryManagementCommand;
      const scope = scopeFromCommand(command);
      return respond(
        request,
        reply,
        (signal) => management.manualSaveLongTermMemory(command, signal),
        (view) => projectMemory(scope, view),
      );
    },
  );

  instance.post(
    `${BASE}/search`,
    { config: { opLog: { prefix: 'MemoryController.searchMemory', level: 'MINOR' as const } } },
    async (request, reply) => {
      const body = asRecord(request.body);
      if (!isValidMemoryQueryText(body)) {
        return invalidInput(reply, memoryQueryTextValidationMessage('memory search'));
      }
      if (!isValidInput(body, searchLongTermMemoryBody)) {
        return invalidInput(reply, formatMemoryErrors([...Value.Errors(searchLongTermMemoryBody, body)], 'memory search'));
      }
      const command = clean({
        ...resolveAuditedScope(request, dependencies),
        memoryInstance: asString(body.memoryInstance) ?? 'defaultInstance',
        queryText: asString(body.queryText) ?? '',
        memoryType: asString(body.memoryType) as MemoryType | undefined,
        knowledgeSourceType: asString(body.knowledgeSourceType) as KnowledgeSourceType | undefined,
        minConfidence: asNumber(body.minConfidence) ?? 0,
        sinceTime: asNumber(body.sinceTime),
        untilTime: asNumber(body.untilTime),
        labels: asStringArray(body.labels),
        limit: asNumber(body.limit) ?? 10,
        offset: asNumber(body.offset) ?? 0,
      }) as SearchLongTermMemoryManagementQuery;
      validateListQueryRange(asNumber(body.limit), asNumber(body.offset), asNumber(body.minConfidence));
      return respond(
        request,
        reply,
        (signal) => management.searchLongTermMemory(command, signal),
        (page) => ({
          items: page.items.map((item) => ({
            summary: projectSummary(item.summary),
            score: item.score,
            relevanceScore: item.relevanceScore,
          })),
          total: page.total,
          offset: page.offset,
          limit: page.limit,
        }),
      );
    },
  );

  instance.get(`${BASE}/shared`, async (request, reply) => {
    const query = asRecord(request.query);
    if (!isValidMemoryQueryText(query)) {
      return invalidInput(reply, memoryQueryTextValidationMessage('memory shared'));
    }
    if (!isValidInput(query, listPublishedLongTermMemoryQuery)) {
      return invalidInput(reply, formatMemoryErrors([...Value.Errors(listPublishedLongTermMemoryQuery, query)], 'memory shared'));
    }
    const command = clean({
      ...resolveScope(request, dependencies),
      memoryInstance: asString(query.memoryInstance) ?? 'defaultInstance',
      queryText: asString(query.queryText),
      memoryType: asString(query.memoryType) as MemoryType | undefined,
      knowledgeSourceType: asString(query.knowledgeSourceType) as KnowledgeSourceType | undefined,
      labels: asString(query.labels),
      limit: asNumber(query.limit),
      offset: asNumber(query.offset),
    }) as ListPublishedLongTermMemoryManagementQuery;
    validateListQueryRange(query.limit, asNumber(query.offset), undefined);
    return respond(
      request,
      reply,
      (signal) => management.listPublishedLongTermMemory(command, signal),
      (page) => ({
        items: page.items.map(projectPublishedSummary),
        total: page.total,
        offset: page.offset,
        limit: page.limit,
      }),
    );
  });

  instance.post(
    `${BASE}/shared/copy`,
    { config: { opLog: { prefix: 'MemoryController.copyPublishedMemory', level: 'MINOR' as const } } },
    async (request, reply) => {
      const body = asRecord(request.body);
      if (!isValidInput(body, copyPublishedMemoryBody)) {
        return invalidInput(reply, formatMemoryErrors([...Value.Errors(copyPublishedMemoryBody, body)], 'memory copy'));
      }
      const memoryIds = asStringArray(body.memoryIds);
      if (memoryIds === undefined || memoryIds.length === 0) {
        return invalidInput(reply, 'memoryIds must be a non-empty array.');
      }
      const command = clean({
        ...resolveAuditedScope(request, dependencies),
        memoryInstance: asString(body.memoryInstance) ?? 'defaultInstance',
        memoryIds: memoryIds.map((id) => brand<string, 'LongTermMemoryId'>(id)),
        reasonCode: asString(body.reasonCode),
      }) as CopyPublishedMemoryManagementCommand;
      const scope = scopeFromCommand(command);
      return respond(
        request,
        reply,
        (signal) => management.copyPublishedMemory(command, signal),
        (result) =>
          result.results.map((item) => ({
            memoryId: item.memoryId,
            record: projectMemory(scope, item.record),
            sourceMemoryId: item.sourceMemoryId,
            copyStatus: item.copyStatus,
          })),
      );
    },
  );

  instance.get(`${BASE}/:memoryId/record`, async (request, reply) => {
    const query = asRecord(request.query);
    if (!isValidInput(query, memoryInstanceQuery)) {
      return invalidInput(reply, formatMemoryErrors([...Value.Errors(memoryInstanceQuery, query)], 'memory detail'));
    }
    const command = {
      ...resolveScope(request, dependencies),
      memoryId: memoryIdFromParams(request),
      memoryInstance: asString(query.memoryInstance) ?? 'defaultInstance',
    } satisfies GetLongTermMemoryManagementQuery;
    const scope = scopeFromCommand(command);
    return respond(
      request,
      reply,
      (signal) => management.getLongTermMemory(command, signal),
      (view) => projectMemory(scope, view),
    );
  });

  instance.get(`${BASE}/:memoryId`, async (request, reply) => {
    const query = asRecord(request.query);
    if (!isValidInput(query, memoryInstanceQuery)) {
      return invalidInput(reply, formatMemoryErrors([...Value.Errors(memoryInstanceQuery, query)], 'memory detail'));
    }
    const command = {
      ...resolveScope(request, dependencies),
      memoryId: memoryIdFromParams(request),
      memoryInstance: asString(query.memoryInstance) ?? 'defaultInstance',
    } satisfies GetLongTermMemoryDetailManagementQuery;
    const scope = scopeFromCommand(command);
    return respond(
      request,
      reply,
      (signal) => management.getLongTermMemoryDetail(command, signal),
      (view) => projectMemory(scope, view),
    );
  });

  instance.delete(
    `${BASE}/:memoryId`,
    { config: { opLog: { prefix: 'MemoryController.deleteLongTermMemory', level: 'RISK' as const, detailParams: ['params.memoryId'] } } },
    async (request, reply) => {
      const query = asRecord(request.query);
      if (!isValidInput(query, deleteLongTermMemoryQuery)) {
        return invalidInput(reply, formatMemoryErrors([...Value.Errors(deleteLongTermMemoryQuery, query)], 'memory delete'));
      }
      const command = clean({
        ...resolveAuditedScope(request, dependencies),
        memoryId: memoryIdFromParams(request),
        memoryInstance: asString(query.memoryInstance) ?? 'defaultInstance',
        reasonCode: asString(query.reasonCode),
      }) as DeleteLongTermMemoryManagementCommand;
      return respond(
        request,
        reply,
        (signal) => management.deleteLongTermMemory(command, signal),
        (result) => ({ memoryId: result.memoryId }),
      );
    },
  );

  instance.patch(
    `${BASE}/:memoryId`,
    { config: { opLog: { prefix: 'MemoryController.mutateLongTermMemory', level: 'MINOR' as const, detailParams: ['params.memoryId'] } } },
    async (request, reply) => {
      const body = asRecord(request.body);
      if (!isValidInput(body, mutateLongTermMemoryBody)) {
        return invalidInput(reply, formatMemoryErrors([...Value.Errors(mutateLongTermMemoryBody, body)], 'memory mutate'));
      }
      const expectedVersion = asNumber(body.expectedVersion);
      const command = clean({
        ...resolveAuditedScope(request, dependencies),
        memoryId: memoryIdFromParams(request),
        memoryInstance: asString(body.memoryInstance) ?? 'defaultInstance',
        targetState: asString(body.targetState) as LongTermMemoryState | undefined,
        archiveReason: asString(body.archiveReason),
        delta: asNumber(body.delta),
        lastAccessTime: asNumber(body.lastAccessTime),
        isPinned: asBoolean(body.isPinned),
        writeOptions: expectedVersion === undefined ? undefined : { expectedVersion },
      }) as MutateLongTermMemoryManagementCommand;
      const scope = scopeFromCommand(command);
      return respond(
        request,
        reply,
        (signal) => management.mutateLongTermMemory(command, signal),
        (result) =>
          clean({
            status: result.status,
            memoryId: result.memoryId,
            currentVersion: result.currentVersion,
            record: result.record === undefined ? undefined : projectMemory(scope, result.record),
          }),
      );
    },
  );

  instance.post(
    `${BASE}/:memoryId/publish`,
    { config: { opLog: { prefix: 'MemoryController.publishLongTermMemory', level: 'MINOR' as const, detailParams: ['params.memoryId'] } } },
    async (request, reply) => {
      const body = asRecord(request.body);
      if (!isValidInput(body, sharingLongTermMemoryBody)) {
        return invalidInput(reply, formatMemoryErrors([...Value.Errors(sharingLongTermMemoryBody, body)], 'memory publish'));
      }
      const command = clean({
        ...resolveAuditedScope(request, dependencies),
        memoryId: memoryIdFromParams(request),
        memoryInstance: asString(body.memoryInstance) ?? 'defaultInstance',
        reasonCode: asString(body.reasonCode),
      }) as PublishLongTermMemoryManagementCommand;
      const scope = scopeFromCommand(command);
      return respond(
        request,
        reply,
        (signal) => management.publishLongTermMemory(command, signal),
        (result) => ({
          publishedMemory: projectMemory(scope, result.publishedMemory),
          sourceMemoryId: result.sourceMemoryId,
          ownerUserId: result.ownerSubjectId,
        }),
      );
    },
  );

  instance.post(
    `${BASE}/:memoryId/unpublish`,
    { config: { opLog: { prefix: 'MemoryController.unpublishLongTermMemory', level: 'MINOR' as const, detailParams: ['params.memoryId'] } } },
    async (request, reply) => {
      const body = asRecord(request.body);
      if (!isValidInput(body, sharingLongTermMemoryBody)) {
        return invalidInput(reply, formatMemoryErrors([...Value.Errors(sharingLongTermMemoryBody, body)], 'memory unpublish'));
      }
      const command = clean({
        ...resolveAuditedScope(request, dependencies),
        memoryId: memoryIdFromParams(request),
        memoryInstance: asString(body.memoryInstance) ?? 'defaultInstance',
        reasonCode: asString(body.reasonCode),
      }) as UnpublishLongTermMemoryManagementCommand;
      return respond(
        request,
        reply,
        (signal) => management.unpublishLongTermMemory(command, signal),
        (result) => ({ memoryId: result.memoryId }),
      );
    },
  );
}

async function respond<TResult, TBody>(
  request: FastifyRequest,
  reply: FastifyReply,
  operation: (signal: AbortSignal) => Promise<TResult | SafeError>,
  project: (result: TResult) => TBody,
): Promise<RestResponse<TBody> | FastifyReply> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.raw.on('aborted', abort);
  reply.raw.on('close', abort);
  try {
    const result = await operation(controller.signal);
    return isSafeError(result) ? sendSafeError(reply, result) : ok(project(result));
  } catch (err) {
    if (err instanceof RangeError) {
      return reply.status(400).send({ code: 'LTM_QUERY_INVALID', message: err.message, retryable: false });
    }
    return sendSafeError(reply, unavailableError());
  } finally {
    request.raw.off('aborted', abort);
    reply.raw.off('close', abort);
  }
}

function resolveScope(request: FastifyRequest, dependencies: MemoryRouteDependencies): LongTermMemoryManagementScope {
  return {
    identityContext: dependencies.identityResolver(request),
    agentId: resolveAgentIdFromHeader(request, dependencies.defaultAgentId),
  };
}

function resolveAuditedScope(request: FastifyRequest, dependencies: MemoryRouteDependencies): LongTermMemoryManagementScope {
  const scope = resolveScope(request, dependencies);
  (request as FastifyRequest & { opLogIdentity?: ReturnType<IdentityResolver> }).opLogIdentity = scope.identityContext;
  return scope;
}

function scopeFromCommand(command: LongTermMemoryManagementScope): LongTermMemoryManagementScope {
  return { identityContext: command.identityContext, agentId: command.agentId };
}

function memoryIdFromParams(request: FastifyRequest) {
  return brand<string, 'LongTermMemoryId'>((request.params as { readonly memoryId: string }).memoryId);
}

function projectMemory(scope: LongTermMemoryManagementScope, view: LongTermMemoryManagementView): Record<string, unknown> {
  return {
    memoryId: view.memoryId,
    tenantId: scope.identityContext.tenantId,
    userId: scope.identityContext.subjectId,
    agentId: scope.agentId,
    memoryInstance: view.memoryInstance,
    memoryType: view.memoryType,
    knowledgeSourceType: view.knowledgeSourceType,
    sharingState: view.sharingState,
    ...(view.sourceMemoryId === undefined ? {} : { sourceMemoryId: view.sourceMemoryId }),
    state: view.state,
    briefIndex: view.briefIndex,
    content: view.content,
    labels: view.labels,
    confidence: view.confidence,
    version: view.version,
    accessCount: view.accessCount,
    recallCount: view.recallCount,
    extractionCount: view.extractionCount,
    ...(view.lastAccessedAt === undefined ? {} : { lastAccessedAt: view.lastAccessedAt }),
    archivedAt: view.archivedAt,
    archiveReason: view.archiveReason,
    isPinned: view.isPinned,
    source: view.source,
    createTime: view.createTime,
    updateTime: view.updateTime,
  };
}

function projectSummary(summary: LongTermMemorySummaryManagementView): Record<string, unknown> {
  return { ...summary };
}

function projectPublishedSummary(summary: PublishedLongTermMemoryManagementView): Record<string, unknown> {
  return {
    ...projectSummary(summary),
    sourceMemoryId: summary.sourceMemoryId,
    ownerUserId: summary.ownerSubjectId,
    ...(summary.ownerUserName === undefined ? {} : { ownerUserName: summary.ownerUserName }),
  };
}

function ok<T>(data: T): RestResponse<T> {
  return { errorCode: 0, errorMsg: 'SUCCESS', data };
}

function isSafeError(value: unknown): value is SafeError {
  return value !== null && typeof value === 'object' && 'code' in value && 'category' in value && 'retryable' in value;
}

function sendSafeError(reply: FastifyReply, error: SafeError): FastifyReply {
  return reply.status(errorStatus(error)).send({ code: error.code, message: error.message, retryable: error.retryable });
}

function errorStatus(error: SafeError): number {
  if (error.code === 'LTM_MEMORY_NOT_FOUND' || error.category === 'NOT_FOUND') {
    return 404;
  }
  if (error.code === 'LTM_STORAGE_UNAVAILABLE') {
    return 500;
  }
  if (error.category === 'UNAVAILABLE') {
    return 503;
  }
  return 400;
}

function invalidInput(reply: FastifyReply, message = 'Request contains unsupported fields.'): FastifyReply {
  return reply.status(400).send({ code: 'LTM_QUERY_INVALID', message, retryable: false });
}

function formatMemoryErrors(errors: readonly ValueError[], prefix: string): string {
  const first = errors[0];
  if (!first) {
    return `${prefix} request contains unsupported fields.`;
  }
  const field = first.path?.replace(/^\//, '').replace(/\//g, '.') || 'body';
  switch (first.type) {
    case ValueErrorType.ObjectRequiredProperty:
      return `${prefix} ${field} is required.`;
    case ValueErrorType.StringMinLength:
      return `${prefix} ${field} must not be empty.`;
    case ValueErrorType.StringMaxLength:
      return `${prefix} ${field} must not exceed ${first.schema?.maxLength} characters.`;
    case ValueErrorType.StringPattern:
      return `${prefix} ${field} format is invalid.`;
    case ValueErrorType.Union:
      return `${prefix} ${field} value is not allowed.`;
    case ValueErrorType.NumberMinimum:
      return `${prefix} ${field} must be at least ${first.schema?.minimum}.`;
    case ValueErrorType.NumberMaximum:
      return `${prefix} ${field} must not exceed ${first.schema?.maximum}.`;
    case ValueErrorType.ObjectAdditionalProperties:
      return `${prefix} field '${first.path?.split('/').pop()}' is not allowed.`;
    case ValueErrorType.ArrayMinItems:
      return `${prefix} ${field} must contain at least ${first.schema?.minItems} item(s).`;
    case ValueErrorType.ArrayMaxItems:
      return `${prefix} ${field} must not exceed ${first.schema?.maxItems} items.`;
    default:
      return `${prefix} ${field} validation failed.`;
  }
}

const MEMORY_LIST_MAX_LIMIT = 10000;

/** Validate list/query range constraints that schema-level Union types cannot fully enforce. */
function validateListQueryRange(limit: unknown, offset?: number, minConfidence?: number): void {
  // Accept the raw query value (string | number | undefined) so that non-numeric strings
  // like "abc" are caught here rather than silently converted to undefined by asNumber.
  const limitNum = typeof limit === 'number' ? limit : asNumber(limit);
  if (limit !== undefined && limitNum === undefined) {
    throw new RangeError('limit must be a positive integer.');
  }
  if (limitNum !== undefined && limitNum < 1) {
    throw new RangeError('limit must be a positive integer.');
  }
  if (limitNum !== undefined && limitNum > MEMORY_LIST_MAX_LIMIT) {
    throw new RangeError(`limit must not exceed ${MEMORY_LIST_MAX_LIMIT}.`);
  }
  if (offset !== undefined && offset < 0) {
    throw new RangeError(`memory offset must be a non-negative integer.`);
  }
  if (minConfidence !== undefined && (minConfidence < 0 || minConfidence > 1)) {
    throw new RangeError(`memory minConfidence must be between 0 and 1.`);
  }
}

function manualSaveValidationMessage(body: Readonly<Record<string, unknown>>): string {
  if (Array.isArray(body.labels) && body.labels.length > 10) {
    return 'At most 10 labels are allowed.';
  }
  if (typeof body.briefIndex !== 'string' || body.briefIndex.length === 0 || body.briefIndex.length > 2048) {
    return 'briefIndex must contain 1 to 2048 characters.';
  }
  if (typeof body.content !== 'string' || body.content.length === 0 || body.content.length > 4000) {
    return 'content must contain 1 to 4000 characters.';
  }
  if (Array.isArray(body.labels) && body.labels.some((label) => typeof label !== 'string' || label.length === 0 || label.length > 256)) {
    return 'Each label must contain 1 to 256 characters.';
  }
  return 'Manual memory request is invalid.';
}

function unavailableError(): SafeError {
  return {
    code: 'LTM_STORAGE_UNAVAILABLE',
    message: 'Long-term memory is temporarily unavailable.',
    category: 'UNAVAILABLE',
    retryable: true,
  };
}

function isValidInput(value: Readonly<Record<string, unknown>>, schema: TSchema): boolean {
  return Value.Check(schema, value);
}

function isValidMemoryQueryText(value: Readonly<Record<string, unknown>>): boolean {
  const queryText = asString(value.queryText);
  return queryText === undefined || [...queryText].length <= WEB_QUERY_MEMORY_TEXT_MAX_CODE_POINTS;
}

function memoryQueryTextValidationMessage(prefix: string): string {
  return `${prefix} queryText must not exceed ${WEB_QUERY_MEMORY_TEXT_MAX_CODE_POINTS} characters.`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return undefined;
}

function asStringArray(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined;
}

function asMemoryId(value: unknown) {
  const memoryId = asString(value);
  return memoryId === undefined ? undefined : brand<string, 'LongTermMemoryId'>(memoryId);
}

function clean<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
