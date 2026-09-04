import type { JsonObject } from '@nextagent/agent-common';
import { Ajv } from 'ajv/dist/ajv.js';

const stringField = { type: 'string', minLength: 1, maxLength: 256 } as const;
const targetCapabilityIdField = {
  type: 'string',
  minLength: 1,
  maxLength: 128,
  pattern: '^(?=.*\\S)(?!.*\\p{Cc})[\\s\\S]+$',
} as const;
const capabilityStartedPayloadSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    messageId: stringField,
    capabilityId: stringField,
    capabilityKind: { enum: ['TOOL', 'SKILL', 'AGENT', 'WORKFLOW'] },
    targetCapabilityId: targetCapabilityIdField,
    toolCallId: stringField,
    stepId: stringField,
    toolBatchExecutionMode: { enum: ['PARALLEL', 'SERIAL'] },
    toolBatchOrdinal: { type: 'number', minimum: 1, maximum: 100 },
    toolBatchSize: { type: 'number', minimum: 2, maximum: 100 },
    projectionUnavailable: stringField,
  },
  allOf: [
    {
      if: { required: ['targetCapabilityId'] },
      then: { properties: { capabilityId: { enum: ['Agent', 'Skill', 'Workflow'] } } },
    },
  ],
  required: ['capabilityId', 'toolCallId', 'stepId'],
} as const;

const ajv = new Ajv({ allErrors: true });
const validateCapabilityStartedPayload = ajv.compile<JsonObject>(capabilityStartedPayloadSchema);

export function isCapabilityStartedTimelinePayload(value: unknown): value is JsonObject {
  return validateCapabilityStartedPayload(value);
}
