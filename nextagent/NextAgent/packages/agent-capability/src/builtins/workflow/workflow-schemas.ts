import type { JsonObject } from '@nextagent/agent-common';

export const workflowToolInputSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['recipeName'],
  properties: {
    recipeName: {
      type: 'string',
      minLength: 1,
      maxLength: 128,
      description: 'Registered workflow recipe name available in the current Agent scope.',
    },
    inputText: { type: 'string', description: 'Optional user question or task text to pass as workflow input.' },
    inputVariables: { type: 'object', additionalProperties: true, description: 'Optional structured context variables to pass as workflow input.' },
  },
};

export const workflowToolOutputSchema: JsonObject = {
  type: 'object',
  additionalProperties: true,
};

export const workflowToolRecipeNameMaxLength = 128;
export const workflowToolInputTextMaxLength = 100_000;
export const workflowToolInputVariableCountMax = 64;
