import { brand } from '@nextagent/agent-common';
import { registerWebChannel, type WebChannelDependencies } from '@nextagent/agent-channel-web';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

const apps: Array<ReturnType<typeof Fastify>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close().catch(() => undefined)));
});

describe('runtime bootstrap portal ability config', () => {
  it('resolves the public booleans on each request and reflects provider changes', async () => {
    const values = [
      {
        suggestedQuestionsEnabled: false,
        cronTasksEnabled: false,
        longTermMemoryManagementEnabled: false,
        knowledgeImportEnabled: false,
        fullProcessEnabled: false,
      },
      {
        suggestedQuestionsEnabled: true,
        cronTasksEnabled: true,
        longTermMemoryManagementEnabled: true,
        knowledgeImportEnabled: true,
        fullProcessEnabled: true,
      },
    ];
    const provider = {
      get: vi.fn(
        async () =>
          values.shift() ?? {
            suggestedQuestionsEnabled: true,
            cronTasksEnabled: true,
            longTermMemoryManagementEnabled: true,
            knowledgeImportEnabled: true,
            fullProcessEnabled: true,
          },
      ),
    };
    const app = Fastify();
    apps.push(app);
    await registerWebChannel(app, makeDependencies(provider));

    const disabled = await app.inject({ method: 'GET', url: '/api/v1/runtime/bootstrap' });
    expect(disabled.statusCode).toBe(200);
    expect(JSON.parse(disabled.body)).toEqual({
      transportKind: 'SSE',
      portalAbilityConfig: {
        suggestedQuestionsEnabled: false,
        cronTasksEnabled: false,
        longTermMemoryManagementEnabled: false,
        knowledgeImportEnabled: false,
        fullProcessEnabled: false,
      },
    });

    const enabled = await app.inject({ method: 'GET', url: '/api/v1/runtime/bootstrap' });
    expect(enabled.statusCode).toBe(200);
    expect(JSON.parse(enabled.body)).toEqual({
      transportKind: 'SSE',
      portalAbilityConfig: {
        suggestedQuestionsEnabled: true,
        cronTasksEnabled: true,
        longTermMemoryManagementEnabled: true,
        knowledgeImportEnabled: true,
        fullProcessEnabled: true,
      },
    });
    expect(provider.get).toHaveBeenCalledTimes(2);
  });

  it('defaults portal ability entry gates to enabled when fields are missing or invalid', async () => {
    const provider = {
      get: vi.fn(async () => ({
        suggestedQuestionsEnabled: true,
        cronTasksEnabled: 'false',
        longTermMemoryManagementEnabled: null,
        knowledgeImportEnabled: undefined,
        fullProcessEnabled: 'false',
      })),
    };
    const app = Fastify();
    apps.push(app);
    await registerWebChannel(app, makeDependencies(provider));

    const response = await app.inject({ method: 'GET', url: '/api/v1/runtime/bootstrap' });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).portalAbilityConfig).toEqual({
      suggestedQuestionsEnabled: true,
      cronTasksEnabled: true,
      longTermMemoryManagementEnabled: true,
      knowledgeImportEnabled: true,
      fullProcessEnabled: true,
    });
  });

  it('defaults portal ability fields to enabled when no portal provider is configured', async () => {
    const app = Fastify();
    apps.push(app);
    await registerWebChannel(app, makeDependencies(undefined));

    const response = await app.inject({ method: 'GET', url: '/api/v1/runtime/bootstrap' });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      transportKind: 'SSE',
      portalAbilityConfig: {
        suggestedQuestionsEnabled: true,
        cronTasksEnabled: true,
        longTermMemoryManagementEnabled: true,
        knowledgeImportEnabled: true,
        fullProcessEnabled: true,
      },
    });
  });

  it('does not expose the AskUserQuestion timeout or a derived value', async () => {
    const provider = {
      get: vi.fn(async () => ({
        suggestedQuestionsEnabled: true,
        cronTasksEnabled: true,
        longTermMemoryManagementEnabled: true,
        knowledgeImportEnabled: true,
        fullProcessEnabled: true,
        askUserQuestionTimeoutMs: 15 * 60 * 1000,
      })),
    };
    const app = Fastify();
    apps.push(app);
    await registerWebChannel(app, makeDependencies(provider));

    const response = await app.inject({ method: 'GET', url: '/api/v1/runtime/bootstrap' });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain('askUserQuestionTimeMinutes');
    expect(response.body).not.toContain('askUserQuestionTimeoutMs');
    expect(response.body).not.toContain(String(15 * 60 * 1000));
    expect(JSON.parse(response.body).portalAbilityConfig).toEqual({
      suggestedQuestionsEnabled: true,
      cronTasksEnabled: true,
      longTermMemoryManagementEnabled: true,
      knowledgeImportEnabled: true,
      fullProcessEnabled: true,
    });
  });
});

function makeDependencies(
  portalAbilityConfigProvider:
    | {
        get: () => Promise<
          Record<
            'suggestedQuestionsEnabled' | 'cronTasksEnabled' | 'longTermMemoryManagementEnabled' | 'knowledgeImportEnabled' | 'fullProcessEnabled',
            boolean | unknown
          >
        >;
      }
    | undefined,
): WebChannelDependencies {
  return {
    runtime: {},
    sessions: {},
    identityResolver: () => ({
      tenantId: brand<string, 'TenantId'>('T1'),
      subjectId: brand<string, 'SubjectId'>('U1'),
      displayName: 'Test User',
    }),
    runtimeBootstrap: { transportKind: 'SSE' as const },
    defaultAgentId: brand<string, 'AgentId'>('default-agent'),
    ...(portalAbilityConfigProvider === undefined ? {} : { portalAbilityConfigProvider }),
  } as unknown as WebChannelDependencies;
}
