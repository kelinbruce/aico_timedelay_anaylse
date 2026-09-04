import { registerWebChannel, skillCatalogResponse } from '@nextagent/agent-channel-web';
import { AgentError, brand, type CapabilityId, type IdentityContext } from '@nextagent/agent-common';
import type {
  RuntimeCommandPort,
  RuntimeSessionPort,
  SkillCatalogQueryPort,
  SkillCatalogQueryRequest,
  SkillCatalogQueryResult,
  SkillCatalogSummaryEntry,
} from '@nextagent/agent-contracts/runtime';
import { Value } from '@sinclair/typebox/value';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

const identity: IdentityContext = {
  tenantId: brand<string, 'TenantId'>('tenant-skill-catalog'),
  subjectId: brand<string, 'SubjectId'>('subject-skill-catalog'),
  displayName: 'Skill Catalog Contract',
};

function skillId(id: string): CapabilityId {
  return brand<string, 'CapabilityId'>(id);
}

function makeSkillEntry(overrides: Partial<Omit<SkillCatalogSummaryEntry, 'capabilityId'>> & { capabilityId: string }): SkillCatalogSummaryEntry {
  return {
    displayName: overrides.displayName ?? overrides.capabilityId,
    description: overrides.description ?? 'A skill for testing.',
    providerKind: overrides.providerKind ?? 'LOCAL_DIRECTORY',
    ...overrides,
    capabilityId: skillId(overrides.capabilityId),
  };
}

function makeSkillCatalogPort(
  listSkillsImpl: (request: SkillCatalogQueryRequest, signal?: AbortSignal) => Promise<SkillCatalogQueryResult>,
): SkillCatalogQueryPort {
  return { listSkills: vi.fn(listSkillsImpl) };
}

function makeDependencies(overrides: { skillCatalog?: SkillCatalogQueryPort } = {}) {
  const runtime: RuntimeCommandPort = {
    submit: vi.fn(async (command) => ({
      sessionId: command.sessionId ?? brand<string, 'SessionId'>('session-skill-catalog'),
      requestId: brand<string, 'MessageId'>('request-skill-catalog'),
      runId: brand<string, 'RequestRunId'>('run-skill-catalog'),
      attempt: 1,
    })),
    cancel: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('s'),
      targetRequestId: brand<string, 'MessageId'>('r'),
      action: 'CANCEL' as const,
      idempotencyKey: brand<string, 'IdempotencyKey'>('i'),
    })),
    retryLatest: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('s'),
      requestId: brand<string, 'MessageId'>('r'),
      runId: brand<string, 'RequestRunId'>('run'),
      attempt: 2,
    })),
    editLatest: vi.fn(async () => {
      throw new Error('not used');
    }),
    answerPendingInput: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('s'),
      pendingInputId: brand<string, 'PendingInputId'>('p'),
      status: 'RECEIVED' as const,
    })),
  };
  const sessions: RuntimeSessionPort = {
    createSession: vi.fn(async () => ({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId: brand<string, 'AgentId'>('a'),
      sessionId: brand<string, 'SessionId'>('s'),
      title: 't',
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
      hasInFlightRequest: false,
    })),
    requireSession: vi.fn(async ({ sessionId }) => ({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId: brand<string, 'AgentId'>('a'),
      sessionId,
      title: 't',
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
      hasInFlightRequest: false,
    })),
    listSessions: vi.fn(async () => ({ entries: [], offset: 0, limit: 10, hasMore: false })),
    deleteSession: vi.fn(async () => undefined),
    forkFromMessage: vi.fn(async () => {
      throw new Error('not used');
    }),
    forkFromRequest: vi.fn(async () => {
      throw new Error('not used');
    }),
    listMessages: vi.fn(async () => ({ items: [], limit: 20, hasMore: false })),
    listConversationPreview: vi.fn(async ({ sessionId }) => ({ sessionId, totalMarkers: 0, offset: 0, limit: 100, markers: [] })),
    updateTitle: vi.fn(async () => {
      throw new Error('not used');
    }),
    streamEvents: vi.fn(async function* () {}),
    listEvents: vi.fn(async () => ({ availability: 'AVAILABLE' as const, events: [] })),
    getActiveRun: vi.fn(async () => undefined),
    getRequestSummary: vi.fn(async () => undefined),
  };
  return {
    runtime,
    sessions,
    identityResolver: () => identity,
    runtimeBootstrap: { transportKind: 'SSE' as const },
    skillCatalog: overrides.skillCatalog ?? makeSkillCatalogPort(async () => ({ total: 0, pageNum: 1, pageSize: 50, skills: [] })),
    defaultAgentId: brand<string, 'AgentId'>('default-agent'),
  };
}

async function setupApp(dependencies: ReturnType<typeof makeDependencies>) {
  const app = Fastify();
  await registerWebChannel(app, dependencies);
  return app;
}

describe('GET /api/v1/skills contract', () => {
  describe('pagination', () => {
    it('returns default pagination (pageNum=1, pageSize=50)', async () => {
      const allSkills = Array.from({ length: 60 }, (_, i) => makeSkillEntry({ capabilityId: `skill-${i}` }));
      const port = makeSkillCatalogPort(async (request) => {
        const start = (request.pageNum - 1) * request.pageSize;
        return {
          total: allSkills.length,
          pageNum: request.pageNum,
          pageSize: request.pageSize,
          skills: allSkills.slice(start, start + request.pageSize),
        };
      });
      const app = await setupApp(makeDependencies({ skillCatalog: port }));

      const response = await app.inject({ method: 'GET', url: '/api/v1/skills' });
      expect(response.statusCode).toBe(200);
      const body = response.json<{ total: number; pageNum: number; pageSize: number; skills: SkillCatalogSummaryEntry[] }>();
      expect(body.pageNum).toBe(1);
      expect(body.pageSize).toBe(50);
      expect(body.total).toBe(60);
      expect(body.skills).toHaveLength(50);
      await app.close();
    });

    it('returns custom pagination (pageNum=2, pageSize=20)', async () => {
      const allSkills = Array.from({ length: 60 }, (_, i) => makeSkillEntry({ capabilityId: `skill-${i}` }));
      const port = makeSkillCatalogPort(async (request) => {
        const start = (request.pageNum - 1) * request.pageSize;
        return {
          total: allSkills.length,
          pageNum: request.pageNum,
          pageSize: request.pageSize,
          skills: allSkills.slice(start, start + request.pageSize),
        };
      });
      const app = await setupApp(makeDependencies({ skillCatalog: port }));

      const response = await app.inject({ method: 'GET', url: '/api/v1/skills?pageNum=2&pageSize=20' });
      expect(response.statusCode).toBe(200);
      const body = response.json<{ total: number; pageNum: number; pageSize: number; skills: SkillCatalogSummaryEntry[] }>();
      expect(body.pageNum).toBe(2);
      expect(body.pageSize).toBe(20);
      expect(body.total).toBe(60);
      expect(body.skills).toHaveLength(20);
      expect(body.skills[0]!.capabilityId).toBe('skill-20');
      await app.close();
    });

    it('rejects pageNum=0 with 400', async () => {
      const app = await setupApp(makeDependencies());
      const response = await app.inject({ method: 'GET', url: '/api/v1/skills?pageNum=0' });
      expect(response.statusCode).toBe(400);
      await app.close();
    });

    it('rejects pageSize=0 with 400', async () => {
      const app = await setupApp(makeDependencies());
      const response = await app.inject({ method: 'GET', url: '/api/v1/skills?pageSize=0' });
      expect(response.statusCode).toBe(400);
      await app.close();
    });

    it('rejects pageSize=200 with 400', async () => {
      const app = await setupApp(makeDependencies());
      const response = await app.inject({ method: 'GET', url: '/api/v1/skills?pageSize=200' });
      expect(response.statusCode).toBe(400);
      await app.close();
    });

    it('returns empty result with total=0 when no skills', async () => {
      const app = await setupApp(makeDependencies());
      const response = await app.inject({ method: 'GET', url: '/api/v1/skills' });
      expect(response.statusCode).toBe(200);
      const body = response.json<{ total: number; skills: SkillCatalogSummaryEntry[] }>();
      expect(body.total).toBe(0);
      expect(body.skills).toEqual([]);
      await app.close();
    });
  });

  describe('response DTO safety', () => {
    it('response matches skillCatalogResponse schema', async () => {
      const skills = [
        makeSkillEntry({
          capabilityId: 'alarm-diagnosis',
          displayName: 'Alarm Diagnosis',
          description: 'Diagnose network alarms.',
          version: '1.0.0',
        }),
      ];
      const port = makeSkillCatalogPort(async () => ({ total: skills.length, pageNum: 1, pageSize: 50, skills }));
      const app = await setupApp(makeDependencies({ skillCatalog: port }));

      const response = await app.inject({ method: 'GET', url: '/api/v1/skills' });
      expect(response.statusCode).toBe(200);
      expect(Value.Check(skillCatalogResponse, response.json())).toBe(true);
      await app.close();
    });

    it('returns optional source metadata without changing the catalog DTO', async () => {
      const skills = [
        makeSkillEntry({
          capabilityId: 'network-diagnostics',
          sourceMetadata: { 'zh-name': '网络诊断', 'en-name': 'Network Diagnostics' },
        }),
      ];
      const port = makeSkillCatalogPort(async () => ({ total: skills.length, pageNum: 1, pageSize: 50, skills }));
      const app = await setupApp(makeDependencies({ skillCatalog: port }));

      const response = await app.inject({ method: 'GET', url: '/api/v1/skills' });
      expect(response.statusCode).toBe(200);
      expect(response.json<{ skills: SkillCatalogSummaryEntry[] }>().skills[0]?.sourceMetadata).toEqual({
        'zh-name': '网络诊断',
        'en-name': 'Network Diagnostics',
      });
      await app.close();
    });

    it('response does not contain sensitive fields', async () => {
      const skills = [makeSkillEntry({ capabilityId: 'alarm-diagnosis' })];
      const port = makeSkillCatalogPort(async () => ({ total: 1, pageNum: 1, pageSize: 50, skills }));
      const app = await setupApp(makeDependencies({ skillCatalog: port }));

      const response = await app.inject({ method: 'GET', url: '/api/v1/skills' });
      const body = response.json();
      const jsonStr = JSON.stringify(body);
      expect(jsonStr).not.toContain('inputSchema');
      expect(jsonStr).not.toContain('outputSchema');
      expect(jsonStr).not.toContain('compatibility');
      expect(jsonStr).not.toContain('metadata');
      expect(jsonStr).not.toContain('credential');
      expect(jsonStr).not.toContain('replayPolicy');
      expect(jsonStr).not.toContain('providerId');
      await app.close();
    });

    it('providerKind is BUNDLED, LOCAL_DIRECTORY or SKILL_HUB', async () => {
      const skills = [
        makeSkillEntry({ capabilityId: 'local-skill', providerKind: 'LOCAL_DIRECTORY' }),
        makeSkillEntry({ capabilityId: 'hub-skill', providerKind: 'SKILL_HUB' }),
      ];
      const port = makeSkillCatalogPort(async () => ({ total: 2, pageNum: 1, pageSize: 50, skills }));
      const app = await setupApp(makeDependencies({ skillCatalog: port }));

      const response = await app.inject({ method: 'GET', url: '/api/v1/skills' });
      const body = response.json<{ skills: SkillCatalogSummaryEntry[] }>();
      for (const skill of body.skills) {
        expect(['BUNDLED', 'LOCAL_DIRECTORY', 'SKILL_HUB']).toContain(skill.providerKind);
      }
      await app.close();
    });
  });

  describe('scope and source aggregation', () => {
    it('LOCAL mode returns BUNDLED and LOCAL_DIRECTORY skills', async () => {
      const skills = [
        makeSkillEntry({ capabilityId: 'builtin-skill', providerKind: 'BUNDLED' }),
        makeSkillEntry({ capabilityId: 'local-skill', providerKind: 'LOCAL_DIRECTORY' }),
        makeSkillEntry({ capabilityId: 'hub-skill', providerKind: 'SKILL_HUB' }),
      ];
      const port = makeSkillCatalogPort(async () => ({
        total: 2,
        pageNum: 1,
        pageSize: 50,
        skills: skills.filter((s) => s.providerKind === 'BUNDLED' || s.providerKind === 'LOCAL_DIRECTORY'),
      }));
      const app = await setupApp(makeDependencies({ skillCatalog: port }));

      const response = await app.inject({ method: 'GET', url: '/api/v1/skills' });
      const body = response.json<{ skills: SkillCatalogSummaryEntry[] }>();
      expect(body.skills.every((s) => s.providerKind === 'BUNDLED' || s.providerKind === 'LOCAL_DIRECTORY')).toBe(true);
      expect(body.skills).toHaveLength(2);
      await app.close();
    });

    it('disabled provider skills do not appear', async () => {
      const port = makeSkillCatalogPort(async () => ({
        total: 1,
        pageNum: 1,
        pageSize: 50,
        skills: [makeSkillEntry({ capabilityId: 'available-skill' })],
      }));
      const app = await setupApp(makeDependencies({ skillCatalog: port }));

      const response = await app.inject({ method: 'GET', url: '/api/v1/skills' });
      const body = response.json<{ skills: SkillCatalogSummaryEntry[] }>();
      expect(body.skills).toHaveLength(1);
      expect(body.skills[0]!.capabilityId).toBe('available-skill');
      await app.close();
    });
  });

  describe('keyword search', () => {
    it('keyword matches displayName', async () => {
      const skills = [
        makeSkillEntry({ capabilityId: 'skill-1', displayName: 'Alarm Diagnosis' }),
        makeSkillEntry({ capabilityId: 'skill-2', displayName: 'Config Manager' }),
      ];
      const port = makeSkillCatalogPort(async (request) => {
        const keyword = request.keyword?.toLowerCase() ?? '';
        const filtered = skills.filter((s) => s.displayName.toLowerCase().includes(keyword) || s.capabilityId.toLowerCase().includes(keyword));
        return { total: filtered.length, pageNum: request.pageNum, pageSize: request.pageSize, skills: filtered };
      });
      const app = await setupApp(makeDependencies({ skillCatalog: port }));

      const response = await app.inject({ method: 'GET', url: '/api/v1/skills?keyword=alarm' });
      const body = response.json<{ total: number; skills: SkillCatalogSummaryEntry[] }>();
      expect(body.total).toBe(1);
      expect(body.skills[0]!.displayName).toBe('Alarm Diagnosis');
      await app.close();
    });

    it('keyword matches capabilityId', async () => {
      const skills = [
        makeSkillEntry({ capabilityId: 'diag-tool', displayName: 'Tool' }),
        makeSkillEntry({ capabilityId: 'other', displayName: 'Other' }),
      ];
      const port = makeSkillCatalogPort(async (request) => {
        const keyword = request.keyword?.toLowerCase() ?? '';
        const filtered = skills.filter((s) => s.displayName.toLowerCase().includes(keyword) || s.capabilityId.toLowerCase().includes(keyword));
        return { total: filtered.length, pageNum: request.pageNum, pageSize: request.pageSize, skills: filtered };
      });
      const app = await setupApp(makeDependencies({ skillCatalog: port }));

      const response = await app.inject({ method: 'GET', url: '/api/v1/skills?keyword=diag' });
      const body = response.json<{ total: number; skills: SkillCatalogSummaryEntry[] }>();
      expect(body.total).toBe(1);
      expect(body.skills[0]!.capabilityId).toBe('diag-tool');
      await app.close();
    });

    it('keyword with no match returns total=0', async () => {
      const skills = [makeSkillEntry({ capabilityId: 'skill-1', displayName: 'Alarm' })];
      const port = makeSkillCatalogPort(async (request) => {
        const keyword = request.keyword?.toLowerCase() ?? '';
        const filtered = skills.filter((s) => s.displayName.toLowerCase().includes(keyword) || s.capabilityId.toLowerCase().includes(keyword));
        return { total: filtered.length, pageNum: request.pageNum, pageSize: request.pageSize, skills: filtered };
      });
      const app = await setupApp(makeDependencies({ skillCatalog: port }));

      const response = await app.inject({ method: 'GET', url: '/api/v1/skills?keyword=zzzzz' });
      expect(response.statusCode).toBe(200);
      const body = response.json<{ total: number; skills: SkillCatalogSummaryEntry[] }>();
      expect(body.total).toBe(0);
      expect(body.skills).toEqual([]);
      await app.close();
    });

    it('empty keyword is equivalent to no keyword', async () => {
      const skills = [makeSkillEntry({ capabilityId: 'skill-1' }), makeSkillEntry({ capabilityId: 'skill-2' })];
      let receivedKeyword: string | undefined;
      const port = makeSkillCatalogPort(async (request) => {
        receivedKeyword = request.keyword;
        return { total: skills.length, pageNum: request.pageNum, pageSize: request.pageSize, skills };
      });
      const app = await setupApp(makeDependencies({ skillCatalog: port }));

      await app.inject({ method: 'GET', url: '/api/v1/skills?keyword=' });
      expect(receivedKeyword).toBeUndefined();

      await app.inject({ method: 'GET', url: '/api/v1/skills?keyword=%20' });
      expect(receivedKeyword).toBeUndefined();

      await app.close();
    });
  });

  describe('security', () => {
    it('catalog unavailable returns 503 safe error', async () => {
      const port = makeSkillCatalogPort(async () => {
        throw new AgentError({
          code: 'CAPABILITY_CATALOG_UNAVAILABLE',
          message: 'Capability catalog is unavailable.',
          category: 'UNAVAILABLE',
          retryable: true,
        });
      });
      const app = await setupApp(makeDependencies({ skillCatalog: port }));

      const response = await app.inject({ method: 'GET', url: '/api/v1/skills' });
      expect(response.statusCode).toBe(503);
      const body = response.json<{ error: { code: string; message: string } }>();
      expect(body.error.code).toBe('CAPABILITY_CATALOG_UNAVAILABLE');
      const jsonStr = JSON.stringify(body);
      expect(jsonStr).not.toContain('stack');
      await app.close();
    });

    it('error response does not expose raw error or stack trace', async () => {
      const port = makeSkillCatalogPort(async () => {
        throw new Error('internal: /home/secret/config.yaml credential=abc123');
      });
      const app = await setupApp(makeDependencies({ skillCatalog: port }));

      const response = await app.inject({ method: 'GET', url: '/api/v1/skills' });
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Request failed safely.' } });
      const jsonStr = JSON.stringify(response.json());
      expect(jsonStr).not.toContain('internal:');
      expect(jsonStr).not.toContain('/home/secret');
      expect(jsonStr).not.toContain('credential=abc123');
      await app.close();
    });
  });

  describe('cancel safety', () => {
    it('passes AbortSignal to the port for cancellation support', async () => {
      let receivedSignal: AbortSignal | undefined;
      let listSkillsCalled = false;
      const port = makeSkillCatalogPort(async (_request, signal?) => {
        listSkillsCalled = true;
        receivedSignal = signal;
        return { total: 0, pageNum: 1, pageSize: 50, skills: [] };
      });
      const app = await setupApp(makeDependencies({ skillCatalog: port }));

      const response = await app.inject({ method: 'GET', url: '/api/v1/skills' });
      expect(response.statusCode).toBe(200);
      expect(listSkillsCalled).toBe(true);
      expect(receivedSignal).toBeDefined();
      expect(receivedSignal).toBeInstanceOf(AbortSignal);
      await app.close();
    });
  });
});

describe('GET /api/v1/skills REMOTE mode', () => {
  it('returns BUNDLED + LOCAL_DIRECTORY + SKILL_HUB skills in REMOTE deployment mode', async () => {
    const skills = [
      makeSkillEntry({ capabilityId: 'builtin-skill', providerKind: 'BUNDLED' }),
      makeSkillEntry({ capabilityId: 'local-skill', providerKind: 'LOCAL_DIRECTORY' }),
      makeSkillEntry({ capabilityId: 'hub-skill', providerKind: 'SKILL_HUB' }),
      makeSkillEntry({ capabilityId: 'another-local', providerKind: 'LOCAL_DIRECTORY' }),
      makeSkillEntry({ capabilityId: 'another-hub', providerKind: 'SKILL_HUB' }),
    ];
    const port = makeSkillCatalogPort(async () => ({ total: skills.length, pageNum: 1, pageSize: 50, skills }));
    const app = await setupApp(makeDependencies({ skillCatalog: port }));

    const response = await app.inject({ method: 'GET', url: '/api/v1/skills' });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ total: number; skills: SkillCatalogSummaryEntry[] }>();
    expect(body.total).toBe(5);
    const providerKinds = body.skills.map((s) => s.providerKind);
    expect(providerKinds).toContain('BUNDLED');
    expect(providerKinds).toContain('LOCAL_DIRECTORY');
    expect(providerKinds).toContain('SKILL_HUB');
    expect(body.skills.filter((s) => s.providerKind === 'BUNDLED')).toHaveLength(1);
    expect(body.skills.filter((s) => s.providerKind === 'LOCAL_DIRECTORY')).toHaveLength(2);
    expect(body.skills.filter((s) => s.providerKind === 'SKILL_HUB')).toHaveLength(2);
    await app.close();
  });
});

describe('GET /api/v1/skills builtin-skills source', () => {
  it('LOCAL mode includes BUNDLED provider skills', async () => {
    const skills = [
      makeSkillEntry({ capabilityId: 'network-diagnostics', displayName: 'Network Diagnostics', providerKind: 'BUNDLED' }),
      makeSkillEntry({ capabilityId: 'local-skill', displayName: 'Local Skill', providerKind: 'LOCAL_DIRECTORY' }),
    ];
    const port = makeSkillCatalogPort(async () => ({ total: skills.length, pageNum: 1, pageSize: 50, skills }));
    const app = await setupApp(makeDependencies({ skillCatalog: port }));

    const response = await app.inject({ method: 'GET', url: '/api/v1/skills' });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ skills: SkillCatalogSummaryEntry[] }>();
    const builtinSkills = body.skills.filter((s) => s.providerKind === 'BUNDLED');
    expect(builtinSkills).toHaveLength(1);
    expect(builtinSkills[0]!.capabilityId).toBe('network-diagnostics');
    const localSkills = body.skills.filter((s) => s.providerKind === 'LOCAL_DIRECTORY');
    expect(localSkills).toHaveLength(1);
    await app.close();
  });
});

describe('GET /api/v1/skills agent-owned authorization', () => {
  it('authorized agent-owned skills appear in results', async () => {
    const skills = [makeSkillEntry({ capabilityId: 'agent-owned-skill', providerKind: 'LOCAL_DIRECTORY' })];
    const port = makeSkillCatalogPort(async () => ({ total: skills.length, pageNum: 1, pageSize: 50, skills }));
    const app = await setupApp(makeDependencies({ skillCatalog: port }));

    const response = await app.inject({ method: 'GET', url: '/api/v1/skills' });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ skills: SkillCatalogSummaryEntry[] }>();
    expect(body.skills).toHaveLength(1);
    expect(body.skills[0]!.capabilityId).toBe('agent-owned-skill');
    await app.close();
  });

  it('unauthorized agent-owned skills do not appear in results', async () => {
    const port = makeSkillCatalogPort(async () => ({
      total: 0,
      pageNum: 1,
      pageSize: 50,
      skills: [],
    }));
    const app = await setupApp(makeDependencies({ skillCatalog: port }));

    const response = await app.inject({ method: 'GET', url: '/api/v1/skills' });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ total: number; skills: SkillCatalogSummaryEntry[] }>();
    expect(body.skills).toEqual([]);
    expect(body.total).toBe(0);
    await app.close();
  });
});

describe('statusFor UNAVAILABLE regression', () => {
  it('attachment UNAVAILABLE error returns 503', async () => {
    const port = makeSkillCatalogPort(async () => {
      throw new AgentError({
        code: 'ATTACHMENT_DEPENDENCY_UNAVAILABLE',
        message: 'Attachment intake dependencies are unavailable.',
        category: 'UNAVAILABLE',
        retryable: true,
      });
    });
    const app = await setupApp(makeDependencies({ skillCatalog: port }));

    const response = await app.inject({ method: 'GET', url: '/api/v1/skills' });
    expect(response.statusCode).toBe(503);
    const body = response.json<{ error: { code: string; message: string } }>();
    expect(body.error.code).toBe('ATTACHMENT_DEPENDENCY_UNAVAILABLE');
    await app.close();
  });
});
