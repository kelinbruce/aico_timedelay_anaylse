import { Type } from '@sinclair/typebox';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { capabilityDescriptorSchema, capabilityProviderConfigSchema } from '@nextagent/agent-contracts/capability';
import { Ajv } from 'ajv/dist/ajv.js';
import { describe, expect, it } from 'vitest';

describe('runtime schema smoke validation', () => {
  const capabilityDescriptor = {
    capabilityId: 'Read',
    kind: 'TOOL',
    provider: { providerId: 'builtin-tools', providerKind: 'BUNDLED' },
    displayName: 'Read',
    description: 'Read a bounded slice from one workspace-relative file.',
    modelInvocable: true,
    availabilityStatus: 'AVAILABLE',
    inputSchema: { type: 'object' },
    outputSchema: {
      type: 'object',
      required: ['content'],
      properties: { content: { type: 'string' } },
    },
    replayPolicy: 'IDEMPOTENT',
  } as const;

  it('rejects untrusted command payloads before application use', () => {
    const commandSchema = Type.Object({
      sessionId: Type.String({ minLength: 1 }),
      inputText: Type.String({ minLength: 1 }),
      locale: Type.String({ minLength: 2 }),
    });
    const validate = new Ajv().compile(commandSchema);

    expect(validate({ sessionId: 'session-1', inputText: '诊断基站告警', locale: 'zh-CN' })).toBe(true);
    expect(validate({ sessionId: '', inputText: '', locale: '' })).toBe(false);
  });

  it('validates capability provider config by provider kind', () => {
    const validate = new Ajv().compile(capabilityProviderConfigSchema);

    expect(
      validate({
        provider: { providerId: 'mcp-a', providerKind: 'MCP_SERVER' },
        discoveryMode: 'SEARCH',
        options: { endpoint: 'https://mcp.example' },
      }),
    ).toBe(true);
    expect(validate({ provider: { providerId: 'builtin-tools', providerKind: 'BUNDLED' }, discoveryMode: 'EAGER', options: {} })).toBe(false);
    expect(validate({ provider: { providerId: 'custom-a', providerKind: 'CUSTOM' }, discoveryMode: 'SEARCH', options: { customOptions: {} } })).toBe(
      false,
    );
    expect(
      validate({ provider: { providerId: 'custom-a', providerKind: 'CUSTOM', providerType: 'vendor-a' }, discoveryMode: 'SEARCH', options: {} }),
    ).toBe(false);
  });

  it('validates capability descriptor outputSchema as structured payload schema', () => {
    const validate = new Ajv().compile(capabilityDescriptorSchema);

    expect(validate(capabilityDescriptor)).toBe(true);
    expect(validate({ capabilityId: 'Read', kind: 'TOOL', outputSchema: { type: 'object' } })).toBe(false);
  });

  it('accepts optional localized capability display names for open BCP 47-compatible locale tags', () => {
    const validate = new Ajv().compile(capabilityDescriptorSchema);
    const longestLocaleTag = 'abcdefgh-12345678-abcdefgh-12345678';

    expect(validate(capabilityDescriptor)).toBe(true);
    expect(
      validate({
        ...capabilityDescriptor,
        locales: {
          language: {
            'zh-CN': { displayName: '读取文件' },
            'en-US': { displayName: 'Read file' },
            'fr-FR': { displayName: 'Lire un fichier' },
            en: { displayName: 'Read' },
            [longestLocaleTag]: { displayName: '边界语种名称' },
          },
        },
      }),
    ).toBe(true);
  });

  it.each([
    ['null locales', null],
    ['array locales', []],
    ['empty language map', { language: {} }],
    ['36-character locale tag', { language: { 'abcdefgh-12345678-abcdefgh-123456789': { displayName: 'Invalid' } } }],
    ['unknown localized content field', { language: { 'en-US': { displayName: 'Read file', description: 'not allowed' } } }],
    ['blank localized display name', { language: { 'en-US': { displayName: '   ' } } }],
    ['control character in localized display name', { language: { 'en-US': { displayName: 'Read\nfile' } } }],
    ['257-code-point localized display name', { language: { 'en-US': { displayName: '界'.repeat(257) } } }],
  ])('rejects %s', (_label, locales) => {
    const validate = new Ajv().compile(capabilityDescriptorSchema);

    expect(validate({ ...capabilityDescriptor, locales })).toBe(false);
  });

  it('accepts a 256-code-point localized display name and rejects unknown locales fields', () => {
    const validate = new Ajv().compile(capabilityDescriptorSchema);

    expect(
      validate({
        ...capabilityDescriptor,
        locales: { language: { 'zh-CN': { displayName: '界'.repeat(256) } } },
      }),
    ).toBe(true);
    expect(
      validate({
        ...capabilityDescriptor,
        locales: { language: { 'zh-CN': { displayName: '读取文件' } }, fallback: 'en-US' },
      }),
    ).toBe(false);
  });

  it('does not expose app configuration snapshots as agent-contracts contracts', async () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'packages', 'agent-contracts', 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>;
    };
    const forbiddenSubpath = '@nextagent/agent-contracts' + '/configuration';

    expect(Object.keys(packageJson.exports)).not.toContain('./configuration');
    await expect(import(forbiddenSubpath)).rejects.toThrow();
  });
});
