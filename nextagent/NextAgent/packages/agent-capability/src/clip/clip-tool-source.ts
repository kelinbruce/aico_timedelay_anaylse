import { AgentError, brand, type CapabilityId, type JsonObject, type SafeError } from '@nextagent/agent-common';
import type {
  CapabilityDescriptor,
  CapabilityExecutor,
  CapabilityInvocationRuntimeContext,
  CapabilityInvocationRequest,
  CapabilityInvocationResult,
  CapabilityProviderIdentity,
  CapabilityProviderConfig,
} from '@nextagent/agent-contracts/capability';

import type { CapabilityDiscovery } from '../discovery/discovery.js';
import { failed } from '../invocation/input-validation.js';
import { validateJsonSchema } from '../invocation/schema-validation.js';

export const clipServerProviderType = 'clip_server';
const RESERVED_TRACE_HEADER_NAMES = new Set(['traceparent', 'tracestate', 'x-task-event-id']);

export type ClipDiagnosticReasonCode =
  'CLIP_CONFIG_INVALID' | 'CLIP_RUNNER_UNAVAILABLE' | 'CLIP_DESCRIPTOR_INVALID' | 'CLIP_EXECUTION_UNAVAILABLE' | 'CLIP_RESULT_INVALID';

export interface ClipSafeDiagnostic {
  readonly reasonCode: ClipDiagnosticReasonCode;
  readonly providerId: string;
  readonly capabilityId?: CapabilityId;
  readonly safeCount?: number;
  readonly failureClass: SafeError['category'];
}

export interface ClipSourceOptions {
  readonly enabled: true;
  readonly clipPathRef: string;
  readonly endpointRef: string;
  readonly timeoutMs: number;
}

export interface ClipToolFact {
  readonly clipCapabilityId: string;
  readonly primitive: string;
  readonly capabilityId: CapabilityId;
  readonly displayName: string;
  readonly description: string;
  readonly inputSchema: JsonObject;
  readonly outputSchema: JsonObject;
  readonly metadata?: JsonObject;
  readonly ref?: string;
  readonly parameters?: readonly ClipToolParameter[];
  readonly bodyRequired?: boolean;
  readonly replayPolicy?: 'NON_IDEMPOTENT' | 'IDEMPOTENT';
}

export interface ClipToolParameter {
  readonly name: string;
  readonly location: 'path' | 'query' | 'header';
  readonly required: boolean;
}

export interface ClipExecutionRequest {
  readonly providerId: string;
  readonly clipPathRef: string;
  readonly endpointRef: string;
  readonly clipCapabilityId: string;
  readonly primitive: string;
  readonly ref?: string;
  readonly parameters?: readonly ClipToolParameter[];
  readonly bodyRequired?: boolean;
  readonly arguments: JsonObject;
  readonly timeoutMs: number;
}

export interface ClipCommandRunner {
  listTools: (provider: CapabilityProviderIdentity, options: ClipSourceOptions, signal: AbortSignal) => Promise<readonly unknown[]>;
  describeTool: (provider: CapabilityProviderIdentity, options: ClipSourceOptions, listedTool: unknown, signal: AbortSignal) => Promise<unknown>;
  executeTool: (request: ClipExecutionRequest, signal: AbortSignal, options?: ClipExecutionOptions) => Promise<unknown>;
}

export interface ClipExecutionOptions {
  readonly emitResultDelta?: (payload: JsonObject) => Promise<void>;
  readonly trustedHeaders?: Readonly<Record<string, string>>;
}

export interface ClipListedToolTarget {
  readonly target: string;
  readonly ref: string;
  readonly primitive?: string;
  readonly parameters?: readonly ClipToolParameter[];
  readonly bodyRequired?: boolean;
}

export interface ClipToolRegistryEntry {
  readonly provider: CapabilityProviderIdentity;
  readonly capabilityId: CapabilityId;
  readonly clipCapabilityId: string;
  readonly primitive: string;
  readonly sourceOptions: ClipSourceOptions;
  readonly inputSchema: JsonObject;
  readonly outputSchema: JsonObject;
  readonly ref?: string;
  readonly parameters?: readonly ClipToolParameter[];
  readonly bodyRequired?: boolean;
}

export class ClipToolRegistry {
  private readonly entries = new Map<string, ClipToolRegistryEntry>();

  register(entry: ClipToolRegistryEntry): void {
    this.entries.set(registryKey(entry.provider, entry.capabilityId), entry);
  }

  resolve(provider: CapabilityProviderIdentity, capabilityId: CapabilityId): ClipToolRegistryEntry | undefined {
    return this.entries.get(registryKey(provider, capabilityId));
  }
}

export interface ClipAdapterOptions {
  readonly registry: ClipToolRegistry;
  readonly runner?: ClipCommandRunner;
  readonly diagnostics?: ClipSafeDiagnostic[];
  readonly disclosureMode?: 'list' | 'tool-search';
}

const unavailableOutputSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['reasonCode'],
  properties: { reasonCode: { type: 'string', minLength: 1 } },
};
const genericJsonObjectOutputSchema: JsonObject = { type: 'object', additionalProperties: true };

export function isClipServerProvider(provider: CapabilityProviderIdentity): boolean {
  return provider.providerKind === 'CUSTOM' && provider.providerType === clipServerProviderType;
}

export function validateClipSourceOptions(config: CapabilityProviderConfig): ClipSourceOptions {
  if (!isClipServerProvider(config.provider)) {
    throw new AgentError({ code: 'CLIP_PROVIDER_TYPE_INVALID', message: 'CLIP provider type is invalid.', category: 'VALIDATION', retryable: false });
  }
  const customOptions = (config.options as { readonly customOptions?: unknown }).customOptions;
  if (!isRecord(customOptions)) {
    throw invalidConfig();
  }
  if (customOptions['enabled'] !== true) {
    throw invalidConfig();
  }
  const clipPathRef = readSafeRef(customOptions['clipPathRef']);
  const endpointRef = readSafeRef(customOptions['endpointRef']);
  const timeoutMs = customOptions['timeoutMs'];
  const retry = customOptions['retry'];
  const retryMaxAttemptsRaw = isRecord(retry) ? retry['maxAttempts'] : undefined;
  const retryMaxAttempts = Number.isInteger(retryMaxAttemptsRaw) ? Number(retryMaxAttemptsRaw) : 1;
  if (
    clipPathRef === undefined ||
    endpointRef === undefined ||
    !Number.isInteger(timeoutMs) ||
    Number(timeoutMs) <= 0 ||
    retryMaxAttempts < 1 ||
    retryMaxAttempts > 3
  ) {
    throw invalidConfig();
  }
  return { enabled: true, clipPathRef, endpointRef, timeoutMs: Number(timeoutMs) };
}

export class ClipBackedToolDiscovery implements CapabilityDiscovery {
  readonly discoveryMode = 'EAGER' as const;
  private readonly descriptorCache = new Map<string, CapabilityDescriptor>();

  constructor(
    readonly provider: CapabilityProviderIdentity,
    private readonly config: CapabilityProviderConfig,
    private readonly options: ClipAdapterOptions,
  ) {}

  async listAll(signal: AbortSignal): Promise<readonly CapabilityDescriptor[]> {
    let sourceOptions: ClipSourceOptions;
    try {
      sourceOptions = validateClipSourceOptions(this.config);
    } catch {
      this.record('CLIP_CONFIG_INVALID', 'VALIDATION');
      return [];
    }
    if (this.options.runner === undefined) {
      this.record('CLIP_RUNNER_UNAVAILABLE', 'UNAVAILABLE');
      return [unavailableDescriptor(this.provider, 'clip_server_unavailable', 'CLIP_RUNNER_UNAVAILABLE')];
    }
    let listedTools: readonly unknown[];
    try {
      listedTools = await this.options.runner.listTools(this.provider, sourceOptions, signal);
    } catch {
      this.record('CLIP_RUNNER_UNAVAILABLE', 'UNAVAILABLE');
      return [unavailableDescriptor(this.provider, 'clip_server_unavailable', 'CLIP_RUNNER_UNAVAILABLE')];
    }
    const descriptors: CapabilityDescriptor[] = [];
    let invalidCount = 0;
    for (const listedTool of listedTools) {
      if (this.options.disclosureMode === 'tool-search') {
        const listed = parseClipListedTool(listedTool);
        if (listed === undefined) {
          invalidCount += 1;
          this.record('CLIP_DESCRIPTOR_INVALID', 'VALIDATION');
          continue;
        }
        const fallback = fallbackClipToolFactFromListed(listedTool);
        if (fallback !== undefined) {
          this.registerToolEntry(fallback, sourceOptions);
        }
        descriptors.push(this.descriptorCache.get(listed.capabilityId) ?? deferredDescriptor(this.provider, listed));
        continue;
      }
      let fact: unknown;
      try {
        fact = await this.options.runner.describeTool(this.provider, sourceOptions, listedTool, signal);
      } catch {
        const fallback = fallbackClipToolFactFromListed(listedTool);
        if (fallback === undefined) {
          invalidCount += 1;
          this.record('CLIP_DESCRIPTOR_INVALID', 'VALIDATION');
          continue;
        }
        descriptors.push(this.registerParsedFact(fallback, sourceOptions));
        continue;
      }
      const parsed = parseOrNormalizeClipToolFact(listedTool, fact);
      if (parsed === undefined) {
        invalidCount += 1;
        this.record('CLIP_DESCRIPTOR_INVALID', 'VALIDATION');
        continue;
      }
      descriptors.push(this.registerParsedFact(parsed, sourceOptions));
    }
    if (invalidCount > 0) {
      this.record('CLIP_DESCRIPTOR_INVALID', 'VALIDATION', undefined, invalidCount);
    }
    return descriptors;
  }

  async resolve(capabilityId: CapabilityId, signal: AbortSignal): Promise<CapabilityDescriptor | undefined> {
    const cached = this.descriptorCache.get(capabilityId);
    if (cached !== undefined) {
      return cached;
    }
    let sourceOptions: ClipSourceOptions;
    try {
      sourceOptions = validateClipSourceOptions(this.config);
    } catch {
      this.record('CLIP_CONFIG_INVALID', 'VALIDATION', capabilityId);
      return undefined;
    }
    if (this.options.runner === undefined) {
      this.record('CLIP_RUNNER_UNAVAILABLE', 'UNAVAILABLE', capabilityId);
      return undefined;
    }
    let listedTools: readonly unknown[];
    try {
      listedTools = await this.options.runner.listTools(this.provider, sourceOptions, signal);
    } catch {
      this.record('CLIP_RUNNER_UNAVAILABLE', 'UNAVAILABLE', capabilityId);
      return undefined;
    }
    const listedTool = listedTools.find((candidate) => parseClipListedTool(candidate)?.capabilityId === capabilityId);
    if (listedTool === undefined) {
      return undefined;
    }
    let fact: unknown;
    try {
      fact = await this.options.runner.describeTool(this.provider, sourceOptions, listedTool, signal);
    } catch {
      const fallback = fallbackClipToolFactFromListed(listedTool);
      if (fallback === undefined || fallback.capabilityId !== capabilityId) {
        this.record('CLIP_DESCRIPTOR_INVALID', 'VALIDATION', capabilityId);
        return undefined;
      }
      return this.registerParsedFact(fallback, sourceOptions);
    }
    const parsed = parseOrNormalizeClipToolFact(listedTool, fact);
    if (parsed === undefined || parsed.capabilityId !== capabilityId) {
      this.record('CLIP_DESCRIPTOR_INVALID', 'VALIDATION', capabilityId);
      return undefined;
    }
    return this.registerParsedFact(parsed, sourceOptions);
  }

  private registerParsedFact(parsed: ClipToolFact, sourceOptions: ClipSourceOptions): CapabilityDescriptor {
    this.registerToolEntry(parsed, sourceOptions);
    const descriptor: CapabilityDescriptor = {
      capabilityId: parsed.capabilityId,
      kind: 'TOOL',
      provider: this.provider,
      version: '1',
      displayName: parsed.displayName,
      description: parsed.description,
      availabilityStatus: 'AVAILABLE',
      modelInvocable: this.options.disclosureMode !== 'tool-search',
      inputSchema: parsed.inputSchema,
      outputSchema: parsed.outputSchema,
      ...(parsed.metadata === undefined ? {} : { metadata: parsed.metadata }),
      replayPolicy: parsed.replayPolicy ?? 'NON_IDEMPOTENT',
      ...(this.options.disclosureMode === 'tool-search' ? { disclosurePolicy: { mode: 'DEFERRED' as const, searchHint: parsed.description } } : {}),
    };
    this.descriptorCache.set(parsed.capabilityId, descriptor);
    return descriptor;
  }

  private registerToolEntry(parsed: ClipToolFact, sourceOptions: ClipSourceOptions): void {
    this.options.registry.register({
      provider: this.provider,
      capabilityId: parsed.capabilityId,
      clipCapabilityId: parsed.clipCapabilityId,
      primitive: parsed.primitive,
      sourceOptions,
      inputSchema: parsed.inputSchema,
      outputSchema: parsed.outputSchema,
      ...(parsed.ref === undefined ? {} : { ref: parsed.ref }),
      ...(parsed.parameters === undefined ? {} : { parameters: parsed.parameters }),
      ...(parsed.bodyRequired === undefined ? {} : { bodyRequired: parsed.bodyRequired }),
    });
  }

  private record(reasonCode: ClipDiagnosticReasonCode, failureClass: SafeError['category'], capabilityId?: CapabilityId, safeCount?: number): void {
    if (this.options.diagnostics === undefined) {
      return;
    }
    const diagnostic: ClipSafeDiagnostic = {
      reasonCode,
      providerId: this.provider.providerId,
      failureClass,
      ...(capabilityId !== undefined && { capabilityId }),
      ...(safeCount !== undefined && { safeCount }),
    };
    this.options.diagnostics.push(diagnostic);
  }
}

export class ClipToolExecutor implements CapabilityExecutor {
  readonly capabilityKinds = ['TOOL'] as const;

  constructor(
    private readonly provider: CapabilityProviderIdentity,
    private readonly registry: ClipToolRegistry,
    private readonly runner?: ClipCommandRunner,
  ) {}

  async invoke(
    descriptor: CapabilityDescriptor,
    request: CapabilityInvocationRequest,
    signal: AbortSignal,
    runtimeContext?: CapabilityInvocationRuntimeContext,
  ): Promise<CapabilityInvocationResult> {
    if (signal.aborted) {
      return failed('CAPABILITY_ABORTED', 'Capability invocation was aborted.', 'CANCELED');
    }
    const entry = this.registry.resolve(descriptor.provider, request.capabilityId);
    if (entry === undefined || this.runner === undefined) {
      return failed(
        'CLIP_EXECUTION_UNAVAILABLE',
        'The requested CLIP-backed capability or its governed runner is no longer available, so execution did not start. Use ToolSearch to discover another available capability, answer without this integration, or stop and report the unavailable boundary.',
        'UNAVAILABLE',
      );
    }
    try {
      const trustedHeaders: Record<string, string> = {
        chatId: request.requestId,
        conversationId: request.sessionId,
        'x-user-id': request.identityContext.subjectId,
        ...(request.identityContext.displayName ? { 'x-user-name': request.identityContext.displayName } : {}),
      };
      const clipExecutionOptions = {
        ...(runtimeContext?.emitResultDelta === undefined
          ? {}
          : {
              emitResultDelta: async (payload: JsonObject) => {
                await runtimeContext.emitResultDelta?.({ structuredPayload: normalizeClipExecutionPayload(payload) });
              },
            }),
        trustedHeaders,
      };
      const result = await this.runner.executeTool(
        {
          providerId: entry.provider.providerId,
          clipPathRef: entry.sourceOptions.clipPathRef,
          endpointRef: entry.sourceOptions.endpointRef,
          clipCapabilityId: entry.clipCapabilityId,
          primitive: entry.primitive,
          ...(entry.ref === undefined ? {} : { ref: entry.ref }),
          ...(entry.parameters === undefined ? {} : { parameters: entry.parameters }),
          ...(entry.bodyRequired === undefined ? {} : { bodyRequired: entry.bodyRequired }),
          arguments: request.arguments,
          timeoutMs: request.timeoutMs,
        },
        signal,
        clipExecutionOptions,
      );
      const normalized = normalizeRunnerResult(result);
      if (normalized === undefined) {
        return failed(
          'CLIP_RESULT_INVALID',
          'The CLIP-backed capability returned a result that failed its declared output contract, so the result was not delivered. Do not repeat the same call unchanged; revise or narrow the request, choose another capability, or stop and report the invalid integration result.',
          'VALIDATION',
        );
      }
      return normalized;
    } catch {
      return failed(
        'CLIP_EXECUTION_UNAVAILABLE',
        'The governed CLIP execution boundary failed before a usable result was returned. Use ToolSearch to discover another available capability, answer without this integration, or stop and report the unavailable execution boundary.',
        'UNAVAILABLE',
      );
    }
  }
}

export function createClipBackedToolDiscovery(input: {
  readonly provider: CapabilityProviderIdentity;
  readonly config: CapabilityProviderConfig;
  readonly registry: ClipToolRegistry;
  readonly runner?: ClipCommandRunner;
  readonly diagnostics?: ClipSafeDiagnostic[];
  readonly disclosureMode?: 'list' | 'tool-search';
}): ClipBackedToolDiscovery {
  return new ClipBackedToolDiscovery(input.provider, input.config, input);
}

export function createClipToolExecutor(input: {
  readonly provider: CapabilityProviderIdentity;
  readonly registry: ClipToolRegistry;
  readonly runner?: ClipCommandRunner;
}): ClipToolExecutor {
  return new ClipToolExecutor(input.provider, input.registry, input.runner);
}

export function clipDescribeTarget(listedTool: unknown): ClipListedToolTarget {
  const parsed = parseClipListedToolTarget(listedTool);
  if (parsed === undefined) {
    throw new AgentError({
      code: 'CLIP_RUNNER_RESPONSE_INVALID',
      message: 'CLIP runner response is invalid.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  return parsed;
}

export function normalizeClipDescribeResult(listedTool: unknown, described: unknown): ClipToolFact {
  const listed = clipDescribeTarget(listedTool);
  if (isRecord(described) && isInternalClipToolFact(described)) {
    const parsed = parseClipToolFact(described);
    if (parsed !== undefined && parsed.capabilityId === listed.target) {
      return parsed;
    }
    throw new AgentError({
      code: 'CLIP_RUNNER_RESPONSE_INVALID',
      message: 'CLIP runner response is invalid.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  const capability = selectDescribedCapability(described, listed);
  if (capability === undefined) {
    throw new AgentError({
      code: 'CLIP_RUNNER_RESPONSE_INVALID',
      message: 'CLIP runner response is invalid.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  const target = readSafeText(capability['target_id'], 128) ?? readSafeText(capability['target'], 128) ?? listed.target;
  const ref = readClipRef(capability['ref_template']) ?? readClipRef(capability['ref']) ?? listed.ref;
  const primitive = readSafeText(capability['operation'], 128) ?? listed.primitive ?? 'query';
  const parameters = readClipParameters(capability['params']) ?? listed.parameters ?? [];
  const bodyRequired = typeof capability['body_required'] === 'boolean' ? capability['body_required'] : listed.bodyRequired;
  const description = readClipDescription(capability) ?? `${primitive} ${target}`;
  const metadata = readClipMetadata(capability, primitive);
  const outputSchema = readClipOutputSchema(metadata, primitive) ?? genericJsonObjectOutputSchema;
  return {
    capabilityId: brand<string, 'CapabilityId'>(target),
    clipCapabilityId: target,
    primitive,
    ref,
    displayName: target,
    description,
    inputSchema: clipInputSchema(parameters, bodyRequired === true),
    outputSchema,
    ...(metadata === undefined ? {} : { metadata }),
    parameters,
    ...(bodyRequired === undefined ? {} : { bodyRequired }),
    replayPolicy: primitive === 'query' ? 'IDEMPOTENT' : 'NON_IDEMPOTENT',
  };
}

function readClipOutputSchema(metadata: JsonObject | undefined, primitive: string): JsonObject | undefined {
  const clip = isJsonObject(metadata?.['clip']) ? metadata['clip'] : undefined;
  if (!isJsonObject(clip)) {
    return undefined;
  }
  const streamEventSchema = isJsonObject(clip['streamEventSchema']) ? clip['streamEventSchema'] : undefined;
  if (primitive === 'subscribe' && streamEventSchema !== undefined) {
    return {
      type: 'object',
      additionalProperties: true,
      properties: {
        events: {
          type: 'array',
          items: streamEventSchema,
        },
        completion: {
          type: 'object',
          additionalProperties: true,
        },
      },
    };
  }
  const responses = Array.isArray(clip['responses']) ? clip['responses'] : [];
  for (const response of responses) {
    if (!isJsonObject(response['content'])) {
      continue;
    }
    for (const content of Object.values(response['content'])) {
      if (!isJsonObject(content) || !isJsonObject(content['schema'])) {
        continue;
      }
      return content['schema'];
    }
  }
  return undefined;
}

export function buildClipExecutionArgs(request: ClipExecutionRequest, systemHeaders: Readonly<Record<string, string>> = {}): readonly string[] {
  const ref = request.ref ?? `/${request.clipCapabilityId}`;
  const args = [request.primitive, request.clipCapabilityId, ref];
  if (request.primitive === 'subscribe') {
    args.push('--format', 'jsonl');
  }
  const parameters = request.parameters ?? [];
  const declaredSystemHeaders = filterDeclaredSystemHeaders(parameters, systemHeaders);
  const { requestHeader, cleanArguments } = extractRequestHeader(request.arguments);
  const effectiveHeaders: Record<string, string> = { ...declaredSystemHeaders };
  for (const [name, value] of Object.entries(requestHeader)) {
    if (typeof value === 'string') {
      effectiveHeaders[name] = value;
    }
  }
  if (request.bodyRequired === true) {
    const body = computeBody(request, cleanArguments);
    if (parameters.length > 0) {
      const params = clipParamsEnvelope(cleanArguments, parameters, effectiveHeaders);
      args.push('--params', JSON.stringify(params));
    }
    args.push('-b', JSON.stringify(body));
    return args;
  }
  const params = clipParamsEnvelope(cleanArguments, parameters, effectiveHeaders);
  args.push('--params', JSON.stringify(params));
  return args;
}

function extractRequestHeader(arguments_: JsonObject): { requestHeader: JsonObject; cleanArguments: JsonObject } {
  const header = arguments_['request_header'];
  if (isJsonObject(header)) {
    const { request_header: _removed, ...rest } = arguments_;
    return { requestHeader: header, cleanArguments: rest as JsonObject };
  }
  return { requestHeader: {}, cleanArguments: arguments_ };
}

function computeBody(request: ClipExecutionRequest, cleanArguments: JsonObject): JsonObject {
  const explicitBody = cleanArguments['body'];
  if (isJsonObject(explicitBody)) {
    return explicitBody;
  }
  const parameters = request.parameters ?? [];
  if (parameters.length === 0) {
    return cleanArguments;
  }
  const declaredKeys = new Set(parameters.map((parameter) => parameter.name));
  const body: Record<string, JsonObject[keyof JsonObject]> = {};
  for (const [key, value] of Object.entries(cleanArguments)) {
    if (key !== 'body' && key !== 'request_header' && !declaredKeys.has(key)) {
      body[key] = value;
    }
  }
  return body as JsonObject;
}

function normalizeRunnerResult(value: unknown): CapabilityInvocationResult | undefined {
  if (isCapabilityInvocationResult(value)) {
    const structuredPayload = normalizeClipExecutionPayload(value.structuredPayload);
    return { ...value, structuredPayload };
  }
  if (!isJsonObject(value)) {
    return undefined;
  }
  const structuredPayload = normalizeClipExecutionPayload(value);
  return { status: 'SUCCEEDED', structuredPayload, generatedMessages: [], artifactRefs: [] };
}

function normalizeClipExecutionPayload(value: JsonObject): JsonObject {
  const event = normalizeClipSubscribeEventEnvelope(value);
  if (event !== undefined) {
    return event;
  }
  const subscribeEvents = readClipSubscribeEventEnvelopes(value);
  if (subscribeEvents === undefined) {
    // CLIpc wraps the real API response body as { data: { structured?: {}, raw?: string } }.
    // Unwrap it so consumers receive the actual API response directly.
    const unwrapped = unwrapClipDataRaw(value);
    if (unwrapped !== undefined) {
      return unwrapped;
    }
    return value;
  }
  const normalizedEvents = subscribeEvents.map(normalizeClipSubscribeEventEnvelope).filter((item): item is JsonObject => item !== undefined);
  const completion = readClipSubscribeCompletion(value);
  return {
    events: normalizedEvents,
    ...(completion === undefined ? {} : { completion }),
  };
}

// CLIpc wraps RESTful API responses as { data: { structured?: {}, raw?: string } }.
// Unwrap the inner JSON so capability consumers receive the real API body.
function unwrapClipDataRaw(value: JsonObject): JsonObject | undefined {
  const data = value['data'];
  if (!isJsonObject(data)) {
    return undefined;
  }
  // CLIpc may provide structured (parsed JSON object) or raw (original body
  // text). Prefer structured; fall back to raw only when structured is absent
  // or null.
  const structured = data['structured'];
  if (structured !== null && structured !== undefined && isJsonObject(structured)) {
    return structured;
  }
  const raw = data['raw'];
  if (typeof raw !== 'string' || raw.length === 0) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isJsonObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function normalizeClipSubscribeEventEnvelope(value: JsonObject): JsonObject | undefined {
  if (value['type'] !== 'clip.subscribe.event' || typeof value['data_raw'] !== 'string') {
    return undefined;
  }
  const eventName = readSafeText(value['event'], 128);
  const parsedData = readClipSubscribeData(value);
  return {
    ...(eventName === undefined ? {} : { event: eventName }),
    ...(parsedData === undefined ? {} : { data: parsedData }),
    data_raw: value['data_raw'],
  };
}

function readClipSubscribeEventEnvelopes(value: JsonObject): readonly JsonObject[] | undefined {
  const lines = value['lines'];
  if (Array.isArray(lines)) {
    const events = lines.filter((item): item is JsonObject => isJsonObject(item) && item['type'] === 'clip.subscribe.event');
    return events.length === 0 ? undefined : events;
  }
  const events = value['events'];
  if (Array.isArray(events)) {
    const subscribeEvents = events.filter((item): item is JsonObject => isJsonObject(item) && item['type'] === 'clip.subscribe.event');
    return subscribeEvents.length === 0 ? undefined : subscribeEvents;
  }
  return undefined;
}

function readClipSubscribeCompletion(value: JsonObject): JsonObject | undefined {
  const direct = normalizeClipSubscribeCompletion(value['completion']);
  if (direct !== undefined) {
    return direct;
  }
  const lines = value['lines'];
  if (!Array.isArray(lines)) {
    return undefined;
  }
  for (const line of lines) {
    const completion = normalizeClipSubscribeCompletion(line);
    if (completion !== undefined) {
      return completion;
    }
  }
  return undefined;
}

function normalizeClipSubscribeCompletion(value: unknown): JsonObject | undefined {
  if (!isJsonObject(value) || value['type'] !== 'clip.subscribe.completed') {
    return undefined;
  }
  const reason = readSafeText(value['reason'], 128);
  const eventCount = typeof value['event_count'] === 'number' ? value['event_count'] : undefined;
  return {
    type: 'clip.subscribe.completed',
    ...(reason === undefined ? {} : { reason }),
    ...(eventCount === undefined ? {} : { event_count: eventCount }),
  };
}

function readClipSubscribeData(value: JsonObject): JsonObject[keyof JsonObject] | undefined {
  const dataJson = value['data_json'];
  if (isJsonValue(dataJson)) {
    return dataJson;
  }
  try {
    const parsed = JSON.parse(value['data_raw'] as string) as unknown;
    return isJsonValue(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isInternalClipToolFact(value: Record<string, unknown>): boolean {
  return (
    typeof value['capabilityId'] === 'string' &&
    typeof value['clipCapabilityId'] === 'string' &&
    typeof value['primitive'] === 'string' &&
    typeof value['displayName'] === 'string' &&
    typeof value['description'] === 'string' &&
    isRecord(value['inputSchema']) &&
    isRecord(value['outputSchema'])
  );
}

function parseClipToolFact(value: unknown): ClipToolFact | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const capabilityId = readCapabilityId(value['capabilityId']);
  if (capabilityId === undefined) {
    return undefined;
  }
  const clipCapabilityId = readSafeRef(value['clipCapabilityId']);
  if (clipCapabilityId === undefined) {
    return undefined;
  }
  const primitive = readSafeRef(value['primitive']);
  if (primitive === undefined) {
    return undefined;
  }
  const displayName = readSafeText(value['displayName'], 128);
  if (displayName === undefined) {
    return undefined;
  }
  const description = readSafeText(value['description'], 512);
  if (description === undefined) {
    return undefined;
  }
  const inputSchema = readJsonSchema(value['inputSchema']);
  if (inputSchema === undefined) {
    return undefined;
  }
  const outputSchema = readJsonSchema(value['outputSchema']);
  if (outputSchema === undefined) {
    return undefined;
  }
  const metadata = isJsonObject(value['metadata']) ? value['metadata'] : undefined;
  const ref = readClipRef(value['ref']);
  const parameters = readClipParameters(value['parameters']);
  const bodyRequired = typeof value['bodyRequired'] === 'boolean' ? value['bodyRequired'] : undefined;
  const replayPolicy = value['replayPolicy'] === 'IDEMPOTENT' || value['replayPolicy'] === 'NON_IDEMPOTENT' ? value['replayPolicy'] : undefined;
  return {
    clipCapabilityId,
    primitive,
    capabilityId,
    displayName,
    description,
    inputSchema,
    outputSchema,
    ...(metadata === undefined ? {} : { metadata }),
    ...(ref === undefined ? {} : { ref }),
    ...(parameters === undefined ? {} : { parameters }),
    ...(bodyRequired === undefined ? {} : { bodyRequired }),
    ...(replayPolicy === undefined ? {} : { replayPolicy }),
  };
}

interface ClipListedTool {
  readonly capabilityId: CapabilityId;
  readonly displayName: string;
  readonly description: string;
  readonly searchHint?: string;
}

function parseClipListedTool(value: unknown): ClipListedTool | undefined {
  const listed = parseClipListedToolTarget(value);
  if (typeof value === 'string') {
    const capabilityId = readCapabilityId(value);
    if (capabilityId === undefined) {
      return undefined;
    }
    return {
      capabilityId,
      displayName: capabilityId,
      description: `${capabilityId} CLIP Tool.`,
    };
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const capabilityId =
    listed === undefined
      ? (readCapabilityId(value['capabilityId']) ??
        readCapabilityId(value['target']) ??
        readCapabilityId(value['target_id']) ??
        readCapabilityId(value['id']))
      : brand<string, 'CapabilityId'>(listed.target);
  if (capabilityId === undefined) {
    return undefined;
  }
  const displayName = readSafeText(value['displayName'], 128) ?? readSafeText(value['name'], 128) ?? capabilityId;
  const description =
    readSafeText(value['description'], 512) ??
    readSafeText(value['summary'], 512) ??
    (listed?.primitive === undefined ? undefined : `${listed.primitive} ${listed.target}`) ??
    `${capabilityId} CLIP Tool.`;
  const searchHint = readSafeText(value['searchHint'], 256) ?? readSafeText(value['search_hint'], 256) ?? readSafeText(value['description'], 256);
  return {
    capabilityId,
    displayName,
    description,
    ...(searchHint === undefined ? {} : { searchHint }),
  };
}

function deferredDescriptor(provider: CapabilityProviderIdentity, listed: ClipListedTool): CapabilityDescriptor {
  return {
    capabilityId: listed.capabilityId,
    kind: 'TOOL',
    provider,
    version: '1',
    displayName: listed.displayName,
    description: listed.description,
    availabilityStatus: 'AVAILABLE',
    modelInvocable: false,
    inputSchema: { type: 'object', additionalProperties: true },
    outputSchema: { type: 'object', additionalProperties: true },
    replayPolicy: 'NON_IDEMPOTENT',
    disclosurePolicy: {
      mode: 'DEFERRED',
      searchHint: listed.searchHint ?? listed.description,
    },
  };
}

function unavailableDescriptor(provider: CapabilityProviderIdentity, id: string, reason: string): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>(id),
    kind: 'TOOL',
    provider,
    displayName: 'CLIP Server unavailable',
    description: 'CLIP-backed tools are unavailable.',
    availabilityStatus: 'UNAVAILABLE',
    availabilityReason: reason,
    inputSchema: { type: 'object', additionalProperties: false },
    outputSchema: unavailableOutputSchema,
  };
}

function parseClipListedToolTarget(value: unknown): ClipListedToolTarget | undefined {
  if (typeof value === 'string') {
    const target = readSafeText(value, 128);
    return target === undefined ? undefined : { target, ref: `/${target}` };
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const target =
    readSafeText(value['target'], 128) ??
    readSafeText(value['target_id'], 128) ??
    readSafeText(value['capabilityId'], 128) ??
    readSafeText(value['clipCapabilityId'], 128) ??
    readSafeText(value['id'], 128);
  const ref = readClipRef(value['ref']) ?? readClipRef(value['ref_template']) ?? (target === undefined ? undefined : `/${target}`);
  if (target === undefined || ref === undefined) {
    return undefined;
  }
  const primitive = readSafeText(value['operation'], 128);
  const parameters = readClipParameters(value['params']);
  const bodyRequired = typeof value['body_required'] === 'boolean' ? value['body_required'] : undefined;
  return {
    target,
    ref,
    ...(primitive === undefined ? {} : { primitive }),
    ...(parameters === undefined ? {} : { parameters }),
    ...(bodyRequired === undefined ? {} : { bodyRequired }),
  };
}

function selectDescribedCapability(value: unknown, listed: ClipListedToolTarget): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const structured = isRecord(value['data']) && isRecord(value['data']['structured']) ? value['data']['structured'] : value;
  const candidates = Array.isArray(structured['callable_capabilities'])
    ? structured['callable_capabilities']
    : Array.isArray(structured['capabilities'])
      ? structured['capabilities']
      : [];
  const records = candidates.filter(isRecord);
  if (records.length === 0) {
    return undefined;
  }
  return records.find((candidate) => matchesListedTarget(candidate, listed));
}

function matchesListedTarget(candidate: Record<string, unknown>, listed: ClipListedToolTarget): boolean {
  const target = readSafeText(candidate['target_id'], 128) ?? readSafeText(candidate['target'], 128);
  const ref = readClipRef(candidate['ref_template']) ?? readClipRef(candidate['ref']);
  return target === listed.target && ref === listed.ref;
}

function readClipDescription(capability: Record<string, unknown>): string | undefined {
  const responses = capability['responses'];
  if (!Array.isArray(responses)) {
    return undefined;
  }
  for (const response of responses) {
    if (!isRecord(response)) {
      continue;
    }
    const description = readSafeText(response['description'], 512);
    if (description !== undefined) {
      return description;
    }
  }
  return undefined;
}

function parseOrNormalizeClipToolFact(listedTool: unknown, fact: unknown): ClipToolFact | undefined {
  const parsed = parseClipToolFact(fact);
  if (parsed !== undefined) {
    return parsed;
  }
  if (isRecord(fact) && isInternalClipToolFact(fact)) {
    const capabilityId = readCapabilityId(fact['capabilityId']);
    const inputSchema = readJsonSchema(fact['inputSchema']);
    const outputSchema = readJsonSchema(fact['outputSchema']);
    return capabilityId !== undefined && inputSchema !== undefined && outputSchema === undefined
      ? fallbackClipToolFactFromListed(listedTool)
      : undefined;
  }
  try {
    return normalizeClipDescribeResult(listedTool, fact);
  } catch {
    return undefined;
  }
}

function fallbackClipToolFactFromListed(listedTool: unknown): ClipToolFact | undefined {
  const listed = parseClipListedToolTarget(listedTool);
  if (listed === undefined) {
    return undefined;
  }
  const searchable = parseClipListedTool(listedTool);
  const primitive = listed.primitive ?? 'query';
  const parameters = listed.parameters ?? [];
  return {
    capabilityId: brand<string, 'CapabilityId'>(listed.target),
    clipCapabilityId: listed.target,
    primitive,
    ref: listed.ref,
    displayName: searchable?.displayName ?? listed.target,
    description: searchable?.description ?? `${primitive} ${listed.target}`,
    inputSchema: clipInputSchema(parameters, listed.bodyRequired === true),
    outputSchema: genericJsonObjectOutputSchema,
    parameters,
    ...(listed.bodyRequired === undefined ? {} : { bodyRequired: listed.bodyRequired }),
    replayPolicy: primitive === 'query' ? 'IDEMPOTENT' : 'NON_IDEMPOTENT',
  };
}

function readClipMetadata(capability: Record<string, unknown>, primitive: string): JsonObject | undefined {
  const responses = readClipResponseMetadata(capability['responses']);
  if (responses.length === 0) {
    return undefined;
  }
  const streamEventSchema = readClipStreamEventSchema(responses);
  return {
    clip: {
      operation: primitive,
      responses,
      ...(streamEventSchema === undefined ? {} : { streamEventSchema }),
    },
  };
}

function readClipResponseMetadata(value: unknown): readonly JsonObject[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const responses: JsonObject[] = [];
  for (const response of value) {
    if (!isRecord(response)) {
      continue;
    }
    const status = readSafeText(response['status'] ?? response['code'], 32);
    const description = readSafeText(response['description'], 512);
    const contentTypes = readSafeStringArray(response['content_types'], 128);
    const content = readClipResponseContent(response['content']);
    if (status === undefined && description === undefined && contentTypes.length === 0 && content === undefined) {
      continue;
    }
    responses.push({
      ...(status === undefined ? {} : { status }),
      ...(description === undefined ? {} : { description }),
      ...(contentTypes.length === 0 ? {} : { contentTypes }),
      ...(content === undefined ? {} : { content }),
    });
  }
  return responses;
}

function readClipResponseContent(value: unknown): JsonObject | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const entries: Record<string, JsonObject> = {};
  for (const [contentType, content] of Object.entries(value)) {
    if (!isRecord(content) || readSafeText(contentType, 128) === undefined) {
      continue;
    }
    const schema = readJsonSchema(content['schema']);
    const example = isJsonValue(content['example']) ? content['example'] : undefined;
    if (schema === undefined && example === undefined) {
      continue;
    }
    entries[contentType] = {
      ...(schema === undefined ? {} : { schema }),
      ...(example === undefined ? {} : { example }),
    };
  }
  return Object.keys(entries).length === 0 ? undefined : entries;
}

function readClipStreamEventSchema(responses: readonly JsonObject[]): JsonObject | undefined {
  for (const response of responses) {
    const content = response['content'];
    if (!isJsonObject(content)) {
      continue;
    }
    for (const [contentType, value] of Object.entries(content)) {
      const normalizedContentType = contentType.split(';')[0]?.trim().toLowerCase();
      if (normalizedContentType !== 'text/event-stream') {
        continue;
      }
      const schema = isJsonObject(value) ? value['schema'] : undefined;
      if (isJsonObject(schema)) {
        return schema;
      }
    }
  }
  return undefined;
}

function readSafeStringArray(value: unknown, maxLength: number): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => readSafeText(item, maxLength)).filter((item): item is string => item !== undefined);
}

function invalidConfig(): AgentError {
  return new AgentError({ code: 'CLIP_CONFIG_INVALID', message: 'CLIP source configuration is invalid.', category: 'VALIDATION', retryable: false });
}

function readCapabilityId(value: unknown): CapabilityId | undefined {
  const text = readSafeText(value, 128);
  if (text === undefined || text === 'clipc' || text === 'clip_api_call' || text.includes('api_name')) {
    return undefined;
  }
  return brand<string, 'CapabilityId'>(text);
}

function readSafeRef(value: unknown): string | undefined {
  const text = readSafeText(value, 256);
  if (text === undefined || !/^[A-Za-z0-9._-]+$/u.test(text)) {
    return undefined;
  }
  return text;
}

function readClipRef(value: unknown): string | undefined {
  const text = readSafeText(value, 512);
  if (text === undefined || !text.startsWith('/') || text.includes('..') || text.includes('\\')) {
    return undefined;
  }
  return text;
}

function readClipParameters(value: unknown): readonly ClipToolParameter[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  const parameters: ClipToolParameter[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      return undefined;
    }
    const name = readSafeText(item['name'], 128);
    const location = item['location'];
    if (name === undefined || (location !== 'path' && location !== 'query' && location !== 'header')) {
      return undefined;
    }
    parameters.push({ name, location, required: item['required'] === true });
  }
  return parameters;
}

function clipInputSchema(parameters: readonly ClipToolParameter[], bodyRequired: boolean): JsonObject {
  const properties: Record<string, JsonObject> = {};
  for (const parameter of parameters) {
    properties[parameter.name] = { type: 'string' };
  }
  if (bodyRequired) {
    if (parameters.length === 0) {
      return { type: 'object', additionalProperties: true };
    }
    properties['body'] = { type: 'object', additionalProperties: true };
  }
  return {
    type: 'object',
    additionalProperties: true,
    properties,
  };
}

function clipParamsEnvelope(
  input: JsonObject,
  parameters: readonly ClipToolParameter[],
  systemHeaders: Readonly<Record<string, string>>,
): JsonObject {
  const pathBucket: Record<string, unknown> = {};
  const queryBucket: Record<string, unknown> = {};
  const headerBucket: Record<string, unknown> = {};
  if (parameters.length === 0) {
    Object.assign(queryBucket, input);
    Object.assign(headerBucket, systemHeaders);
    return buildParamsEnvelope(pathBucket, queryBucket, headerBucket);
  }
  for (const parameter of parameters) {
    const value = input[parameter.name];
    if (value === undefined) {
      continue;
    }
    if (parameter.location === 'path') {
      pathBucket[parameter.name] = value;
    } else if (parameter.location === 'query') {
      queryBucket[parameter.name] = value;
    } else {
      headerBucket[parameter.name] = value;
    }
  }
  const mergedHeaders = mergeTrustedHeaders(headerBucket as JsonObject, systemHeaders);
  return buildParamsEnvelope(pathBucket, queryBucket, mergedHeaders);
}

function buildParamsEnvelope(
  pathBucket: Record<string, unknown>,
  queryBucket: Record<string, unknown>,
  headerBucket: Record<string, unknown>,
): JsonObject {
  const envelope: Record<string, unknown> = {};
  if (Object.keys(pathBucket).length > 0) {
    envelope['path'] = pathBucket;
  }
  if (Object.keys(queryBucket).length > 0) {
    envelope['query'] = queryBucket;
  }
  if (Object.keys(headerBucket).length > 0) {
    envelope['header'] = headerBucket;
  }
  return envelope as JsonObject;
}

function mergeTrustedHeaders(untrustedHeaders: JsonObject, trustedHeaders: Readonly<Record<string, string>>): JsonObject {
  const filtered = Object.fromEntries(Object.entries(untrustedHeaders).filter(([name]) => !RESERVED_TRACE_HEADER_NAMES.has(name.toLowerCase())));
  return { ...filtered, ...trustedHeaders };
}

function filterDeclaredSystemHeaders(
  parameters: readonly ClipToolParameter[],
  systemHeaders: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const declaredHeaderNames = new Set(
    parameters.filter((parameter) => parameter.location === 'header').map((parameter) => parameter.name.toLowerCase()),
  );
  return Object.fromEntries(Object.entries(systemHeaders).filter(([name]) => declaredHeaderNames.has(name.toLowerCase())));
}

function readSafeText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength || /[\r\n]/u.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function readJsonSchema(value: unknown): JsonObject | undefined {
  if (!isJsonObject(value)) {
    return undefined;
  }
  try {
    validateJsonSchema(value, undefined);
    return value;
  } catch {
    return undefined;
  }
}

function isCapabilityInvocationResult(value: unknown): value is CapabilityInvocationResult {
  return (
    isRecord(value) &&
    (value['status'] === 'SUCCEEDED' || value['status'] === 'FAILED' || value['status'] === 'DEGRADED' || value['status'] === 'TIMED_OUT') &&
    isJsonObject(value['structuredPayload']) &&
    Array.isArray(value['generatedMessages']) &&
    Array.isArray(value['artifactRefs'])
  );
}

function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function isJsonValue(value: unknown): value is JsonObject[keyof JsonObject] {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    isJsonObject(value) ||
    (Array.isArray(value) && value.every(isJsonValue))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function registryKey(provider: CapabilityProviderIdentity, capabilityId: CapabilityId): string {
  return `${provider.providerId}\0${capabilityId}`;
}
