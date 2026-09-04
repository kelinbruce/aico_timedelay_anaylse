import { jsonSchema, tool } from 'ai';
import type { ToolSet } from 'ai';
import type { JsonObject } from '@nextagent/agent-common';
import type { ModelToolDescriptor } from '@nextagent/agent-contracts/model';
import type { JSONSchema7 } from 'json-schema';
import { isJsonObject } from '../../internal/json.js';

export function toToolSet(tools: readonly ModelToolDescriptor[]): ToolSet | undefined {
  if (tools.length === 0) {
    return undefined;
  }
  const result: ToolSet = {};
  for (const descriptor of tools) {
    const inputSchema = parseJsonSchema(descriptor.inputSchema);
    result[descriptor.name] = tool({
      ...(descriptor.description === undefined ? {} : { description: descriptor.description }),
      inputSchema: jsonSchema(inputSchema),
    });
  }
  return result;
}

function parseJsonSchema(value: JsonObject): JSONSchema7 {
  if (!isJsonSchema(value)) {
    throw new Error('Model tool input schema is invalid.');
  }
  return value;
}

function isJsonSchema(value: unknown): value is JSONSchema7 {
  if (!isJsonObject(value)) {
    return false;
  }
  if (
    value.type !== undefined &&
    typeof value.type !== 'string' &&
    !(Array.isArray(value.type) && value.type.every((item) => typeof item === 'string'))
  ) {
    return false;
  }
  if (value.properties !== undefined && (!isJsonObject(value.properties) || Object.values(value.properties).some((item) => !isJsonSchema(item)))) {
    return false;
  }
  if (value.required !== undefined && (!Array.isArray(value.required) || value.required.some((item) => typeof item !== 'string'))) {
    return false;
  }
  if (value.items !== undefined && !isJsonSchema(value.items) && !(Array.isArray(value.items) && value.items.every(isJsonSchema))) {
    return false;
  }
  return true;
}
