import { createLocalRagKnowledgeGovernance, createRestrictedLocalSandboxGateway } from '@nextagent/agent-platform-gateway-local';
import { describe, expect, it } from 'vitest';
import { createNextAgentTestApp } from '../src/composition/create-test-composition.js';

describe('gateway observability linking', () => {
  it('keeps HTTP and stream component diagnostics out of observation-derived logs', async () => {
    const entries: unknown[] = [];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'ok' }],
      ragRetrievalFactory: createLocalRagKnowledgeGovernance,
      sandboxGatewayFactory: createRestrictedLocalSandboxGateway,
      observationLogger: {
        debug(entry) {
          entries.push(entry);
        },
        info(entry) {
          entries.push(entry);
        },
        warn(entry) {
          entries.push(entry);
        },
        error(entry) {
          entries.push(entry);
        },
      },
    });
    try {
      const session = await app.server.inject({ method: 'POST', url: '/api/v1/sessions', payload: {} });
      const sessionId = session.json<{ sessionId: string }>().sessionId;
      const accepted = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: { inputText: 'hello', idempotencyKey: 'gateway-link-1', sessionId },
      });
      const runId = accepted.json<{ runId: string }>().runId;
      const response = await app.server.inject({
        method: 'GET',
        url: `/api/v1/sessions/${sessionId}/stream?lastSeenSequence=0&runId=${runId}`,
      });

      expect(response.statusCode).toBe(200);
      expect(
        entries.some((entry) => {
          const record = entry as { readonly operation?: string; readonly event?: string };
          return record.operation?.startsWith('HTTP_') === true || record.event === 'GATEWAY_CALL_DIAGNOSTIC';
        }),
      ).toBe(false);
      expect(JSON.stringify(entries)).not.toContain('lastSeenSequence');
    } finally {
      await app.close();
    }
  });
});
