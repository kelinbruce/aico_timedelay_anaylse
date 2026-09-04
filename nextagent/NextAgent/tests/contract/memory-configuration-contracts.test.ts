import {
  createAppCredentialResolver,
  evaluateDefaultSystemConfigSource,
  evaluateDefaultSystemConfig,
  validateDefaultSystemConfig,
} from '@nextagent/agent-app/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('memory-configuration contract', () => {
  it('derives a frozen valid MemoryConfig by default', () => {
    const config = validateDefaultSystemConfig(rawSystemConfig(), process.cwd(), { credentialResolver: testCredentialResolver() });

    expect(config.memory).toMatchObject({
      enabled: true,
      status: 'VALID',
      search: { defaultLimit: 20, minConfidence: 0.3 },
      extraction: {
        enabled: true,
        strategy: 'RULE_FIRST',
        crossSessionSchedule: '0 0 0 * * ?',
        maxCycleTrajectories: 20,
        maxCandidates: 50,
        timeoutMs: 60_000,
        lookbackDays: 7,
      },
      aging: {
        enabled: true,
        schedule: '0 0 0 * * ?',
        decayStaleDays: 30,
        archiveRetentionDays: 90,
        decayFactor: 0.05,
        batchLimit: 1_000,
        timeoutMs: 30_000,
        reviveConfidenceBoost: 0.1,
      },
    });
    expect(config.memory.diagnostics[0]).toMatchObject({
      issueCode: 'MEMORY_CONFIG_VALID',
      fieldRef: 'nextAgent.memory.enabled',
      source: 'default',
    });
    expect(Object.isFrozen(config.memory)).toBe(true);
    expect(Object.isFrozen(config.memory.search)).toBe(true);
    expect(Object.isFrozen(config.memory.extraction)).toBe(true);
    expect(Object.isFrozen(config.memory.aging)).toBe(true);
    expect(Object.isFrozen(config.memory.diagnostics)).toBe(true);
  });

  it('accepts enabled memory extraction and aging config without requiring nextAgent.system', () => {
    const config = validateDefaultSystemConfig(
      {
        ...rawSystemConfig(),
        nextAgent: {
          memory: {
            enabled: true,
            search: { 'default-limit': 12, 'min-confidence': 0.7 },
            extraction: {
              enabled: true,
              strategy: 'LLM_ONLY',
              crossSessionSchedule: '0 0 2 * * ?',
              maxCycleTrajectories: 25,
              maxCandidates: 80,
              timeoutMs: 90_000,
              lookbackDays: 14,
            },
            aging: {
              enabled: true,
              schedule: '0 0 3 * * ?',
              decayStaleDays: 45,
              archiveRetentionDays: 120,
              decayFactor: 0.1,
              batchLimit: 500,
              timeoutMs: 45_000,
              reviveConfidenceBoost: 0.2,
            },
          },
        },
      },
      process.cwd(),
      { credentialResolver: testCredentialResolver() },
    );

    expect(config.memory).toMatchObject({
      enabled: true,
      status: 'VALID',
      search: { defaultLimit: 12, minConfidence: 0.7 },
      extraction: {
        enabled: true,
        strategy: 'LLM_ONLY',
        crossSessionSchedule: '0 0 2 * * ?',
        maxCycleTrajectories: 25,
        maxCandidates: 80,
        timeoutMs: 90_000,
        lookbackDays: 14,
      },
      aging: {
        enabled: true,
        schedule: '0 0 3 * * ?',
        decayStaleDays: 45,
        archiveRetentionDays: 120,
        decayFactor: 0.1,
        batchLimit: 500,
        timeoutMs: 45_000,
        reviveConfidenceBoost: 0.2,
      },
    });
    expect(config.memory.diagnostics[0]).toMatchObject({ issueCode: 'MEMORY_CONFIG_VALID', source: 'explicit' });
  });

  it('keeps explicit parent disabled as the highest-priority memory gate', () => {
    const config = validateDefaultSystemConfig(
      {
        ...rawSystemConfig(),
        nextAgent: {
          memory: {
            enabled: false,
            extraction: { enabled: true, crossSessionSchedule: '0 0 2 * * ?' },
            aging: { enabled: true, schedule: '0 0 3 * * ?' },
          },
        },
      },
      process.cwd(),
      { credentialResolver: testCredentialResolver() },
    );

    expect(config.memory).toMatchObject({
      enabled: false,
      status: 'DISABLED',
      extraction: {
        enabled: false,
        crossSessionSchedule: '0 0 2 * * ?',
      },
      aging: {
        enabled: false,
        schedule: '0 0 3 * * ?',
      },
    });
    expect(config.memory.diagnostics[0]).toMatchObject({
      issueCode: 'MEMORY_CONFIG_DISABLED_EXPLICIT',
      source: 'explicit',
    });
  });

  it('treats nextAgent.system and nextAgent.memory as optional sibling groups', () => {
    const systemOnly = validateDefaultSystemConfig(
      {
        ...rawSystemConfig(),
        nextAgent: { system: {} },
      },
      process.cwd(),
      { credentialResolver: testCredentialResolver() },
    );
    const both = validateDefaultSystemConfig(
      {
        ...rawSystemConfig(),
        nextAgent: {
          system: { 'capability-providers': [] },
          memory: { enabled: false },
        },
      },
      process.cwd(),
      { credentialResolver: testCredentialResolver() },
    );

    expect(systemOnly.memory).toMatchObject({
      enabled: true,
      status: 'VALID',
      extraction: { enabled: true, crossSessionSchedule: '0 0 0 * * ?' },
      aging: { enabled: true, schedule: '0 0 0 * * ?' },
    });
    expect(both.userCapabilityProviders).toEqual([]);
    expect(both.memory).toMatchObject({
      enabled: false,
      status: 'DISABLED',
      extraction: { enabled: false },
      aging: { enabled: false },
    });
    expect(both.memory.diagnostics[0]).toMatchObject({
      issueCode: 'MEMORY_CONFIG_DISABLED_EXPLICIT',
      source: 'explicit',
    });
  });

  it.each([
    {
      name: 'out of range default limit',
      input: { nextAgent: { memory: { enabled: true, search: { 'default-limit': 101 } } } },
      issueCode: 'MEMORY_CONFIG_INVALID',
      fieldRef: 'nextAgent.memory.search.default-limit',
    },
    {
      name: 'owner override',
      input: { nextAgent: { memory: { enabled: true, tenantId: 'tenant-from-config' } } },
      issueCode: 'MEMORY_CONFIG_OWNER_OVERRIDE_FORBIDDEN',
      fieldRef: 'nextAgent.memory.tenantId',
    },
    {
      name: 'undefined future field',
      input: { nextAgent: { memory: { enabled: true, future: { 'unreviewed-field': true } } } },
      issueCode: 'MEMORY_CONFIG_FIELD_UNDEFINED',
      fieldRef: 'nextAgent.memory.future.unreviewed-field',
    },
    {
      name: 'forbidden extraction sibling',
      input: { nextAgent: { extraction: { enabled: true } } },
      issueCode: 'MEMORY_CONFIG_FIELD_UNDEFINED',
      fieldRef: 'nextAgent.extraction.enabled',
    },
    {
      name: 'prompt template ids',
      input: { nextAgent: { memory: { enabled: true, promptTemplateIds: ['memory-extraction-default'] } } },
      issueCode: 'MEMORY_CONFIG_FIELD_UNDEFINED',
      fieldRef: 'nextAgent.memory.promptTemplateIds',
    },
    {
      name: 'invalid extraction strategy',
      input: { nextAgent: { memory: { enabled: true, extraction: { strategy: 'AUTO' } } } },
      issueCode: 'MEMORY_CONFIG_INVALID',
      fieldRef: 'nextAgent.memory.extraction.strategy',
    },
    {
      name: 'invalid extraction max candidates',
      input: { nextAgent: { memory: { enabled: true, extraction: { maxCandidates: 201 } } } },
      issueCode: 'MEMORY_CONFIG_INVALID',
      fieldRef: 'nextAgent.memory.extraction.maxCandidates',
    },
    {
      name: 'undefined extraction field',
      input: { nextAgent: { memory: { enabled: true, extraction: { promptTemplateIds: ['memory-extraction-default'] } } } },
      issueCode: 'MEMORY_CONFIG_FIELD_UNDEFINED',
      fieldRef: 'nextAgent.memory.extraction.promptTemplateIds',
    },
    {
      name: 'invalid aging decay stale days',
      input: { nextAgent: { memory: { enabled: true, aging: { decayStaleDays: 6 } } } },
      issueCode: 'MEMORY_CONFIG_INVALID',
      fieldRef: 'nextAgent.memory.aging.decayStaleDays',
    },
    {
      name: 'invalid aging schedule',
      input: { nextAgent: { memory: { enabled: true, aging: { schedule: '' } } } },
      issueCode: 'MEMORY_CONFIG_INVALID',
      fieldRef: 'nextAgent.memory.aging.schedule',
    },
    {
      name: 'aging schedule with a non-zero seconds field',
      input: { nextAgent: { memory: { enabled: true, aging: { schedule: '30 0 3 * * ?' } } } },
      issueCode: 'MEMORY_CONFIG_INVALID',
      fieldRef: 'nextAgent.memory.aging.schedule',
    },
    {
      name: 'aging schedule with an unsupported step',
      input: { nextAgent: { memory: { enabled: true, aging: { schedule: '*/5 * * * * ?' } } } },
      issueCode: 'MEMORY_CONFIG_INVALID',
      fieldRef: 'nextAgent.memory.aging.schedule',
    },
    {
      name: 'extraction schedule with a named range',
      input: { nextAgent: { memory: { enabled: true, extraction: { crossSessionSchedule: '0 0 2 * * MON-FRI' } } } },
      issueCode: 'MEMORY_CONFIG_INVALID',
      fieldRef: 'nextAgent.memory.extraction.crossSessionSchedule',
    },
    {
      name: 'extraction schedule with a non-decimal numeric expression',
      input: { nextAgent: { memory: { enabled: true, extraction: { crossSessionSchedule: '0 1e1 2 * * ?' } } } },
      issueCode: 'MEMORY_CONFIG_INVALID',
      fieldRef: 'nextAgent.memory.extraction.crossSessionSchedule',
    },
    {
      name: 'undefined aging field',
      input: { nextAgent: { memory: { enabled: true, aging: { durableCycleTable: true } } } },
      issueCode: 'MEMORY_CONFIG_FIELD_UNDEFINED',
      fieldRef: 'nextAgent.memory.aging.durableCycleTable',
    },
  ])('rejects $name', ({ input, issueCode, fieldRef }) => {
    const result = evaluateDefaultSystemConfig(
      {
        ...rawSystemConfig(),
        ...input,
      },
      process.cwd(),
      { credentialResolver: testCredentialResolver() },
    );

    expect(result.status).toBe('BLOCKED');
    expect(result.evidenceInput.diagnostics[0]).toMatchObject({
      issueCode,
      scope: 'memory',
      fieldRef,
      configurationStatus: 'INVALID',
      affectsReadiness: true,
    });
  });

  it('does not add ranking or prompt-template controls to MemoryConfig', () => {
    const config = validateDefaultSystemConfig(
      {
        ...rawSystemConfig(),
        nextAgent: { memory: { enabled: true } },
      },
      process.cwd(),
      { credentialResolver: testCredentialResolver() },
    );

    expect(config.memory).not.toHaveProperty('rankingWeights');
    expect(config.memory).not.toHaveProperty('promptTemplateIds');
    expect(config.memory.search).toEqual({ defaultLimit: 20, minConfidence: 0.3 });
  });

  it('loads the repository default-system memory sample without making it the only source of defaults', () => {
    const fromDefaultFile = evaluateDefaultSystemConfigSource({
      cwd: process.cwd(),
      credentialResolver: testCredentialResolver(),
    });
    const fromOmittedMemory = validateDefaultSystemConfig(rawSystemConfig(), process.cwd(), { credentialResolver: testCredentialResolver() });

    expect(fromDefaultFile.status).toBe('DEGRADED_READY');
    expect(fromDefaultFile.config?.sandbox.enabled).toBe(true);
    expect(fromDefaultFile.config?.sandbox.allowedExecutables).toEqual(['clipc', 'curl', 'python']);
    expect(fromDefaultFile.config?.sandbox.deniedExecutables).toEqual(defaultDeniedExecutables);
    expect(fromDefaultFile.config?.sandbox.allowedExecutables?.some((name) => defaultDeniedExecutables.includes(name))).toBe(false);
    expect(fromDefaultFile.config?.memory).toMatchObject({
      enabled: true,
      status: 'VALID',
      search: { defaultLimit: 20, minConfidence: 0.3 },
      extraction: {
        enabled: true,
        strategy: 'RULE_FIRST',
        crossSessionSchedule: '0 0 0 * * ?',
        maxCycleTrajectories: 20,
        maxCandidates: 50,
        timeoutMs: 60_000,
        lookbackDays: 7,
      },
      aging: {
        enabled: true,
        schedule: '0 0 0 * * ?',
        decayStaleDays: 30,
        archiveRetentionDays: 90,
        decayFactor: 0.05,
        batchLimit: 1_000,
        timeoutMs: 30_000,
        reviveConfidenceBoost: 0.1,
      },
    });
    expect(fromOmittedMemory.memory).toMatchObject({
      enabled: fromDefaultFile.config?.memory.enabled,
      status: fromDefaultFile.config?.memory.status,
      search: fromDefaultFile.config?.memory.search,
      extraction: fromDefaultFile.config?.memory.extraction,
      aging: fromDefaultFile.config?.memory.aging,
    });
    expect(fromOmittedMemory.memory.diagnostics[0]).toMatchObject({ issueCode: 'MEMORY_CONFIG_VALID', source: 'default' });
    expect(fromDefaultFile.config?.memory.diagnostics[0]).toMatchObject({ issueCode: 'MEMORY_CONFIG_VALID', source: 'explicit' });
  });

  it('reports unavailable source configuration as an invalid memory configuration diagnostic', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'nextagent-memory-source-'));
    const missingConfigFile = join(tempDir, 'missing-default-system.json');
    try {
      const result = evaluateDefaultSystemConfigSource({
        configFile: missingConfigFile,
        credentialResolver: testCredentialResolver(),
      });

      expect(result.status).toBe('BLOCKED');
      expect(result.evidenceInput.diagnostics[0]).toMatchObject({
        issueCode: 'MEMORY_CONFIG_SOURCE_UNAVAILABLE',
        scope: 'memory',
        fieldRef: 'nextAgent.memory',
        configurationStatus: 'INVALID',
        affectsReadiness: true,
      });
      expect(JSON.stringify(result.evidenceInput)).not.toContain(missingConfigFile);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

const defaultDeniedExecutables = [
  'bash',
  'sh',
  'zsh',
  'fish',
  'cmd',
  'cmd.exe',
  'powershell',
  'powershell.exe',
  'pwsh',
  'eval',
  'exec',
  'env',
  'xargs',
  'node',
  'npm',
  'npx',
  'deno',
  'bun',
  'pip',
  'pip3',
  'perl',
  'ruby',
  'php',
  'lua',
  'awk',
  'find',
  'sed',
  'wget',
  'ssh',
  'scp',
  'sftp',
  'nc',
  'netcat',
  'socat',
  'rm',
  'mv',
  'cp',
  'install',
  'tee',
  'dd',
  'truncate',
  'chmod',
  'chown',
  'chgrp',
  'ln',
  'tar',
  'unzip',
  'zip',
  '7z',
  'kill',
  'killall',
  'pkill',
  'taskkill',
  'sudo',
  'su',
  'runas',
  'mount',
  'umount',
  'systemctl',
  'service',
  'docker',
  'podman',
  'kubectl',
  'helm',
];

function testCredentialResolver() {
  return createAppCredentialResolver({
    OPENAI_API_KEY: 'test-only',
    OPENAI_MODEL_NAME: 'MiniMax-M2.7-highspeed',
    OPENAI_BASE_URL: 'https://api.minimaxi.com/v1',
  });
}

function rawSystemConfig() {
  return {
    deployment: { mode: 'LOCAL' },
    paths: { workspaceRoot: 'workspaces', logDirectory: 'logs' },
    auth: {
      mode: 'local',
      localIdentity: { tenantId: 'local-tenant', subjectId: 'local-subject', displayName: 'Local developer' },
    },
    channel: { transport: 'fastify', host: '127.0.0.1', port: 3000 },
    hostedAgent: { activeAgentId: 'default-agent' },
    modelProfiles: [
      {
        providerId: 'openai-compatible',
        baseUrl: 'https://api.minimaxi.com/v1',
        credentialRef: 'env:OPENAI_API_KEY',
        models: [
          {
            modelId: 'MiniMax-M2.7',
            timeoutMs: 45_000,
            temperature: 0.1,
            maxOutputTokens: 128,
            providerOptions: { parallelToolCalls: false },
            contextWindowTokens: 128_000,
            fallbackEligible: false,
          },
        ],
      },
    ],
    gateway: {
      gateways: [
        { gatewayId: 'local-sqlite', gatewayKind: 'sqlite', deploymentMode: 'LOCAL', sqliteFileRef: 'paths.sqliteFile' },
        { gatewayId: 'local-rag', gatewayKind: 'rag-knowledge', deploymentMode: 'LOCAL' },
      ],
    },
    noopBoundaries: { lifecycleHook: 'noop', checkpoint: 'noop', audit: 'noop' },
  };
}
