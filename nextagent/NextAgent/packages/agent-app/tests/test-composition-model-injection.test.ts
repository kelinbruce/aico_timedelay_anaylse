import { brand } from '@nextagent/agent-common';
import type { ModelInvocationService } from '@nextagent/agent-contracts/model';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { modelEventStreamFixture } from '../../../tests/helpers/model-stream-fixture.js';
import { identity, waitForTimelineEvent } from '../../../tests/agent-kernel/lifecycle-hook-test-helpers.js';
import { createNextAgentTestApp } from '../src/composition/create-test-composition.js';
import type { NextAgentApp } from '../src/composition/composition-contracts.js';

const apps: NextAgentApp[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close().catch(() => undefined)));
});

describe('test composition model injection', () => {
  it('uses the explicitly injected ModelInvocationService', async () => {
    const stream = vi.fn(
      modelEventStreamFixture(async function* () {
        yield { content: 'injected model response', finishReason: 'stop' };
      }),
    );
    const model: ModelInvocationService = {
      async complete() {
        return { content: 'injected model response', finishReason: 'stop' };
      },
      stream,
    };
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'deterministic fallback must not run' }],
      model,
      identity,
    });
    apps.push(app);
    const session = await app.runtime.createSession({
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('session-test-model-injection'),
    });

    const accepted = await app.runtime.submit({
      sessionId: session.sessionId,
      identityContext: identity,
      inputText: 'verify injected model',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('submit-test-model-injection'),
    });
    const terminal = await waitForTimelineEvent(app, session.sessionId, accepted.runId, 'REQUEST_COMPLETED');

    expect(terminal.inlinePayload['content']).toBe('injected model response');
    expect(stream).toHaveBeenCalled();
  }, 20_000);
});
