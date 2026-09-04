import type { JsonObject } from '@nextagent/agent-common';
import { Type, type Static } from '@sinclair/typebox';

export type SkillAcquisitionOutcomeCode = 'ACQUIRED_REQUIRES_REPLAN' | 'NOT_FOUND' | 'UNAVAILABLE' | 'REJECTED' | 'INSTALL_FAILED' | 'UNAUTHORIZED';

export const SkillAcquisitionResultSchema = Type.Object(
  {
    outcomeCode: Type.Union([
      Type.Literal('ACQUIRED_REQUIRES_REPLAN'),
      Type.Literal('NOT_FOUND'),
      Type.Literal('UNAVAILABLE'),
      Type.Literal('REJECTED'),
      Type.Literal('INSTALL_FAILED'),
      Type.Literal('UNAUTHORIZED'),
    ]),
    requiresReplan: Type.Boolean(),
    providerKind: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    providerId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    skillId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    message: Type.String({ minLength: 1, maxLength: 256 }),
  },
  { additionalProperties: false },
);

export type SkillAcquisitionResult = Static<typeof SkillAcquisitionResultSchema> & JsonObject;
