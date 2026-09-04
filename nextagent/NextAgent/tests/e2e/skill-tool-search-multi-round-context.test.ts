import type { ModelInvocationRequest } from '@nextagent/agent-contracts/model';
import { loadBuiltInDefaultAgentDefinition } from '@nextagent/agent-app/testing';
import { cp } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanupE2ETestContext, createE2ETestContext } from './e2e-helpers.js';
import { describe, expect, it } from 'vitest';

describe('Skill ToolSearch multi-round context', () => {
  it('applies Skill model metadata to the next governed model invocation', async () => {
    const requests: ModelInvocationRequest[] = [];
    const modelPatchSkill = 'model-patch-skill-test';
    const defaultAgent = loadBuiltInDefaultAgentDefinition();
    const ctx = await createE2ETestContext({
      tempPrefix: 'nextagent-skill-model-patch-e2e-',
      modelRequestSink: requests,
      skillDisclosureMode: 'tool-search',
      modelProfiles: [
        {
          providerId: 'openai-compatible',
          baseUrl: 'https://api.minimaxi.com/v1',
          credentialRef: 'env:NEXTAGENT_TEST_ONLY',
          models: [
            {
              modelId: 'deterministic-test-model',
              timeoutMs: 30_000,
              temperature: 0.2,
              maxOutputTokens: 2048,
              contextWindowTokens: 128_000,
              fallbackEligible: false,
            },
            {
              modelId: 'skill-preferred-model',
              timeoutMs: 30_000,
              temperature: 0.1,
              maxOutputTokens: 1024,
              contextWindowTokens: 128_000,
              fallbackEligible: false,
            },
          ],
        },
      ],
      agentDefinition: {
        ...defaultAgent,
        modelIds: ['deterministic-test-model', 'skill-preferred-model'],
        defaultModelId: 'deterministic-test-model',
        runtimeSettings: {
          ...defaultAgent.runtimeSettings,
        },
      },
      prepareWorkspace: async (workspaceDir) => {
        await cp(skillFixtureRoot(), join(workspaceDir, 'skills'), { recursive: true });
      },
      modelSteps: [
        {
          toolCalls: [
            {
              toolCallId: 'model-patch-search',
              toolName: 'ToolSearch',
              arguments: { query: modelPatchSkill, limit: 5 },
            },
          ],
        },
        {
          toolCalls: [
            {
              toolCallId: 'model-patch-load',
              toolName: 'Skill',
              arguments: { name: modelPatchSkill, args: { scenario: 'model-patch' } },
            },
          ],
        },
        { content: 'Skill model patch verified.' },
      ],
    });

    try {
      const accepted = await fetch(`${ctx.baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          inputText: 'Run the Skill model patch validation.',
          idempotencyKey: `skill-model-patch-e2e-${crypto.randomUUID()}`,
        }),
      });

      expect(accepted.status).toBe(200);
      const body = (await accepted.json()) as { sessionId: string; runId: string };
      const stream = await fetch(`${ctx.baseUrl}/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`);
      expect(stream.status).toBe(200);
      const streamBody = await stream.text();

      expect(streamBody).toContain('event: CAPABILITY_COMPLETED');
      expect(streamBody).toContain('"toolCallId":"model-patch-load"');
      expect(requests).toHaveLength(3);
      expect(requests[0]?.modelId).toBe('deterministic-test-model');
      expect(requests[1]?.modelId).toBe('deterministic-test-model');
      expect(requests[2]?.modelId).toBe('skill-preferred-model');
      expect(requests[2]).toMatchObject({
        temperature: 0.4,
        maxOutputTokens: 1024,
        topP: 0.8,
      });
      const discoveredRequestText = requestText(requests[1]!);
      expect(discoveredRequestText).toContain('<available-skills>');
      expect(discoveredRequestText).toContain(`capability_id=${modelPatchSkill}`);
      expect(discoveredRequestText).not.toContain(`<skill_content name="${modelPatchSkill}">`);
      expect(requestText(requests[2]!)).toContain(`<skill_content name="${modelPatchSkill}">`);
    } finally {
      await cleanupE2ETestContext(ctx);
    }
  }, 60_000);

  /**
   * E2E Case: unauthorized Skill model hint is rejected.
   * Risk: A Skill could silently route a request to a model profile that the accepted Agent assembly did not authorize.
   * Design Rationale: This crosses HTTP submit, ToolSearch discovery, Skill loading, context patch propagation,
   * model profile governance, and SSE failure projection; unit tests alone do not prove the product path wiring.
   * Entry: HTTP POST /api/v1/requests plus session SSE stream.
   * Cross-module path: channel-web -> runtime -> core -> capability Skill -> context-engine -> app model profile registry -> stream projection.
   * Untestable node: real local server and SSE stream.
   * Source deps: agent-core model patch resolver, agent-context-engine assembly, agent-capability Skill manifest parser, agent-app model profiles.
   */
  it('rejects Skill model metadata when the target model is not authorized by the Agent assembly', async () => {
    const requests: ModelInvocationRequest[] = [];
    const modelPatchSkill = 'model-patch-skill-test';
    const defaultAgent = loadBuiltInDefaultAgentDefinition();
    const ctx = await createE2ETestContext({
      tempPrefix: 'nextagent-skill-model-patch-denied-e2e-',
      modelRequestSink: requests,
      skillDisclosureMode: 'tool-search',
      modelProfiles: [
        {
          providerId: 'openai-compatible',
          baseUrl: 'https://api.minimaxi.com/v1',
          credentialRef: 'env:NEXTAGENT_TEST_ONLY',
          models: [
            {
              modelId: 'deterministic-test-model',
              timeoutMs: 30_000,
              temperature: 0.2,
              maxOutputTokens: 2048,
              contextWindowTokens: 128_000,
              fallbackEligible: false,
            },
            {
              modelId: 'skill-preferred-model',
              timeoutMs: 30_000,
              temperature: 0.1,
              maxOutputTokens: 1024,
              contextWindowTokens: 128_000,
              fallbackEligible: false,
            },
          ],
        },
      ],
      agentDefinition: {
        ...defaultAgent,
        modelIds: ['deterministic-test-model'],
        defaultModelId: 'deterministic-test-model',
        runtimeSettings: {
          ...defaultAgent.runtimeSettings,
        },
      },
      prepareWorkspace: async (workspaceDir) => {
        await cp(skillFixtureRoot(), join(workspaceDir, 'skills'), { recursive: true });
      },
      modelSteps: [
        {
          toolCalls: [
            {
              toolCallId: 'model-patch-search-denied',
              toolName: 'ToolSearch',
              arguments: { query: modelPatchSkill, limit: 5 },
            },
          ],
        },
        {
          toolCalls: [
            {
              toolCallId: 'model-patch-load-denied',
              toolName: 'Skill',
              arguments: { name: modelPatchSkill, args: { scenario: 'model-patch-denied' } },
            },
          ],
        },
        { content: 'Unauthorized Skill model patch rejected; default model retained.' },
      ],
    });

    try {
      const accepted = await fetch(`${ctx.baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          inputText: 'Run the unauthorized Skill model patch validation.',
          idempotencyKey: `skill-model-patch-denied-e2e-${crypto.randomUUID()}`,
        }),
      });

      expect(accepted.status).toBe(200);
      const body = (await accepted.json()) as { sessionId: string; runId: string };
      const stream = await fetch(`${ctx.baseUrl}/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`);
      expect(stream.status).toBe(200);
      const streamBody = await stream.text();

      expect(streamBody).toContain('event: CAPABILITY_COMPLETED');
      expect(streamBody).toContain('"toolCallId":"model-patch-load-denied"');
      expect(streamBody).toContain('"status":"FAILED"');
      expect(streamBody).toContain('"safeErrorCode":"CAPABILITY_MODEL_PATCH_DENIED"');
      expect(streamBody).toContain('event: DEGRADATION_NOTICE');
      expect(streamBody).toContain('event: REQUEST_COMPLETED');
      expect(streamBody).toContain('Unauthorized Skill model patch rejected; default model retained.');
      expect(requests.map((request) => request.modelId)).toEqual([
        'deterministic-test-model',
        'deterministic-test-model',
        'deterministic-test-model',
      ]);
    } finally {
      await cleanupE2ETestContext(ctx);
    }
  }, 60_000);

  it('discovers and loads multiple Skills across ToolSearch rounds while context grows', async () => {
    const requests: ModelInvocationRequest[] = [];
    const testSkill = 'tool-search-multi-round-context-test';
    const firstDeferredSkill = 'multi-round-context-fixture-a';
    const secondDeferredSkill = 'multi-round-context-fixture-b';
    const ctx = await createE2ETestContext({
      tempPrefix: 'nextagent-skill-multi-round-context-e2e-',
      modelRequestSink: requests,
      skillDisclosureMode: 'tool-search',
      prepareWorkspace: async (workspaceDir) => {
        await cp(skillFixtureRoot(), join(workspaceDir, 'skills'), { recursive: true });
      },
      modelSteps: [
        {
          toolCalls: [
            {
              toolCallId: 'multi-round-search-fixture',
              toolName: 'ToolSearch',
              arguments: { query: testSkill, limit: 5 },
            },
          ],
        },
        {
          toolCalls: [
            {
              toolCallId: 'multi-round-load-fixture',
              toolName: 'Skill',
              arguments: { name: testSkill, args: { scenario: 'multi-round-context' } },
            },
          ],
        },
        {
          toolCalls: [
            {
              toolCallId: 'multi-round-search-a',
              toolName: 'ToolSearch',
              arguments: { query: firstDeferredSkill, limit: 5 },
            },
          ],
        },
        {
          toolCalls: [
            {
              toolCallId: 'multi-round-load-a',
              toolName: 'Skill',
              arguments: { name: firstDeferredSkill, args: { scenario: 'multi-round-context-a' } },
            },
          ],
        },
        {
          toolCalls: [
            {
              toolCallId: 'multi-round-search-b',
              toolName: 'ToolSearch',
              arguments: { query: secondDeferredSkill, limit: 5 },
            },
          ],
        },
        {
          toolCalls: [
            {
              toolCallId: 'multi-round-load-b',
              toolName: 'Skill',
              arguments: { name: secondDeferredSkill, args: { scenario: 'multi-round-context-b' } },
            },
          ],
        },
        { content: 'ToolSearch multi-round context verified.' },
      ],
    });

    try {
      const accepted = await fetch(`${ctx.baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          inputText: 'Run the multi-round ToolSearch context validation.',
          idempotencyKey: `skill-multi-round-context-e2e-${crypto.randomUUID()}`,
        }),
      });

      expect(accepted.status).toBe(200);
      const body = (await accepted.json()) as { sessionId: string; runId: string };
      const stream = await fetch(`${ctx.baseUrl}/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`);
      expect(stream.status).toBe(200);
      const streamBody = await stream.text();

      expect(streamBody).toContain('event: CAPABILITY_COMPLETED');
      expect(streamBody).toContain('"toolCallId":"multi-round-search-fixture"');
      expect(streamBody).toContain('"toolCallId":"multi-round-load-fixture"');
      expect(streamBody).toContain('"toolCallId":"multi-round-search-a"');
      expect(streamBody).toContain('"toolCallId":"multi-round-load-a"');
      expect(streamBody).toContain('"toolCallId":"multi-round-search-b"');
      expect(streamBody).toContain('"toolCallId":"multi-round-load-b"');
      expect(requests).toHaveLength(7);

      const initialText = requestText(requests[0]!);
      expect(initialText).not.toContain('<available-deferred-skills>');
      expect(initialText).not.toContain(testSkill);
      expect(initialText).not.toContain(firstDeferredSkill);
      expect(initialText).not.toContain(secondDeferredSkill);
      expect(initialText).not.toContain('ToolSearch Multi-Round Context Test');
      expect(initialText).not.toContain('## Required Test Action');

      const afterFixtureSearchIndex = findRequestIndex(
        requests,
        (text) =>
          text.includes(`- capability_id=${testSkill} | name=${testSkill} | kind=SKILL`) && !text.includes(`<skill_content name="${testSkill}">`),
      );
      const afterFixtureSearch = requestText(requests[afterFixtureSearchIndex]!);
      expect(afterFixtureSearch).toContain('<available-skills>');
      expect(afterFixtureSearch).toContain(`- capability_id=${testSkill} | name=${testSkill} | kind=SKILL`);
      expect(afterFixtureSearch).toContain('Use the Skill tool with name equal to one capability_id above');
      expect(afterFixtureSearch).toContain('only metadata is loaded until the Skill tool succeeds');
      expect(afterFixtureSearch).not.toContain('ToolSearch Multi-Round Context Test');

      const afterFirstSearchIndex = findRequestIndex(
        requests,
        (text) =>
          text.includes(`- capability_id=${firstDeferredSkill} | name=${firstDeferredSkill} | kind=SKILL`) &&
          !text.includes(`<skill_content name="${firstDeferredSkill}">`),
      );
      expect(afterFirstSearchIndex).toBeGreaterThan(afterFixtureSearchIndex);
      const afterFirstSearch = requestText(requests[afterFirstSearchIndex]!);
      expect(afterFirstSearch).toContain('<available-skills>');
      expect(afterFirstSearch).toContain(`- capability_id=${firstDeferredSkill} | name=${firstDeferredSkill} | kind=SKILL`);
      expect(afterFirstSearch).not.toContain(`<skill_content name="${firstDeferredSkill}">`);

      const afterSecondSearchIndex = findRequestIndex(
        requests,
        (text) =>
          text.includes(`- capability_id=${secondDeferredSkill} | name=${secondDeferredSkill} | kind=SKILL`) &&
          !text.includes(`<skill_content name="${secondDeferredSkill}">`),
      );
      expect(afterSecondSearchIndex).toBeGreaterThan(afterFirstSearchIndex);
      const afterSecondSearch = requestText(requests[afterSecondSearchIndex]!);
      expect(afterSecondSearch).toContain('<available-skills>');
      expect(afterSecondSearch).toContain(`- capability_id=${secondDeferredSkill} | name=${secondDeferredSkill} | kind=SKILL`);
      expect(afterSecondSearch).not.toContain(`<skill_content name="${secondDeferredSkill}">`);

      const conversation = await fetch(`${ctx.baseUrl}/api/v1/sessions/${body.sessionId}/conversation?limit=40&includeCapabilityResults=true`);
      expect(conversation.status).toBe(200);
      const history = (await conversation.json()) as { items: Array<{ role: string; content: string; metadata?: Record<string, unknown> }> };
      const toolSearchResults = history.items.filter((item) => item.role === 'CAPABILITY_RESULT' && item.metadata?.['toolName'] === 'ToolSearch');
      expect(toolSearchResults).toHaveLength(3);
      expect(toolSearchResults.map((item) => item.content).join('\n')).not.toContain('## Required Test Action');
      const skillResults = history.items.filter((item) => item.role === 'CAPABILITY_RESULT' && item.metadata?.['toolName'] === 'Skill');
      expect(skillResults).toHaveLength(3);
      expect(history.items.at(-1)).toMatchObject({ role: 'ASSISTANT', content: 'ToolSearch multi-round context verified.' });
    } finally {
      await cleanupE2ETestContext(ctx);
    }
  }, 120_000);
});

function skillFixtureRoot(): string {
  return join(process.cwd(), 'tests', 'e2e', 'fixtures', 'skills');
}

function requestText(request: ModelInvocationRequest): string {
  return request.messages.map((message) => message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n')).join('\n');
}

function findRequestIndex(requests: readonly ModelInvocationRequest[], predicate: (text: string) => boolean): number {
  const index = requests.findIndex((request) => predicate(requestText(request)));
  if (index < 0) {
    throw new Error('Expected captured model request matching predicate.');
  }
  return index;
}
