import { Type } from '@sinclair/typebox';

const detailAvailabilitySchema = Type.Object({
  status: Type.Union([Type.Literal('available'), Type.Literal('partial'), Type.Literal('unavailable'), Type.Literal('truncated')]),
  reasonCode: Type.Optional(Type.String()),
});

export const agentQuerySchema = Type.Object({
  agentId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
});

export const conversationQuerySchema = Type.Object({
  requestRunId: Type.String({ minLength: 1, maxLength: 128 }),
  agentId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
});

export const sessionQuerySchema = Type.Object({
  agentId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  sessionId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  requestRunId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
});

export const runQuerySchema = Type.Object({
  agentId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  sessionId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  requestRunId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
});

export const logQuerySchema = Type.Object({
  agentId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  requestId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  sessionId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  agentVersion: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  requestContextId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  capabilityInvocationId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  fromEpochMillis: Type.Optional(Type.Integer({ minimum: 0 })),
  toEpochMillis: Type.Optional(Type.Integer({ minimum: 0 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
});

export const agentPageSchema = Type.Object({
  entries: Type.Array(
    Type.Object({
      agentId: Type.String(),
      agentVersion: Type.Optional(Type.String()),
      agentAssemblyRef: Type.Optional(Type.String()),
      displayName: Type.Optional(Type.String()),
      description: Type.Optional(Type.String()),
      sourceKind: Type.Optional(Type.String()),
      agentInvocation: Type.Optional(Type.String()),
      kind: Type.Union([Type.Literal('agent'), Type.Literal('subagent'), Type.Literal('historical')]),
      userInvocable: Type.Optional(Type.Boolean()),
      parentAgentScope: Type.Optional(Type.Record(Type.String(), Type.Any())),
      sessionCount: Type.Number(),
      configuration: Type.Optional(Type.Record(Type.String(), Type.Any())),
      configurationAvailability: detailAvailabilitySchema,
    }),
  ),
  detailAvailability: detailAvailabilitySchema,
});

export const sessionPageSchema = Type.Object({
  entries: Type.Array(
    Type.Object({
      tenantId: Type.String(),
      subjectId: Type.String(),
      agentId: Type.String(),
      sessionId: Type.String(),
      title: Type.Optional(Type.String()),
      parentSessionId: Type.Optional(Type.String()),
      parentRunId: Type.Optional(Type.String()),
      parentRequestId: Type.Optional(Type.String()),
      createdAt: Type.Number(),
      updatedAt: Type.Number(),
      latestRunStatus: Type.Optional(Type.String()),
    }),
  ),
  detailAvailability: detailAvailabilitySchema,
});

export const conversationSchema = Type.Object({
  sessionId: Type.String(),
  messages: Type.Array(
    Type.Object({
      messageId: Type.String(),
      requestId: Type.String(),
      runId: Type.Optional(Type.String()),
      role: Type.String(),
      contentType: Type.String(),
      content: Type.String(),
      metadata: Type.Optional(Type.Any()),
      visible: Type.Boolean(),
      createdAt: Type.Number(),
    }),
  ),
  detailAvailability: detailAvailabilitySchema,
});

export const runPageSchema = Type.Object({
  entries: Type.Array(
    Type.Object({
      tenantId: Type.String(),
      subjectId: Type.String(),
      agentId: Type.String(),
      agentVersion: Type.String(),
      sessionId: Type.String(),
      requestId: Type.String(),
      runId: Type.String(),
      agentAssemblyRef: Type.String(),
      attempt: Type.Number(),
      parentRunId: Type.Optional(Type.String()),
      parentRequestId: Type.Optional(Type.String()),
      status: Type.String(),
      terminalCommitState: Type.String(),
      createdAt: Type.Number(),
      updatedAt: Type.Number(),
      rootMessageSummary: Type.Optional(Type.String()),
    }),
  ),
  detailAvailability: detailAvailabilitySchema,
});

export const graphSchema = Type.Object({
  requestRunId: Type.String(),
  nodes: Type.Array(Type.Any()),
  edges: Type.Array(Type.Any()),
  effectiveView: Type.Object({
    status: Type.Union([Type.Literal('reconstructed'), Type.Literal('current-view'), Type.Literal('partial'), Type.Literal('unavailable')]),
    agentId: Type.Optional(Type.String()),
    agentVersion: Type.Optional(Type.String()),
    agentAssemblyRef: Type.Optional(Type.String()),
    modelIds: Type.Array(Type.String()),
    defaultModelId: Type.Optional(Type.String()),
    promptTemplateRefs: Type.Array(Type.String()),
    disclosedCapabilityIds: Type.Array(Type.String()),
    renderedToolNames: Type.Array(Type.String()),
    skillCapabilityIds: Type.Array(Type.String()),
    agentCapabilityIds: Type.Array(Type.String()),
    agentConfiguration: Type.Optional(Type.Record(Type.String(), Type.Any())),
    agentConfigurationAvailability: detailAvailabilitySchema,
  }),
  detailAvailability: detailAvailabilitySchema,
});

export const actionDetailSchema = Type.Object({
  actionId: Type.String(),
  detailAvailability: detailAvailabilitySchema,
  status: Type.Optional(Type.String()),
  timing: Type.Optional(Type.Any()),
  refs: Type.Any(),
  safeSummary: Type.Any(),
  input: Type.Optional(Type.Any()),
  output: Type.Optional(Type.Any()),
  promptApproximation: Type.Optional(
    Type.Object({
      status: Type.Union([Type.Literal('approximate'), Type.Literal('partial'), Type.Literal('unavailable')]),
      authoritative: Type.Literal(false),
      templateRef: Type.Optional(Type.String()),
      template: Type.Optional(Type.Record(Type.String(), Type.Any())),
      selectedMessageRefs: Type.Array(Type.String()),
      selectedMessages: Type.Array(
        Type.Object({
          messageId: Type.String(),
          role: Type.String(),
          contentType: Type.String(),
          content: Type.String(),
        }),
      ),
      missingMessageRefs: Type.Array(Type.String()),
      renderedToolNames: Type.Array(Type.String()),
      limitations: Type.Array(Type.String()),
    }),
  ),
});

export const logEvidenceSchema = Type.Object({
  requestRunId: Type.String(),
  entries: Type.Array(
    Type.Object({
      source: Type.Union([Type.Literal('runtime-diagnostic-log'), Type.Literal('structured-safe-log')]),
      timestamp: Type.Optional(Type.Number()),
      message: Type.String(),
      refs: Type.Any(),
    }),
  ),
  detailAvailability: detailAvailabilitySchema,
});
