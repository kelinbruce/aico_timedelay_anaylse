import { brand } from '@nextagent/agent-common';
import type {
  ContextAssembly,
  ContextCompressionEvidence,
  RenderedModelInput,
  SystemPromptSection,
  TraceableSummaryDraft,
  TraceableSummaryGenerationPort,
  TraceableSummaryGenerationRequest,
} from '@nextagent/agent-contracts/context';
import type { CheckpointStoreGateway, RunTimelineEventStoreGateway } from '@nextagent/agent-contracts/gateway';
import type { AgentRunStatePort } from '@nextagent/agent-contracts/runtime';
import type { ReplacementEvidence, SessionMessage } from '@nextagent/agent-contracts/session';
import { createIdentityFixture } from '@nextagent/agent-test-kit';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const contextSource = () => readFile(join(process.cwd(), 'packages/agent-contracts/src/context/index.ts'), 'utf8');
const sessionSource = () => readFile(join(process.cwd(), 'packages/agent-contracts/src/session/index.ts'), 'utf8');
const promptShapingSource = () =>
  readFile(join(process.cwd(), 'packages/agent-context-engine/src/prompt-shaping'), 'utf8')
    .then(async (dir) => {
      // dir is a directory; concatenate every .ts under it. We can't read
      // a directory via readFile, so re-implement by listing with the
      // caller-supplied helper below.
      return dir;
    })
    .catch(async () => {
      // Fall back to walking the prompt-shaping directory explicitly.
      const { readdir } = await import('node:fs/promises');
      const root = join(process.cwd(), 'packages/agent-context-engine/src/prompt-shaping');
      const collected: string[] = [];
      const walk = async (current: string): Promise<void> => {
        for (const entry of await readdir(current, { withFileTypes: true })) {
          const full = join(current, entry.name);
          if (entry.isDirectory()) {
            await walk(full);
          } else if (entry.name.endsWith('.ts')) {
            collected.push(await readFile(full, 'utf8'));
          }
        }
      };
      await walk(root);
      return collected.join('\n');
    });
const rendererSource = () => readFile(join(process.cwd(), 'packages/agent-context-engine/src/prompt-shaping/model-input-renderer.ts'), 'utf8');

describe('context-assembly-contracts refinement', () => {
  // Task 2.1
  it('keeps SystemPromptSection.sectionId public and treats sectionKey as legacy only', async () => {
    const section: SystemPromptSection = {
      sectionId: 'identity',
      heading: '# System',
      content: '...',
      metadata: { overridable: false, order: 1, dependencies: [] },
    };
    const source = await contextSource();
    const sectionBlock = source.slice(source.indexOf('interface SystemPromptSection '), source.indexOf('interface SystemPrompt '));
    const metadataBlock = source.slice(source.indexOf('interface SystemPromptSectionMetadata'), source.indexOf('interface SystemPromptSection '));

    expect(section.sectionId).toBe('identity');
    // sectionId is the top-level public identifier on SystemPromptSection.
    expect(sectionBlock).toContain('readonly sectionId: string;');
    // sectionKey survives only as optional legacy metadata, never as a public id replacement.
    expect(sectionBlock).not.toContain('sectionKey');
    expect(metadataBlock).toContain('readonly sectionKey?: string;');
    expect(metadataBlock).toContain('Legacy template-internal key');
    expect(source).not.toContain('readonly sectionKey: string;');
  });

  // Task 2.2
  it('owns summary generation DTOs in agent-contracts/context with no parallel shape', async () => {
    const request: TraceableSummaryGenerationRequest = {
      identityContext: createIdentityFixture(),
      agentId: brand<string, 'AgentId'>('agent-1'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      sessionId: brand<string, 'SessionId'>('session-1'),
      requestId: brand<string, 'MessageId'>('message-1'),
      runId: brand<string, 'RequestRunId'>('run-1'),
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      purpose: 'SUMMARY_GENERATION',
      flowVariables: { networkEnvironment: 'lab' },
      coveredMessages: [] as readonly SessionMessage[],
      coveredMessageRefs: [],
      retainedTailMessageRefs: [],
      targetBudgetUnits: 1024,
    };
    const draft: TraceableSummaryDraft = {
      content: 'summary',
      sourceReferences: [],
      historyLookupLinkage: [],
      rehydrationHints: [],
      generationMode: 'normal',
      promptTemplateVersion: 'compact-summary/v1',
      inputUnitEstimate: 10,
      outputUnitEstimate: 5,
    };
    const port: TraceableSummaryGenerationPort = {
      async generate() {
        return draft;
      },
    };

    const result = await port.generate(request);
    expect(result.content).toBe('summary');
    expect(request.flowVariables).toEqual({ networkEnvironment: 'lab' });
    // Draft is an internal port DTO, not a persistable message: it carries no message identity / role.
    expect(Object.hasOwn(draft, 'messageId')).toBe(false);
    expect(Object.hasOwn(draft, 'role')).toBe(false);
    // DTOs are defined in context, not re-declared in session.
    const session = await sessionSource();
    expect(session).not.toContain('TraceableSummaryDraft');
    expect(session).not.toContain('TraceableSummaryGenerationRequest');
  });

  // Task 2.3
  it('crosses compression evidence only through ContextAssembly.compressionEvidence', async () => {
    const evidence: ContextCompressionEvidence = {
      sessionId: brand<string, 'SessionId'>('session-1'),
      requestId: brand<string, 'MessageId'>('message-1'),
      runId: brand<string, 'RequestRunId'>('run-1'),
      stepId: 'step-1',
      sourceActiveContextVersion: 4,
      targetActiveContextVersion: 5,
      summaryMessageId: brand<string, 'MessageId'>('summary-1'),
      strategy: 'PREFIX_COMPACT_RECENT_TAIL',
      coveredMessageRefCount: 12,
      retainedTailRefCount: 3,
      safeReason: 'history-over-budget',
      edgeLabel: 'CONTEXT_COMPACTED_EVIDENCE',
    };
    const assembly = { compressionEvidence: evidence } as Pick<ContextAssembly, 'compressionEvidence'>;
    const source = await contextSource();

    expect(assembly.compressionEvidence?.edgeLabel).toBe('CONTEXT_COMPACTED_EVIDENCE');
    expect(source).toContain('readonly compressionEvidence?: ContextCompressionEvidence;');
    // No alternate surface / lookup fallback / read-back helper.
    expect(source).not.toContain('lastCompressionEvidence');
    expect(source).not.toContain('readCompressionEvidence');
  });

  it('keeps prompt-shaping diagnostics and profile refs out of public context DTOs', async () => {
    const source = await contextSource();
    const assemblyBlock = source.slice(source.indexOf('interface ContextAssembly '), source.indexOf('export interface RenderedModelInput'));
    const renderedBlock = source.slice(
      source.indexOf('export interface RenderedModelInput'),
      source.indexOf('export interface ModelInputRenderRequest'),
    );
    const rendered: RenderedModelInput = {
      requestContextId: brand<string, 'RequestContextId'>('request-context'),
      messages: [],
      tools: [],
      modelConfiguration: {
        modelId: 'test-model',
        contextWindowTokens: 128_000,
        temperature: 0.55,
        maxOutputTokens: 32_000,
        topP: 1,
        toolChoice: 'AUTO' as const,
        defaultTimeoutMs: 30_000,
        defaultMaxRetries: 2,
      },
      modelOptions: {},
      providerOptions: {},
    };

    expect(rendered.requestContextId).toBe('request-context');
    expect(Object.hasOwn(rendered, 'diagnostics')).toBe(false);
    expect(Object.hasOwn(rendered, 'systemPrompt')).toBe(false);
    expect(Object.hasOwn(rendered, 'selectedMessageRefs')).toBe(false);
    expect(Object.hasOwn(rendered, 'rawSessionMessages')).toBe(false);
    expect(assemblyBlock).not.toContain('profileRef');
    expect(assemblyBlock).not.toContain('diagnostics');
    expect(assemblyBlock).not.toContain('attachmentRefs');
    expect(assemblyBlock).not.toContain('currentRequestRef');
    expect(renderedBlock).not.toContain('diagnostics');
    expect(renderedBlock).not.toContain('SystemPrompt');
    expect(renderedBlock).not.toContain('SessionMessageRecord');
  });

  // Task 2.4
  it('reuses existing checkpoint/timeline entry points and adds no runtime compression port', async () => {
    const checkpoint: Pick<CheckpointStoreGateway, 'saveCheckpoint'> = {
      async saveCheckpoint(record) {
        return record;
      },
    };
    const timeline: Pick<RunTimelineEventStoreGateway, 'appendEvent'> = {
      async appendEvent(record) {
        return record;
      },
    };
    const runState: Pick<AgentRunStatePort, 'emitEvent'> = {
      async emitEvent() {
        // existing runtime execution-path timeline entry point
      },
    };

    expect(checkpoint.saveCheckpoint).toBeTypeOf('function');
    expect(timeline.appendEvent).toBeTypeOf('function');
    expect(runState.emitEvent).toBeTypeOf('function');

    const gateway = await readFile(join(process.cwd(), 'packages/agent-contracts/src/gateway/index.ts'), 'utf8');
    const runtime = await readFile(join(process.cwd(), 'packages/agent-contracts/src/runtime/index.ts'), 'utf8');
    expect(gateway).toContain('saveCheckpoint: (record: CheckpointRecord, options:');
    expect(gateway).toContain('appendEvent: (record: RunTimelineEventRecord');
    // No runtime-specific compression port anywhere in the contracts.
    expect(gateway).not.toContain('RuntimeCompressionReconciliationPort');
    expect(runtime).not.toContain('RuntimeCompressionReconciliationPort');
    expect(runtime).not.toContain('recordCompression');
  });

  // tune-auto-compact-threshold: the proactive auto-compact headroom is a
  // fixed constant owned by the context engine; it MUST NOT be carried by
  // ContextAssemblyRequest, client request body, model output, or capability
  // arguments (same governance as the context-window source).
  it('does not carry the auto-compact headroom on ContextAssemblyRequest or in agent-contracts', async () => {
    const context = await contextSource();
    const requestBlock = context.slice(
      context.indexOf('export interface ContextAssemblyRequest '),
      context.indexOf('export interface', context.indexOf('export interface ContextAssemblyRequest ') + 1),
    );
    expect(requestBlock).not.toContain('autoCompactHeadroomUnits');
    expect(requestBlock).not.toContain('autoCompact');
    // The headroom is not a contract field anywhere in agent-contracts/context.
    expect(context).not.toContain('autoCompactHeadroomUnits');
    // It lives as a fixed constant in the context engine implementation.
    const assembleSource = await readFile(join(process.cwd(), 'packages/agent-context-engine/src/assembly/assemble-context.ts'), 'utf8');
    expect(assembleSource).toContain('DEFAULT_AUTO_COMPACT_HEADROOM_UNITS = 13_000');
  });

  // Task 2.5
  it('owns replacement evidence schema in agent-contracts/session and uses it for large content', async () => {
    const replacement: ReplacementEvidence = {
      kind: 'PERSISTED_PREVIEW',
      reason: 'policy:oversized-single-result',
      contentRef: { refId: 'ref-1', refType: 'CAPABILITY_RESULT' },
      originalSize: 100_000,
      previewSize: 512,
      contentType: 'text/plain',
      lineage: { sourceMessageId: null, sourceRunId: null, sourceInvocationId: null, stepId: null },
      decisionState: 'frozen',
      degradation: null,
    };
    const schemaRaw = await readFile(join(process.cwd(), 'packages/agent-contracts/src/session/replacement-evidence.schema.json'), 'utf8');
    const schema = JSON.parse(schemaRaw);

    expect(replacement.kind).toBe('PERSISTED_PREVIEW');
    expect(schema.$id).toContain('agent-contracts/session/replacement-evidence.schema.json');
    expect(schema.properties.kind.enum).toEqual(['INLINE', 'PERSISTED_PREVIEW', 'SPECIALIZED_REF', 'EMPTY_MARKER']);
    // The replacement evidence type and schema live in session, not in context.
    const session = await sessionSource();
    expect(session).toContain('interface ReplacementEvidence');
    const context = await contextSource();
    expect(context).not.toContain('interface ReplacementEvidence');
  });

  // Task 6.9 — SystemPrompt contract shape preservation.
  //
  // The system prompt is a single flat list of `sections`, ordered by
  // the builder's `defaultSectionOrder()`. The prompt-shaping pipeline
  // does NOT introduce `stableSections` / `dynamicSections` top-level
  // fields on `SystemPrompt`; the builder's internal
  // `STABLE_SECTION_KEYS` / `DYNAMIC_SECTION_KEYS` arrays are the only
  // place that categorization lives. The render stage re-derives
  // stable vs dynamic from the canonical `sectionId` list (or the
  // builder's `defaultSectionOrder`) — it MUST NOT read the legacy
  // `metadata.sectionKey` or `metadata.order` to do so.
  it('preserves the SystemPrompt core contract: flat `sections` only, no stableSections/dynamicSections split', async () => {
    const context = await contextSource();
    // Locate the SystemPrompt interface block.
    const start = context.indexOf('export interface SystemPrompt ');
    const end = context.indexOf('export ', start + 1);
    const block = context.slice(start, end);

    // Core shape: a single readonly `sections` array.
    expect(block).toContain('readonly sections: readonly SystemPromptSection[];');
    // Forbidden top-level splits — would silently re-introduce a
    // second source of truth for "stable vs dynamic" and conflict
    // with the builder's canonical order.
    expect(block).not.toContain('stableSections');
    expect(block).not.toContain('dynamicSections');
    expect(block).not.toContain('cacheBoundary');
    // The cache boundary is a TEXT marker rendered between the
    // stable and dynamic blocks, not a structural field.
  });

  it('canonical-renders SystemPrompt.sections in builder order', async () => {
    // Programmatic check: building a system prompt and reading the
    // emitted section ids must follow the canonical stable-then-
    // dynamic order from the default builder. This pins the
    // contract that downstream consumers can rely on the builder's
    // `defaultSectionOrder()` to map stable/dynamic positions
    // without reading legacy metadata.
    const { DefaultPromptTemplateAssembler, DefaultPromptTemplateRegistry, defaultSystemPromptSectionOrder } =
      await import('@nextagent/agent-context-engine');
    const expectedOrder = [
      'identity',
      'system_behavior',
      'task_approach',
      'communication_style',
      'agent_delegation',
      'tooling',
      'memory',
      'skill_disclosure',
      'action_safety',
      'context_management',
      'workspace',
      'runtime',
      'environment',
      'project_context',
      'dynamic_context',
      'session_context',
    ];
    expect(defaultSystemPromptSectionOrder()).toEqual(expectedOrder);

    const root = await mkdtemp(join(tmpdir(), 'nextagent-system-prompt-order-'));
    try {
      const templateRoot = join(root, 'SYSTEM_PROMPT');
      await mkdir(templateRoot, { recursive: true });
      await writeFile(
        join(templateRoot, 'template.yaml'),
        [
          'schemaVersion: nextagent.prompt-template/v1',
          'content:',
          '  - id: workspace',
          '    inline: Workspace first in manifest.',
          '  - id: identity',
          '    inline: Identity second in manifest.',
        ].join('\n'),
        'utf8',
      );
      const assembler = new DefaultPromptTemplateAssembler(new DefaultPromptTemplateRegistry(root));
      const prompt = await assembler.assemble({
        purpose: 'SYSTEM_PROMPT',
        agentId: 'a',
        agentVersion: 'v1',
        flowVariables: {},
        selectedModel: { modelId: 'MiniMax-M2.7-highspeed' },
      });
      expect(prompt.sections.map((section) => section.id)).toEqual(['identity', 'workspace']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }

    // The emitted `sections` list must be a strict subsequence of
    // the canonical order (sections with empty resolved content are
    // omitted, never reordered or duplicated).
    const emittedIds = ['identity', 'workspace'];
    for (let i = 0; i < emittedIds.length; i += 1) {
      expect(expectedOrder.indexOf(emittedIds[i]!)).toBeGreaterThanOrEqual(expectedOrder.indexOf(emittedIds[i - 1] ?? expectedOrder[0]!));
    }
  });

  it('prompt shaping and render do not read SystemPromptSection.metadata.sectionKey or metadata.order', async () => {
    const shaping = await promptShapingSource();
    const renderer = await rendererSource();

    // `metadata.sectionKey` and `metadata.order` exist ONLY as legacy
    // shape on the public section metadata; prompt shaping may not
    // read them when deciding which section to emit, when to
    // override, or when to render.
    //
    // The single legitimate use is the `metadata.sectionKey` literal
    // on the public `SystemPromptSectionMetadata` interface
    // declaration. We exclude that by anchoring on a non-public
    // usage: any access via `.metadata.sectionKey` (with the dot)
    // or `metadata.order` (with the dot) in shaping / builder /
    // renderer code is a violation.
    const forbidden = /metadata\.sectionKey|metadata\.order|metadata\[["']sectionKey["']\]|metadata\[["']order["']\]/gu;
    expect(shaping).not.toMatch(forbidden);
    expect(renderer).not.toMatch(forbidden);

    // And the only public-keyed access in the metadata interface is
    // the readonly declaration itself.
    const context = await contextSource();
    const metadataBlock = context.slice(context.indexOf('interface SystemPromptSectionMetadata'), context.indexOf('interface SystemPromptSection '));
    expect(metadataBlock).toContain('readonly sectionKey?: string;');
    expect(metadataBlock).toContain('readonly order: number;');
  });
});
