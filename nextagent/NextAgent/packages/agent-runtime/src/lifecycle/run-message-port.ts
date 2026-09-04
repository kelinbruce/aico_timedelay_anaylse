import { brand, type EpochMillis, type JsonObject } from '@nextagent/agent-common';
import type { SessionMessageStoreGateway } from '@nextagent/agent-contracts/gateway';
import type { LargeContentExternalizerPort, RequestContext, RequestRun, RunMessagePort } from '@nextagent/agent-contracts/runtime';
import type { GeneratedUserMessageDraft, SessionMessageDraft } from '@nextagent/agent-contracts/session';

export interface RuntimeOwnedRunMessagePortDependencies {
  readonly messageStore: SessionMessageStoreGateway;
  readonly clock: () => EpochMillis;
  readonly idFactory: (prefix: string) => string;
  readonly shouldSuppress?: () => boolean;
  readonly largeContentExternalizer?: LargeContentExternalizerPort;
}

export class RuntimeOwnedRunMessagePort implements RunMessagePort {
  constructor(private readonly deps: RuntimeOwnedRunMessagePortDependencies) {}

  async appendMessage(run: RequestRun, context: RequestContext, draft: SessionMessageDraft) {
    const messageId = brand<string, 'MessageId'>(this.deps.idFactory(draft.role === 'CAPABILITY_RESULT' ? 'capability-result' : 'assistant-tool'));
    if (this.deps.shouldSuppress?.() === true) {
      return messageId;
    }
    const externalizedDraft =
      (await this.deps.largeContentExternalizer?.externalize(draft, {
        identityContext: context.identityContext,
        agentId: run.agentId,
        agentVersion: run.agentVersion,
        agentAssemblyRef: run.agentAssemblyRef,
        sessionId: run.sessionId,
        requestId: run.requestId,
        runId: run.runId,
        requestContextId: context.requestContextId,
        messageId,
      })) ?? draft;
    const saved = await this.deps.messageStore.appendSessionMessage(
      {
        tenantId: context.identityContext.tenantId,
        subjectId: context.identityContext.subjectId,
        agentId: run.agentId,
        messageId,
        sessionId: run.sessionId,
        requestId: run.requestId,
        runId: run.runId,
        role: externalizedDraft.role,
        content: externalizedDraft.content,
        contentType: externalizedDraft.contentType,
        metadata: externalizedDraft.metadata ?? {},
        visible: externalizedDraft.visible,
        createdAt: this.deps.clock(),
      },
      externalizedDraft.idempotencyKey === undefined ? undefined : { idempotencyKey: externalizedDraft.idempotencyKey },
    );
    return saved.messageId;
  }

  async appendGeneratedUserMessage(run: RequestRun, context: RequestContext, draft: GeneratedUserMessageDraft) {
    const messageId = brand<string, 'MessageId'>(this.deps.idFactory('generated-user'));
    if (this.deps.shouldSuppress?.() === true) {
      return messageId;
    }
    // Generated USER messages (e.g. a directed-Skill body) carry inline text and
    // a fixed `visible`/`metadata` projection decided by the caller (page-hidden
    // + modelVisibility.included), so they do not run through the large-content
    // externalizer (which targets capability results). Persist directly as a
    // full SessionMessageRecord.
    const saved = await this.deps.messageStore.appendSessionMessage(
      {
        tenantId: context.identityContext.tenantId,
        subjectId: context.identityContext.subjectId,
        agentId: run.agentId,
        messageId,
        sessionId: run.sessionId,
        requestId: run.requestId,
        runId: run.runId,
        role: draft.role,
        content: draft.content,
        contentType: draft.contentType,
        metadata: draft.metadata ?? {},
        visible: draft.visible,
        createdAt: this.deps.clock(),
      },
      { idempotencyKey: draft.idempotencyKey },
    );
    return saved.messageId;
  }
}

export function createRuntimeOwnedRunMessagePort(deps: RuntimeOwnedRunMessagePortDependencies): RuntimeOwnedRunMessagePort {
  return new RuntimeOwnedRunMessagePort(deps);
}
