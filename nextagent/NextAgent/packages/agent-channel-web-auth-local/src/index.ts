import { AgentError, brand, type IdentityContext, type SecretReference } from '@nextagent/agent-common';
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export interface LocalWebAuthOptions {
  readonly loopbackOnly: true;
}

export interface LocalConfiguredWebAuthOptions extends LocalWebAuthOptions {
  readonly identity: IdentityContext;
  readonly credentialRef: SecretReference;
  readonly cookieTtlMs: number;
  readonly credentialResolver: (ref: SecretReference) => Promise<string>;
  readonly clock?: () => number;
  readonly protectedPathPrefixes?: readonly string[];
  // Mount prefix for the auth-local routes (login/logout) and the public
  // runtime/bootstrap route. Must match the Web channel `routePrefix` so the
  // auth routes stay reachable and the public-route exemption stays correct.
  readonly routePrefix?: string;
  readonly registerProtectedRoutes?: (instance: FastifyInstance, context: LocalConfiguredWebAuthPluginContext) => void | Promise<void>;
}

export interface LocalConfiguredWebAuth {
  ready: () => Promise<void>;
  readonly plugin: FastifyPluginAsync;
  resolveIdentity: (request: FastifyRequest | IncomingMessage) => IdentityContext;
}

export interface LocalConfiguredWebAuthPluginContext {
  readonly resolveIdentity: (request: FastifyRequest | IncomingMessage) => IdentityContext;
}

const cookieName = 'nextagent_local_auth';
const purpose = 'LOCAL_CONFIG_AUTH';
const loginBodySchema = {
  type: 'object',
  properties: { credential: { type: 'string', minLength: 1, maxLength: 4096 } },
  required: ['credential'],
  additionalProperties: false,
} as const;
const identityResponseSchema = {
  type: 'object',
  properties: {
    identity: {
      type: 'object',
      properties: {
        tenantId: { type: 'string' },
        subjectId: { type: 'string' },
        displayName: { type: 'string' },
      },
      required: ['tenantId', 'subjectId'],
      additionalProperties: false,
    },
  },
  required: ['identity'],
  additionalProperties: false,
} as const;
const logoutResponseSchema = {
  type: 'object',
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
  additionalProperties: false,
} as const;
const authChallengeResponseSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    authMode: { const: 'LOCAL_CONFIG' },
    loginUrl: { type: 'string' },
    iamStatus: { type: 'null' },
    localLoginEnabled: { type: 'boolean' },
  },
  required: ['error', 'authMode', 'loginUrl', 'iamStatus', 'localLoginEnabled'],
  additionalProperties: false,
} as const;

export function createLocalConfiguredWebAuth(options: LocalConfiguredWebAuthOptions): LocalConfiguredWebAuth {
  if (!options.loopbackOnly) {
    throw new AgentError({
      code: 'LOCAL_AUTH_LOOPBACK_ONLY_REQUIRED',
      message: 'Local auth requires loopback-only serving.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  if (!Number.isSafeInteger(options.cookieTtlMs) || options.cookieTtlMs < 60_000) {
    throw new AgentError({
      code: 'LOCAL_AUTH_COOKIE_TTL_INVALID',
      message: 'Local auth cookie TTL is invalid.',
      category: 'VALIDATION',
      retryable: false,
    });
  }

  const signingKey = randomBytes(32);
  const protectedPathPrefixes = validateProtectedPathPrefixes(options.protectedPathPrefixes ?? []);
  // Public path prefix P (default `/` = no prefix). The API segment `/api/v1`
  // is fixed; P is prepended in front of it. auth-local routes and the public
  // runtime/bootstrap route mount under ${prefix}/api/v1/...
  const routePrefix = options.routePrefix ?? '/';
  const prefix = routePrefix === '/' ? '' : routePrefix;
  const API_SEGMENT = '/api/v1';
  const authLocalPrefix = `${prefix}${API_SEGMENT}/auth/local/`;
  const runtimeBootstrapPath = `${prefix}${API_SEGMENT}/runtime/bootstrap`;
  const issuedIdentities = new WeakMap<object, IdentityContext>();
  const failedAttempts = new Map<string, { count: number; blockedUntil: number }>();
  const clock = options.clock ?? (() => Date.now());
  const credentialPromise = options
    .credentialResolver(options.credentialRef)
    .then((credential) => {
      if (credential.length === 0) {
        throw localAuthCredentialUnavailable();
      }
      return credential;
    })
    .catch((error: unknown) => {
      if (error instanceof AgentError && error.code === 'LOCAL_AUTH_CREDENTIAL_UNAVAILABLE') {
        throw error;
      }
      throw localAuthCredentialUnavailable();
    });

  async function ready(): Promise<void> {
    await credentialPromise;
  }

  function registerRoutes(instance: FastifyInstance): void {
    instance.post(
      `${authLocalPrefix}login`,
      { schema: { body: loginBodySchema, response: { 200: identityResponseSchema, 401: authChallengeResponseSchema } } },
      async (request, reply) => {
        await handleLogin(request, reply);
      },
    );
    instance.post(`${authLocalPrefix}logout`, { schema: { response: { 200: logoutResponseSchema } } }, async (_request, reply) => {
      clearAuthCookie(reply);
      await reply.send({ ok: true });
    });
    instance.setNotFoundHandler(async (request, reply) => {
      const path = new URL(request.url, 'http://localhost').pathname;
      if (!isProtectedPath(path, protectedPathPrefixes, routePrefix, authLocalPrefix, runtimeBootstrapPath)) {
        await reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found.' } });
        return;
      }
      try {
        issuedIdentities.set(request, verifyCookie(request));
      } catch {
        await sendChallenge(reply, prefix);
        return;
      }
      await reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found.' } });
    });
  }

  const plugin: FastifyPluginAsync = async (instance) => {
    registerRoutes(instance);
    await instance.register(async (protectedScope) => {
      protectedScope.addHook('preValidation', async (request, reply) => {
        if (
          !isProtectedPath(
            new URL(request.url, 'http://localhost').pathname,
            protectedPathPrefixes,
            routePrefix,
            authLocalPrefix,
            runtimeBootstrapPath,
          )
        ) {
          return undefined;
        }
        try {
          issuedIdentities.set(request, verifyCookie(request));
        } catch {
          return await sendApiChallenge(reply);
        }
        return undefined;
      });
      await options.registerProtectedRoutes?.(protectedScope, { resolveIdentity });
    });
  };

  function resolveIdentity(request: FastifyRequest | IncomingMessage): IdentityContext {
    const existing = typeof request === 'object' ? issuedIdentities.get(request) : undefined;
    if (existing !== undefined) {
      return existing;
    }
    return verifyCookie(request);
  }

  async function handleLogin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = request.body as { credential?: unknown };
    const credential = typeof body.credential === 'string' ? body.credential : '';
    const key = clientKey(request);
    const failure = failedAttempts.get(key);
    if (failure !== undefined && failure.blockedUntil > clock()) {
      await sendAuthFailure(reply, prefix);
      return;
    }

    const expected = await credentialPromise;
    if (!constantTimeEquals(credential, expected)) {
      const nextCount = (failure?.count ?? 0) + 1;
      failedAttempts.set(key, { count: nextCount, blockedUntil: nextCount >= 3 ? clock() + 500 : 0 });
      await sendAuthFailure(reply, prefix);
      return;
    }

    failedAttempts.delete(key);
    setAuthCookie(reply, signCookie(clock()), options.cookieTtlMs);
    await reply.send({
      identity: {
        tenantId: options.identity.tenantId,
        subjectId: options.identity.subjectId,
        displayName: options.identity.displayName,
      },
    });
  }

  function signCookie(now: number): string {
    const payload = {
      purpose,
      tenantId: options.identity.tenantId,
      subjectId: options.identity.subjectId,
      displayName: options.identity.displayName,
      issuedAt: now,
      expiresAt: now + options.cookieTtlMs,
      nonce: randomBytes(16).toString('base64url'),
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signature = createHmac('sha256', signingKey).update(encodedPayload).digest('base64url');
    return `${encodedPayload}.${signature}`;
  }

  function verifyCookie(request: FastifyRequest | IncomingMessage): IdentityContext {
    const value = readCookie(request, cookieName);
    if (value === undefined) {
      throw authRequired();
    }
    const [encodedPayload, signature] = value.split('.');
    if (encodedPayload === undefined || signature === undefined) {
      throw authRequired();
    }
    const expected = createHmac('sha256', signingKey).update(encodedPayload).digest('base64url');
    if (!constantTimeEquals(signature, expected)) {
      throw authRequired();
    }
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Record<string, unknown>;
    } catch {
      throw authRequired();
    }
    if (
      payload.purpose !== purpose ||
      payload.tenantId !== options.identity.tenantId ||
      payload.subjectId !== options.identity.subjectId ||
      payload.displayName !== options.identity.displayName ||
      typeof payload.expiresAt !== 'number' ||
      payload.expiresAt <= clock()
    ) {
      throw authRequired();
    }
    return options.identity;
  }

  return { ready, plugin, resolveIdentity };
}

function localAuthCredentialUnavailable(): AgentError {
  return new AgentError({
    code: 'LOCAL_AUTH_CREDENTIAL_UNAVAILABLE',
    message: 'Local auth credential is unavailable.',
    category: 'VALIDATION',
    retryable: false,
  });
}

export function createLocalConfiguredWebAuthPlugin(options: LocalConfiguredWebAuthOptions): FastifyPluginAsync {
  return createLocalConfiguredWebAuth(options).plugin;
}

function isProtectedPath(
  path: string,
  protectedPathPrefixes: readonly string[],
  routePrefix: string,
  authLocalPrefix: string,
  runtimeBootstrapPath: string,
): boolean {
  // Public routes: auth-local login/logout, runtime bootstrap (API routes that
  // follow P), and static SPA assets (which stay at the root — page/asset
  // paths are not prefixed). These are exempt from cookie verification.
  if (
    path.startsWith(authLocalPrefix) ||
    path === runtimeBootstrapPath ||
    path === '/login' ||
    path.startsWith('/assets/') ||
    path === '/favicon.ico' ||
    path === '/manifest.webmanifest' ||
    path === '/robots.txt'
  ) {
    return false;
  }
  const prefix = routePrefix === '/' ? '' : routePrefix;
  return path.startsWith(`${prefix}/api/`) || isProtectedSpaRoute(path) || protectedPathPrefixes.some((p) => path === p || path.startsWith(`${p}/`));
}

function validateProtectedPathPrefixes(prefixes: readonly string[]): readonly string[] {
  const unique = [...new Set(prefixes)];
  for (const prefix of unique) {
    if (!/^\/[A-Za-z0-9_./-]+$/u.test(prefix) || prefix.endsWith('/') || prefix.includes('//') || prefix.includes('..')) {
      throw new AgentError({
        code: 'LOCAL_AUTH_PROTECTED_PREFIX_INVALID',
        message: 'Local auth protected path prefix is invalid.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
  }
  return unique;
}

function isProtectedSpaRoute(path: string): boolean {
  return path === '/' || path === '/session' || path.startsWith('/session/');
}

function setAuthCookie(reply: FastifyReply, value: string, ttlMs: number): void {
  reply.header('set-cookie', `${cookieName}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(ttlMs / 1000)}`);
}

function clearAuthCookie(reply: FastifyReply): void {
  reply.header('set-cookie', `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

async function sendChallenge(reply: FastifyReply, prefix: string): Promise<FastifyReply> {
  return await reply.status(401).send({
    error: 'Authentication required',
    authMode: 'LOCAL_CONFIG',
    loginUrl: `${prefix}/login`,
    iamStatus: null,
    localLoginEnabled: true,
  });
}

async function sendApiChallenge(reply: FastifyReply): Promise<FastifyReply> {
  return await reply.status(401).send({
    error: {
      code: 'LOCAL_AUTH_REQUIRED',
      message: 'Authentication required.',
    },
  });
}

async function sendAuthFailure(reply: FastifyReply, prefix: string): Promise<void> {
  await reply.status(401).send({
    error: 'Authentication failed',
    authMode: 'LOCAL_CONFIG',
    loginUrl: `${prefix}/login`,
    iamStatus: null,
    localLoginEnabled: true,
  });
}

function readCookie(request: FastifyRequest | IncomingMessage, name: string): string | undefined {
  const header = request.headers.cookie;
  if (header === undefined) {
    return undefined;
  }
  for (const part of header.split(';')) {
    const [key, ...valueParts] = part.trim().split('=');
    if (key === name) {
      return valueParts.join('=');
    }
  }
  return undefined;
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    timingSafeEqual(Buffer.from(right), Buffer.from(right));
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function clientKey(request: FastifyRequest): string {
  return request.ip ?? 'local';
}

function authRequired(): AgentError {
  return new AgentError({ code: 'LOCAL_AUTH_REQUIRED', message: 'Authentication required.', category: 'AUTHORIZATION', retryable: false });
}

export function localIdentityFromConfig(input: {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly displayName?: string;
}): IdentityContext {
  return {
    tenantId: brand<string, 'TenantId'>(input.tenantId),
    subjectId: brand<string, 'SubjectId'>(input.subjectId),
    displayName: input.displayName ?? 'Local developer',
  };
}
