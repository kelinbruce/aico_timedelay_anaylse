import type { ModelInvocationScope } from '@nextagent/agent-contracts/model';

export function composeInvocationCorrelationHeaders(scope: ModelInvocationScope): Readonly<Record<string, string>> {
  const runHeaders =
    scope.sessionId !== undefined && scope.requestId !== undefined && scope.runId !== undefined
      ? {
          'X-NextAgent-Session-Id': scope.sessionId,
          'X-NextAgent-Request-Id': scope.requestId,
          'X-NextAgent-Run-Id': scope.runId,
        }
      : {};
  return Object.freeze({
    'X-NextAgent-Agent-Id': scope.agentId,
    ...runHeaders,
  });
}
