import { describe, expect, it } from 'vitest';

import { buildApiUrl, loadRuntimeConfig, resolveRuntimeBootstrap, resolveRuntimeConfig, resolveTransportKind } from '../src/config/runtimeConfig.ts';

function asEnv(overrides: Partial<ImportMetaEnv> = {}): ImportMetaEnv {
  return overrides as ImportMetaEnv;
}

describe('runtimeConfig contract', () => {
  it('uses stable static defaults when environment values are missing', () => {
    const config = resolveRuntimeConfig(asEnv());

    expect(config.backendBaseUrl).toBe('');
    expect(config.transportKind).toBe('SSE');
  });

  it('applies env overrides for backend base URL and dev transport fallback', () => {
    const config = resolveRuntimeConfig(
      asEnv({
        DEV: true,
        VITE_BACKEND_BASE_URL: ' https://agent.local:8443/ ',
        VITE_TRANSPORT_KIND: ' websocket ',
      }),
    );

    expect(config.backendBaseUrl).toBe('https://agent.local:8443');
    expect(config.transportKind).toBe('WEBSOCKET');
  });

  it('loads transport kind from backend bootstrap before product stream selection', async () => {
    const fetcher = async (url: string | URL | Request) => {
      const target = String(url);
      expect(target).toBe('https://agent.local/api/v1/runtime/bootstrap');
      return new Response(JSON.stringify({ transportKind: 'WEBSOCKET' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const config = await loadRuntimeConfig({
      env: asEnv({
        DEV: false,
        VITE_BACKEND_BASE_URL: 'https://agent.local',
        VITE_TRANSPORT_KIND: 'SSE',
      }),
      fetcher,
    });

    expect(config.transportKind).toBe('WEBSOCKET');
    expect(config.backendBaseUrl).toBe('https://agent.local');
  });

  it('assigns only the public portal ability boolean from backend bootstrap', async () => {
    const fetcher = async () =>
      new Response(
        JSON.stringify({
          transportKind: 'SSE',
          portalAbilityConfig: {
            suggestedQuestionsEnabled: false,
            askUserQuestionTimeMinutes: 15,
            askUserQuestionTimeoutMs: 15 * 60 * 1000,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );

    const config = await loadRuntimeConfig({ env: asEnv({ DEV: false }), fetcher });

    expect(config.portalAbilityConfig).toEqual({
      suggestedQuestionsEnabled: false,
      cronTasksEnabled: true,
      longTermMemoryManagementEnabled: true,
      knowledgeImportEnabled: true,
      fullProcessEnabled: true,
    });
  });

  it('prepends the build-time VITE_API_URL_PREFIX in front of /api/v1', async () => {
    const fetcher = async (url: string | URL | Request) => {
      expect(String(url)).toBe('https://agent.local/svcA/api/v1/runtime/bootstrap');
      return new Response(JSON.stringify({ transportKind: 'SSE' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const config = await loadRuntimeConfig({
      env: asEnv({
        DEV: false,
        VITE_BACKEND_BASE_URL: 'https://agent.local',
        VITE_API_URL_PREFIX: '/svcA',
        VITE_TRANSPORT_KIND: 'SSE',
      }),
      fetcher,
    });

    expect(config.apiPrefix).toBe('/svcA');
    expect(buildApiUrl('/api/v1/sessions', config)).toBe('https://agent.local/svcA/api/v1/sessions');
  });

  it('uses no prefix when VITE_API_URL_PREFIX is absent', async () => {
    const fetcher = async (url: string | URL | Request) => {
      expect(String(url)).toBe('https://agent.local/api/v1/runtime/bootstrap');
      return new Response(JSON.stringify({ transportKind: 'SSE' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const config = await loadRuntimeConfig({
      env: asEnv({
        DEV: false,
        VITE_BACKEND_BASE_URL: 'https://agent.local',
        VITE_TRANSPORT_KIND: 'SSE',
      }),
      fetcher,
    });

    expect(config.apiPrefix).toBe('');
  });

  it('rejects invalid backend bootstrap transport in product mode', async () => {
    const fetcher = async () => new Response(JSON.stringify({ transportKind: 'WS' }), { status: 200 });

    await expect(loadRuntimeConfig({ env: asEnv({ DEV: false }), fetcher })).rejects.toThrow(/Runtime bootstrap transportKind is invalid/);
  });

  it('parses the portal ability public DTO without retaining the AskUserQuestion timeout', () => {
    expect(
      resolveRuntimeBootstrap({
        transportKind: 'SSE',
        portalAbilityConfig: {
          suggestedQuestionsEnabled: false,
          askUserQuestionTimeMinutes: 15,
          askUserQuestionTimeoutMs: 15 * 60 * 1000,
        },
      }),
    ).toEqual({
      transportKind: 'SSE',
      portalAbilityConfig: {
        suggestedQuestionsEnabled: false,
        cronTasksEnabled: true,
        longTermMemoryManagementEnabled: true,
        knowledgeImportEnabled: true,
        fullProcessEnabled: true,
      },
    });
  });

  it('parses portal ability entry gates independently with safe defaults', () => {
    expect(
      resolveRuntimeBootstrap({
        transportKind: 'SSE',
        portalAbilityConfig: {
          suggestedQuestionsEnabled: false,
          cronTasksEnabled: false,
          longTermMemoryManagementEnabled: true,
          knowledgeImportEnabled: false,
          fullProcessEnabled: false,
        },
      }),
    ).toEqual({
      transportKind: 'SSE',
      portalAbilityConfig: {
        suggestedQuestionsEnabled: false,
        cronTasksEnabled: false,
        longTermMemoryManagementEnabled: true,
        knowledgeImportEnabled: false,
        fullProcessEnabled: false,
      },
    });

    expect(
      resolveRuntimeBootstrap({
        transportKind: 'SSE',
        portalAbilityConfig: {
          suggestedQuestionsEnabled: true,
          cronTasksEnabled: 'false',
          longTermMemoryManagementEnabled: null,
          knowledgeImportEnabled: undefined,
          fullProcessEnabled: 'false',
        },
      }),
    ).toEqual({
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

  it('defaults the portal ability switch to enabled when the field is missing or invalid', () => {
    expect(resolveRuntimeBootstrap({ transportKind: 'SSE' })).toEqual({
      transportKind: 'SSE',
      portalAbilityConfig: {
        suggestedQuestionsEnabled: true,
        cronTasksEnabled: true,
        longTermMemoryManagementEnabled: true,
        knowledgeImportEnabled: true,
        fullProcessEnabled: true,
      },
    });
    expect(resolveRuntimeBootstrap({ transportKind: 'SSE', portalAbilityConfig: {} })).toEqual({
      transportKind: 'SSE',
      portalAbilityConfig: {
        suggestedQuestionsEnabled: true,
        cronTasksEnabled: true,
        longTermMemoryManagementEnabled: true,
        knowledgeImportEnabled: true,
        fullProcessEnabled: true,
      },
    });
    expect(resolveRuntimeBootstrap({ transportKind: 'SSE', portalAbilityConfig: { suggestedQuestionsEnabled: 'false' } })).toEqual({
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

  it('does not accept arbitrary runtime bootstrap fields as transport override', () => {
    expect(() => resolveRuntimeBootstrap({ transportKind: 'SSE', queryTransportKind: 'WEBSOCKET' })).not.toThrow();
    expect(resolveRuntimeBootstrap({ transportKind: 'SSE', localStorageTransportKind: 'WEBSOCKET' })).toEqual({
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

  it('fails fast for invalid transport kind in dev mode', () => {
    expect(() => resolveTransportKind('invalid-kind', true)).toThrowError(/Unsupported VITE_TRANSPORT_KIND/);
  });

  it('falls back to SSE for invalid transport kind in non-dev mode', () => {
    expect(resolveTransportKind('invalid-kind', false)).toBe('SSE');
  });

  it('builds API URLs from static backend base URL without changing relative-path behavior', () => {
    const localConfig = resolveRuntimeConfig(asEnv());
    expect(buildApiUrl('/api/v1/sessions', localConfig)).toBe('/api/v1/sessions');
    expect(buildApiUrl('api/v1/sessions', localConfig)).toBe('/api/v1/sessions');

    const remoteConfig = resolveRuntimeConfig(asEnv({ VITE_BACKEND_BASE_URL: 'https://agent.local/' }));
    expect(buildApiUrl('/api/v1/sessions', remoteConfig)).toBe('https://agent.local/api/v1/sessions');
    expect(buildApiUrl('api/v1/sessions', remoteConfig)).toBe('https://agent.local/api/v1/sessions');
  });

  it('prepends the public path prefix P in front of /api/v1', () => {
    const config = resolveRuntimeConfig(asEnv({ VITE_API_URL_PREFIX: '/svcA' }));
    expect(buildApiUrl('/api/v1/sessions', config)).toBe('/svcA/api/v1/sessions');
    expect(buildApiUrl('/api/v1', config)).toBe('/svcA/api/v1');
    expect(buildApiUrl('/api/v1/sessions/123/stream', config)).toBe('/svcA/api/v1/sessions/123/stream');
  });

  it('does not prefix non-/api/v1 paths such as /rest/ external calls', () => {
    const config = resolveRuntimeConfig(asEnv({ VITE_API_URL_PREFIX: '/svcA' }));
    expect(buildApiUrl('/rest/naie/guardrail/config/v1/report/risks', config)).toBe('/rest/naie/guardrail/config/v1/report/risks');
    expect(buildApiUrl('/rest/naie/aicoservice/v1/sessions/s1/bi-reports', config)).toBe('/rest/naie/aicoservice/v1/sessions/s1/bi-reports');
  });

  it('normalizes a single-slash prefix to no prefix', () => {
    const config = resolveRuntimeConfig(asEnv({ VITE_API_URL_PREFIX: '/' }));
    expect(config.apiPrefix).toBe('');
    expect(buildApiUrl('/api/v1/sessions', config)).toBe('/api/v1/sessions');
  });

  it('rejects malformed path prefix regardless of dev or prod mode', () => {
    expect(() => resolveRuntimeConfig(asEnv({ DEV: true, VITE_API_URL_PREFIX: 'svcA' }))).toThrow(/Unsupported VITE_API_URL_PREFIX/);
    expect(() => resolveRuntimeConfig(asEnv({ DEV: false, VITE_API_URL_PREFIX: 'svcA' }))).toThrow(/Unsupported VITE_API_URL_PREFIX/);
  });
});
