import type { ParameterExtractionPort, ParameterExtractionRequest, ParameterExtractionResult } from '@nextagent/agent-contracts/capability';
import type { AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { ModelSelectionService } from '@nextagent/agent-contracts/context';
import type { ModelInvocationService, ModelMessage } from '@nextagent/agent-contracts/model';
import type { JsonObject } from '@nextagent/agent-common';

export interface ParameterExtractionPortDependencies {
  readonly modelInvocationService: ModelInvocationService;
  readonly modelSelectionService: ModelSelectionService;
  readonly assemblyRegistry: AgentAssemblyRegistry;
}

export function createParameterExtractionPort(deps: ParameterExtractionPortDependencies): ParameterExtractionPort {
  return {
    async extractParams(request: ParameterExtractionRequest, signal: AbortSignal): Promise<ParameterExtractionResult> {
      try {
        const assembly = await deps.assemblyRegistry.require(request.agentId, request.agentVersion);
        const selection = await deps.modelSelectionService.select(
          {
            identityContext: request.identityContext,
            agentId: assembly.agentId,
            agentVersion: assembly.agentVersion,
            agentAssemblyRef: assembly.agentAssemblyRef,
            purpose: 'API_PARAMETER_EXTRACTION',
            flowVariables: {},
            mode: 'INITIAL',
            ...(request.locale === undefined ? {} : { locale: request.locale }),
          },
          signal,
        );
        if (selection.status === 'FAILED') {
          return {
            status: 'FAILED',
            safeErrorCode: 'PARAMETER_EXTRACTION_FAILED',
            safeErrorMessage: 'Parameter extraction model selection failed safely.',
          };
        }
        const configuration = selection.configuration;

        const messages: readonly ModelMessage[] = [
          {
            role: 'USER',
            content: [{ type: 'text', text: request.prompt }],
          },
        ];

        const result = await deps.modelInvocationService.complete(
          {
            invocationScope: {
              tenantId: request.identityContext.tenantId,
              subjectId: request.identityContext.subjectId,
              agentId: assembly.agentId,
              agentVersion: assembly.agentVersion,
              agentAssemblyRef: assembly.agentAssemblyRef,
              operationId: `${request.stepId}:parameter-extraction`,
              sessionId: request.sessionId,
              requestId: request.requestId,
              runId: request.runId,
            },
            modelId: configuration.modelId,
            messages,
            tools: [],
            temperature: configuration.temperature,
            maxOutputTokens: configuration.maxOutputTokens,
            topP: configuration.topP,
            ...(configuration.topK === undefined ? {} : { topK: configuration.topK }),
            ...(configuration.presencePenalty === undefined ? {} : { presencePenalty: configuration.presencePenalty }),
            ...(configuration.frequencyPenalty === undefined ? {} : { frequencyPenalty: configuration.frequencyPenalty }),
            ...(configuration.thinking === undefined ? {} : { thinking: configuration.thinking }),
            timeoutMs: Math.min(request.timeoutMs, configuration.defaultTimeoutMs),
            maxRetries: configuration.defaultMaxRetries,
          },
          signal,
        );

        if (result.safeError !== undefined) {
          const timedOut = result.safeError.category === 'TIMEOUT';
          return {
            status: timedOut ? 'TIMED_OUT' : 'FAILED',
            safeErrorCode: timedOut ? 'PARAMETER_EXTRACTION_TIMEOUT' : 'PARAMETER_EXTRACTION_FAILED',
            safeErrorMessage: timedOut ? 'Parameter extraction timed out.' : 'Parameter extraction failed safely.',
          };
        }

        const parameters = parseParameters(result.content);
        if (parameters === undefined) {
          return {
            status: 'FAILED',
            safeErrorCode: 'PARAMETER_EXTRACTION_FAILED',
            safeErrorMessage: 'Parameter extraction result could not be parsed.',
          };
        }

        return {
          status: 'SUCCEEDED',
          parameters,
        };
      } catch (error) {
        const isTimeout = signal.aborted || (error instanceof Error && error.name === 'AbortError');
        return {
          status: isTimeout ? 'TIMED_OUT' : 'FAILED',
          safeErrorCode: isTimeout ? 'PARAMETER_EXTRACTION_TIMEOUT' : 'PARAMETER_EXTRACTION_FAILED',
          safeErrorMessage: isTimeout ? 'Parameter extraction timed out.' : 'Parameter extraction failed safely.',
        };
      }
    },
  };
}

function parseParameters(content: string): JsonObject | undefined {
  const trimmed = content.trim();
  // New prompt returns a JSON array; try array first
  const arrayStart = trimmed.indexOf('[');
  const arrayEnd = trimmed.lastIndexOf(']');
  if (arrayStart !== -1 && arrayEnd !== -1 && arrayEnd > arrayStart) {
    try {
      const parsed = JSON.parse(trimmed.slice(arrayStart, arrayEnd + 1));
      if (Array.isArray(parsed) && parsed.length > 0) {
        const first = parsed[0];
        if (first !== null && typeof first === 'object' && !Array.isArray(first)) {
          return first as JsonObject;
        }
      }
      if (Array.isArray(parsed) && parsed.length === 0) {
        return undefined;
      }
    } catch {
      // Fall through to object parsing
    }
  }
  // Fallback: try parsing as a single JSON object
  const jsonStart = trimmed.indexOf('{');
  const jsonEnd = trimmed.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1));
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as JsonObject;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
