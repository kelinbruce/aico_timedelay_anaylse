import type { SafeError } from '@nextagent/agent-common';
import { guardrailServiceUnavailableMessage } from '@nextagent/agent-common';
import type {
  GatewayAdapterKind,
  GatewayBindings,
  GatewayProvider,
  GatewayProviderCreateInput,
  GuardrailCheckAnswerInput,
  GuardrailCheckAnswerResult,
  GuardrailCheckQuestionInput,
  GuardrailCheckQuestionResult,
  GuardrailCheckNl2PythonInput,
  GuardrailCheckNl2PythonResult,
  GuardrailCheckKnowledgeInput,
  GuardrailCheckKnowledgeResult,
  GuardrailGatewayPort,
} from '@nextagent/agent-contracts/gateway';
import type { ExecutionCorrelationPort } from '@nextagent/agent-contracts/observability';

export interface RobotRouterGuardrailProviderOptions {
  readonly providerId?: string;
  readonly endpoint: string;
  readonly fetch?: RobotRouterFetch;
  readonly executionCorrelation?: ExecutionCorrelationPort;
}

export type RobotRouterFetch = (
  input: string,
  init?: {
    readonly method?: string;
    readonly headers?: Record<string, string>;
    readonly body?: string;
    readonly signal?: AbortSignal;
  },
) => Promise<RobotRouterFetchResponse>;

export interface RobotRouterFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly json: () => Promise<unknown>;
}

const guardrailAdapterKinds: readonly GatewayAdapterKind[] = ['guardrail'];
const knowledgeCheckTimeoutMs = 5000;
const maxKnowledgeFragmentCodePoints = 2000;
const maxKnowledgeFragmentsPerRequest = 5;

interface RobotRouterCheckResultItem {
  readonly isLegal?: boolean;
  readonly question?: string;
  readonly answer?: string;
  readonly response?: string;
}

interface RobotRouterCheckResponseBody {
  readonly checkResults?: readonly RobotRouterCheckResultItem[];
}

interface RobotRouterNl2PythonResponseBody {
  readonly status?: boolean;
  readonly error_msg?: readonly string[];
}

interface RobotRouterKnowledgeCheckResultItem {
  readonly is_legal: 'true' | 'false';
}

interface RobotRouterKnowledgeCheckResponseBody {
  readonly is_legal: boolean;
  readonly check_results: readonly RobotRouterKnowledgeCheckResultItem[];
}

export function createRobotRouterGuardrailProvider(options: RobotRouterGuardrailProviderOptions): GatewayProvider {
  const providerId = options.providerId ?? 'remote-robotrouter-guardrail';
  const endpoint = options.endpoint.replace(/\/+$/, '');
  const doFetch = options.fetch ?? defaultFetch;
  return {
    providerId,
    deploymentMode: 'REMOTE',
    supportedAdapterKinds: guardrailAdapterKinds,
    create(input: GatewayProviderCreateInput): GatewayBindings {
      const unsupported = input.selectedEntries.find(
        (entry) => entry.deploymentMode !== 'REMOTE' || !guardrailAdapterKinds.includes(entry.adapterKind),
      );
      if (unsupported !== undefined) {
        return blockedGuardrailBindings(providerId, `adapter:${unsupported.adapterKind}:unsupported`);
      }
      const executionCorrelation = input.executionCorrelation ?? options.executionCorrelation;
      const port: GuardrailGatewayPort = {
        checkQuestion: (request, signal) => checkQuestion(doFetch, endpoint, request, signal, executionCorrelation),
        checkNl2Python: (request, signal) => checkNl2Python(doFetch, endpoint, request, signal, executionCorrelation),
        checkAnswer: (request, signal) => checkAnswer(doFetch, endpoint, request, signal, executionCorrelation),
        checkKnowledge: (request, signal) => checkKnowledge(doFetch, endpoint, request, signal, executionCorrelation),
      };
      return readyGuardrailBindings(providerId, port);
    },
  };
}

async function checkQuestion(
  fetch: RobotRouterFetch,
  endpoint: string,
  input: GuardrailCheckQuestionInput,
  signal?: AbortSignal,
  executionCorrelation?: ExecutionCorrelationPort,
): Promise<GuardrailCheckQuestionResult> {
  const url = `${endpoint}/rest/naie/guardrail/v1/question/check`;
  // Fail-closed: any guard-service failure MUST refuse the input. The message
  // language follows the request `locale` (deployment defaultLanguage).
  const SERVICE_UNAVAILABLE = guardrailServiceUnavailableMessage(input.locale);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  if (signal !== undefined) {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: executionCorrelation?.outboundHeaders({ 'content-type': 'application/json' }) ?? { 'content-type': 'application/json' },
      body: JSON.stringify({
        questions: input.questions,
        ...(input.ignoreItems === undefined ? {} : { ignore_items: input.ignoreItems }),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { isLegal: false, refusalMessage: SERVICE_UNAVAILABLE };
    }
    const body = (await response.json()) as RobotRouterCheckResponseBody;
    const first = body.checkResults?.[0];
    if (first === undefined) {
      return { isLegal: false, refusalMessage: SERVICE_UNAVAILABLE };
    }
    return { isLegal: first.isLegal === true, refusalMessage: first.response ?? '' };
  } catch {
    return { isLegal: false, refusalMessage: SERVICE_UNAVAILABLE };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkNl2Python(
  fetch: RobotRouterFetch,
  endpoint: string,
  input: GuardrailCheckNl2PythonInput,
  signal?: AbortSignal,
  executionCorrelation?: ExecutionCorrelationPort,
): Promise<GuardrailCheckNl2PythonResult> {
  const url = `${endpoint}/rest/naie/guardrail/v1/application-sec/check`;
  // Fail-closed: any guard-service failure MUST block the code rather than
  // forward it to the sandbox.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  if (signal !== undefined) {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: executionCorrelation?.outboundHeaders({ 'content-type': 'application/json' }) ?? { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'nl2py', content: input.content }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { status: false, errorMsg: ['guard service unavailable'] };
    }
    const body = (await response.json()) as RobotRouterNl2PythonResponseBody;
    return { status: body.status === true, errorMsg: body.error_msg ?? [] };
  } catch {
    return { status: false, errorMsg: ['guard service unavailable'] };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkAnswer(
  fetch: RobotRouterFetch,
  endpoint: string,
  input: GuardrailCheckAnswerInput,
  signal?: AbortSignal,
  executionCorrelation?: ExecutionCorrelationPort,
): Promise<GuardrailCheckAnswerResult> {
  const url = `${endpoint}/rest/naie/guardrail/v1/answer/check`;
  // Fail-closed: any guard-service failure MUST block the output. The message
  // language follows the request `locale` (deployment defaultLanguage).
  const SERVICE_UNAVAILABLE = guardrailServiceUnavailableMessage(input.locale);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  if (signal !== undefined) {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: executionCorrelation?.outboundHeaders({ 'content-type': 'application/json' }) ?? { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: input.answers }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { isLegal: false, refusalMessage: SERVICE_UNAVAILABLE };
    }
    const body = (await response.json()) as RobotRouterCheckResponseBody;
    const first = body.checkResults?.[0];
    if (first === undefined) {
      return { isLegal: false, refusalMessage: SERVICE_UNAVAILABLE };
    }
    return { isLegal: first.isLegal === true, refusalMessage: first.response ?? '' };
  } catch {
    return { isLegal: false, refusalMessage: SERVICE_UNAVAILABLE };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkKnowledge(
  fetch: RobotRouterFetch,
  endpoint: string,
  input: GuardrailCheckKnowledgeInput,
  signal?: AbortSignal,
  executionCorrelation?: ExecutionCorrelationPort,
): Promise<GuardrailCheckKnowledgeResult | SafeError> {
  if (!isValidKnowledgeInput(input)) {
    return knowledgeRequestInvalidError();
  }
  if (isAborted(signal)) {
    return knowledgeCanceledError();
  }

  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(), knowledgeCheckTimeoutMs);
  try {
    const response = await fetch(`${endpoint}/rest/naie/guardrail/v1/text/security/check`, {
      method: 'POST',
      headers: executionCorrelation?.outboundHeaders({ 'content-type': 'application/json' }) ?? { 'content-type': 'application/json' },
      body: JSON.stringify({
        texts: input.texts,
        ...(input.isPrivacy === undefined ? {} : { is_privacy: input.isPrivacy }),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return response.status === 400 ? knowledgeRequestInvalidError() : knowledgeUnavailableError();
    }

    const body: unknown = await response.json();
    if (!isKnowledgeResponse(body, input.texts.length)) {
      return knowledgeUnavailableError();
    }
    return {
      isLegal: body.is_legal === true && body.check_results.every((item) => item.is_legal === 'true'),
    };
  } catch {
    return isAborted(signal) ? knowledgeCanceledError() : knowledgeUnavailableError();
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}

function isValidKnowledgeInput(input: GuardrailCheckKnowledgeInput): boolean {
  return (
    Array.isArray(input.texts) &&
    input.texts.length >= 1 &&
    input.texts.length <= maxKnowledgeFragmentsPerRequest &&
    input.texts.every((text) => typeof text === 'string' && text.length > 0 && Array.from(text).length <= maxKnowledgeFragmentCodePoints) &&
    (input.isPrivacy === undefined || typeof input.isPrivacy === 'boolean')
  );
}

function isKnowledgeResponse(value: unknown, expectedItemCount: number): value is RobotRouterKnowledgeCheckResponseBody {
  if (!isObject(value) || typeof value.is_legal !== 'boolean' || !Array.isArray(value.check_results)) {
    return false;
  }
  return (
    value.check_results.length === expectedItemCount &&
    value.check_results.every((item) => isObject(item) && (item.is_legal === 'true' || item.is_legal === 'false'))
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

function knowledgeRequestInvalidError(): SafeError {
  return {
    code: 'GUARDRAIL_KNOWLEDGE_REQUEST_INVALID',
    message: 'Knowledge security check request is invalid.',
    category: 'VALIDATION',
    retryable: false,
  };
}

function knowledgeUnavailableError(): SafeError {
  return {
    code: 'GUARDRAIL_KNOWLEDGE_UNAVAILABLE',
    message: 'Knowledge security check is temporarily unavailable.',
    category: 'UNAVAILABLE',
    retryable: true,
  };
}

function knowledgeCanceledError(): SafeError {
  return {
    code: 'GUARDRAIL_KNOWLEDGE_CANCELED',
    message: 'Knowledge security check was canceled.',
    category: 'CANCELED',
    retryable: false,
  };
}

function readyGuardrailBindings(providerId: string, port: GuardrailGatewayPort): GatewayBindings {
  return {
    providerId,
    deploymentMode: 'REMOTE',
    readiness: { state: 'READY', evidenceRef: `guardrail:${providerId}`, safeMessage: 'RobotRouter guardrail binding is ready.' },
    guardrail: port,
  };
}

function blockedGuardrailBindings(providerId: string, reason: string): GatewayBindings {
  return { providerId, deploymentMode: 'REMOTE', readiness: { state: 'BLOCKED', evidenceRef: `guardrail:${providerId}`, safeMessage: reason } };
}

async function defaultFetch(
  input: string,
  init?: { readonly method?: string; readonly headers?: Record<string, string>; readonly body?: string; readonly signal?: AbortSignal },
): Promise<RobotRouterFetchResponse> {
  const response = await fetch(input, {
    ...(init === undefined ? {} : { method: init.method }),
    ...(init === undefined || init.headers === undefined ? {} : { headers: init.headers }),
    ...(init === undefined || init.body === undefined ? {} : { body: init.body }),
    ...(init === undefined || init.signal === undefined ? {} : { signal: init.signal }),
  });
  return { ok: response.ok, status: response.status, json: () => response.json() };
}
