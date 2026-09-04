import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRobotRouterGuardrailProvider, type RobotRouterFetch } from '@nextagent/agent-platform-gateway-remote';
import type { GatewayProviderCreateInput } from '@nextagent/agent-contracts/gateway';

interface MockBehavior {
  readonly guardLegal: boolean;
  readonly guardRefusalMessage?: string;
  readonly nl2pyStatus: boolean;
  readonly nl2pyErrorMsg?: readonly string[];
}

interface CapturedRequest {
  readonly url: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body: string;
}

function startMockRobotRouter(behavior: MockBehavior): Promise<Server> {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/rest/naie/guardrail/v1/question/check' && req.method === 'POST') {
        const parsed = JSON.parse(body || '{}');
        const questions: string[] = parsed.questions ?? [];
        res.end(
          JSON.stringify({
            checkResults: questions.map((q: string) => ({
              isLegal: behavior.guardLegal,
              question: q,
              response: behavior.guardLegal ? '' : (behavior.guardRefusalMessage ?? 'blocked'),
            })),
          }),
        );
        return;
      }
      if (req.url === '/rest/naie/guardrail/v1/application-sec/check' && req.method === 'POST') {
        res.end(
          JSON.stringify({
            status: behavior.nl2pyStatus,
            error_msg: behavior.nl2pyStatus ? [] : (behavior.nl2pyErrorMsg ?? ['blocked import']),
          }),
        );
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'not found' }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function serverEndpoint(server: Server): string {
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('mock server not bound');
  }
  return `http://127.0.0.1:${address.port}`;
}

function captureRequests(): { fetch: RobotRouterFetch; calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = [];
  const captured: RobotRouterFetch = async (input, init) => {
    calls.push({
      url: input,
      ...(init?.method === undefined ? {} : { method: init.method }),
      ...(init?.headers === undefined ? {} : { headers: init.headers }),
      body: init?.body ?? '',
    });
    const response = await globalThis.fetch(input, {
      ...(init?.method === undefined ? {} : { method: init.method }),
      ...(init?.headers === undefined ? {} : { headers: init.headers }),
      ...(init?.body === undefined ? {} : { body: init.body }),
      ...(init?.signal === undefined ? {} : { signal: init.signal }),
    });
    return { ok: response.ok, status: response.status, json: () => response.json() };
  };
  return { fetch: captured, calls };
}

const createInput: GatewayProviderCreateInput = {
  selectedEntries: [{ gatewayId: 'guardrail-1', adapterKind: 'guardrail', deploymentMode: 'REMOTE' }],
  runtime: {
    paths: {
      workingMemorySqliteFile: '',
      longTermMemorySqliteFile: '',
      sqliteFile: '',
      workspaceRoot: '',
      logDirectory: '',
      runtimeWorkspaceRoot: '',
    },
    sandbox: { enabled: false, deniedExecutables: [] },
  },
};

describe('RobotRouter guardrail gateway contract', () => {
  let server: Server;

  beforeEach(() => {
    server = undefined as unknown as Server;
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (server !== undefined) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('creates a READY guardrail binding for a REMOTE guardrail selection', async () => {
    server = await startMockRobotRouter({ guardLegal: true, nl2pyStatus: true });
    const provider = createRobotRouterGuardrailProvider({ endpoint: serverEndpoint(server) });
    const bindings = provider.create(createInput);
    expect(bindings.deploymentMode).toBe('REMOTE');
    expect(bindings.readiness.state).toBe('READY');
    expect(bindings.guardrail).toBeDefined();
  });

  it('blocks on a REMOTE non-remote selection', () => {
    const provider = createRobotRouterGuardrailProvider({ endpoint: 'http://127.0.0.1:1' });
    const bindings = provider.create({
      ...createInput,
      selectedEntries: [{ gatewayId: 'guardrail-1', adapterKind: 'guardrail', deploymentMode: 'LOCAL' }],
    });
    expect(bindings.readiness.state).toBe('BLOCKED');
    expect(bindings.guardrail).toBeUndefined();
  });

  it('returns isLegal=false when the guard service blocks input', async () => {
    server = await startMockRobotRouter({
      guardLegal: false,
      guardRefusalMessage: '请修改输入',
      nl2pyStatus: true,
    });
    const { fetch, calls } = captureRequests();
    const provider = createRobotRouterGuardrailProvider({ endpoint: serverEndpoint(server), fetch });
    const bindings = provider.create(createInput);
    const result = await bindings.guardrail!.checkQuestion({ questions: ['hello'] });
    expect(result.isLegal).toBe(false);
    expect(result.refusalMessage).toBe('请修改输入');
    expect(calls[0]?.url).toContain('/rest/naie/guardrail/v1/question/check');
  });

  it('returns isLegal=true when the guard service accepts input', async () => {
    server = await startMockRobotRouter({ guardLegal: true, nl2pyStatus: true });
    const provider = createRobotRouterGuardrailProvider({ endpoint: serverEndpoint(server) });
    const bindings = provider.create(createInput);
    const result = await bindings.guardrail!.checkQuestion({ questions: ['hello'] });
    expect(result.isLegal).toBe(true);
  });

  it('localizes the fail-closed refusal by locale when the guard service is unavailable (checkQuestion)', async () => {
    // Guard service returns 503 → fail-closed isLegal=false; the refusal
    // message language follows the request `locale`.
    const unavailable: RobotRouterFetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
    const provider = createRobotRouterGuardrailProvider({ endpoint: 'https://guardrail.example.test', fetch: unavailable });
    const guardrail = provider.create(createInput).guardrail!;

    const enResult = await guardrail.checkQuestion({ questions: ['hello'], locale: 'en-US' });
    expect(enResult.isLegal).toBe(false);
    expect(enResult.refusalMessage).toBe('The guardrail service is unavailable. The response has been refused.');

    const zhResult = await guardrail.checkQuestion({ questions: ['hello'], locale: 'zh-CN' });
    expect(zhResult.isLegal).toBe(false);
    expect(zhResult.refusalMessage).toBe('护栏服务不可用，拒绝回答。');

    const defaultResult = await guardrail.checkQuestion({ questions: ['hello'] });
    expect(defaultResult.isLegal).toBe(false);
    expect(defaultResult.refusalMessage).toBe('护栏服务不可用，拒绝回答。');
  });

  it('localizes the fail-closed refusal by locale when the guard service is unavailable (checkAnswer)', async () => {
    const networkFailure: RobotRouterFetch = async () => {
      throw new Error('RAW_NETWORK_ERROR');
    };
    const provider = createRobotRouterGuardrailProvider({ endpoint: 'https://guardrail.example.test', fetch: networkFailure });
    const guardrail = provider.create(createInput).guardrail!;

    const enResult = await guardrail.checkAnswer({ answers: ['some answer'], locale: 'en-US' });
    expect(enResult.isLegal).toBe(false);
    expect(enResult.refusalMessage).toBe('The guardrail service is unavailable. The response has been refused.');

    const zhResult = await guardrail.checkAnswer({ answers: ['some answer'], locale: 'zh-CN' });
    expect(zhResult.isLegal).toBe(false);
    expect(zhResult.refusalMessage).toBe('护栏服务不可用，拒绝回答。');
  });

  it('checks nl2py code and returns structured error messages', async () => {
    server = await startMockRobotRouter({
      guardLegal: true,
      nl2pyStatus: false,
      nl2pyErrorMsg: ['代码行号1，导入包：禁止导入email。'],
    });
    const { fetch, calls } = captureRequests();
    const provider = createRobotRouterGuardrailProvider({ endpoint: serverEndpoint(server), fetch });
    const bindings = provider.create(createInput);
    const result = await bindings.guardrail!.checkNl2Python({ content: 'import email' });
    expect(result.status).toBe(false);
    expect(result.errorMsg).toEqual(['代码行号1，导入包：禁止导入email。']);
    expect(calls[0]?.url).toContain('/rest/naie/guardrail/v1/application-sec/check');
  });

  it('checks five ordered knowledge fragments with privacy enabled', async () => {
    const calls: CapturedRequest[] = [];
    const fetch: RobotRouterFetch = async (input, init) => {
      calls.push({
        url: input,
        ...(init?.method === undefined ? {} : { method: init.method }),
        ...(init?.headers === undefined ? {} : { headers: init.headers }),
        body: init?.body ?? '',
      });
      return response({
        is_legal: true,
        check_results: ['true', 'true', 'true', 'true', 'true'].map((isLegal) => ({
          is_legal: isLegal,
          detail: '',
        })),
      });
    };
    const provider = createRobotRouterGuardrailProvider({ endpoint: 'https://guardrail.example.test', fetch });
    const bindings = provider.create(createInput);
    const texts = ['first', 'second', 'third', 'fourth', 'fifth'];

    const result = await bindings.guardrail!.checkKnowledge({ texts, isPrivacy: true });

    expect(result).toEqual({ isLegal: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      url: 'https://guardrail.example.test/rest/naie/guardrail/v1/text/security/check',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ texts, is_privacy: true }),
    });
  });

  it('preserves an explicit false privacy option and omits an absent option', async () => {
    const bodies: unknown[] = [];
    const fetch: RobotRouterFetch = async (_input, init) => {
      bodies.push(JSON.parse(init?.body ?? '{}'));
      return response({ is_legal: true, check_results: [{ is_legal: 'true', detail: '' }] });
    };
    const provider = createRobotRouterGuardrailProvider({ endpoint: 'https://guardrail.example.test', fetch });
    const guardrail = provider.create(createInput).guardrail!;

    expect(await guardrail.checkKnowledge({ texts: ['first'], isPrivacy: false })).toEqual({ isLegal: true });
    expect(await guardrail.checkKnowledge({ texts: ['second'] })).toEqual({ isLegal: true });
    expect(bodies).toEqual([{ texts: ['first'], is_privacy: false }, { texts: ['second'] }]);
  });

  it('rejects invalid knowledge request bounds before calling RobotRouter', async () => {
    const fetch: RobotRouterFetch = vi.fn(async () =>
      response({
        is_legal: true,
        check_results: [{ is_legal: 'true', detail: '' }],
      }),
    );
    const provider = createRobotRouterGuardrailProvider({ endpoint: 'https://guardrail.example.test', fetch });
    const guardrail = provider.create(createInput).guardrail!;
    const validMaximum = '😀'.repeat(2000);

    expect(await guardrail.checkKnowledge({ texts: [validMaximum] })).toEqual({ isLegal: true });
    expect(fetch).toHaveBeenCalledTimes(1);

    for (const texts of [[], ['one', 'two', 'three', 'four', 'five', 'six'], [''], ['😀'.repeat(2001)]]) {
      expect(await guardrail.checkKnowledge({ texts })).toMatchObject({
        code: 'GUARDRAIL_KNOWLEDGE_REQUEST_INVALID',
        category: 'VALIDATION',
        retryable: false,
      });
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('blocks on a legal-shaped rejected item without exposing provider detail', async () => {
    const detailCanary = 'SENSITIVE_PROVIDER_DETAIL';
    const fetch: RobotRouterFetch = async () =>
      response({
        is_legal: false,
        check_results: [{ is_legal: 'false', detail: detailCanary }],
      });
    const provider = createRobotRouterGuardrailProvider({ endpoint: 'https://guardrail.example.test', fetch });

    const result = await provider.create(createInput).guardrail!.checkKnowledge({ texts: ['blocked content'] });

    expect(result).toEqual({ isLegal: false });
    expect(JSON.stringify(result)).not.toContain(detailCanary);
  });

  it.each([
    {
      name: 'missing check_results',
      body: { is_legal: true },
    },
    {
      name: 'mismatched item count',
      body: { is_legal: true, check_results: [] },
    },
    {
      name: 'boolean item value',
      body: { is_legal: true, check_results: [{ is_legal: true, detail: 'RAW_DETAIL' }] },
    },
    {
      name: 'invalid top-level value',
      body: { is_legal: 'true', check_results: [{ is_legal: 'true', detail: 'RAW_DETAIL' }] },
    },
  ])('fails closed for an invalid success response: $name', async ({ body }) => {
    const fetch: RobotRouterFetch = async () => response(body);
    const provider = createRobotRouterGuardrailProvider({ endpoint: 'https://guardrail.example.test', fetch });

    const result = await provider.create(createInput).guardrail!.checkKnowledge({ texts: ['content'] });

    expect(result).toMatchObject({
      code: 'GUARDRAIL_KNOWLEDGE_UNAVAILABLE',
      category: 'UNAVAILABLE',
      retryable: true,
    });
    expect(JSON.stringify(result)).not.toContain('RAW_DETAIL');
  });

  it('maps HTTP 400 separately from unavailable and network failures', async () => {
    const http400: RobotRouterFetch = async () => response({ errorCode: 400, errorMsg: 'RAW_BODY' }, false, 400);
    const unavailable: RobotRouterFetch = async () => response({ error: 'RAW_BODY' }, false, 503);
    const networkFailure: RobotRouterFetch = async () => {
      throw new Error('RAW_NETWORK_ERROR');
    };

    const invalidResult = await createRobotRouterGuardrailProvider({
      endpoint: 'https://guardrail.example.test',
      fetch: http400,
    })
      .create(createInput)
      .guardrail!.checkKnowledge({ texts: ['content'] });
    const unavailableResult = await createRobotRouterGuardrailProvider({
      endpoint: 'https://guardrail.example.test',
      fetch: unavailable,
    })
      .create(createInput)
      .guardrail!.checkKnowledge({ texts: ['content'] });
    const networkResult = await createRobotRouterGuardrailProvider({
      endpoint: 'https://guardrail.example.test',
      fetch: networkFailure,
    })
      .create(createInput)
      .guardrail!.checkKnowledge({ texts: ['content'] });

    expect(invalidResult).toMatchObject({
      code: 'GUARDRAIL_KNOWLEDGE_REQUEST_INVALID',
      category: 'VALIDATION',
      retryable: false,
    });
    expect(unavailableResult).toMatchObject({
      code: 'GUARDRAIL_KNOWLEDGE_UNAVAILABLE',
      category: 'UNAVAILABLE',
      retryable: true,
    });
    expect(networkResult).toMatchObject({
      code: 'GUARDRAIL_KNOWLEDGE_UNAVAILABLE',
      category: 'UNAVAILABLE',
      retryable: true,
    });
    expect(JSON.stringify([invalidResult, unavailableResult, networkResult])).not.toContain('RAW_BODY');
    expect(JSON.stringify(networkResult)).not.toContain('RAW_NETWORK_ERROR');
  });

  it('distinguishes caller cancellation from the adapter timeout', async () => {
    vi.useFakeTimers();
    const waitForAbort: RobotRouterFetch = async (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    const provider = createRobotRouterGuardrailProvider({ endpoint: 'https://guardrail.example.test', fetch: waitForAbort });
    const guardrail = provider.create(createInput).guardrail!;
    const controller = new AbortController();

    const canceledPromise = guardrail.checkKnowledge({ texts: ['content'] }, controller.signal);
    controller.abort();
    await expect(canceledPromise).resolves.toMatchObject({
      code: 'GUARDRAIL_KNOWLEDGE_CANCELED',
      category: 'CANCELED',
      retryable: false,
    });

    const timeoutPromise = guardrail.checkKnowledge({ texts: ['content'] });
    await vi.advanceTimersByTimeAsync(5000);
    await expect(timeoutPromise).resolves.toMatchObject({
      code: 'GUARDRAIL_KNOWLEDGE_UNAVAILABLE',
      category: 'UNAVAILABLE',
      retryable: true,
    });
  });

  it('propagates active execution trace headers to RobotRouter', async () => {
    const headers: Array<Record<string, string>> = [];
    const provider = createRobotRouterGuardrailProvider({
      endpoint: 'https://robotrouter.example',
      fetch: async (_input, init) => {
        headers.push(init?.headers ?? {});
        return {
          ok: true,
          status: 200,
          async json() {
            return { checkResults: [{ isLegal: true, response: '' }] };
          },
        };
      },
    });
    const bindings = provider.create({
      ...createInput,
      executionCorrelation: {
        async withIncomingCarrier(_carrier, operation) {
          return operation();
        },
        async withExecutionRef(_ref, operation) {
          return operation();
        },
        outboundHeaders(input = {}) {
          return {
            ...input,
            traceparent: '00-11111111111111111111111111111111-2222222222222222-01',
            'x-task-event-id': 'task-01',
          };
        },
      },
    });

    await bindings.guardrail!.checkQuestion({ questions: ['hello'] });

    expect(headers[0]).toMatchObject({
      traceparent: '00-11111111111111111111111111111111-2222222222222222-01',
      'x-task-event-id': 'task-01',
    });
  });
});

function response(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  };
}
