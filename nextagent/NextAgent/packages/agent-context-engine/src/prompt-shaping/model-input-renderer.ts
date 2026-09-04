import { AgentError, type JsonObject } from '@nextagent/agent-common';
import type { CapabilityContextPatch, CapabilityDescriptor, CapabilityGeneratedMessage } from '@nextagent/agent-contracts/capability';
import type {
  ContextAssembly,
  AttachmentContextEvidence,
  AttachmentDegradationEvidence,
  ModelInputRenderRequest,
  ModelInputRenderer,
  RenderedModelInput,
} from '@nextagent/agent-contracts/context';
import type { ModelMessage, ModelToolCall } from '@nextagent/agent-contracts/model';
import type { SessionMessage } from '@nextagent/agent-contracts/session';
import type { PromptShapingDiagnosticsSink } from './diagnostics.js';
import { renderSystemPromptContent } from './prompt-template-purpose-policy.js';
import { injectSystemReminders, smooshSystemReminderSiblings } from '../system-reminder/index.js';

export class DefaultModelInputRenderer implements ModelInputRenderer {
  constructor(private readonly diagnostics?: PromptShapingDiagnosticsSink) {}

  async render(request: ModelInputRenderRequest): Promise<RenderedModelInput> {
    this.diagnostics?.record({ event: 'renderStarted' });
    const generatedMessages = request.assembly.request.capabilityGeneratedMessages ?? [];
    const generatedCharBudget = request.maxGeneratedMessageChars ?? 70_000;
    if (generatedMessages.some((generated) => generated.content.length > generatedCharBudget)) {
      this.diagnostics?.record({
        event: 'fragmentRenderFailed',
        safeReason: 'capability-generated-context-budget-exceeded',
      });
      throw new AgentError({
        code: 'CAPABILITY_GENERATED_CONTEXT_BUDGET_EXCEEDED',
        message: 'Capability generated context exceeds the model context budget.',
        category: 'VALIDATION',
        retryable: false,
      });
    }

    const selectedMessages = request.selectedMessages.map(renderSelectedMessage);
    assertToolPairing(selectedMessages, this.diagnostics);

    // Surface the section-omission diagnostic for every builder section
    // whose resolved content is empty (the builder already omits these
    // before the renderer sees them, so this loop documents the omission
    // for the timeline event subscriber without affecting the rendered
    // message stream).
    for (const section of request.assembly.systemPrompt.sections) {
      if (section.content.trim().length === 0) {
        this.diagnostics?.record({
          event: 'sectionOmitted',
          section: { sectionId: section.sectionId, reason: 'empty-resolved-content' },
        });
      }
    }

    const messages: ModelMessage[] = [
      {
        role: 'SYSTEM',
        content: [{ type: 'text', text: renderSystemMessageText(request.assembly) }],
      },
      ...placeGeneratedMessages(selectedMessages, generatedMessages),
    ];

    // System-reminder pipeline (add-ts-system-reminder-memory-v1): inject any
    // reminders collected on the assembly request, then fold SR text blocks
    // that share a USER message with a tool-result into that tool-result's
    // output. Runs after assertToolPairing so tool-call/tool-result structure
    // is already validated; smoosh only touches text blocks. No-op when the
    // assembly carries no systemReminders (zero-impact regression).
    const injected = injectSystemReminders(messages, request.assembly.request.systemReminders);
    const smoothed = smooshSystemReminderSiblings(injected);

    const rendered = {
      requestContextId: request.assembly.request.requestContextId,
      messages: smoothed,
      tools: renderTools(request.assembly.visibleCapabilities, request.assembly.request.capabilityContextPatch),
      modelConfiguration: request.assembly.modelConfiguration,
      modelOptions: request.assembly.modelOptions,
      ...(request.assembly.modelOptions.providerOptions === undefined && request.providerOptions === undefined
        ? {}
        : {
            providerOptions: {
              ...(request.assembly.modelOptions.providerOptions ?? {}),
              ...(request.providerOptions ?? {}),
            },
          }),
    };
    this.diagnostics?.record({ event: 'renderCompleted' });
    return rendered;
  }
}

function placeGeneratedMessages(
  selectedMessages: readonly ModelMessage[],
  generatedMessages: readonly CapabilityGeneratedMessage[],
): readonly ModelMessage[] {
  const anchored = new Map<number, ModelMessage[]>();
  const unanchored: ModelMessage[] = [];

  // Skill bodies live on the Skill tool-result payload (`output.body`), which
  // persists as a CAPABILITY_RESULT session message. The conversation
  // projection clears CAPABILITY_RESULT content and the stream envelope projects
  // Skill results as STATUS_ONLY, so the body is model-visible but user-hidden.
  // The tool-result's `output.body` is therefore the single, in-place carrier
  // of the Skill body — the renderer must NOT reconstruct a separate
  // USER(<skill_content>) message from it, since that would duplicate the body
  // (once inside the tool-result, once as a standalone USER) and drift it out
  // of sequence position on later rounds. Only request-local
  // `generatedMessages` (non-Skill-body, e.g. terminal guard feedback) are
  // placed here, anchored after their matching tool-result when one exists.
  for (const generated of generatedMessages) {
    const rendered = renderGeneratedMessage(generated);
    const skillName = generated.meta === true ? generatedSkillName(generated.content) : undefined;
    let matchingResultIndex: number | undefined;
    if (skillName !== undefined) {
      matchingResultIndex = latestMatchingLoadedSkillResultIndex(selectedMessages, skillName);
    }
    let anchorIndex: number | undefined;
    if (matchingResultIndex !== undefined) {
      anchorIndex = toolResultBatchEndIndex(selectedMessages, matchingResultIndex);
    }
    if (anchorIndex === undefined) {
      unanchored.push(rendered);
      continue;
    }
    const messagesAtAnchor = anchored.get(anchorIndex) ?? [];
    messagesAtAnchor.push(rendered);
    anchored.set(anchorIndex, messagesAtAnchor);
  }

  return [...selectedMessages.flatMap((message, index) => [message, ...(anchored.get(index) ?? [])]), ...unanchored];
}

function renderGeneratedMessage(generated: CapabilityGeneratedMessage): ModelMessage {
  return {
    role: 'USER',
    content: [{ type: 'text', text: generated.content }],
  };
}

function generatedSkillName(content: string): string | undefined {
  return /^<skill_content name="(?<name>[^"]+)">/u.exec(content)?.groups?.['name'];
}

function latestMatchingLoadedSkillResultIndex(messages: readonly ModelMessage[], escapedSkillName: string): number | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const matches = messages[index]?.content.some(
      (part) =>
        part.type === 'tool-result' &&
        part.toolName === 'Skill' &&
        typeof part.output['name'] === 'string' &&
        escapeSkillAttribute(part.output['name']) === escapedSkillName &&
        part.output['status'] === 'loaded',
    );
    if (matches === true) {
      return index;
    }
  }
  return undefined;
}

function toolResultBatchEndIndex(messages: readonly ModelMessage[], matchingResultIndex: number): number {
  let batchEndIndex = matchingResultIndex;
  while (messages[batchEndIndex + 1]?.role === 'TOOL') {
    batchEndIndex += 1;
  }
  return batchEndIndex;
}

function escapeSkillAttribute(value: string): string {
  return value.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
}

export function createDefaultModelInputRenderer(): ModelInputRenderer {
  return new DefaultModelInputRenderer();
}

function renderSystemMessageText(assembly: ContextAssembly): string {
  const sectionBlock = renderSystemPromptContent(assembly.systemPrompt.sections);
  const clipcDisclosure = renderClipcToolSearchDisclosure(assembly.visibleCapabilities);
  const agentDisclosure = renderAgentDisclosure(assembly.visibleCapabilities);
  const attachmentDisclosure = renderAttachmentDisclosure(assembly.attachmentEvidence ?? []);
  const attachmentContentBlocks = renderAttachmentContentBlocks(assembly.attachmentContentBlocks ?? []);
  const attachmentDegradationDisclosure = renderAttachmentDegradationDisclosure(assembly.attachmentDegradationEvidence ?? []);
  const localeHint = `Locale/language hint: ${assembly.request.locale}.`;
  return `${sectionBlock}${clipcDisclosure}${agentDisclosure}${attachmentDisclosure}${attachmentContentBlocks}${attachmentDegradationDisclosure}\n${localeHint}`;
}

function renderSelectedMessage(message: SessionMessage): ModelMessage {
  return {
    role: message.role === 'CAPABILITY_RESULT' ? 'TOOL' : message.role === 'ASSISTANT' ? 'ASSISTANT' : 'USER',
    content: messageContentParts(message.role, message.content),
  };
}

function assertToolPairing(messages: readonly ModelMessage[], diagnostics?: PromptShapingDiagnosticsSink): void {
  const expectedToolResults: string[] = [];
  for (const message of messages) {
    if (message.role === 'ASSISTANT') {
      for (const part of message.content) {
        if (part.type === 'tool-call') {
          expectedToolResults.push(part.toolCall.toolCallId);
        }
      }
    }
    if (message.role === 'TOOL') {
      for (const part of message.content) {
        if (part.type !== 'tool-result') {
          continue;
        }
        const expected = expectedToolResults.shift();
        if (expected === undefined || expected !== part.toolCallId) {
          diagnostics?.record({ event: 'toolPairingRejected', safeReason: 'orphan-or-out-of-order-tool-result' });
          throw new AgentError({
            code: 'CONTEXT_RENDER_TOOL_PAIRING_INVALID',
            message: 'Rendered model input contains an orphan or out-of-order tool result.',
            category: 'VALIDATION',
            retryable: false,
          });
        }
      }
    }
  }
  if (expectedToolResults.length > 0) {
    diagnostics?.record({ event: 'toolPairingRejected', safeReason: 'assistant-tool-call-without-result' });
    throw new AgentError({
      code: 'CONTEXT_RENDER_TOOL_PAIRING_INVALID',
      message: 'Rendered model input contains an assistant tool call without a matching tool result.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
}

function renderTools(capabilities: readonly CapabilityDescriptor[], patch?: CapabilityContextPatch) {
  const allowed = new Set<string>(patch?.allowedTools ?? []);
  return capabilities.flatMap((capability) =>
    capability.kind !== 'TOOL' ||
    capability.inputSchema === undefined ||
    capability.disclosurePolicy?.mode === 'HIDDEN' ||
    isUngatedDeferredClipcTool(capability, allowed)
      ? []
      : [
          {
            capabilityId: capability.capabilityId,
            name: capability.capabilityId,
            description: renderToolDescription(capability),
            inputSchema: capability.inputSchema,
          },
        ],
  );
}

function renderToolDescription(capability: CapabilityDescriptor): string {
  const schemaHint = renderClipResponseSchemaHint(capability.metadata);
  return schemaHint.length === 0 ? capability.description : `${capability.description}\n\nCLIP response schema: ${schemaHint}`;
}

function renderClipResponseSchemaHint(metadata?: JsonObject): string {
  const clip = asJsonObject(metadata?.['clip']);
  if (clip === undefined) {
    return '';
  }
  const schema = asJsonObject(clip['streamEventSchema']) ?? firstClipResponseSchema(clip);
  if (schema === undefined) {
    return '';
  }
  const fields: string[] = [];
  collectSchemaFields(schema, '', fields, 0);
  return truncateText(fields.join('; '), 900);
}

function firstClipResponseSchema(clip: JsonObject): JsonObject | undefined {
  const responses = Array.isArray(clip['responses']) ? clip['responses'] : [];
  for (const response of responses) {
    const content = asJsonObject(asJsonObject(response)?.['content']);
    if (content === undefined) {
      continue;
    }
    for (const entry of Object.values(content)) {
      const schema = asJsonObject(asJsonObject(entry)?.['schema']);
      if (schema !== undefined) {
        return schema;
      }
    }
  }
  return undefined;
}

function collectSchemaFields(schema: JsonObject, path: string, fields: string[], depth: number): void {
  if (fields.length >= 16 || depth > 4) {
    return;
  }
  const properties = asJsonObject(schema['properties']);
  if (properties !== undefined) {
    if (path.length > 0) {
      fields.push(formatSchemaField(path, schema));
    }
    for (const [name, child] of Object.entries(properties)) {
      const childSchema = asJsonObject(child);
      if (childSchema !== undefined) {
        collectSchemaFields(childSchema, path.length === 0 ? name : `${path}.${name}`, fields, depth + 1);
      }
    }
    return;
  }
  if (path.length > 0) {
    fields.push(formatSchemaField(path, schema));
  }
}

function formatSchemaField(path: string, schema: JsonObject): string {
  const type = schemaTypeLabel(schema);
  const description = typeof schema['description'] === 'string' ? ` - ${truncateText(schema['description'].replace(/\s+/gu, ' ').trim(), 160)}` : '';
  return `${path}: ${type}${description}`;
}

function schemaTypeLabel(schema: JsonObject): string {
  const type = typeof schema['type'] === 'string' ? schema['type'] : 'unknown';
  const format = typeof schema['format'] === 'string' ? `/${schema['format']}` : '';
  const enumValues = Array.isArray(schema['enum'])
    ? ` enum(${schema['enum']
        .filter((value): value is string | number | boolean => ['string', 'number', 'boolean'].includes(typeof value))
        .slice(0, 6)
        .join(', ')})`
    : '';
  return `${type}${format}${enumValues}`;
}

function asJsonObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

function truncateText(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

function isUngatedDeferredClipcTool(capability: CapabilityDescriptor, allowed: ReadonlySet<string>): boolean {
  return isDeferredClipcTool(capability) && !capabilityRefs(capability).some((ref) => allowed.has(ref));
}

function renderAgentDisclosure(capabilities: readonly CapabilityDescriptor[]): string {
  const agents = capabilities.filter(
    (capability) => capability.kind === 'AGENT' && capability.availabilityStatus === 'AVAILABLE' && capability.modelInvocable === true,
  );
  if (agents.length === 0) {
    return '';
  }
  const available = agents.map((agent) => `- ${agent.capabilityId}: ${agent.description}`).join('\n');
  return `\n\n### Available agents\n${available}\n\n### How to use agents\n- Treat these as governed delegation targets only.\n- Do not invent agent names or refer to hidden provider, package, path, prompt, source, loading, or child assembly details.\n- Agent execution may be unavailable until a later execution change enables it.`;
}

function renderAttachmentDisclosure(attachmentEvidence: readonly AttachmentContextEvidence[]): string {
  if (attachmentEvidence.length === 0) {
    return '';
  }
  const lines = attachmentEvidence.map((evidence) => {
    const hasMetadata = evidence.fileName !== undefined && evidence.mediaType !== undefined && evidence.sizeBytes !== undefined;
    if (hasMetadata) {
      const sizeMB = (evidence.sizeBytes! / (1024 * 1024)).toFixed(2);
      const pathSuffix = evidence.modelPath === undefined ? '' : ` — read with the Read tool at path: ${evidence.modelPath}`;
      return `- ${evidence.fileName} (${evidence.mediaType}, ${sizeMB}MB)${pathSuffix}`;
    }
    return `- ${evidence.safeIdentifier} :: ${evidence.decision} :: ${evidence.reasonCode}`;
  });
  const hasReadableAttachment = attachmentEvidence.some((evidence) => evidence.modelPath !== undefined);
  const guidance = hasReadableAttachment
    ? '\n- To read an uploaded attachment, call the Read tool with the exact path shown above. Use the path verbatim — do not reconstruct it, prefix it, or discover the file through shell tools (the physical path differs from the Read-tool path).'
    : '';
  return `\n\n### Attachment context\n${lines.join('\n')}${guidance}`;
}

function renderAttachmentContentBlocks(blocks: readonly string[]): string {
  if (blocks.length === 0) {
    return '';
  }
  return [
    '\n\n### Attachment content',
    'Uploaded attachment content below is already available in this model input. Use it directly for the current request.',
    'Do not call the Read tool with an uploaded attachment file name; uploaded attachments are not workspace files unless an explicit workspace file path is provided.',
    blocks.join('\n\n'),
  ].join('\n');
}

function renderAttachmentDegradationDisclosure(degradationEvidence: readonly AttachmentDegradationEvidence[]): string {
  if (degradationEvidence.length === 0) {
    return '';
  }
  const lines = degradationEvidence.map((evidence) => `- ${evidence.safeReasonCode} :: ${evidence.projectionKind}`);
  return `\n\n### Attachment degradation\n${lines.join('\n')}`;
}

function renderClipcToolSearchDisclosure(capabilities: readonly CapabilityDescriptor[]): string {
  const hasToolSearch = capabilities.some(
    (capability) => capability.kind === 'TOOL' && capability.capabilityId === 'ToolSearch' && capability.availabilityStatus === 'AVAILABLE',
  );
  if (!hasToolSearch) {
    return '';
  }
  const deferredClipc = capabilities.filter(isDeferredClipcTool);
  const deferredBlock = renderDeferredCapabilityIdList(deferredClipc);
  if (deferredBlock.length === 0) {
    return '';
  }
  return `\n\n<available-deferred-clipc>\n${deferredBlock}\n</available-deferred-clipc>\n\n### How to use CLIP tools\n- CLIP Tool lazy loading is enabled by ToolSearch mode. \`<available-deferred-clipc>\` lists searchable CLIP Tool ids only; descriptions and schemas are not loaded into the default model tool list there.\n- Use \`ToolSearch\` to turn a relevant deferred CLIP id or search phrase into governed CLIP Tool metadata.\n- ToolSearch CLIP matches appear in \`<available-clipc>\` with \`capability_id\`, \`kind=TOOL\`, description, and \`defer_loading=true\`.\n- After ToolSearch finds a CLIP Tool, call the exact model tool named by \`capability_id\`; do not call a generic \`clipc\` dispatch tool and do not invent provider-private CLIP ids, primitives, commands, or API selector fields.\n- If no searched CLIP Tool is a clear match, continue with other available tools and normal reasoning.`;
}

function renderDeferredCapabilityIdList(capabilities: readonly CapabilityDescriptor[]): string {
  return capabilities
    .map((capability) => capability.capabilityId)
    .sort((left, right) => left.localeCompare(right, 'en'))
    .join('\n');
}

function isDeferredClipcTool(capability: CapabilityDescriptor): boolean {
  return (
    capability.kind === 'TOOL' &&
    capability.availabilityStatus === 'AVAILABLE' &&
    capability.provider.providerKind === 'CUSTOM' &&
    capability.provider.providerType === 'clip_server' &&
    capability.disclosurePolicy?.mode === 'DEFERRED'
  );
}

function capabilityRefs(capability: CapabilityDescriptor): readonly string[] {
  return [capability.capabilityId, `@${capability.provider.providerId}/${capability.capabilityId}`];
}

function messageContentParts(role: string, content: string): ModelMessage['content'] {
  const parsed = parseJsonObject(content);
  if (role === 'ASSISTANT' && Array.isArray(parsed?.toolCalls)) {
    const textParts = typeof parsed.content === 'string' && parsed.content.length > 0 ? [{ type: 'text' as const, text: parsed.content }] : [];
    const toolCallParts = parsed.toolCalls.flatMap((toolCall) => (isModelToolCall(toolCall) ? [{ type: 'tool-call' as const, toolCall }] : []));
    return [...textParts, ...toolCallParts];
  }
  if (role === 'CAPABILITY_RESULT' && typeof parsed?.toolCallId === 'string' && typeof parsed.toolName === 'string' && isJsonObject(parsed.payload)) {
    return [{ type: 'tool-result', toolCallId: parsed.toolCallId, toolName: parsed.toolName, output: parsed.payload }];
  }
  return [{ type: 'text', text: content }];
}

function parseJsonObject(value: string): JsonObject | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isJsonObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isModelToolCall(value: unknown): value is ModelToolCall {
  return isJsonObject(value) && typeof value.toolCallId === 'string' && typeof value.toolName === 'string' && isJsonObject(value.arguments);
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
