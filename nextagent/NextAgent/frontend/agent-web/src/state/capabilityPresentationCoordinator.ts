import type { StreamEnvelope } from './contracts.ts';
import { capabilityPresentationStore } from './capabilityPresentationStore.ts';

const capabilityKinds = new Set(['TOOL', 'SKILL', 'AGENT', 'WORKFLOW']);
const wrapperTargetKinds: Readonly<Record<string, string>> = {
  Agent: 'AGENT',
  Skill: 'SKILL',
  Workflow: 'WORKFLOW',
};
const acquisitionEventsBySession = new Map<string, Set<string>>();
const activatedSessions = new Set<string>();
let activeSessionId: string | undefined;

export function activateCapabilityPresentationResources(sessionId: string): void {
  if (activeSessionId === sessionId) {
    return;
  }
  const isReactivation = activatedSessions.has(sessionId) && activeSessionId !== sessionId;
  activatedSessions.add(sessionId);
  activeSessionId = sessionId;
  void (isReactivation ? capabilityPresentationStore.refresh(sessionId) : capabilityPresentationStore.activate(sessionId));
}

export function deactivateCapabilityPresentationResources(): void {
  activeSessionId = undefined;
}

export function observeCapabilityPresentationEvents(sessionId: string, events: readonly StreamEnvelope[]): void {
  const identities = new Set<string>();
  let acquisitionCompleted = false;
  const acquisitionEvents = acquisitionEventsBySession.get(sessionId) ?? new Set<string>();
  acquisitionEventsBySession.set(sessionId, acquisitionEvents);

  for (const event of events) {
    if (event.eventType !== 'CAPABILITY_STARTED' && event.eventType !== 'CAPABILITY_RESULT_DELTA' && event.eventType !== 'CAPABILITY_COMPLETED') {
      continue;
    }
    const payload = event.payload as Record<string, unknown>;
    const capabilityId = readIdentifier(payload.capabilityId);
    const capabilityKind =
      typeof payload.capabilityKind === 'string' && capabilityKinds.has(payload.capabilityKind) ? payload.capabilityKind : 'TOOL';
    if (capabilityId !== undefined) {
      identities.add(`${capabilityKind}:${capabilityId}`);
      const targetKind = wrapperTargetKinds[capabilityId];
      const targetCapabilityId = readIdentifier(payload.targetCapabilityId);
      if (targetKind !== undefined && targetCapabilityId !== undefined) {
        identities.add(`${targetKind}:${targetCapabilityId}`);
      }
    }
    if (
      event.eventType === 'CAPABILITY_COMPLETED' &&
      capabilityId === 'acquire_skill' &&
      payload.status === 'SUCCEEDED' &&
      !acquisitionEvents.has(event.eventId)
    ) {
      acquisitionEvents.add(event.eventId);
      acquisitionCompleted = true;
    }
  }

  void capabilityPresentationStore.observeIdentities(sessionId, [...identities]);
  if (acquisitionCompleted) {
    void capabilityPresentationStore.refresh(sessionId);
  }
}

export function clearCapabilityPresentationResources(sessionId: string): void {
  acquisitionEventsBySession.delete(sessionId);
  activatedSessions.delete(sessionId);
  if (activeSessionId === sessionId) {
    activeSessionId = undefined;
  }
  capabilityPresentationStore.clear(sessionId);
}

function readIdentifier(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 && Array.from(normalized).length <= 256 && !/\p{Cc}/u.test(normalized) ? normalized : undefined;
}
