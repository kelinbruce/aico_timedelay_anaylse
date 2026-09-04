import Fastify from 'fastify';
import { brand } from '@nextagent/agent-common';
import { describe, expect, it } from 'vitest';
import { createLocalConfiguredWebAuth } from '../src/index.js';

describe('local auth protected path contributions', () => {
  it('protects a trusted extension prefix with the same identity cookie', async () => {
    const auth = createLocalConfiguredWebAuth({
      loopbackOnly: true,
      identity: {
        tenantId: brand<string, 'TenantId'>('tenant-local'),
        subjectId: brand<string, 'SubjectId'>('subject-local'),
        displayName: 'Local Developer',
      },
      credentialRef: brand<`env:${string}`, 'SecretReference'>('env:LOCAL_PASSWORD'),
      cookieTtlMs: 60_000,
      credentialResolver: async () => 'local-secret',
      protectedPathPrefixes: ['/__nextagent/dev/workbench'],
      registerProtectedRoutes: async (server, context) => {
        server.get('/__nextagent/dev/workbench', async (request) => {
          const identity = context.resolveIdentity(request);
          return { tenantId: identity.tenantId, subjectId: identity.subjectId };
        });
      },
    });
    const server = Fastify({ logger: false });
    await server.register(auth.plugin);
    await auth.ready();

    const anonymous = await server.inject({ method: 'GET', url: '/__nextagent/dev/workbench' });
    expect(anonymous.statusCode).toBe(401);

    const login = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/local/login',
      payload: { credential: 'local-secret' },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json()).toEqual({
      identity: {
        tenantId: 'tenant-local',
        subjectId: 'subject-local',
        displayName: 'Local Developer',
      },
    });
    const cookie = login.headers['set-cookie'];
    expect(cookie).toBeTypeOf('string');

    const authenticated = await server.inject({
      method: 'GET',
      url: '/__nextagent/dev/workbench',
      headers: { cookie: String(cookie).split(';')[0] ?? '' },
    });
    expect(authenticated.statusCode).toBe(200);
    expect(authenticated.json()).toEqual({ tenantId: 'tenant-local', subjectId: 'subject-local' });

    const logout = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/local/logout',
      headers: { cookie: String(cookie).split(';')[0] ?? '' },
    });
    expect(logout.statusCode).toBe(200);
    expect(logout.json()).toEqual({ ok: true });
    await server.close();
  });

  it('returns documented challenge and failure responses', async () => {
    const auth = createLocalConfiguredWebAuth({
      loopbackOnly: true,
      identity: {
        tenantId: brand<string, 'TenantId'>('tenant-local'),
        subjectId: brand<string, 'SubjectId'>('subject-local'),
        displayName: 'Local Developer',
      },
      credentialRef: brand<`env:${string}`, 'SecretReference'>('env:LOCAL_PASSWORD'),
      cookieTtlMs: 60_000,
      credentialResolver: async () => 'local-secret',
      protectedPathPrefixes: ['/__nextagent/dev/workbench'],
      registerProtectedRoutes: async (server) => {
        server.get('/__nextagent/dev/workbench', async () => ({ ok: true }));
      },
    });
    const server = Fastify({ logger: false });
    await server.register(auth.plugin);
    await auth.ready();

    const anonymous = await server.inject({ method: 'GET', url: '/__nextagent/dev/workbench' });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toEqual({
      error: {
        code: 'LOCAL_AUTH_REQUIRED',
        message: 'Authentication required.',
      },
    });

    const failedLogin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/local/login',
      payload: { credential: 'bad-secret' },
    });
    expect(failedLogin.statusCode).toBe(401);
    expect(failedLogin.json()).toEqual({
      error: 'Authentication failed',
      authMode: 'LOCAL_CONFIG',
      loginUrl: '/login',
      iamStatus: null,
      localLoginEnabled: true,
    });
    await server.close();
  });

  it('rejects unsafe protected prefixes', () => {
    expect(() =>
      createLocalConfiguredWebAuth({
        loopbackOnly: true,
        identity: {
          tenantId: brand<string, 'TenantId'>('tenant-local'),
          subjectId: brand<string, 'SubjectId'>('subject-local'),
          displayName: 'Local Developer',
        },
        credentialRef: brand<`env:${string}`, 'SecretReference'>('env:LOCAL_PASSWORD'),
        cookieTtlMs: 60_000,
        credentialResolver: async () => 'local-secret',
        protectedPathPrefixes: ['/../unsafe'],
      }),
    ).toThrow('Local auth protected path prefix is invalid');
  });

  it('mounts auth-local routes and challenge loginUrl under the public path prefix P', async () => {
    const auth = createLocalConfiguredWebAuth({
      loopbackOnly: true,
      routePrefix: '/svcA',
      identity: {
        tenantId: brand<string, 'TenantId'>('tenant-local'),
        subjectId: brand<string, 'SubjectId'>('subject-local'),
        displayName: 'Local Developer',
      },
      credentialRef: brand<`env:${string}`, 'SecretReference'>('env:LOCAL_PASSWORD'),
      cookieTtlMs: 60_000,
      credentialResolver: async () => 'local-secret',
      protectedPathPrefixes: ['/svcA/__nextagent/dev/workbench'],
      registerProtectedRoutes: async (server) => {
        server.get('/svcA/__nextagent/dev/workbench', async () => ({ ok: true }));
      },
    });
    const server = Fastify({ logger: false });
    await server.register(auth.plugin);
    await auth.ready();

    // Login mounts under ${P}/api/v1/auth/local/login; the old /api/v1 path misses.
    const login = await server.inject({
      method: 'POST',
      url: '/svcA/api/v1/auth/local/login',
      payload: { credential: 'local-secret' },
    });
    expect(login.statusCode).toBe(200);

    const oldLogin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/local/login',
      payload: { credential: 'local-secret' },
    });
    expect(oldLogin.statusCode).not.toBe(200);

    // Protected path under P requires cookie; preValidation issues the API
    // challenge (LOCAL_AUTH_REQUIRED) for registered protected routes.
    const anonymous = await server.inject({ method: 'GET', url: '/svcA/__nextagent/dev/workbench' });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toEqual({
      error: { code: 'LOCAL_AUTH_REQUIRED', message: 'Authentication required.' },
    });

    // An unregistered protected path under P hits the notFoundHandler, whose
    // challenge body carries ${P}/login so the SPA knows where to redirect.
    const orphan = await server.inject({ method: 'GET', url: '/svcA/api/v1/sessions' });
    expect(orphan.statusCode).toBe(401);
    expect(orphan.json()).toEqual({
      error: 'Authentication required',
      authMode: 'LOCAL_CONFIG',
      loginUrl: '/svcA/login',
      iamStatus: null,
      localLoginEnabled: true,
    });

    const cookie = login.headers['set-cookie'];
    const authenticated = await server.inject({
      method: 'GET',
      url: '/svcA/__nextagent/dev/workbench',
      headers: { cookie: String(cookie).split(';')[0] ?? '' },
    });
    expect(authenticated.statusCode).toBe(200);

    const logout = await server.inject({
      method: 'POST',
      url: '/svcA/api/v1/auth/local/logout',
      headers: { cookie: String(cookie).split(';')[0] ?? '' },
    });
    expect(logout.statusCode).toBe(200);
    await server.close();
  });
});
