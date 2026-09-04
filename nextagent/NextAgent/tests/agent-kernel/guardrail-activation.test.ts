import { createNextAgentTestApp, type NextAgentApp } from '@nextagent/agent-platform-gateway-local/testing';
import type { GatewayBindings, GatewayProvider, GuardrailGatewayPort } from '@nextagent/agent-contracts/gateway';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

function stubGuardrailProvider(blocked: boolean): GatewayProvider {
  const port: GuardrailGatewayPort = {
    checkQuestion: async () => (blocked ? { isLegal: false, refusalMessage: '输入被测试护栏拦截' } : { isLegal: true, refusalMessage: '' }),
    checkNl2Python: async () => ({ status: true, errorMsg: [] }),
    checkAnswer: async () => ({ isLegal: true, refusalMessage: '' }),
    checkKnowledge: async () => ({ isLegal: true }),
  };
  return {
    providerId: 'stub-guardrail',
    deploymentMode: 'REMOTE',
    supportedAdapterKinds: ['guardrail'],
    create(): GatewayBindings {
      return {
        providerId: 'stub-guardrail',
        deploymentMode: 'REMOTE',
        readiness: { state: 'READY', evidenceRef: 'stub-guardrail', safeMessage: 'stub guardrail ready' },
        guardrail: port,
      };
    },
  };
}

describe('guardrail activation e2e', () => {
  let app: NextAgentApp;
  let sessionId: string;

  beforeAll(async () => {
    app = createNextAgentTestApp({ modelSteps: [], guardrailProvider: stubGuardrailProvider(true) });
    const sessionRes = await app.server.inject({ method: 'POST', url: '/api/v1/sessions', payload: {} });
    sessionId = sessionRes.json().sessionId;
  });

  afterAll(async () => {
    await app?.server?.close();
  });

  it('blocks submit with GUARD_INPUT_BLOCKED and bootstrap projects guardrail enabled', async () => {
    const bootstrapRes = await app.server.inject({ method: 'GET', url: '/api/v1/runtime/bootstrap' });
    expect(bootstrapRes.statusCode).toBe(200);
    expect(bootstrapRes.json().guardrail).toEqual({ enabled: true });

    const submitRes = await app.server.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/requests`,
      payload: { inputText: 'hello', idempotencyKey: 'idem-submit-activation' },
    });
    expect(submitRes.statusCode).toBeGreaterThanOrEqual(400);
    expect(submitRes.json().error.code).toBe('GUARD_INPUT_BLOCKED');
    expect(submitRes.json().error.message).toBe('输入被测试护栏拦截');
  });
});
