import { Type } from '@sinclair/typebox';

const healthStatus = Type.Union([Type.Literal('UP'), Type.Literal('DOWN'), Type.Literal('DEGRADED')]);

export const healthResponse = Type.Object(
  {
    status: healthStatus,
    components: Type.Array(
      Type.Object(
        {
          name: Type.String({ minLength: 1 }),
          status: healthStatus,
          summary: Type.Optional(Type.String()),
          reasonCode: Type.Optional(Type.String()),
          latencyMs: Type.Optional(Type.Number({ minimum: 0 })),
        },
        { additionalProperties: false },
      ),
    ),
    timestamp: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);
