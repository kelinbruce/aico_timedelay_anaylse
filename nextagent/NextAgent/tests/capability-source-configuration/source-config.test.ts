import {
  CapabilityProviderConfigurationError,
  resolveCapabilityProviders,
  type CapabilityProviderDiagnostic,
  type CapabilityProviderUserConfig,
  type CapabilityProvidersConfig,
  type ResolveCapabilityProvidersOptions,
} from '@nextagent/agent-app/testing';
import { brand, type SecretReference } from '@nextagent/agent-common';
import { isAbsolute, resolve as resolvePath } from 'node:path';
import { describe, expect, it } from 'vitest';

function secretRef(value: `${string}:${string}`): SecretReference {
  return brand<`env:${string}` | `file:${string}`, 'SecretReference'>(value as `env:${string}` | `file:${string}`);
}

function resolve(input: CapabilityProvidersConfig | undefined, options: ResolveCapabilityProvidersOptions = {}) {
  return resolveCapabilityProviders(input, options);
}

describe('capability provider resolver: baseline behavior', () => {
  it('treats an undefined input as an empty user config and never blocks startup', () => {
    const result = resolve(undefined);

    expect(result.providers).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it('treats an empty providers array the same as an undefined input', () => {
    const emptyArray = resolve([]);
    const undefinedInput = resolve(undefined);

    expect(emptyArray.providers).toEqual(undefinedInput.providers);
    expect(emptyArray.diagnostics).toEqual(undefinedInput.diagnostics);
  });

  it('exposes only two top-level fields (providers + diagnostics) and no parallel frozen artifacts', () => {
    const result = resolve(undefined);

    expect(Object.keys(result).sort()).toEqual(['diagnostics', 'providers']);
    expect((result as unknown as Record<string, unknown>).frozenAt).toBeUndefined();
    expect((result as unknown as Record<string, unknown>).readinessState).toBeUndefined();
    expect((result as unknown as Record<string, unknown>).disabled).toBeUndefined();
    expect((result as unknown as Record<string, unknown>).disabledCapabilityIdsByProviderId).toBeUndefined();
    expect((result as unknown as Record<string, unknown>).validatedProviderSet).toBeUndefined();
    expect((result as unknown as Record<string, unknown>).enabledProviderSet).toBeUndefined();
    expect((result as unknown as Record<string, unknown>).disabledProviderSet).toBeUndefined();
    expect((result as unknown as Record<string, unknown>).capabilitySourceSnapshot).toBeUndefined();
    expect((result as unknown as Record<string, unknown>).providerAvailabilityPreparationResult).toBeUndefined();
  });
});

describe('capability provider resolver: user → internal field mapping', () => {
  it('rejects local-directory entries because LOCAL_DIRECTORY is reserved for local Skill source', () => {
    const result = resolve([{ id: 'local-a', type: 'local-directory', path: './capabilities/a' }]);

    expect(result.providers).toEqual([]);
    expect(result.diagnostics[0]).toMatchObject({
      providerId: 'local-a',
      reasonCode: 'UNSUPPORTED_PROVIDER_TYPE',
    });
  });

  it('maps mcp-server entries with SEARCH discovery and endpoint + optional credentialRef', () => {
    const result = resolve([
      {
        id: 'mcp-a',
        type: 'mcp-server',
        url: 'http://localhost:3000',
        credential: secretRef('env:MCP_TOKEN'),
      },
    ]);

    expect(result.providers).toHaveLength(1);
    const mcp = result.providers[0]!;
    expect(mcp.provider).toEqual({ providerId: 'mcp-a', providerKind: 'MCP_SERVER' });
    expect(mcp.discoveryMode).toBe('SEARCH');
    expect(mcp.options).toEqual({
      endpoint: 'http://localhost:3000',
      credentialRef: 'env:MCP_TOKEN',
    });
  });

  it('maps agent-registry entries with EAGER discovery and registryRef + optional credentialRef', () => {
    const result = resolve([
      {
        id: 'registry-a',
        type: 'agent-registry',
        url: 'https://registry.example',
        credential: secretRef('env:REG_TOKEN'),
      },
    ]);

    expect(result.providers).toHaveLength(1);
    const registry = result.providers[0]!;
    expect(registry.provider).toEqual({ providerId: 'registry-a', providerKind: 'AGENT_REGISTRY' });
    expect(registry.discoveryMode).toBe('EAGER');
    expect(registry.options).toEqual({
      registryRef: 'https://registry.example',
      credentialRef: 'env:REG_TOKEN',
    });
  });

  it('maps skill-hub entries with SEARCH discovery and gatewayId + managedInstallRef', () => {
    const result = resolve(
      [
        {
          id: 'hub-a',
          type: 'skill-hub',
          gatewayId: 'skillhub-main',
          installDir: './skills',
        },
      ],
      { resolveLocalDirectoryPath: (path) => resolvePath(process.cwd(), path) },
    );

    expect(result.providers).toHaveLength(1);
    const hub = result.providers[0]!;
    expect(hub.provider).toEqual({ providerId: 'hub-a', providerKind: 'SKILL_HUB' });
    expect(hub.discoveryMode).toBe('SEARCH');
    expect((hub.options as { gatewayId?: string }).gatewayId).toBe('skillhub-main');
    const installRef = (hub.options as { managedInstallRef?: string }).managedInstallRef;
    expect(installRef).toBeDefined();
    expect(isAbsolute(installRef!)).toBe(true);
    expect(hub.options).not.toHaveProperty('endpoint');
    expect(hub.options).not.toHaveProperty('credentialRef');
  });

  it('preserves CUSTOM providerType and customOptions when the adapter is registered', () => {
    const result = resolve(
      [
        {
          id: 'custom-a',
          type: 'custom',
          adapter: 'vendor-a',
          config: { mode: 'test', flags: ['x', 'y'] },
        },
      ],
      { registeredCustomAdapterTypes: new Set(['vendor-a']) },
    );

    expect(result.providers).toHaveLength(1);
    const custom = result.providers[0]!;
    expect(custom.provider).toEqual({ providerId: 'custom-a', providerKind: 'CUSTOM', providerType: 'vendor-a' });
    expect(custom.discoveryMode).toBe('EAGER');
    expect(custom.options).toEqual({ customOptions: { mode: 'test', flags: ['x', 'y'] } });
  });

  it('allows skill-hub absolute installDir paths through untouched by the resolver', () => {
    const result = resolve([{ id: 'hub-a', type: 'skill-hub', gatewayId: 'skillhub-main', installDir: '/etc/nextagent/skills' }]);

    expect(result.providers).toHaveLength(1);
    const installRef = (result.providers[0]!.options as { managedInstallRef?: string }).managedInstallRef;
    expect(installRef).toBe('/etc/nextagent/skills');
  });
});

describe('capability provider resolver: validation failures', () => {
  it('rejects duplicate id with a DUPLICATE_PROVIDER_ID diagnostic (first occurrence wins)', () => {
    const result = resolve([
      { id: 'dup', type: 'mcp-server', url: 'http://localhost:3000' },
      { id: 'dup', type: 'mcp-server', url: 'http://localhost:3001' },
    ]);

    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]?.provider.providerId).toBe('dup');
    expect(result.diagnostics).toEqual([expect.objectContaining({ reasonCode: 'DUPLICATE_PROVIDER_ID', providerId: 'dup' })]);
  });

  it('rejects unsupported type values with UNSUPPORTED_PROVIDER_TYPE diagnostics', () => {
    const input: CapabilityProvidersConfig = [{ id: 'unknown-a', type: 'unknown' }];

    const result = resolve(input);

    expect(result.providers).toEqual([]);
    expect(result.diagnostics[0]).toMatchObject({
      providerId: 'unknown-a',
      reasonCode: 'UNSUPPORTED_PROVIDER_TYPE',
    });
  });

  it('rejects builtin-style type values (bundled / builtin) with UNSUPPORTED_PROVIDER_TYPE', () => {
    for (const builtinAlias of ['bundled', 'builtin', 'BUNDLED']) {
      const input: CapabilityProvidersConfig = [{ id: `banned-${builtinAlias}`, type: builtinAlias }];

      const result = resolve(input);

      expect(result.providers).toEqual([]);
      expect(result.diagnostics[0]).toMatchObject({
        providerId: `banned-${builtinAlias}`,
        reasonCode: 'UNSUPPORTED_PROVIDER_TYPE',
      });
    }
  });

  it('excludes local-directory entries as unsupported while keeping the rest viable', () => {
    const result = resolve([
      { id: 'mcp-good', type: 'mcp-server', url: 'http://localhost:3000' },
      { id: 'local-bad', type: 'local-directory', path: './a' } as unknown as CapabilityProviderUserConfig,
    ]);

    expect(result.providers.map((config) => config.provider.providerId)).toEqual(['mcp-good']);
    expect(result.diagnostics.find((diag) => diag.providerId === 'local-bad')).toMatchObject({
      reasonCode: 'UNSUPPORTED_PROVIDER_TYPE',
    });
  });

  it('excludes mcp-server entries with non-http URL', () => {
    const result = resolve([{ id: 'mcp-bad', type: 'mcp-server', url: 'not-a-url' }]);

    expect(result.providers).toEqual([]);
    expect(result.diagnostics[0]).toMatchObject({
      providerId: 'mcp-bad',
      reasonCode: 'INVALID_URL',
    });
  });

  it('excludes mcp-server entries with a non-SecretReference credential', () => {
    const result = resolve([
      {
        id: 'mcp-bad',
        type: 'mcp-server',
        url: 'http://localhost:3000',
        credential: 'raw-secret' as SecretReference,
      },
    ]);

    expect(result.providers).toEqual([]);
    expect(result.diagnostics[0]).toMatchObject({
      providerId: 'mcp-bad',
      reasonCode: 'INVALID_CREDENTIAL_REFERENCE',
    });
  });

  it('excludes skill-hub entries that omit installDir', () => {
    const result = resolve([{ id: 'hub-bad', type: 'skill-hub', gatewayId: 'skillhub-main' }]);

    expect(result.providers).toEqual([]);
    expect(result.diagnostics[0]).toMatchObject({
      providerId: 'hub-bad',
      reasonCode: 'MISSING_REQUIRED_FIELD',
    });
  });

  it('excludes skill-hub entries that omit gatewayId', () => {
    const result = resolve([{ id: 'hub-bad', type: 'skill-hub', installDir: './skills' }]);

    expect(result.providers).toEqual([]);
    expect(result.diagnostics[0]).toMatchObject({
      providerId: 'hub-bad',
      reasonCode: 'MISSING_REQUIRED_FIELD',
    });
  });

  it('excludes skill-hub entries that carry direct service access fields without echoing values', () => {
    const result = resolve([
      {
        id: 'hub-bad',
        type: 'skill-hub',
        gatewayId: 'skillhub-main',
        installDir: './skills',
        url: 'https://private-skillhub.example/token-path',
        endpoint: 'https://private-skillhub.example/endpoint',
        token: 'very-secret-token',
      } as unknown as CapabilityProviderUserConfig,
    ]);

    expect(result.providers).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        providerId: 'hub-bad',
        reasonCode: 'FORBIDDEN_PROVIDER_FIELD',
      }),
    ]);
    const serialized = JSON.stringify(result.diagnostics);
    expect(serialized).not.toContain('private-skillhub');
    expect(serialized).not.toContain('very-secret-token');
  });

  it('leaves framework provider id collisions to capability assembly', () => {
    const result = resolve([{ id: 'builtin-agents', type: 'skill-hub', gatewayId: 'skillhub-main', installDir: './skills' }]);

    expect(result.diagnostics).toEqual([]);
    expect(result.providers[0]?.provider.providerId).toBe('builtin-agents');
  });

  it('rejects local-directory before interpreting path or credential fields', () => {
    const result = resolve([
      {
        id: 'local-bad',
        type: 'local-directory',
        path: './a',
        credential: secretRef('env:TOKEN'),
      },
    ]);

    expect(result.providers).toEqual([]);
    expect(result.diagnostics[0]).toMatchObject({
      providerId: 'local-bad',
      reasonCode: 'UNSUPPORTED_PROVIDER_TYPE',
    });
  });

  it('rejects custom entries missing adapter', () => {
    const result = resolve([{ id: 'custom-bad', type: 'custom' } as unknown as CapabilityProviderUserConfig]);

    expect(result.providers).toEqual([]);
    expect(result.diagnostics[0]).toMatchObject({
      providerId: 'custom-bad',
      reasonCode: 'MISSING_REQUIRED_FIELD',
    });
  });

  it('rejects custom entries whose adapter is not in the registered set', () => {
    const result = resolve([{ id: 'custom-bad', type: 'custom', adapter: 'vendor-a', config: { mode: 'test' } }], {
      registeredCustomAdapterTypes: new Set(),
    });

    expect(result.providers).toEqual([]);
    expect(result.diagnostics[0]).toMatchObject({
      providerId: 'custom-bad',
      reasonCode: 'CUSTOM_ADAPTER_UNREGISTERED',
    });
  });

  it('reports an empty-or-whitespace id as MISSING_REQUIRED_FIELD without throwing', () => {
    const result = resolve([{ id: '   ', type: 'mcp-server', url: 'http://localhost:3000' } as unknown as CapabilityProviderUserConfig]);

    expect(result.providers).toEqual([]);
    expect(result.diagnostics[0]).toMatchObject({
      reasonCode: 'MISSING_REQUIRED_FIELD',
    });
  });

  it('collects multiple validation errors in input order rather than failing fast on the first', () => {
    const result = resolve([
      { id: 'custom-bad', type: 'custom' } as unknown as CapabilityProviderUserConfig,
      { id: 'mcp-bad', type: 'mcp-server', url: 'not-a-url' },
      { id: 'hub-bad', type: 'skill-hub', gatewayId: 'skillhub-main' },
    ]);

    expect(result.providers).toEqual([]);
    expect(result.diagnostics.map((diag) => diag.providerId)).toEqual(['custom-bad', 'mcp-bad', 'hub-bad']);
  });

  it('never throws even when every entry is invalid', () => {
    expect(() =>
      resolve([
        { id: 'bad-1', type: 'mcp-server', url: '' },
        { id: 'bad-2', type: 'skill-hub', gatewayId: 'skillhub-main' },
        { id: 'bad-3', type: 'local-directory' } as unknown as CapabilityProviderUserConfig,
      ]),
    ).not.toThrow();
  });
});

describe('capability provider resolver: app-provided predicates', () => {
  it('excludes entries whose URL fails the isUrlResolvable predicate', () => {
    const result = resolve([{ id: 'mcp-a', type: 'mcp-server', url: 'https://mcp.example' }], { isUrlResolvable: () => false });

    expect(result.providers).toEqual([]);
    expect(result.diagnostics[0]).toMatchObject({
      providerId: 'mcp-a',
      reasonCode: 'INVALID_URL',
    });
  });

  it('excludes entries whose credential fails the isCredentialReferenceResolvable predicate', () => {
    const result = resolve(
      [
        {
          id: 'mcp-a',
          type: 'mcp-server',
          url: 'https://mcp.example',
          credential: secretRef('env:MISSING'),
        },
      ],
      { isCredentialReferenceResolvable: () => false },
    );

    expect(result.providers).toEqual([]);
    expect(result.diagnostics[0]).toMatchObject({
      providerId: 'mcp-a',
      reasonCode: 'INVALID_CREDENTIAL_REFERENCE',
    });
  });

  it('does not consult path predicates for unsupported local-directory entries', () => {
    const result = resolve([{ id: 'local-a', type: 'local-directory', path: './missing-dir' }], {
      resolveLocalDirectoryPath: () => {
        throw new Error('should not be called');
      },
    });

    expect(result.providers).toEqual([]);
    expect(result.diagnostics[0]).toMatchObject({
      providerId: 'local-a',
      reasonCode: 'UNSUPPORTED_PROVIDER_TYPE',
    });
  });

  it('excludes entries whose type-level adapter is not registered in the composition', () => {
    const result = resolve([{ id: 'mcp-a', type: 'mcp-server', url: 'http://localhost:3000' }], { isProviderAdapterRegistered: () => false });

    expect(result.providers).toEqual([]);
    expect(result.diagnostics[0]).toMatchObject({
      providerId: 'mcp-a',
      reasonCode: 'PROVIDER_ADAPTER_UNREGISTERED',
    });
  });

  it('accepts skill-hub providers by default because product composition supplies the adapter', () => {
    const result = resolve([{ id: 'hub-a', type: 'skill-hub', gatewayId: 'skillhub-main', installDir: './skills' }]);

    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]?.provider).toEqual({ providerId: 'hub-a', providerKind: 'SKILL_HUB' });
    expect(result.diagnostics).toEqual([]);
  });

  it('fails closed when composition explicitly reports the SkillHub adapter unavailable', () => {
    const result = resolve([{ id: 'hub-a', type: 'skill-hub', gatewayId: 'skillhub-main', installDir: './skills' }], {
      isProviderAdapterRegistered: (kind) => kind !== 'SKILL_HUB',
    });

    expect(result.providers).toEqual([]);
    expect(result.diagnostics[0]).toMatchObject({
      providerId: 'hub-a',
      reasonCode: 'PROVIDER_ADAPTER_UNREGISTERED',
    });
  });

  it('maps resolver-native exceptions to safe diagnostics without leaking details', () => {
    const result = resolve([{ id: 'mcp-a', type: 'mcp-server', url: 'http://mcp.example' }], {
      isUrlResolvable: () => {
        throw new Error('C:/private/adapter.ts token=very-secret');
      },
    });

    expect(result.providers).toEqual([]);
    expect(result.diagnostics[0]).toMatchObject({
      providerId: 'mcp-a',
      reasonCode: 'INVALID_URL',
    });
    const serialized = JSON.stringify(result.diagnostics);
    expect(serialized).not.toContain('very-secret');
    expect(serialized).not.toContain('adapter.ts');
  });

  it('accepts a custom adapter registered via the composition predicate (not just the registeredCustomAdapterTypes set)', () => {
    const result = resolve([{ id: 'custom-a', type: 'custom', adapter: 'vendor-a', config: {} }], {
      isProviderAdapterRegistered: (kind, type) => kind === 'CUSTOM' && type === 'vendor-a',
    });

    expect(result.providers).toHaveLength(1);
    expect(result.diagnostics).toEqual([]);
  });
});

describe('capability provider resolver: diagnostic safety', () => {
  it('never includes the credential value in any diagnostic (it may appear in resolved providers, never in failure messages)', () => {
    const sensitiveRef = secretRef('env:VERY_SECRET_TOKEN_NAME');
    const result = resolve([
      {
        id: 'mcp-a',
        type: 'mcp-server',
        url: 'http://localhost:3000',
        credential: sensitiveRef,
      },
    ]);

    expect(result.providers).toHaveLength(1);
    expect(result.diagnostics).toEqual([]);
    const diagnosticsSerialized = JSON.stringify(result.diagnostics);
    expect(diagnosticsSerialized).not.toContain('env:VERY_SECRET_TOKEN_NAME');
  });

  it('does not surface raw local-directory paths in unsupported-type diagnostics', () => {
    const result = resolve([{ id: 'local-bad', type: 'local-directory', path: 'C:/private/skills' } as unknown as CapabilityProviderUserConfig]);

    const serialized = JSON.stringify(result.diagnostics);
    expect(result.diagnostics[0]?.reasonCode).toBe('UNSUPPORTED_PROVIDER_TYPE');
    expect(serialized).not.toContain('C:/private/skills');
  });

  it('uses a safe static message for CUSTOM adapter rejection without echoing user input', () => {
    const result = resolve([{ id: 'custom-a', type: 'custom', adapter: 'vendor-with-internal-stack-trace', config: {} }], {
      registeredCustomAdapterTypes: new Set(),
    });

    const serialized = JSON.stringify(result.diagnostics);
    expect(serialized).not.toMatch(/stack|trace|at .*:\d+/u);
    expect(result.diagnostics[0]?.reasonCode).toBe('CUSTOM_ADAPTER_UNREGISTERED');
  });

  it('does not echo the user-provided adapter or config in the diagnostic', () => {
    const result = resolve([{ id: 'custom-a', type: 'custom', adapter: 'vendor-secret', config: { leaked: 'very-secret-payload' } }], {
      registeredCustomAdapterTypes: new Set(),
    });

    const serialized = JSON.stringify(result.diagnostics);
    expect(serialized).not.toContain('vendor-secret');
    expect(serialized).not.toContain('very-secret-payload');
  });

  it('marks every diagnostic with severity ERROR', () => {
    const result = resolve([
      { id: 'bad-1', type: 'mcp-server', url: '' },
      { id: 'bad-2', type: 'skill-hub', gatewayId: 'skillhub-main' },
    ]);

    expect(result.diagnostics.length).toBeGreaterThan(0);
    for (const diag of result.diagnostics) {
      expect(diag.severity).toBe('ERROR');
    }
  });
});

describe('capability provider resolver: input integrity', () => {
  it('does not mutate the input config or any provider entry', () => {
    const input: CapabilityProvidersConfig = [{ id: 'mcp-a', type: 'mcp-server', url: 'http://localhost:3000' }];
    const originalJson = JSON.stringify(input);

    resolve(input);

    expect(JSON.stringify(input)).toBe(originalJson);
  });

  it('freezes providers and diagnostics so request-time code cannot mutate startup-resolved config', () => {
    const result = resolve([
      { id: 'mcp-a', type: 'mcp-server', url: 'http://localhost:3000' },
      { id: 'mcp-bad', type: 'mcp-server', url: 'not-a-url' },
    ]);

    expect(Object.isFrozen(result.providers)).toBe(true);
    expect(Object.isFrozen(result.diagnostics)).toBe(true);
    expect(() => {
      (result.providers as unknown as Array<{ providerId: string }>).push({ providerId: 'leaked' } as never);
    }).toThrow(TypeError);
    expect(() => {
      (result.diagnostics as unknown as CapabilityProviderDiagnostic[]).push({} as CapabilityProviderDiagnostic);
    }).toThrow(TypeError);
  });
});

describe('capability provider configuration error', () => {
  it('is exported with providerId and reasonCode fields', () => {
    const error = new CapabilityProviderConfigurationError('test message', { providerId: 'p1', reasonCode: 'INVALID_PATH' });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('CapabilityProviderConfigurationError');
    expect(error.message).toBe('test message');
    expect(error.providerId).toBe('p1');
    expect(error.reasonCode).toBe('INVALID_PATH');
  });
});
