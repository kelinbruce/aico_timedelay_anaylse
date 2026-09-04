import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  brand,
  deriveCapabilityInvocationIdempotencyKey,
  getLogger,
  type JsonObject,
  type JsonValue,
  type RunStatus,
  type TimelineEventType,
} from '@nextagent/agent-common';
import type { RequestRunRecord, RunTimelineEventRecord, SessionMessageRecord, SessionRecord } from '@nextagent/agent-contracts/gateway';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  actionDetailSchema,
  agentPageSchema,
  agentQuerySchema,
  conversationQuerySchema,
  conversationSchema,
  graphSchema,
  logEvidenceSchema,
  logQuerySchema,
  runPageSchema,
  runQuerySchema,
  sessionPageSchema,
  sessionQuerySchema,
} from './http-schemas.js';
import {
  arrayStringValues,
  boundedSingleLine,
  detailPayload,
  isJsonObject,
  payloadSummary,
  safePayloadRefs,
  stringValues,
  uniqueStrings,
} from './safe-payload-projection.js';
import { renderWorkbenchLauncherScript, renderWorkbenchPage, sendWorkbenchAsset } from './workbench-http-assets.js';

export const agentDevWorkbenchBasePath = '/__nextagent/dev/workbench' as const;
export const agentDevWorkbenchLauncherScriptPath = `${agentDevWorkbenchBasePath}/launcher.js` as const;
const workbenchLauncherElementName = 'nextagent-dev-workbench-launcher';
const logger = getLogger({ component: 'agent-dev-workbench', source: 'sqlite-read-port' });

type WorkbenchSqliteReadOperation =
  | 'list_agent_session_counts'
  | 'list_sessions'
  | 'list_conversation'
  | 'list_runs'
  | 'project_subagent_child_links'
  | 'load_inspection_messages'
  | 'load_timeline_events';

export interface AgentDevWorkbenchRegistrationOptions {
  readonly readPort: AgentDevWorkbenchLocalReadPort;
  readonly resolveAccessScope: (request: FastifyRequest) => Promise<AgentDevWorkbenchAccessScope> | AgentDevWorkbenchAccessScope;
  readonly developerDiagnosticArtifactStatus?: () => AgentDevWorkbenchDeveloperDiagnosticArtifactStatus;
}

export interface AgentDevWorkbenchDeveloperDiagnosticArtifactStatus {
  readonly availability: 'DISABLED' | 'AVAILABLE' | 'DEGRADED';
  readonly droppedCount: number;
  readonly lastFailureCode?: 'INVALID_RECORD' | 'RECORD_TOO_LARGE' | 'QUEUE_OVERLOADED' | 'OUTPUT_UNAVAILABLE';
}

export interface AgentDevWorkbenchAccessScope {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly allowedAgentIds: readonly string[];
}

export interface AgentDevWorkbenchLocalReadPort {
  listAgents: (scope: AgentDevWorkbenchAccessScope) => Promise<AgentDevWorkbenchAgentPage>;
  listSessions: (scope: AgentDevWorkbenchAccessScope, query: AgentDevWorkbenchSessionQuery) => Promise<AgentDevWorkbenchSessionPage>;
  listConversation: (scope: AgentDevWorkbenchAccessScope, query: AgentDevWorkbenchConversationQuery) => Promise<AgentDevWorkbenchConversationView>;
  listRuns: (scope: AgentDevWorkbenchAccessScope, query: AgentDevWorkbenchRunQuery) => Promise<AgentDevWorkbenchRunPage>;
  getRunGraph: (scope: AgentDevWorkbenchAccessScope, query: AgentDevWorkbenchRunLookup) => Promise<AgentDevWorkbenchGraphView>;
  getActionDetail: (scope: AgentDevWorkbenchAccessScope, query: AgentDevWorkbenchActionDetailQuery) => Promise<AgentDevWorkbenchActionDetail>;
  listLogEvidence: (scope: AgentDevWorkbenchAccessScope, query: AgentDevWorkbenchLogEvidenceQuery) => Promise<AgentDevWorkbenchLogEvidenceView>;
}

export interface AgentDevWorkbenchAgentPage {
  readonly entries: readonly AgentDevWorkbenchAgentEntry[];
  readonly detailAvailability: AgentDevWorkbenchDetailAvailability;
}

export interface AgentDevWorkbenchAgentEntry {
  readonly agentId: string;
  readonly agentVersion?: string;
  readonly agentAssemblyRef?: string;
  readonly displayName?: string;
  readonly description?: string;
  readonly sourceKind?: string;
  readonly agentInvocation?: string;
  readonly kind: 'agent' | 'subagent' | 'historical';
  readonly userInvocable?: boolean;
  readonly parentAgentScope?: JsonObject;
  readonly sessionCount: number;
  readonly configuration?: JsonObject;
  readonly configurationAvailability: AgentDevWorkbenchDetailAvailability;
}

export interface AgentDevWorkbenchSessionQuery {
  readonly agentId?: string;
  readonly sessionId?: string;
  readonly requestRunId?: string;
  readonly limit?: number;
}

export interface AgentDevWorkbenchConversationQuery {
  readonly sessionId: string;
  readonly requestRunId: string;
  readonly agentId?: string;
  readonly limit?: number;
}

export interface AgentDevWorkbenchRunQuery {
  readonly agentId?: string;
  readonly sessionId?: string;
  readonly requestRunId?: string;
  readonly limit?: number;
}

export interface AgentDevWorkbenchRunLookup {
  readonly requestRunId: string;
  readonly agentId?: string;
}

export interface AgentDevWorkbenchActionDetailQuery extends AgentDevWorkbenchRunLookup {
  readonly actionId: string;
}

export interface AgentDevWorkbenchLogEvidenceQuery extends AgentDevWorkbenchRunLookup {
  readonly requestId?: string;
  readonly sessionId?: string;
  readonly agentVersion?: string;
  readonly requestContextId?: string;
  readonly capabilityInvocationId?: string;
  readonly fromEpochMillis?: number;
  readonly toEpochMillis?: number;
  readonly limit?: number;
}

export interface AgentDevWorkbenchSessionPage {
  readonly entries: readonly AgentDevWorkbenchSessionEntry[];
  readonly detailAvailability: AgentDevWorkbenchDetailAvailability;
}

export interface AgentDevWorkbenchSessionEntry {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly agentId: string;
  readonly sessionId: string;
  readonly title?: string;
  readonly parentSessionId?: string;
  readonly parentRunId?: string;
  readonly parentRequestId?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly latestRunStatus?: RunStatus;
}

export interface AgentDevWorkbenchConversationView {
  readonly sessionId: string;
  readonly messages: readonly AgentDevWorkbenchMessageEntry[];
  readonly detailAvailability: AgentDevWorkbenchDetailAvailability;
}

export interface AgentDevWorkbenchMessageEntry {
  readonly messageId: string;
  readonly requestId: string;
  readonly runId?: string;
  readonly role: string;
  readonly contentType: string;
  readonly content: string;
  readonly metadata?: JsonObject;
  readonly visible: boolean;
  readonly createdAt: number;
}

export interface AgentDevWorkbenchRunPage {
  readonly entries: readonly AgentDevWorkbenchRunEntry[];
  readonly detailAvailability: AgentDevWorkbenchDetailAvailability;
}

export interface AgentDevWorkbenchRunEntry {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly agentId: string;
  readonly agentVersion: string;
  readonly sessionId: string;
  readonly requestId: string;
  readonly runId: string;
  readonly agentAssemblyRef: string;
  readonly attempt: number;
  readonly parentRunId?: string;
  readonly parentRequestId?: string;
  readonly status: RunStatus;
  readonly terminalCommitState: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly rootMessageSummary?: string;
}

export type AgentDevWorkbenchActionType =
  | 'request'
  | 'scheduler'
  | 'context'
  | 'context_compaction'
  | 'model'
  | 'capability'
  | 'subagent'
  | 'hook'
  | 'policy'
  | 'gateway'
  | 'stream'
  | 'terminal';

export interface AgentDevWorkbenchGraphView {
  readonly requestRunId: string;
  readonly nodes: readonly AgentDevWorkbenchGraphNode[];
  readonly edges: readonly AgentDevWorkbenchGraphEdge[];
  readonly effectiveView: AgentDevWorkbenchEffectiveView;
  readonly detailAvailability: AgentDevWorkbenchDetailAvailability;
}

export interface AgentDevWorkbenchGraphNode {
  readonly actionId: string;
  readonly type: AgentDevWorkbenchActionType;
  readonly label: string;
  readonly status: 'available' | 'running' | 'completed' | 'failed' | 'canceled' | 'unavailable' | 'partial';
  readonly startedAt?: number;
  readonly endedAt?: number;
  readonly durationMs?: number;
  readonly refs: JsonObject;
  readonly detailAvailability: AgentDevWorkbenchDetailAvailability;
}

export interface AgentDevWorkbenchGraphEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: 'sequence' | 'parallel' | 'child';
}

export interface AgentDevWorkbenchEffectiveView {
  readonly status: 'reconstructed' | 'current-view' | 'partial' | 'unavailable';
  readonly agentId?: string;
  readonly agentVersion?: string;
  readonly agentAssemblyRef?: string;
  readonly modelIds: readonly string[];
  readonly defaultModelId?: string;
  readonly promptTemplateRefs: readonly string[];
  readonly disclosedCapabilityIds: readonly string[];
  readonly renderedToolNames: readonly string[];
  readonly skillCapabilityIds: readonly string[];
  readonly agentCapabilityIds: readonly string[];
  readonly agentConfiguration?: JsonObject;
  readonly agentConfigurationAvailability: AgentDevWorkbenchDetailAvailability;
}

export interface AgentDevWorkbenchActionDetail {
  readonly actionId: string;
  readonly detailAvailability: AgentDevWorkbenchDetailAvailability;
  readonly status?: string;
  readonly timing?: {
    readonly startedAt?: number;
    readonly endedAt?: number;
    readonly durationMs?: number;
  };
  readonly refs: JsonObject;
  readonly safeSummary: JsonObject;
  readonly input?: JsonValue;
  readonly output?: JsonValue;
  readonly promptApproximation?: AgentDevWorkbenchPromptApproximation;
}

export interface AgentDevWorkbenchPromptApproximation {
  readonly status: 'approximate' | 'partial' | 'unavailable';
  readonly authoritative: false;
  readonly templateRef?: string;
  readonly template?: JsonObject;
  readonly selectedMessageRefs: readonly string[];
  readonly selectedMessages: readonly AgentDevWorkbenchPromptMessage[];
  readonly missingMessageRefs: readonly string[];
  readonly renderedToolNames: readonly string[];
  readonly limitations: readonly string[];
}

export interface AgentDevWorkbenchPromptMessage {
  readonly messageId: string;
  readonly role: string;
  readonly contentType: string;
  readonly content: string;
}

export interface AgentDevWorkbenchLogEvidenceView {
  readonly requestRunId: string;
  readonly entries: readonly AgentDevWorkbenchLogEvidenceEntry[];
  readonly detailAvailability: AgentDevWorkbenchDetailAvailability;
}

export interface AgentDevWorkbenchLogEvidenceEntry {
  readonly source: 'runtime-diagnostic-log' | 'structured-safe-log';
  readonly timestamp?: number;
  readonly message: string;
  readonly refs: JsonObject;
}

export interface AgentDevWorkbenchDetailAvailability {
  readonly status: 'available' | 'partial' | 'unavailable' | 'truncated';
  readonly reasonCode?: string;
}

export interface AgentDevWorkbenchAgentConfigurationQuery {
  readonly agentId: string;
  readonly agentVersion: string;
  readonly agentAssemblyRef: string;
}

export type AgentDevWorkbenchAgentConfigurationResolver = (query: AgentDevWorkbenchAgentConfigurationQuery) => Promise<JsonObject | undefined>;

export type AgentDevWorkbenchCapabilityDescriptorResolver = (query: {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly sessionId: string;
  readonly agentId: string;
  readonly agentVersion: string;
  readonly agentAssemblyRef: string;
  readonly capabilityIds: readonly string[];
}) => Promise<readonly JsonObject[]>;

export interface AgentDevWorkbenchPromptTemplateQuery {
  readonly agentId: string;
  readonly agentVersion: string;
  readonly promptTemplateRef: string;
}

export type AgentDevWorkbenchPromptTemplateResolver = (query: AgentDevWorkbenchPromptTemplateQuery) => Promise<JsonObject | undefined>;

export type AgentDevWorkbenchAgentInventoryResolver = () => Promise<readonly JsonObject[]>;

interface ProjectedGatewayOperation {
  readonly gatewayKind: string;
  readonly operation: string;
  readonly status: string;
  readonly durationMs?: number;
  readonly timeoutMs?: number;
  readonly resultCountBucket?: string;
  readonly safeErrorCode?: string;
  readonly safeErrorCategory?: string;
}

export function registerAgentDevWorkbench(instance: FastifyInstance, options: AgentDevWorkbenchRegistrationOptions): void {
  instance.get(agentDevWorkbenchLauncherScriptPath, async (_request, reply) => {
    return reply.type('text/javascript; charset=utf-8').send(renderWorkbenchLauncherScript(agentDevWorkbenchBasePath, workbenchLauncherElementName));
  });
  instance.get(`${agentDevWorkbenchBasePath}/assets/*`, async (request, reply) => {
    const params = request.params as { readonly '*': string };
    return sendWorkbenchAsset(params['*'], reply);
  });

  instance.get(agentDevWorkbenchBasePath, { schema: { response: { 200: { type: 'string' } } } }, async (_request, reply) => {
    return reply.type('text/html; charset=utf-8').send(renderWorkbenchPage());
  });

  instance.get(
    `${agentDevWorkbenchBasePath}/api/agents`,
    {
      schema: { response: { 200: agentPageSchema } },
    },
    async (request, reply) => handleWorkbenchQuery(reply, async () => options.readPort.listAgents(await options.resolveAccessScope(request))),
  );

  instance.get(
    `${agentDevWorkbenchBasePath}/api/developer-diagnostics/status`,
    {
      schema: {
        response: {
          200: Type.Object(
            {
              availability: Type.Union([Type.Literal('DISABLED'), Type.Literal('AVAILABLE'), Type.Literal('DEGRADED')]),
              droppedCount: Type.Integer({ minimum: 0, maximum: 2_147_483_647 }),
              lastFailureCode: Type.Optional(
                Type.Union([
                  Type.Literal('INVALID_RECORD'),
                  Type.Literal('RECORD_TOO_LARGE'),
                  Type.Literal('QUEUE_OVERLOADED'),
                  Type.Literal('OUTPUT_UNAVAILABLE'),
                ]),
              ),
            },
            { additionalProperties: false },
          ),
        },
      },
    },
    async (_request, reply) => reply.send(options.developerDiagnosticArtifactStatus?.() ?? { availability: 'DISABLED', droppedCount: 0 }),
  );

  instance.get(
    `${agentDevWorkbenchBasePath}/api/sessions`,
    {
      schema: { querystring: sessionQuerySchema, response: { 200: sessionPageSchema } },
    },
    async (request, reply) =>
      handleWorkbenchQuery(reply, async () =>
        options.readPort.listSessions(await options.resolveAccessScope(request), parseSessionQuery(request.query)),
      ),
  );

  instance.get(
    `${agentDevWorkbenchBasePath}/api/sessions/:sessionId/conversation`,
    {
      schema: { querystring: conversationQuerySchema, response: { 200: conversationSchema } },
    },
    async (request, reply) => {
      const params = request.params as { readonly sessionId: string };
      const query = request.query as { readonly requestRunId: string; readonly agentId?: string };
      return handleWorkbenchQuery(reply, async () =>
        options.readPort.listConversation(await options.resolveAccessScope(request), {
          sessionId: params.sessionId,
          requestRunId: query.requestRunId,
          ...(query.agentId === undefined ? {} : { agentId: query.agentId }),
        }),
      );
    },
  );

  instance.get(
    `${agentDevWorkbenchBasePath}/api/runs`,
    {
      schema: { querystring: runQuerySchema, response: { 200: runPageSchema } },
    },
    async (request, reply) =>
      handleWorkbenchQuery(reply, async () => options.readPort.listRuns(await options.resolveAccessScope(request), parseRunQuery(request.query))),
  );

  instance.get(
    `${agentDevWorkbenchBasePath}/api/runs/:requestRunId/graph`,
    {
      schema: { querystring: agentQuerySchema, response: { 200: graphSchema } },
    },
    async (request, reply) => {
      const params = request.params as { readonly requestRunId: string };
      const query = request.query as { readonly agentId?: string };
      return handleWorkbenchQuery(reply, async () =>
        options.readPort.getRunGraph(await options.resolveAccessScope(request), {
          requestRunId: params.requestRunId,
          ...(query.agentId === undefined ? {} : { agentId: query.agentId }),
        }),
      );
    },
  );

  instance.get(
    `${agentDevWorkbenchBasePath}/api/runs/:requestRunId/actions/:actionId`,
    {
      schema: { querystring: agentQuerySchema, response: { 200: actionDetailSchema } },
    },
    async (request, reply) => {
      const params = request.params as { readonly requestRunId: string; readonly actionId: string };
      const query = request.query as { readonly agentId?: string };
      return handleWorkbenchQuery(reply, async () =>
        options.readPort.getActionDetail(await options.resolveAccessScope(request), {
          requestRunId: params.requestRunId,
          actionId: params.actionId,
          ...(query.agentId === undefined ? {} : { agentId: query.agentId }),
        }),
      );
    },
  );

  instance.get(
    `${agentDevWorkbenchBasePath}/api/runs/:requestRunId/logs`,
    {
      schema: { querystring: logQuerySchema, response: { 200: logEvidenceSchema } },
    },
    async (request, reply) => {
      const params = request.params as { readonly requestRunId: string };
      const query = request.query as AgentDevWorkbenchLogEvidenceQuery;
      return handleWorkbenchQuery(reply, async () =>
        options.readPort.listLogEvidence(await options.resolveAccessScope(request), { ...query, requestRunId: params.requestRunId }),
      );
    },
  );
}

export function createSqliteAgentDevWorkbenchReadPort(options: {
  readonly sqliteFile: string;
  readonly activeOperationalLog?: () => { readonly file: string } | undefined;
  readonly resolveAgentConfiguration?: AgentDevWorkbenchAgentConfigurationResolver;
  readonly resolvePromptTemplate?: AgentDevWorkbenchPromptTemplateResolver;
  readonly resolveAgentInventory?: AgentDevWorkbenchAgentInventoryResolver;
  readonly resolveCapabilityDescriptors?: AgentDevWorkbenchCapabilityDescriptorResolver;
}): AgentDevWorkbenchLocalReadPort {
  return new SqliteAgentDevWorkbenchReadPort(
    options.sqliteFile,
    options.activeOperationalLog,
    options.resolveAgentConfiguration,
    options.resolvePromptTemplate,
    options.resolveAgentInventory,
    options.resolveCapabilityDescriptors,
  );
}

async function handleWorkbenchQuery<T>(reply: FastifyReply, query: () => Promise<T>): Promise<T | FastifyReply> {
  try {
    return await query();
  } catch {
    return reply.code(500).send({ error: 'AGENT_DEV_WORKBENCH_QUERY_FAILED' });
  }
}

class SqliteAgentDevWorkbenchReadPort implements AgentDevWorkbenchLocalReadPort {
  constructor(
    private readonly sqliteFile: string,
    private readonly activeOperationalLog?: () => { readonly file: string } | undefined,
    private readonly resolveAgentConfiguration?: AgentDevWorkbenchAgentConfigurationResolver,
    private readonly resolvePromptTemplate?: AgentDevWorkbenchPromptTemplateResolver,
    private readonly resolveAgentInventory?: AgentDevWorkbenchAgentInventoryResolver,
    private readonly resolveCapabilityDescriptors?: AgentDevWorkbenchCapabilityDescriptorResolver,
  ) {}

  async listAgents(scope: AgentDevWorkbenchAccessScope): Promise<AgentDevWorkbenchAgentPage> {
    const allowedAgentIds = normalizedAllowedAgentIds(scope);
    let configurations: readonly JsonObject[] = [];
    let inventoryAvailable = this.resolveAgentInventory !== undefined;
    if (this.resolveAgentInventory !== undefined) {
      try {
        configurations = (await this.resolveAgentInventory()).filter((entry) => {
          const agentId = entry['agentId'];
          return typeof agentId === 'string' && allowedAgentIds.includes(agentId);
        });
      } catch {
        inventoryAvailable = false;
      }
    }
    const sessionCounts =
      existsSync(this.sqliteFile) && allowedAgentIds.length > 0
        ? this.withDb(
            'list_agent_session_counts',
            (db) =>
              db
                .prepare(
                  `SELECT agent_id, COUNT(*) AS session_count, MAX(updated_at) AS latest_session_at FROM sessions
         WHERE tenant_id = ? AND subject_id = ? AND agent_id IN (${sqlPlaceholders(allowedAgentIds)}) GROUP BY agent_id`,
                )
                .all(scope.tenantId, scope.subjectId, ...allowedAgentIds) as unknown as AgentSessionCountRow[],
            [],
          )
        : [];
    return projectAgentInventory(configurations, sessionCounts, inventoryAvailable);
  }

  async listSessions(scope: AgentDevWorkbenchAccessScope, query: AgentDevWorkbenchSessionQuery): Promise<AgentDevWorkbenchSessionPage> {
    if (!existsSync(this.sqliteFile)) {
      return unavailableSessionPage('SQLITE_FILE_UNAVAILABLE');
    }
    return this.withDb(
      'list_sessions',
      (db) => {
        const allowedAgentIds = normalizedAllowedAgentIds(scope);
        if (allowedAgentIds.length === 0 || (query.agentId !== undefined && !allowedAgentIds.includes(query.agentId))) {
          return { entries: [], detailAvailability: { status: 'available' } };
        }
        const where: string[] = ['s.tenant_id = ?', 's.subject_id = ?', `s.agent_id IN (${sqlPlaceholders(allowedAgentIds)})`];
        const values: Array<string | number> = [scope.tenantId, scope.subjectId, ...allowedAgentIds];
        addOptionalFilter(where, values, 's.agent_id', query.agentId);
        addOptionalFilter(where, values, 's.session_id', query.sessionId);
        if (query.requestRunId !== undefined) {
          where.push(
            'EXISTS (SELECT 1 FROM request_runs rr WHERE rr.tenant_id = s.tenant_id AND rr.subject_id = s.subject_id AND rr.agent_id = s.agent_id AND rr.session_id = s.session_id AND rr.run_id = ?)',
          );
          values.push(query.requestRunId);
        }
        const sql = `SELECT s.tenant_id, s.subject_id, s.agent_id, s.session_id, s.parent_session_id, s.parent_run_id,
        s.parent_request_id, s.title, s.created_at, s.updated_at,
        (SELECT rr.status FROM request_runs rr
          WHERE rr.tenant_id = s.tenant_id AND rr.subject_id = s.subject_id AND rr.agent_id = s.agent_id AND rr.session_id = s.session_id
          ORDER BY rr.updated_at DESC, rr.run_id DESC LIMIT 1) AS latest_run_status
        FROM sessions s ${whereClause(where)}
        ORDER BY s.updated_at DESC, s.session_id ASC
        LIMIT ?`;
        const rows = db.prepare(sql).all(...values, normalizeLimit(query.limit, 50, 100)) as unknown as SessionListRow[];
        return {
          entries: rows.map((row) => ({
            tenantId: row.tenant_id,
            subjectId: row.subject_id,
            agentId: row.agent_id,
            sessionId: row.session_id,
            ...(row.title === null ? {} : { title: row.title }),
            ...(row.parent_session_id === null ? {} : { parentSessionId: row.parent_session_id }),
            ...(row.parent_run_id === null ? {} : { parentRunId: row.parent_run_id }),
            ...(row.parent_request_id === null ? {} : { parentRequestId: row.parent_request_id }),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            ...(row.latest_run_status === null ? {} : { latestRunStatus: row.latest_run_status as RunStatus }),
          })),
          detailAvailability: { status: 'available' },
        };
      },
      unavailableSessionPage('SQLITE_READ_FAILED'),
    );
  }

  async listConversation(scope: AgentDevWorkbenchAccessScope, query: AgentDevWorkbenchConversationQuery): Promise<AgentDevWorkbenchConversationView> {
    if (!existsSync(this.sqliteFile)) {
      return { sessionId: query.sessionId, messages: [], detailAvailability: { status: 'unavailable', reasonCode: 'SQLITE_FILE_UNAVAILABLE' } };
    }
    return this.withDb(
      'list_conversation',
      (db) => {
        const allowedAgentIds = normalizedAllowedAgentIds(scope);
        if (allowedAgentIds.length === 0 || (query.agentId !== undefined && !allowedAgentIds.includes(query.agentId))) {
          return unavailableConversation(query.sessionId, 'SESSION_NOT_FOUND');
        }
        const where = ['tenant_id = ?', 'subject_id = ?', `agent_id IN (${sqlPlaceholders(allowedAgentIds)})`, 'session_id = ?', 'run_id = ?'];
        const values: Array<string | number> = [scope.tenantId, scope.subjectId, ...allowedAgentIds, query.sessionId, query.requestRunId];
        addOptionalFilter(where, values, 'agent_id', query.agentId);
        const rows = db
          .prepare(
            `SELECT json_object(
          'tenantId', tenant_id, 'subjectId', subject_id, 'agentId', agent_id, 'messageId', message_id,
          'sessionId', session_id, 'requestId', request_id, 'runId', run_id, 'role', role, 'content', content,
          'contentType', content_type, 'metadata', json(metadata), 'visible', visible != 0, 'createdAt', created_at
        ) AS json FROM messages ${whereClause(where)} ORDER BY created_at ASC, message_id ASC LIMIT ?`,
          )
          .all(...values, normalizeLimit(query.limit, 100, 500)) as unknown as JsonRow[];
        return {
          sessionId: query.sessionId,
          messages: rows.map((row) => projectMessage(parseJson<SessionMessageRecord>(row.json))),
          detailAvailability: { status: 'available' },
        };
      },
      unavailableConversation(query.sessionId, 'SQLITE_READ_FAILED'),
    );
  }

  async listRuns(scope: AgentDevWorkbenchAccessScope, query: AgentDevWorkbenchRunQuery): Promise<AgentDevWorkbenchRunPage> {
    if (!existsSync(this.sqliteFile)) {
      return unavailableRunPage('SQLITE_FILE_UNAVAILABLE');
    }
    return this.withDb(
      'list_runs',
      (db) => {
        const allowedAgentIds = normalizedAllowedAgentIds(scope);
        if (allowedAgentIds.length === 0 || (query.agentId !== undefined && !allowedAgentIds.includes(query.agentId))) {
          return { entries: [], detailAvailability: { status: 'available' } };
        }
        const where: string[] = ['rr.tenant_id = ?', 'rr.subject_id = ?', `rr.agent_id IN (${sqlPlaceholders(allowedAgentIds)})`];
        const values: Array<string | number> = [scope.tenantId, scope.subjectId, ...allowedAgentIds];
        addOptionalFilter(where, values, 'rr.agent_id', query.agentId);
        addOptionalFilter(where, values, 'rr.session_id', query.sessionId);
        addOptionalFilter(where, values, 'rr.run_id', query.requestRunId);
        const rows = db
          .prepare(
            `SELECT rr.json,
          (SELECT m.content FROM messages m
           WHERE m.tenant_id = rr.tenant_id AND m.subject_id = rr.subject_id AND m.agent_id = rr.agent_id
             AND m.session_id = rr.session_id AND m.request_id = rr.request_id AND m.role = 'USER'
           ORDER BY m.created_at ASC, m.message_id ASC LIMIT 1) AS root_message_summary
        FROM request_runs rr ${whereClause(where)} ORDER BY rr.updated_at DESC, rr.run_id DESC LIMIT ?`,
          )
          .all(...values, normalizeLimit(query.limit, 50, 100)) as unknown as RunJsonRow[];
        return {
          entries: rows.map((row) => ({
            ...projectRun(parseJson<RequestRunRecord>(row.json)),
            ...(row.root_message_summary === null ? {} : { rootMessageSummary: boundedSingleLine(row.root_message_summary, 180) }),
          })),
          detailAvailability: { status: 'available' },
        };
      },
      unavailableRunPage('SQLITE_READ_FAILED'),
    );
  }

  async getRunGraph(scope: AgentDevWorkbenchAccessScope, query: AgentDevWorkbenchRunLookup): Promise<AgentDevWorkbenchGraphView> {
    const runs = await this.listRuns(scope, {
      requestRunId: query.requestRunId,
      ...(query.agentId === undefined ? {} : { agentId: query.agentId }),
      limit: 1,
    });
    const run = runs.entries[0];
    if (run === undefined) {
      return unavailableGraph(query.requestRunId, 'RUN_NOT_FOUND');
    }
    const timeline = this.loadTimelineEvents(run);
    return (await this.projectRunInspection(scope, run, timeline.events, timeline.truncated)).graph;
  }

  async getActionDetail(scope: AgentDevWorkbenchAccessScope, query: AgentDevWorkbenchActionDetailQuery): Promise<AgentDevWorkbenchActionDetail> {
    const runs = await this.listRuns(scope, {
      requestRunId: query.requestRunId,
      ...(query.agentId === undefined ? {} : { agentId: query.agentId }),
      limit: 1,
    });
    const run = runs.entries[0];
    if (run === undefined) {
      return unavailableActionDetail(query.actionId, 'RUN_NOT_FOUND');
    }
    const timeline = this.loadTimelineEvents(run);
    const inspection = await this.projectRunInspection(scope, run, timeline.events, timeline.truncated);
    const graph = inspection.graph;
    const node = graph.nodes.find((entry) => entry.actionId === query.actionId);
    if (node === undefined) {
      return unavailableActionDetail(query.actionId, 'ACTION_NOT_FOUND');
    }
    const isCapabilityNode = node.type === 'capability' || node.type === 'subagent';
    const capabilityDetail = isCapabilityNode ? projectCapabilityMessageDetail(inspection.messages, run.runId, node.refs) : {};
    const promptApproximation =
      node.type === 'model'
        ? await projectPromptApproximation(node.refs, inspection.messages, run, graph.effectiveView.renderedToolNames, this.resolvePromptTemplate)
        : undefined;
    const capabilityRawAvailable = isCapabilityNode && capabilityDetail.input !== undefined && capabilityDetail.output !== undefined;
    return {
      actionId: query.actionId,
      detailAvailability: capabilityRawAvailable ? { status: 'available' } : node.detailAvailability,
      status: node.status,
      timing: {
        ...(node.startedAt === undefined ? {} : { startedAt: node.startedAt }),
        ...(node.endedAt === undefined ? {} : { endedAt: node.endedAt }),
        ...(node.durationMs === undefined ? {} : { durationMs: node.durationMs }),
      },
      refs: node.refs,
      safeSummary: {
        label: node.label,
        rawUnavailable: !capabilityRawAvailable,
        ...payloadSummary(node.refs),
        ...(Object.keys(effectiveViewSummary(graph.effectiveView, node.refs)).length === 0
          ? {}
          : { effectiveView: effectiveViewSummary(graph.effectiveView, node.refs) }),
      },
      ...capabilityDetail,
      ...(promptApproximation === undefined ? {} : { promptApproximation }),
    };
  }

  private async projectRunInspection(
    scope: AgentDevWorkbenchAccessScope,
    run: AgentDevWorkbenchRunEntry,
    events: readonly RunTimelineEventRecord[],
    truncated: boolean,
  ): Promise<{ readonly graph: AgentDevWorkbenchGraphView; readonly messages: readonly AgentDevWorkbenchMessageEntry[] }> {
    const messages = this.loadInspectionMessages(run, events);
    const capabilityGraph = projectCapabilityInspectionNodes(projectGraph(run, events, truncated), messages, run.runId);
    const graph = this.projectSubagentChildLinks(scope, capabilityGraph, messages, run);
    return {
      messages,
      graph: {
        ...graph,
        effectiveView: await projectAgentConfiguration(
          scope,
          graph.effectiveView,
          run,
          this.resolveAgentConfiguration,
          this.resolveCapabilityDescriptors,
        ),
      },
    };
  }

  private projectSubagentChildLinks(
    scope: AgentDevWorkbenchAccessScope,
    graph: AgentDevWorkbenchGraphView,
    messages: readonly AgentDevWorkbenchMessageEntry[],
    run: AgentDevWorkbenchRunEntry,
  ): AgentDevWorkbenchGraphView {
    const subagentNodes = graph.nodes.filter((node) => node.type === 'subagent');
    if (subagentNodes.length === 0 || !existsSync(this.sqliteFile)) {
      return graph;
    }
    return this.withDb(
      'project_subagent_child_links',
      (db) => {
        const keys = subagentNodes.flatMap((node) => {
          const toolCallId = stringRef(node.refs, 'toolCallId');
          return toolCallId === undefined
            ? []
            : [String(deriveCapabilityInvocationIdempotencyKey(brand<string, 'RequestRunId'>(run.runId), toolCallId))];
        });
        if (keys.length === 0) {
          return graph;
        }
        const placeholders = keys.map(() => '?').join(', ');
        const allowedAgentIds = normalizedAllowedAgentIds(scope);
        const childSessions =
          allowedAgentIds.length === 0
            ? []
            : (db
                .prepare(
                  `SELECT agent_id, session_id, parent_session_id, parent_run_id, parent_request_id, idempotency_key
         FROM sessions
         WHERE tenant_id = ? AND subject_id = ? AND parent_session_id = ? AND parent_run_id = ?
           AND parent_request_id = ? AND agent_id IN (${sqlPlaceholders(allowedAgentIds)}) AND idempotency_key IN (${placeholders})`,
                )
                .all(
                  run.tenantId,
                  run.subjectId,
                  run.sessionId,
                  run.runId,
                  run.requestId,
                  ...allowedAgentIds,
                  ...keys,
                ) as unknown as SubagentChildSessionRow[]);
        const sessionIds = childSessions.map((session) => session.session_id);
        const childRuns =
          sessionIds.length === 0
            ? []
            : (db
                .prepare(
                  `SELECT json FROM request_runs
         WHERE tenant_id = ? AND subject_id = ? AND session_id IN (${sessionIds.map(() => '?').join(', ')})
         ORDER BY created_at ASC, run_id ASC`,
                )
                .all(run.tenantId, run.subjectId, ...sessionIds) as unknown as SubagentChildRunRow[]);
        return {
          ...graph,
          nodes: graph.nodes.map((node) =>
            node.type === 'subagent' ? projectSubagentChildLink(node, messages, run, childSessions, childRuns) : node,
          ),
        };
      },
      graph,
    );
  }

  private loadInspectionMessages(
    run: AgentDevWorkbenchRunEntry,
    events: readonly RunTimelineEventRecord[],
  ): readonly AgentDevWorkbenchMessageEntry[] {
    if (!existsSync(this.sqliteFile)) {
      return [];
    }
    const selectedMessageRefs = uniqueStrings(events.flatMap((event) => arrayStringValues(event.inlinePayload, 'selectedMessageRefs'))).slice(0, 500);
    return this.withDb(
      'load_inspection_messages',
      (db) => {
        const selectedSql = selectedMessageRefs.length === 0 ? '' : ` OR message_id IN (${selectedMessageRefs.map(() => '?').join(', ')})`;
        const rows = db
          .prepare(
            `SELECT json_object(
          'tenantId', tenant_id, 'subjectId', subject_id, 'agentId', agent_id, 'messageId', message_id,
          'sessionId', session_id, 'requestId', request_id, 'runId', run_id, 'role', role, 'content', content,
          'contentType', content_type, 'metadata', json(metadata), 'visible', visible != 0, 'createdAt', created_at
        ) AS json FROM messages
        WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ?
          AND (run_id = ?${selectedSql})
        ORDER BY created_at ASC, message_id ASC LIMIT 1000`,
          )
          .all(run.tenantId, run.subjectId, run.agentId, run.sessionId, run.runId, ...selectedMessageRefs) as unknown as JsonRow[];
        return rows.map((row) => projectMessage(parseJson<SessionMessageRecord>(row.json)));
      },
      [],
    );
  }

  async listLogEvidence(scope: AgentDevWorkbenchAccessScope, query: AgentDevWorkbenchLogEvidenceQuery): Promise<AgentDevWorkbenchLogEvidenceView> {
    const runs = await this.listRuns(scope, { requestRunId: query.requestRunId, limit: 1 });
    const run = runs.entries[0];
    if (run === undefined) {
      return { requestRunId: query.requestRunId, entries: [], detailAvailability: { status: 'unavailable', reasonCode: 'RUN_NOT_FOUND' } };
    }
    if (this.activeOperationalLog === undefined) {
      return {
        requestRunId: query.requestRunId,
        entries: [],
        detailAvailability: { status: 'unavailable', reasonCode: 'LOG_ACTIVE_SEGMENT_UNAVAILABLE' },
      };
    }
    const entries = await readBoundedLogEntries(this.activeOperationalLog, {
      ...query,
      requestId: run.requestId,
      sessionId: run.sessionId,
      agentId: run.agentId,
      agentVersion: run.agentVersion,
    });
    const limit = normalizeLimit(query.limit, 50, 100);
    return {
      requestRunId: query.requestRunId,
      entries: entries.slice(0, limit),
      detailAvailability:
        entries.length === 0
          ? { status: 'partial', reasonCode: 'NO_MATCHING_ENTRIES' }
          : entries.length > limit
            ? { status: 'truncated' }
            : { status: 'available' },
    };
  }

  private loadTimelineEvents(run: AgentDevWorkbenchRunEntry): { readonly events: readonly RunTimelineEventRecord[]; readonly truncated: boolean } {
    if (!existsSync(this.sqliteFile)) {
      return { events: [], truncated: false };
    }
    return this.withDb(
      'load_timeline_events',
      (db) => {
        const rows = db
          .prepare(
            `SELECT json FROM timeline_events
         WHERE tenant_id = ? AND subject_id = ? AND agent_id = ? AND session_id = ? AND run_id = ?
         ORDER BY sequence ASC LIMIT 501`,
          )
          .all(run.tenantId, run.subjectId, run.agentId, run.sessionId, run.runId) as unknown as JsonRow[];
        return {
          events: rows.slice(0, 500).map((row) => parseJson<RunTimelineEventRecord>(row.json)),
          truncated: rows.length > 500,
        };
      },
      { events: [], truncated: false },
    );
  }

  private withDb<TResult>(operation: WorkbenchSqliteReadOperation, work: (db: DatabaseSync) => TResult, fallback: TResult): TResult {
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(this.sqliteFile, { readOnly: true });
      return work(db);
    } catch (cause) {
      logger.error({
        event: 'agent_dev_workbench.sqlite_read_failed',
        safeReasonCode: safeSqliteReadFailureReason(cause),
        operation,
      });
      return fallback;
    } finally {
      db?.close();
    }
  }
}

function safeSqliteReadFailureReason(cause: unknown): 'SQLITE_SCHEMA_UNAVAILABLE' | 'SQLITE_BUSY' | 'SQLITE_OPEN_FAILED' | 'SQLITE_READ_FAILED' {
  if (!(cause instanceof Error)) {
    return 'SQLITE_READ_FAILED';
  }
  const message = cause.message.toLowerCase();
  if (message.includes('no such table') || message.includes('no such column') || message.includes('database schema')) {
    return 'SQLITE_SCHEMA_UNAVAILABLE';
  }
  if (message.includes('database is locked') || message.includes('database is busy')) {
    return 'SQLITE_BUSY';
  }
  if (message.includes('unable to open database file')) {
    return 'SQLITE_OPEN_FAILED';
  }
  return 'SQLITE_READ_FAILED';
}

function projectRun(record: RequestRunRecord): AgentDevWorkbenchRunEntry {
  return {
    tenantId: record.tenantId,
    subjectId: record.subjectId,
    agentId: record.agentId,
    agentVersion: record.agentVersion,
    sessionId: record.sessionId,
    requestId: record.requestId,
    runId: record.runId,
    agentAssemblyRef: record.agentAssemblyRef,
    attempt: record.attempt,
    ...(record.parentRunId === undefined ? {} : { parentRunId: record.parentRunId }),
    ...(record.parentRequestId === undefined ? {} : { parentRequestId: record.parentRequestId }),
    status: record.status,
    terminalCommitState: record.terminalCommitState,
    createdAt: Number(record.createdAt),
    updatedAt: Number(record.updatedAt),
  };
}

function projectAgentInventory(
  configurations: readonly JsonObject[],
  sessionCounts: readonly AgentSessionCountRow[],
  inventoryAvailable: boolean,
): AgentDevWorkbenchAgentPage {
  const countByAgentId = new Map(sessionCounts.map((row) => [row.agent_id, row.session_count]));
  const currentAgentIds = new Set<string>();
  const current = configurations.flatMap((configuration): readonly AgentDevWorkbenchAgentEntry[] => {
    const agentId = configuration['agentId'];
    if (typeof agentId !== 'string') {
      return [];
    }
    currentAgentIds.add(agentId);
    const parentAgentScope = isJsonObject(configuration['parentAgentScope']) ? configuration['parentAgentScope'] : undefined;
    const agentInvocation = typeof configuration['agentInvocation'] === 'string' ? configuration['agentInvocation'] : undefined;
    const userInvocable = typeof configuration['userInvocable'] === 'boolean' ? configuration['userInvocable'] : undefined;
    const isSubagent = parentAgentScope !== undefined || agentInvocation === 'PARENT' || (userInvocable === false && agentInvocation === 'BOUND');
    return [
      {
        agentId,
        ...(typeof configuration['agentVersion'] === 'string' ? { agentVersion: configuration['agentVersion'] } : {}),
        ...(typeof configuration['agentAssemblyRef'] === 'string' ? { agentAssemblyRef: configuration['agentAssemblyRef'] } : {}),
        ...(typeof configuration['displayName'] === 'string' ? { displayName: configuration['displayName'] } : {}),
        ...(typeof configuration['description'] === 'string' ? { description: configuration['description'] } : {}),
        ...(typeof configuration['sourceKind'] === 'string' ? { sourceKind: configuration['sourceKind'] } : {}),
        ...(agentInvocation === undefined ? {} : { agentInvocation }),
        kind: isSubagent ? 'subagent' : 'agent',
        ...(userInvocable === undefined ? {} : { userInvocable }),
        ...(parentAgentScope === undefined ? {} : { parentAgentScope }),
        sessionCount: countByAgentId.get(agentId) ?? 0,
        configuration,
        configurationAvailability: { status: 'available' },
      },
    ];
  });
  const historical = sessionCounts.flatMap((row): readonly AgentDevWorkbenchAgentEntry[] =>
    currentAgentIds.has(row.agent_id)
      ? []
      : [
          {
            agentId: row.agent_id,
            kind: 'historical',
            sessionCount: row.session_count,
            configurationAvailability: { status: 'unavailable', reasonCode: 'AGENT_NOT_IN_CURRENT_INVENTORY' },
          },
        ],
  );
  return {
    entries: [...current, ...historical].sort((left, right) => {
      const kindOrder = { agent: 0, subagent: 1, historical: 2 } as const;
      return kindOrder[left.kind] - kindOrder[right.kind] || right.sessionCount - left.sessionCount || left.agentId.localeCompare(right.agentId);
    }),
    detailAvailability: inventoryAvailable
      ? { status: 'available' }
      : current.length === 0 && historical.length === 0
        ? { status: 'unavailable', reasonCode: 'AGENT_INVENTORY_UNAVAILABLE' }
        : { status: 'partial', reasonCode: 'CURRENT_AGENT_INVENTORY_UNAVAILABLE' },
  };
}

function projectMessage(record: SessionMessageRecord): AgentDevWorkbenchMessageEntry {
  return {
    messageId: record.messageId,
    requestId: record.requestId,
    ...(record.runId === undefined ? {} : { runId: record.runId }),
    role: record.role,
    contentType: record.contentType,
    content: record.content,
    ...(record.metadata === undefined || Object.keys(record.metadata).length === 0 ? {} : { metadata: record.metadata }),
    visible: record.visible,
    createdAt: Number(record.createdAt),
  };
}

function projectGraph(run: AgentDevWorkbenchRunEntry, events: readonly RunTimelineEventRecord[], truncated: boolean): AgentDevWorkbenchGraphView {
  const graphEvents = coalesceCapabilityLifecycleEvents(events);
  const requestAcceptedEvent = graphEvents.find((event) => event.type === 'REQUEST_ACCEPTED');
  const durations = computeEventDurations(graphEvents, Number(run.updatedAt));
  const startedByBase = new Map<string, RunTimelineEventRecord>();
  const completedToStarted = new Map<string, RunTimelineEventRecord>();
  const startedWithCompletion = new Set<string>();
  for (const event of graphEvents) {
    if (event.type.endsWith('_STARTED')) {
      startedByBase.set(invocationPairKey(event), event);
    } else if (event.type.endsWith('_COMPLETED') || event.type.endsWith('_FAILED')) {
      const key = invocationPairKey(event);
      const started = startedByBase.get(key);
      if (started) {
        completedToStarted.set(event.eventId, started);
        startedWithCompletion.add(started.eventId);
        startedByBase.delete(key);
      }
    }
  }
  const visibleEvents = graphEvents.filter(
    (event) => event.type !== 'REQUEST_ACCEPTED' && !isGraphDeltaEvent(event.type) && !startedWithCompletion.has(event.eventId),
  );
  const projectedEvents = visibleEvents.map((event) => ({
    eventNode: projectEventNode(event, run, durations.get(event.eventId), completedToStarted.get(event.eventId)),
    gatewayNodes: projectGatewayNodes(event),
  }));
  const isTerminal = terminalStatus(run.status);
  const requestDuration = requestAcceptedEvent !== undefined ? durations.get(requestAcceptedEvent.eventId) : undefined;
  const requestNode: AgentDevWorkbenchGraphNode = {
    actionId: `run:${run.runId}:request`,
    type: 'request',
    label: 'Request accepted',
    status: run.status === 'EXECUTING' || run.status === 'QUEUED' || run.status === 'ACCEPTED' ? 'running' : 'completed',
    startedAt: run.createdAt,
    ...(requestDuration !== undefined
      ? { durationMs: requestDuration, endedAt: run.createdAt + requestDuration }
      : isTerminal
        ? { endedAt: run.updatedAt, durationMs: Math.max(0, run.updatedAt - run.createdAt) }
        : {}),
    refs: {
      runId: run.runId,
      sessionId: run.sessionId,
      requestId: run.requestId,
      agentId: run.agentId,
      agentVersion: run.agentVersion,
      agentAssemblyRef: run.agentAssemblyRef,
      ...(requestAcceptedEvent === undefined ? {} : timelineRefs(requestAcceptedEvent)),
    },
    detailAvailability: { status: 'partial', reasonCode: 'RAW_UNAVAILABLE' },
  };
  const nodes = [requestNode, ...projectedEvents.flatMap((entry) => [entry.eventNode, ...entry.gatewayNodes])];
  const sequenceEdges = projectExecutionEdges(
    requestNode,
    projectedEvents.map((entry) => entry.eventNode),
  );
  const childEdges = projectedEvents.flatMap((entry) =>
    entry.gatewayNodes.map((node) => ({
      from: entry.eventNode.actionId,
      to: node.actionId,
      kind: 'child' as const,
    })),
  );
  return {
    requestRunId: run.runId,
    nodes,
    edges: [...sequenceEdges, ...childEdges],
    effectiveView: projectEffectiveView(run, events),
    detailAvailability: graphAvailability(events, truncated),
  };
}

function projectExecutionEdges(
  requestNode: AgentDevWorkbenchGraphNode,
  eventNodes: readonly AgentDevWorkbenchGraphNode[],
): readonly AgentDevWorkbenchGraphEdge[] {
  const edges: AgentDevWorkbenchGraphEdge[] = [];
  let frontier: readonly AgentDevWorkbenchGraphNode[] = [requestNode];
  for (let index = 0; index < eventNodes.length;) {
    const node = eventNodes[index];
    if (node === undefined) {
      break;
    }
    if (node.refs['toolBatchExecutionMode'] !== 'PARALLEL') {
      edges.push(
        ...frontier.map((source) => ({
          from: source.actionId,
          to: node.actionId,
          kind: frontier.length > 1 ? ('parallel' as const) : ('sequence' as const),
        })),
      );
      frontier = [node];
      index += 1;
      continue;
    }
    const stepId = node.refs['stepId'];
    const group: AgentDevWorkbenchGraphNode[] = [];
    while (index < eventNodes.length) {
      const candidate = eventNodes[index];
      if (candidate === undefined || candidate.refs['toolBatchExecutionMode'] !== 'PARALLEL' || candidate.refs['stepId'] !== stepId) {
        break;
      }
      group.push(candidate);
      index += 1;
    }
    edges.push(
      ...frontier.flatMap((source) =>
        group.map((target) => ({
          from: source.actionId,
          to: target.actionId,
          kind: 'parallel' as const,
        })),
      ),
    );
    frontier = group;
  }
  return edges;
}

function coalesceCapabilityLifecycleEvents(events: readonly RunTimelineEventRecord[]): readonly RunTimelineEventRecord[] {
  const selectedByToolCall = new Map<string, { started?: RunTimelineEventRecord; terminal?: RunTimelineEventRecord }>();
  const passthrough: RunTimelineEventRecord[] = [];
  for (const event of events) {
    const isCapabilityLifecycle = event.type === 'CAPABILITY_STARTED' || event.type === 'CAPABILITY_COMPLETED';
    const toolCallId = payloadString(event.inlinePayload, 'toolCallId');
    if (!isCapabilityLifecycle || toolCallId === undefined) {
      passthrough.push(event);
      continue;
    }
    const selected = selectedByToolCall.get(toolCallId) ?? {};
    if (event.type === 'CAPABILITY_STARTED') {
      selected.started ??= event;
    } else {
      const currentTerminalSize = selected.terminal === undefined ? -1 : Object.keys(selected.terminal.inlinePayload).length;
      if (Object.keys(event.inlinePayload).length >= currentTerminalSize) {
        selected.terminal = event;
      }
    }
    selectedByToolCall.set(toolCallId, selected);
  }
  const selected = [...selectedByToolCall.values()].flatMap((entry) =>
    [entry.started, entry.terminal].filter((event): event is RunTimelineEventRecord => event !== undefined),
  );
  return [...passthrough, ...selected].sort((left, right) => Number(left.sequence) - Number(right.sequence));
}

function invocationPairKey(event: RunTimelineEventRecord): string {
  const base = event.type.replace(/_STARTED$|_COMPLETED$|_FAILED$/u, '');
  const correlationId = payloadString(event.inlinePayload, 'toolCallId') ?? payloadString(event.inlinePayload, 'stepId') ?? 'default';
  return `${base}:${correlationId}`;
}

function projectEventNode(
  event: RunTimelineEventRecord,
  run: AgentDevWorkbenchRunEntry,
  durationMs?: number,
  startedEvent?: RunTimelineEventRecord,
): AgentDevWorkbenchGraphNode {
  const type = actionTypeFor(event.type);
  const startedAt = startedEvent ? Number(startedEvent.createdAt) : Number(event.createdAt);
  const mergedPayload = startedEvent ? { ...startedEvent.inlinePayload, ...event.inlinePayload } : event.inlinePayload;
  const mergedEvent = startedEvent ? { ...event, inlinePayload: mergedPayload } : event;
  const payloadDuration = typeof mergedPayload['durationMs'] === 'number' ? (mergedPayload['durationMs'] as number) : undefined;
  const effectiveDuration = payloadDuration ?? durationMs;
  return {
    actionId: `timeline:${event.eventId}`,
    type,
    label: startedEvent ? mergedNodeLabel(type, mergedPayload) : eventLabel(event),
    status: statusForEvent(event.type, run.status),
    startedAt,
    ...(effectiveDuration !== undefined && effectiveDuration >= 0 ? { durationMs: effectiveDuration, endedAt: startedAt + effectiveDuration } : {}),
    refs: {
      ...timelineRefs(mergedEvent),
      ...safePayloadRefs(mergedPayload),
      ...(event.type === 'CAPABILITY_COMPLETED' && gatewayOperationSummaries(mergedPayload).length === 0
        ? { gatewayOperationsAvailability: 'unavailable' }
        : {}),
    },
    detailAvailability: { status: 'partial', reasonCode: 'SAFE_SUMMARY_ONLY' },
  };
}

function mergedNodeLabel(type: AgentDevWorkbenchActionType, payload: JsonObject): string {
  switch (type) {
    case 'model':
      return '模型调用';
    case 'capability': {
      const tn = payload['toolName'];
      return typeof tn === 'string' ? tn : '能力调用';
    }
    case 'scheduler':
      return '调度';
    default:
      return type;
  }
}

function computeEventDurations(events: readonly RunTimelineEventRecord[], runUpdatedAt: number): Map<string, number> {
  const durations = new Map<string, number>();
  const pending: Array<{ readonly base: string; readonly eventId: string; readonly createdAt: number }> = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev === undefined) {
      continue;
    }
    const type = ev.type;
    const at = Number(ev.createdAt);
    if (type.endsWith('_STARTED')) {
      pending.push({ base: invocationPairKey(ev), eventId: ev.eventId, createdAt: at });
    } else if (type.endsWith('_COMPLETED') || type.endsWith('_FAILED')) {
      const base = invocationPairKey(ev);
      const idx = pending.findIndex((p) => p.base === base);
      if (idx >= 0) {
        const started = pending[idx];
        if (started !== undefined) {
          durations.set(ev.eventId, Math.max(0, at - started.createdAt));
        }
        pending.splice(idx, 1);
      }
    }
    if (!durations.has(ev.eventId)) {
      const next = events[i + 1];
      const end = next !== undefined ? Number(next.createdAt) : runUpdatedAt;
      durations.set(ev.eventId, Math.max(0, end - at));
    }
  }
  return durations;
}

function timelineRefs(event: RunTimelineEventRecord): JsonObject {
  const payload = detailPayload(event.inlinePayload);
  return {
    eventId: event.eventId,
    sequence: Number(event.sequence),
    timelineType: event.type,
    ...(event.requestContextId === undefined ? {} : { requestContextId: event.requestContextId }),
    runId: event.runId,
    requestId: event.requestId,
    ...(Object.keys(payload).length === 0 ? {} : { payload }),
  };
}

function unavailableActionDetail(actionId: string, reasonCode: string): AgentDevWorkbenchActionDetail {
  return {
    actionId,
    detailAvailability: { status: 'unavailable', reasonCode },
    refs: {},
    safeSummary: {},
  };
}

function projectCapabilityMessageDetail(
  messages: readonly AgentDevWorkbenchMessageEntry[],
  requestRunId: string,
  refs: JsonObject,
): { readonly input?: JsonValue; readonly output?: JsonValue } {
  const toolCallId = stringRef(refs, 'toolCallId');
  if (toolCallId === undefined) {
    return {};
  }
  let input: JsonValue | undefined;
  let output: JsonValue | undefined;
  for (const message of messages) {
    if (message.runId !== requestRunId) {
      continue;
    }
    const parsed = tryParseJsonObject(message.content);
    if (parsed === undefined) {
      continue;
    }
    if (message.metadata?.['kind'] === 'ASSISTANT_TOOL_USE' && Array.isArray(parsed['toolCalls'])) {
      const toolCall = parsed['toolCalls'].find((entry) => isJsonObject(entry) && entry['toolCallId'] === toolCallId);
      if (isJsonObject(toolCall) && toolCall['arguments'] !== undefined) {
        input = toolCall['arguments'];
      }
    }
    if (message.metadata?.['kind'] === 'CAPABILITY_RESULT' && parsed['toolCallId'] === toolCallId && parsed['payload'] !== undefined) {
      output = parsed['payload'];
    }
  }
  return {
    ...(input === undefined ? {} : { input }),
    ...(output === undefined ? {} : { output }),
  };
}

function projectCapabilityInspectionNodes(
  graph: AgentDevWorkbenchGraphView,
  messages: readonly AgentDevWorkbenchMessageEntry[],
  requestRunId: string,
): AgentDevWorkbenchGraphView {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (node.type !== 'capability') {
        return node;
      }
      const input = projectCapabilityMessageDetail(messages, requestRunId, node.refs).input;
      if (stringRef(node.refs, 'capabilityKind') === 'AGENT') {
        const targetAgentId = isJsonObject(input) && typeof input['agentId'] === 'string' ? input['agentId'] : undefined;
        return {
          ...node,
          type: 'subagent',
          label: targetAgentId === undefined ? 'Subagent' : targetAgentId,
          refs: {
            ...node.refs,
            ...(targetAgentId === undefined ? {} : { targetAgentId }),
            childLinkAvailability: 'unavailable',
          },
        };
      }
      if (stringRef(node.refs, 'toolName') !== 'Bash') {
        return node;
      }
      const command = isJsonObject(input) && typeof input['command'] === 'string' ? boundedCommandPreview(input['command']) : undefined;
      return command === undefined ? node : { ...node, refs: { ...node.refs, commandPreview: command } };
    }),
  };
}

function projectSubagentChildLink(
  node: AgentDevWorkbenchGraphNode,
  messages: readonly AgentDevWorkbenchMessageEntry[],
  parentRun: AgentDevWorkbenchRunEntry,
  childSessions: readonly SubagentChildSessionRow[],
  childRuns: readonly SubagentChildRunRow[],
): AgentDevWorkbenchGraphNode {
  const toolCallId = stringRef(node.refs, 'toolCallId');
  if (toolCallId === undefined) {
    return { ...node, refs: { ...node.refs, childLinkAvailability: 'unavailable', childLinkReasonCode: 'SUBAGENT_TOOL_CALL_ID_UNAVAILABLE' } };
  }
  const idempotencyKey = String(deriveCapabilityInvocationIdempotencyKey(brand<string, 'RequestRunId'>(parentRun.runId), toolCallId));
  const input = projectCapabilityMessageDetail(messages, parentRun.runId, node.refs).input;
  const targetAgentId = isJsonObject(input) && typeof input['agentId'] === 'string' ? input['agentId'] : undefined;
  const matches = childSessions.filter(
    (session) =>
      session.idempotency_key === idempotencyKey &&
      session.parent_session_id === parentRun.sessionId &&
      session.parent_run_id === parentRun.runId &&
      session.parent_request_id === parentRun.requestId &&
      (targetAgentId === undefined || session.agent_id === targetAgentId),
  );
  if (matches.length !== 1) {
    return {
      ...node,
      refs: {
        ...node.refs,
        childLinkAvailability: 'unavailable',
        childLinkReasonCode: matches.length > 1 ? 'SUBAGENT_CHILD_AMBIGUOUS' : 'SUBAGENT_CHILD_NOT_FOUND',
      },
    };
  }
  const childSession = matches[0];
  if (childSession === undefined) {
    return node;
  }
  const matchingRuns = childRuns.flatMap((row): readonly RequestRunRecord[] => {
    const run = parseJson<RequestRunRecord>(row.json);
    return run.agentId === childSession.agent_id &&
      run.sessionId === childSession.session_id &&
      run.parentRunId === parentRun.runId &&
      run.parentRequestId === parentRun.requestId
      ? [run]
      : [];
  });
  if (matchingRuns.length !== 1) {
    return {
      ...node,
      refs: {
        ...node.refs,
        childLinkAvailability: 'unavailable',
        childLinkReasonCode: matchingRuns.length > 1 ? 'SUBAGENT_CHILD_RUN_AMBIGUOUS' : 'SUBAGENT_CHILD_RUN_NOT_FOUND',
      },
    };
  }
  const childRun = matchingRuns[0];
  if (childRun === undefined) {
    return node;
  }
  return {
    ...node,
    refs: {
      ...node.refs,
      childLinkAvailability: 'available',
      childAgentId: childSession.agent_id,
      childSessionId: childSession.session_id,
      childRunId: childRun.runId,
      childRunStatus: childRun.status,
    },
  };
}

async function projectPromptApproximation(
  refs: JsonObject,
  messages: readonly AgentDevWorkbenchMessageEntry[],
  run: AgentDevWorkbenchRunEntry,
  classifiedToolIds: readonly string[],
  resolvePromptTemplate?: AgentDevWorkbenchPromptTemplateResolver,
): Promise<AgentDevWorkbenchPromptApproximation> {
  const templateRef = stringRef(refs, 'promptTemplateRef');
  const selectedMessageRefs = arrayStringRef(refs, 'selectedMessageRefs');
  const renderedToolNames = uniqueStrings([...classifiedToolIds, ...arrayStringRef(refs, 'renderedToolNames')]);
  let template: JsonObject | undefined;
  if (templateRef !== undefined && resolvePromptTemplate !== undefined) {
    try {
      template = await resolvePromptTemplate({
        agentId: run.agentId,
        agentVersion: run.agentVersion,
        promptTemplateRef: templateRef,
      });
    } catch {
      template = undefined;
    }
  }
  const messagesById = new Map(messages.map((message) => [message.messageId, message]));
  const selectedMessages = selectedMessageRefs.flatMap((messageId) => {
    const message = messagesById.get(messageId);
    return message === undefined
      ? []
      : [
          {
            messageId: message.messageId,
            role: message.role,
            contentType: message.contentType,
            content: message.content,
          },
        ];
  });
  const missingMessageRefs = selectedMessageRefs.filter((messageId) => !messagesById.has(messageId));
  const limitations = [
    'DYNAMIC_TEMPLATE_VARIABLES_NOT_REPLAYED',
    'CAPABILITY_GENERATED_MESSAGES_NOT_RECONSTRUCTED',
    'ATTACHMENT_CONTENT_NOT_RECONSTRUCTED',
    'TOOL_SCHEMAS_NOT_RECONSTRUCTED',
    'RENDER_TIME_TRANSFORMS_NOT_REPLAYED',
    'BEFORE_MODEL_INVOKE_HOOK_MUTATIONS_NOT_RECONSTRUCTED',
    ...(templateRef !== undefined && template === undefined ? ['PROMPT_TEMPLATE_UNRESOLVABLE'] : []),
    ...(missingMessageRefs.length > 0 ? ['SELECTED_MESSAGE_MISSING'] : []),
  ];
  const hasEvidence = templateRef !== undefined || selectedMessageRefs.length > 0 || renderedToolNames.length > 0;
  const completeKnownEvidence = templateRef !== undefined && template !== undefined && missingMessageRefs.length === 0;
  return {
    status: !hasEvidence ? 'unavailable' : completeKnownEvidence ? 'approximate' : 'partial',
    authoritative: false,
    ...(templateRef === undefined ? {} : { templateRef }),
    ...(template === undefined ? {} : { template }),
    selectedMessageRefs,
    selectedMessages,
    missingMessageRefs,
    renderedToolNames,
    limitations,
  };
}

function boundedCommandPreview(command: string): string | undefined {
  const singleLine = command.replace(/\s+/gu, ' ').trim();
  if (singleLine.length === 0) {
    return undefined;
  }
  const maxLength = 160;
  return singleLine.length <= maxLength ? singleLine : `${singleLine.slice(0, maxLength - 3)}...`;
}

function stringRef(refs: JsonObject, key: string): string | undefined {
  const direct = refs[key];
  if (typeof direct === 'string') {
    return direct;
  }
  const payload = refs['payload'];
  const nested = isJsonObject(payload) ? payload[key] : undefined;
  return typeof nested === 'string' ? nested : undefined;
}

function arrayStringRef(refs: JsonObject, key: string): readonly string[] {
  const direct = refs[key];
  if (Array.isArray(direct)) {
    return direct.filter((entry): entry is string => typeof entry === 'string');
  }
  const payload = refs['payload'];
  const nested = isJsonObject(payload) ? payload[key] : undefined;
  return Array.isArray(nested) ? nested.filter((entry): entry is string => typeof entry === 'string') : [];
}

function tryParseJsonObject(value: string): JsonObject | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isJsonObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function eventLabel(event: RunTimelineEventRecord): string {
  const payload = event.inlinePayload;
  const toolName = payloadString(payload, 'toolName');
  const stepId = payloadString(payload, 'stepId');
  if (event.type === 'CAPABILITY_STARTED') {
    return `${toolName ?? 'Capability'} started`;
  }
  if (event.type === 'CAPABILITY_RESULT_DELTA') {
    return `${toolName ?? 'Capability'} result`;
  }
  if (event.type === 'CAPABILITY_COMPLETED') {
    return `${toolName ?? 'Capability'} ${payloadString(payload, 'status')?.toLowerCase() ?? 'completed'}`;
  }
  if (event.type === 'MODEL_INVOCATION_STARTED') {
    return `${stepId ?? 'model'} started${payloadString(payload, 'modelId') === undefined ? '' : `: ${payloadString(payload, 'modelId')}`}`;
  }
  if (event.type === 'MODEL_INVOCATION_COMPLETED') {
    return `${stepId ?? 'model'} ${payloadString(payload, 'finishReason') ?? 'completed'}`;
  }
  if (event.type === 'MODEL_INVOCATION_FAILED') {
    return `${stepId ?? 'model'} failed${payloadString(payload, 'safeErrorCode') === undefined ? '' : `: ${payloadString(payload, 'safeErrorCode')}`}`;
  }
  if (event.type === 'POLICY_APPLIED') {
    return `${payloadString(payload, 'policyPoint') ?? 'Policy'}: ${payloadString(payload, 'outcome') ?? 'applied'}`;
  }
  if (event.type === 'HOOK_INVOKED') {
    return payloadString(payload, 'stage') ?? 'HOOK_INVOKED';
  }
  return event.type;
}

function payloadString(payload: JsonObject, key: string): string | undefined {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function projectGatewayNodes(event: RunTimelineEventRecord): readonly AgentDevWorkbenchGraphNode[] {
  if (event.type !== 'CAPABILITY_COMPLETED') {
    return [];
  }
  return gatewayOperationSummaries(event.inlinePayload).map((operation, index) => ({
    actionId: `timeline:${event.eventId}:gateway:${index + 1}`,
    type: 'gateway' as const,
    label: `${operation.gatewayKind}:${operation.operation}`,
    status: gatewayStatus(operation.status),
    startedAt: Number(event.createdAt),
    ...(typeof operation.durationMs === 'number' ? { durationMs: operation.durationMs } : {}),
    refs: {
      parentEventId: event.eventId,
      gatewayKind: operation.gatewayKind,
      operation: operation.operation,
      status: operation.status,
      ...(typeof operation.timeoutMs === 'number' ? { timeoutMs: operation.timeoutMs } : {}),
      ...(typeof operation.resultCountBucket === 'string' ? { resultCountBucket: operation.resultCountBucket } : {}),
      ...(typeof operation.safeErrorCode === 'string' ? { safeErrorCode: operation.safeErrorCode } : {}),
      ...(typeof operation.safeErrorCategory === 'string' ? { safeErrorCategory: operation.safeErrorCategory } : {}),
    },
    detailAvailability: { status: 'available' },
  }));
}

function projectEffectiveView(run: AgentDevWorkbenchRunEntry, events: readonly RunTimelineEventRecord[]): AgentDevWorkbenchEffectiveView {
  const payloads = events.map((event) => event.inlinePayload);
  const hasRunSpecificProjection = payloads.some((payload) =>
    hasAnyKey(payload, [
      'modelId',
      'promptTemplateRef',
      'disclosedCapabilityIds',
      'renderedToolNames',
      'selectedMessageRefs',
      'promptTemplateVersion',
    ]),
  );
  const currentViewRequested = payloads.some((payload) => payload['effectiveViewStatus'] === 'current-view' || payload['currentView'] === true);
  const disclosedCapabilities = uniqueStrings(
    payloads.flatMap((payload) => [...arrayStringValues(payload, 'disclosedCapabilityIds'), ...arrayStringValues(payload, 'visibleCapabilityIds')]),
  );
  return {
    status: hasRunSpecificProjection ? 'reconstructed' : currentViewRequested ? 'current-view' : 'partial',
    agentId: run.agentId,
    agentVersion: run.agentVersion,
    agentAssemblyRef: run.agentAssemblyRef,
    modelIds: uniqueStrings(payloads.flatMap((payload) => stringValues(payload, ['modelId']))),
    promptTemplateRefs: uniqueStrings(payloads.flatMap((payload) => stringValues(payload, ['promptTemplateRef']))),
    disclosedCapabilityIds: disclosedCapabilities,
    renderedToolNames: [],
    skillCapabilityIds: [],
    agentCapabilityIds: [],
    agentConfigurationAvailability: { status: 'unavailable', reasonCode: 'AGENT_ASSEMBLY_REGISTRY_UNAVAILABLE' },
  };
}

async function projectAgentConfiguration(
  scope: AgentDevWorkbenchAccessScope,
  effectiveView: AgentDevWorkbenchEffectiveView,
  run: AgentDevWorkbenchRunEntry,
  resolver?: AgentDevWorkbenchAgentConfigurationResolver,
  descriptorResolver?: AgentDevWorkbenchCapabilityDescriptorResolver,
): Promise<AgentDevWorkbenchEffectiveView> {
  if (resolver === undefined) {
    return effectiveView;
  }
  let assembly: JsonObject | undefined;
  try {
    assembly = await resolver({
      agentId: run.agentId,
      agentVersion: run.agentVersion,
      agentAssemblyRef: run.agentAssemblyRef,
    });
  } catch {
    return {
      ...effectiveView,
      agentConfigurationAvailability: { status: 'unavailable', reasonCode: 'AGENT_ASSEMBLY_NOT_RESOLVABLE' },
    };
  }
  if (assembly === undefined) {
    return {
      ...effectiveView,
      agentConfigurationAvailability: { status: 'unavailable', reasonCode: 'AGENT_ASSEMBLY_NOT_RESOLVABLE' },
    };
  }
  if (assembly['agentId'] !== run.agentId || assembly['agentVersion'] !== run.agentVersion || assembly['agentAssemblyRef'] !== run.agentAssemblyRef) {
    return {
      ...effectiveView,
      agentConfigurationAvailability: { status: 'unavailable', reasonCode: 'AGENT_ASSEMBLY_REF_MISMATCH' },
    };
  }
  const bindings = Array.isArray(assembly['capabilityBindings']) ? assembly['capabilityBindings'].filter(isJsonObject) : [];
  const disclosed = new Set(effectiveView.disclosedCapabilityIds);
  let descriptors: readonly JsonObject[] = [];
  if (descriptorResolver !== undefined && disclosed.size > 0) {
    try {
      descriptors = await descriptorResolver({
        tenantId: scope.tenantId,
        subjectId: scope.subjectId,
        sessionId: run.sessionId,
        agentId: run.agentId,
        agentVersion: run.agentVersion,
        agentAssemblyRef: run.agentAssemblyRef,
        capabilityIds: [...disclosed],
      });
    } catch {
      descriptors = [];
    }
  }
  const classificationSource =
    descriptors.length > 0
      ? descriptors
      : bindings.flatMap((binding) => {
          const capabilityId = binding['capabilityId'];
          const kind = binding['capabilityType'];
          return typeof capabilityId === 'string' && typeof kind === 'string' ? [{ capabilityId, kind }] : [];
        });
  const tools = capabilityIdsByKind(classificationSource, 'TOOL').filter((id) => disclosed.has(id));
  const skills = capabilityIdsByKind(classificationSource, 'SKILL').filter((id) => disclosed.has(id));
  const agents = capabilityIdsByKind(classificationSource, 'AGENT').filter((id) => disclosed.has(id));
  const modelIds = Array.isArray(assembly['modelIds'])
    ? assembly['modelIds'].filter((modelId): modelId is string => typeof modelId === 'string')
    : effectiveView.modelIds;
  const defaultModelId = typeof assembly['defaultModelId'] === 'string' ? assembly['defaultModelId'] : undefined;
  return {
    ...effectiveView,
    ...(descriptorResolver !== undefined && descriptors.length === 0 && disclosed.size > 0 ? { status: 'partial' as const } : {}),
    renderedToolNames: tools,
    skillCapabilityIds: skills,
    agentCapabilityIds: agents,
    modelIds,
    ...(defaultModelId === undefined ? {} : { defaultModelId }),
    agentConfiguration: assembly,
    agentConfigurationAvailability: { status: 'available' },
  };
}

function capabilityIdsByKind(descriptors: readonly JsonObject[], kind: string): readonly string[] {
  return descriptors.flatMap((descriptor): readonly string[] => {
    const capabilityId = descriptor['capabilityId'];
    const capabilityKind = descriptor['kind'];
    if (typeof capabilityId !== 'string' || typeof capabilityKind !== 'string' || capabilityKind.toUpperCase() !== kind) {
      return [];
    }
    return [capabilityId];
  });
}

function effectiveViewSummary(effectiveView: AgentDevWorkbenchEffectiveView, refs: JsonObject): JsonObject {
  const timelineType = refs['timelineType'];
  if (timelineType === 'MODEL_INVOCATION_STARTED' || timelineType === 'MODEL_INVOCATION_COMPLETED' || timelineType === 'MODEL_INVOCATION_FAILED') {
    return {
      status: effectiveView.status,
      modelIds: effectiveView.modelIds,
      ...(effectiveView.defaultModelId === undefined ? {} : { defaultModelId: effectiveView.defaultModelId }),
      promptTemplateRefs: effectiveView.promptTemplateRefs,
      renderedToolNames: effectiveView.renderedToolNames,
      skillCapabilityIds: effectiveView.skillCapabilityIds,
      agentCapabilityIds: effectiveView.agentCapabilityIds,
    };
  }
  if (timelineType === 'CAPABILITY_STARTED' || timelineType === 'CAPABILITY_COMPLETED') {
    const payload = isJsonObject(refs['payload']) ? refs['payload'] : {};
    return {
      status: effectiveView.status,
      ...(typeof payload['capabilityId'] === 'string' ? { capabilityId: payload['capabilityId'] } : {}),
      ...(typeof payload['capabilityKind'] === 'string' ? { capabilityKind: payload['capabilityKind'] } : {}),
      ...(typeof payload['toolName'] === 'string' ? { toolName: payload['toolName'] } : {}),
      ...(typeof refs['targetAgentId'] === 'string' ? { targetAgentId: refs['targetAgentId'] } : {}),
      ...(typeof refs['childRunId'] === 'string' ? { childRunId: refs['childRunId'] } : {}),
    };
  }
  if (refs['agentAssemblyRef'] !== undefined) {
    return {
      status: effectiveView.status,
      ...(effectiveView.agentId === undefined ? {} : { agentId: effectiveView.agentId }),
      ...(effectiveView.agentVersion === undefined ? {} : { agentVersion: effectiveView.agentVersion }),
      ...(effectiveView.agentAssemblyRef === undefined ? {} : { agentAssemblyRef: effectiveView.agentAssemblyRef }),
    };
  }
  return {};
}

function hasAnyKey(payload: JsonObject, keys: readonly string[]): boolean {
  return keys.some((key) => payload[key] !== undefined);
}

function actionTypeFor(type: TimelineEventType): AgentDevWorkbenchActionType {
  if (type === 'PLANNING_STARTED') {
    return 'scheduler';
  }
  if (type === 'USER_INPUT_REQUIRED' || type === 'USER_INPUT_RECEIVED' || type === 'USER_INPUT_TIMEOUT' || type === 'USER_INPUT_CANCELED') {
    return 'context';
  }
  if (type.startsWith('MODEL_') || type.startsWith('LLM_')) {
    return 'model';
  }
  if (type.startsWith('CAPABILITY_') || type === 'TOOL_STRUCTURED_DELTA') {
    return 'capability';
  }
  if (type === 'CONTEXT_COMPACTED') {
    return 'context_compaction';
  }
  if (type === 'POLICY_APPLIED') {
    return 'policy';
  }
  if (type === 'HOOK_INVOKED') {
    return 'hook';
  }
  if (type.startsWith('REQUEST_')) {
    return terminalEvent(type) ? 'terminal' : 'request';
  }
  return 'stream';
}

function graphAvailability(events: readonly RunTimelineEventRecord[], truncated: boolean): AgentDevWorkbenchDetailAvailability {
  if (truncated) {
    return { status: 'truncated', reasonCode: 'TIMELINE_EVENT_LIMIT_EXCEEDED' };
  }
  return events.length === 0 ? { status: 'partial', reasonCode: 'TIMELINE_UNAVAILABLE' } : { status: 'available' };
}

function isGraphDeltaEvent(type: TimelineEventType): boolean {
  return type.includes('DELTA');
}

function gatewayOperationSummaries(payload: JsonObject): readonly ProjectedGatewayOperation[] {
  const value = payload['gatewayOperations'];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry): readonly ProjectedGatewayOperation[] => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return [];
    }
    const candidate = entry as Record<string, unknown>;
    const gatewayKind = candidate['gatewayKind'];
    const operation = candidate['operation'];
    const status = candidate['status'];
    if (typeof gatewayKind !== 'string' || typeof operation !== 'string' || typeof status !== 'string') {
      return [];
    }
    return [
      {
        gatewayKind,
        operation,
        status,
        ...(typeof candidate['durationMs'] === 'number' ? { durationMs: candidate['durationMs'] } : {}),
        ...(typeof candidate['timeoutMs'] === 'number' ? { timeoutMs: candidate['timeoutMs'] } : {}),
        ...(typeof candidate['resultCountBucket'] === 'string' ? { resultCountBucket: candidate['resultCountBucket'] } : {}),
        ...(typeof candidate['safeErrorCode'] === 'string' ? { safeErrorCode: candidate['safeErrorCode'] } : {}),
        ...(typeof candidate['safeErrorCategory'] === 'string' ? { safeErrorCategory: candidate['safeErrorCategory'] } : {}),
      },
    ];
  });
}

function gatewayStatus(status: unknown): AgentDevWorkbenchGraphNode['status'] {
  if (status === 'FAILED' || status === 'TIMED_OUT') {
    return 'failed';
  }
  if (status === 'CANCELED') {
    return 'canceled';
  }
  if (status === 'DEGRADED' || status === 'UNKNOWN') {
    return 'partial';
  }
  return 'completed';
}

function statusForEvent(type: TimelineEventType, runStatus: RunStatus): AgentDevWorkbenchGraphNode['status'] {
  if (type.endsWith('_FAILED') || type === 'REQUEST_FAILED') {
    return 'failed';
  }
  if (type === 'REQUEST_CANCELED') {
    return 'canceled';
  }
  if (terminalEvent(type) || type.endsWith('_COMPLETED') || type.endsWith('_RECEIVED')) {
    return 'completed';
  }
  return terminalStatus(runStatus) ? 'completed' : 'running';
}

function terminalEvent(type: TimelineEventType): boolean {
  return type === 'REQUEST_COMPLETED' || type === 'REQUEST_FAILED' || type === 'REQUEST_CANCELED' || type === 'REQUEST_SUPERSEDED';
}

function terminalStatus(status: RunStatus): boolean {
  return status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELED' || status === 'SUPERSEDED';
}

async function readBoundedLogEntries(
  activeOperationalLog: () => { readonly file: string } | undefined,
  query: AgentDevWorkbenchLogEvidenceQuery,
): Promise<readonly AgentDevWorkbenchLogEvidenceEntry[]> {
  const active = activeOperationalLog();
  if (active === undefined) {
    return [];
  }
  try {
    const entries = await withLogReadDeadline(readActiveLogTail(active.file, query), 250);
    return activeOperationalLog()?.file === active.file ? entries : [];
  } catch {
    return [];
  }
}

async function readActiveLogTail(file: string, query: AgentDevWorkbenchLogEvidenceQuery): Promise<readonly AgentDevWorkbenchLogEvidenceEntry[]> {
  const fileStat = await lstat(file);
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
    return [];
  }
  const handle = await open(file, 'r');
  try {
    const current = await handle.stat();
    const maxBytes = 512_000;
    const start = Math.max(0, current.size - maxBytes);
    const bytes = Buffer.alloc(Math.min(maxBytes, current.size));
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, start);
    let text = bytes.subarray(0, bytesRead).toString('utf8');
    if (start > 0) {
      const firstNewline = text.indexOf('\n');
      text = firstNewline < 0 ? '' : text.slice(firstNewline + 1);
    }
    const entries: AgentDevWorkbenchLogEvidenceEntry[] = [];
    for (const line of text.split(/\r?\n/u)) {
      const parsed = parseOperationalLogLine(line);
      if (parsed === undefined || !matchesLogEvidence(parsed, query)) {
        continue;
      }
      const timestamp = logTimestamp(line);
      if (timestamp !== undefined && query.fromEpochMillis !== undefined && timestamp < query.fromEpochMillis) {
        continue;
      }
      if (timestamp !== undefined && query.toEpochMillis !== undefined && timestamp > query.toEpochMillis) {
        continue;
      }
      entries.push({
        source: parsed['surface'] === 'runtime_diagnostic' ? 'runtime-diagnostic-log' : 'structured-safe-log',
        ...(timestamp === undefined ? {} : { timestamp }),
        message: line.slice(0, 2_000),
        refs: {
          requestRunId: query.requestRunId,
          ...(query.requestId === undefined ? {} : { requestId: query.requestId }),
          ...(query.sessionId === undefined ? {} : { sessionId: query.sessionId }),
          ...(query.agentId === undefined ? {} : { agentId: query.agentId }),
          ...(query.agentVersion === undefined ? {} : { agentVersion: query.agentVersion }),
          ...(query.requestContextId === undefined ? {} : { requestContextId: query.requestContextId }),
          ...(query.capabilityInvocationId === undefined ? {} : { capabilityInvocationId: query.capabilityInvocationId }),
        },
      });
      if (entries.length >= 101) {
        return entries;
      }
    }
    return entries;
  } finally {
    await handle.close();
  }
}

function parseOperationalLogLine(line: string): Record<string, unknown> | undefined {
  if (line.length === 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(line) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }
    const entry = parsed as Record<string, unknown>;
    return entry['surface'] === 'runtime_diagnostic' || entry['surface'] === 'observation_derived' ? entry : undefined;
  } catch {
    return undefined;
  }
}

function matchesLogEvidence(entry: Record<string, unknown>, query: AgentDevWorkbenchLogEvidenceQuery): boolean {
  const correlation = objectField(entry, 'correlation');
  const ownerScope = objectField(entry, 'ownerScope');
  return (
    matchesAny([entry['requestRunId'], entry['runId'], correlation?.['requestRunId']], query.requestRunId) &&
    matchesOptional([entry['requestId'], correlation?.['requestId']], query.requestId) &&
    matchesOptional([entry['sessionId'], correlation?.['sessionId']], query.sessionId) &&
    matchesOptional([entry['agentId'], ownerScope?.['agentId']], query.agentId) &&
    matchesOptional([entry['agentVersion'], ownerScope?.['agentVersion']], query.agentVersion) &&
    matchesOptional([entry['requestContextId'], correlation?.['requestContextId']], query.requestContextId) &&
    matchesOptional([entry['capabilityInvocationId'], correlation?.['capabilityInvocationId']], query.capabilityInvocationId)
  );
}

function objectField(entry: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = entry[key];
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function matchesOptional(candidates: readonly unknown[], expected?: string): boolean {
  return expected === undefined || matchesAny(candidates, expected);
}

function matchesAny(candidates: readonly unknown[], expected: string): boolean {
  return candidates.some((candidate) => candidate === expected);
}

async function withLogReadDeadline<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('LOG_ACTIVE_READ_TIMEOUT')), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function logTimestamp(line: string): number | undefined {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    const value = parsed['time'] ?? parsed['timestamp'];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const millis = Date.parse(value);
      return Number.isFinite(millis) ? millis : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function parseSessionQuery(raw: unknown): AgentDevWorkbenchSessionQuery {
  const query = raw as AgentDevWorkbenchSessionQuery;
  return {
    ...(query.agentId === undefined ? {} : { agentId: query.agentId }),
    ...(query.sessionId === undefined ? {} : { sessionId: query.sessionId }),
    ...(query.requestRunId === undefined ? {} : { requestRunId: query.requestRunId }),
    ...(query.limit === undefined ? {} : { limit: Number(query.limit) }),
  };
}

function parseRunQuery(raw: unknown): AgentDevWorkbenchRunQuery {
  const query = raw as AgentDevWorkbenchRunQuery;
  return {
    ...(query.agentId === undefined ? {} : { agentId: query.agentId }),
    ...(query.sessionId === undefined ? {} : { sessionId: query.sessionId }),
    ...(query.requestRunId === undefined ? {} : { requestRunId: query.requestRunId }),
    ...(query.limit === undefined ? {} : { limit: Number(query.limit) }),
  };
}

function addOptionalFilter(where: string[], values: Array<string | number>, column: string, value?: string): void {
  if (value !== undefined && value.length > 0) {
    where.push(`${column} = ?`);
    values.push(value);
  }
}

function whereClause(where: readonly string[]): string {
  return where.length === 0 ? '' : `WHERE ${where.join(' AND ')}`;
}

function normalizedAllowedAgentIds(scope: AgentDevWorkbenchAccessScope): readonly string[] {
  return [...new Set(scope.allowedAgentIds.filter((agentId) => agentId.trim().length > 0))].sort();
}

function sqlPlaceholders(values: readonly unknown[]): string {
  return values.map(() => '?').join(', ');
}

function normalizeLimit(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.min(max, Math.trunc(value)));
}

function parseJson<T>(json: string): T {
  return JSON.parse(json) as T;
}

function unavailableSessionPage(reasonCode: string): AgentDevWorkbenchSessionPage {
  return { entries: [], detailAvailability: { status: 'unavailable', reasonCode } };
}

function unavailableConversation(sessionId: string, reasonCode: string): AgentDevWorkbenchConversationView {
  return { sessionId, messages: [], detailAvailability: { status: 'unavailable', reasonCode } };
}

function unavailableRunPage(reasonCode: string): AgentDevWorkbenchRunPage {
  return { entries: [], detailAvailability: { status: 'unavailable', reasonCode } };
}

function unavailableGraph(requestRunId: string, reasonCode: string): AgentDevWorkbenchGraphView {
  return {
    requestRunId,
    nodes: [],
    edges: [],
    effectiveView: {
      status: 'unavailable',
      modelIds: [],
      promptTemplateRefs: [],
      disclosedCapabilityIds: [],
      renderedToolNames: [],
      skillCapabilityIds: [],
      agentCapabilityIds: [],
      agentConfigurationAvailability: { status: 'unavailable', reasonCode },
    },
    detailAvailability: { status: 'unavailable', reasonCode },
  };
}

interface JsonRow {
  readonly json: string;
}

interface RunJsonRow extends JsonRow {
  readonly root_message_summary: string | null;
}

interface AgentSessionCountRow {
  readonly agent_id: string;
  readonly session_count: number;
  readonly latest_session_at: number;
}

interface SubagentChildSessionRow {
  readonly agent_id: string;
  readonly session_id: string;
  readonly parent_session_id: string | null;
  readonly parent_run_id: string | null;
  readonly parent_request_id: string | null;
  readonly idempotency_key: string | null;
}

type SubagentChildRunRow = JsonRow;

interface SessionListRow {
  readonly tenant_id: string;
  readonly subject_id: string;
  readonly agent_id: string;
  readonly session_id: string;
  readonly parent_session_id: string | null;
  readonly parent_run_id: string | null;
  readonly parent_request_id: string | null;
  readonly title: string | null;
  readonly created_at: number;
  readonly updated_at: number;
  readonly latest_run_status: string | null;
}
