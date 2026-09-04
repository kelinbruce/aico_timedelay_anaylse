import { AgentError } from '@nextagent/agent-common';
import {
  PromptTemplateResolveRequestSchema,
  PromptTemplateResolveResultSchema,
  type PromptTemplateResolveRequest,
  type PromptTemplateResolveResult,
  type PromptTemplateResolverPort,
} from '@nextagent/agent-contracts/context';
import { Ajv } from 'ajv/dist/ajv.js';
import { createDefaultPromptTemplateAssembler } from './prompt-template-assembler.js';
import type { PromptTemplateAssembler } from './prompt-template-types.js';

const ajv = new Ajv({ allErrors: true, strict: false });
const validateRequest = ajv.compile(PromptTemplateResolveRequestSchema);
const validateResult = ajv.compile(PromptTemplateResolveResultSchema);

export class DefaultPromptTemplateResolver implements PromptTemplateResolverPort {
  constructor(private readonly assembler: PromptTemplateAssembler = createDefaultPromptTemplateAssembler()) {}

  async resolve(request: PromptTemplateResolveRequest, signal: AbortSignal): Promise<PromptTemplateResolveResult> {
    throwIfAborted(signal);
    if (!validateRequest(request)) {
      throw resolverError('PROMPT_TEMPLATE_RESOLVE_REQUEST_INVALID', 'Prompt template resolve request is invalid.');
    }
    let result: PromptTemplateResolveResult;
    try {
      const assembled = await this.assembler.assemble({
        purpose: request.purpose,
        agentId: request.agentId,
        agentVersion: request.agentVersion,
        ...(request.locale === undefined ? {} : { locale: request.locale }),
        flowVariables: request.flowVariables,
        selectedModel: request.selectedModel,
        ...(request.memoryEnabled === undefined ? {} : { memoryEnabled: request.memoryEnabled }),
      });
      result = { status: 'RESOLVED', ...assembled };
    } catch (error) {
      if (!(error instanceof AgentError) || error.code !== 'PROMPT_TEMPLATE_NOT_FOUND') {
        throw error;
      }
      result = { status: 'NOT_FOUND' };
    }
    throwIfAborted(signal);
    if (!validateResult(result)) {
      throw resolverError('PROMPT_TEMPLATE_RESOLVE_RESULT_INVALID', 'Prompt template resolution produced an invalid result.', 'INTERNAL');
    }
    return result;
  }
}

export function createPromptTemplateResolver(assembler?: PromptTemplateAssembler): DefaultPromptTemplateResolver {
  return new DefaultPromptTemplateResolver(assembler);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason ?? resolverError('CANCELED', 'Prompt template resolution was canceled.', 'CANCELED');
  }
}

function resolverError(code: string, message: string, category: 'CANCELED' | 'INTERNAL' | 'VALIDATION' = 'VALIDATION'): AgentError {
  return new AgentError({ code, message, category, retryable: false });
}
