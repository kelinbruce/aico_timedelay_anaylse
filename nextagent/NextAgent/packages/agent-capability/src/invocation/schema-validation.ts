import type { ErrorObject, ValidateFunction } from 'ajv';
import { Ajv } from 'ajv/dist/ajv.js';
import type { JsonObject } from '@nextagent/agent-common';

type JsonSchemaValidation = { readonly ok: true } | { readonly ok: false; readonly errors: readonly ErrorObject[] };

const validatorsBySchema = new WeakMap<JsonObject, ValidateFunction>();
const validatorsBySchemaFast = new WeakMap<JsonObject, ValidateFunction>();

export function validateJsonSchema(schema: JsonObject, value: unknown): JsonSchemaValidation {
  let validator = validatorsBySchema.get(schema);
  if (validator === undefined) {
    validator = compileValidator(schema, true);
    if ((validator as ValidateFunction & { readonly $async?: boolean }).$async === true) {
      throw new Error('Async JSON schemas are not supported by capability validation.');
    }
    validatorsBySchema.set(schema, validator);
  }
  if (validator(value) === true) {
    return { ok: true };
  }
  return { ok: false, errors: [...(validator.errors ?? [])] };
}

export function validateJsonSchemaOk(schema: JsonObject, value: unknown): boolean {
  let validator = validatorsBySchemaFast.get(schema);
  if (validator === undefined) {
    validator = compileValidator(schema, false);
    if ((validator as ValidateFunction & { readonly $async?: boolean }).$async === true) {
      throw new Error('Async JSON schemas are not supported by capability validation.');
    }
    validatorsBySchemaFast.set(schema, validator);
  }
  return validator(value) === true;
}

function compileValidator(schema: JsonObject, allErrors: boolean): ValidateFunction {
  return new Ajv({ strict: false, allErrors }).compile(schema);
}
