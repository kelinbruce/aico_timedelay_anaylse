import type { JsonObject } from '@nextagent/agent-common';
import type { CapabilityDescriptor } from '@nextagent/agent-contracts/capability';
import { isWorkflowCapability } from './workflow-capability.js';

const resultTextPreviewMaxChars = 4_000;

export function projectWorkflowDeltaSafeFields(descriptor: CapabilityDescriptor, result: JsonObject): JsonObject {
  if (!isWorkflowCapability(descriptor)) {
    return {};
  }
  const workflowDelta = readRecord(result['workflowDelta']);
  if (workflowDelta === undefined) {
    return {};
  }
  const channel = readString(workflowDelta['channel']);
  const content = readString(workflowDelta['content']);
  if (content === undefined) {
    return {};
  }
  const preview = previewText(content);
  return {
    safeSummary: channel === 'THINKING' ? 'Workflow is generating reasoning.' : 'Workflow is generating output.',
    safeDetailText: preview.text,
    safeResult: {
      kind: 'workflowDelta',
      ...(channel === undefined ? {} : { channel }),
      truncated: preview.truncated,
    },
  };
}

function previewText(text: string): { readonly text: string; readonly truncated: boolean } {
  if (text.length <= resultTextPreviewMaxChars) {
    return { text, truncated: false };
  }
  return { text: `${text.slice(0, resultTextPreviewMaxChars).trimEnd()}\n...`, truncated: true };
}

function readRecord(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
