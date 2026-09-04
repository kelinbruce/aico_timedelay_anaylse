import { brand, type EpochMillis, type IdempotencyKey } from '@nextagent/agent-common';
import type { RunTimelineEventRecord, RunTimelineEventStoreGateway } from '@nextagent/agent-contracts/gateway';
import { type RequestContext, type RunTimelineEvent, type SubmitRequestCommand } from '@nextagent/agent-contracts/runtime';
import { runtimeTimelinePayload } from './runtime-payload.js';

export async function appendCanonicalEvent(
  timelineStore: RunTimelineEventStoreGateway,
  command: SubmitRequestCommand,
  context: RequestContext,
  event: RunTimelineEvent,
  idempotencyKey: IdempotencyKey,
  helpers: { now: () => EpochMillis; id: (prefix: string) => string },
): Promise<RunTimelineEventRecord> {
  return timelineStore.appendEvent(
    {
      tenantId: command.identityContext.tenantId,
      subjectId: command.identityContext.subjectId,
      agentId: context.agentId,
      agentVersion: context.agentVersion,
      eventId: event.eventId ?? helpers.id('event'),
      sessionId: context.sessionId,
      runId: context.runId,
      requestId: context.requestId,
      requestContextId: context.requestContextId,
      sequence: brand<number, 'TimelineSequence'>(0),
      type: event.type,
      inlinePayload: runtimeTimelinePayload(event.inlinePayload, context),
      createdAt: helpers.now(),
      ...(event.contentRef === undefined ? {} : { contentRef: event.contentRef }),
    },
    { idempotencyKey },
  );
}
