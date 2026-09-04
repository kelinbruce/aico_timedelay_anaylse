import { createNextAgentTestApp, readCapturedAuditRecords } from '@nextagent/agent-platform-gateway-local/testing';
import { brand } from '@nextagent/agent-common';
import type { RunTimelineEvent } from '@nextagent/agent-contracts/runtime';

export const agentId = brand<string, 'AgentId'>('default-agent');
export const identity = {
  tenantId: brand<string, 'TenantId'>('tenant-lifecycle-hook'),
  subjectId: brand<string, 'SubjectId'>('subject-lifecycle-hook'),
  displayName: 'Lifecycle hook tester',
};

export const apps: Array<{ close: () => Promise<void> }> = [];

export async function closeLifecycleHookApps(): Promise<void> {
  await Promise.all(apps.splice(0, apps.length).map(async (app) => app.close()));
}

export async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for lifecycle hook execution.');
}

export async function waitForTimelineEvent(
  app: ReturnType<typeof createNextAgentTestApp>,
  sessionId: string,
  runId: string,
  type: RunTimelineEvent['type'],
  timeoutMs = 5_000,
): Promise<RunTimelineEvent> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = await app.gateway.timeline.listEvents({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId: sessionId as never,
      runId: runId as never,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 200,
    });
    const match = events.find((event) => event.type === type);
    if (match !== undefined) {
      return match as unknown as RunTimelineEvent;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for timeline event ${type}.`);
}

export async function listTimelineEvents(
  app: ReturnType<typeof createNextAgentTestApp>,
  sessionId: string,
  runId: string,
): Promise<readonly RunTimelineEvent[]> {
  const events = await app.gateway.timeline.listEvents({
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    agentId,
    sessionId: sessionId as never,
    runId: runId as never,
    afterSequence: brand<number, 'TimelineSequence'>(0),
    limit: 200,
  });
  return events as unknown as readonly RunTimelineEvent[];
}

export async function waitForAuditEvent(
  app: ReturnType<typeof createNextAgentTestApp>,
  eventName: string,
  timeoutMs = 5_000,
  predicate?: (event: { readonly eventName: string; readonly requestRunId?: string; readonly attributes: Record<string, unknown> }) => boolean,
): Promise<{ readonly eventName: string; readonly requestRunId?: string; readonly attributes: Record<string, unknown> }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = readCapturedAuditRecords(app);
    const match = events
      .map(
        (event) => event as unknown as { readonly eventName: string; readonly requestRunId?: string; readonly attributes: Record<string, unknown> },
      )
      .find((event) => event.eventName === eventName && (predicate === undefined || predicate(event)));
    if (match !== undefined) {
      return match;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for audit event ${eventName}.`);
}
