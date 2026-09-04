import { getLogger } from '@nextagent/agent-common';
import type { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import type { Attributes, AttributeValue } from '@opentelemetry/api';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';

export function instrumentTraceExporterDiagnostics(exporter: OTLPTraceExporter): void {
  const exportSpans = exporter.export.bind(exporter);
  exporter.export = (spans, resultCallback) => {
    const mappedSpans = applyGenAiAttributes(spans);
    exportSpans(mappedSpans, (result) => {
      if (result.code !== 0 || result.error !== undefined) {
        const fields = {
          event: 'otel.trace.export.failed',
          failureStage: 'batch_export',
          exportResultCode: result.code,
        };
        if (result.error === undefined) {
          logger.error(fields);
        } else {
          logger.error({ ...fields, err: result.error });
        }
      }
      resultCallback(result);
    });
  };
}

/**
 * Maps NextAgent's `nextagent.*` span attributes to OpenTelemetry GenAI Semantic Conventions
 * (`gen_ai.*`) at the export boundary. Creates shallow copies of each `ReadableSpan` with merged
 * attributes — original spans are never modified. If mapping fails, the original spans are passed
 * through unchanged so export is not blocked.
 */
function applyGenAiAttributes(spans: readonly ReadableSpan[]): ReadableSpan[] {
  try {
    return spans.map((span) => mapSpan(span));
  } catch {
    return [...spans];
  }
}

function mapSpan(span: ReadableSpan): ReadableSpan {
  const genAiAttributes = computeGenAiAttributes(span.attributes);
  if (Object.keys(genAiAttributes).length === 0) {
    return span;
  }
  return {
    ...span,
    attributes: { ...span.attributes, ...genAiAttributes },
  };
}

function computeGenAiAttributes(attributes: Readonly<Attributes>): Attributes {
  const result: Attributes = {};
  copyAttribute(attributes, result, 'nextagent.owner.agent_id', 'gen_ai.agent.id');
  copyAttribute(attributes, result, 'nextagent.owner.agent_version', 'gen_ai.agent.version');
  copyAttribute(attributes, result, 'session.id', 'gen_ai.conversation.id');

  const observationType = attributes['nextagent.observation_type'];
  if (typeof observationType === 'string') {
    const operationName = GEN_AI_OPERATION_NAMES[observationType];
    if (operationName !== undefined) {
      result['gen_ai.operation.name'] = operationName;
    }
    const outcome = attributes['nextagent.outcome'];
    if (typeof outcome === 'string') {
      const responseStatus = mapResponseStatus(outcome);
      if (responseStatus !== undefined) {
        result['gen_ai.response.status'] = responseStatus;
      }
    }
  }

  // Model span gen_ai mapping: triggered by presence of usage token attributes.
  const hasInputTokens = attributes['nextagent.usage.input_tokens'] !== undefined;
  const hasOutputTokens = attributes['nextagent.usage.output_tokens'] !== undefined;
  if (hasInputTokens || hasOutputTokens) {
    copyAttribute(attributes, result, 'nextagent.usage.input_tokens', 'gen_ai.usage.input_tokens');
    copyAttribute(attributes, result, 'nextagent.usage.output_tokens', 'gen_ai.usage.output_tokens');
    copyAttribute(attributes, result, 'nextagent.usage.total_tokens', 'gen_ai.usage.total_tokens');
    copyAttribute(attributes, result, 'nextagent.duration_ms', 'gen_ai.client.operation.duration');
    if (hasInputTokens && hasOutputTokens) {
      result['gen_ai.token.type'] = 'input;output';
    } else if (hasInputTokens) {
      result['gen_ai.token.type'] = 'input';
    } else if (hasOutputTokens) {
      result['gen_ai.token.type'] = 'output';
    }
    const modelName = process.env.OPENAI_MODEL_NAME;
    if (modelName !== undefined) {
      result['gen_ai.request.model'] = modelName;
    }
    result['gen_ai.operation.name'] = 'chat';
  }

  return result;
}

function copyAttribute(source: Readonly<Attributes>, target: Attributes, sourceKey: string, targetKey: string): void {
  const value = source[sourceKey];
  if (value !== undefined) {
    target[targetKey] = value as AttributeValue;
  }
}

function mapResponseStatus(outcome: string): string | undefined {
  switch (outcome) {
    case 'success':
      return 'completed';
    case 'failure':
      return 'failed';
    case 'canceled':
      return 'cancelled';
    default:
      return undefined;
  }
}

const GEN_AI_OPERATION_NAMES: Readonly<Record<string, string>> = Object.freeze({
  request: 'invoke_agent',
  model: 'chat',
  tool: 'execute_tool',
  workflow_node: 'invoke_workflow',
});

const logger = getLogger({ component: 'agent-observability', source: 'trace-export' });
