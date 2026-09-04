import { createCapabilitySubsystem, createWorkspaceFilePort, readCapabilityId, type ToolExecutionContext } from '@nextagent/agent-capability';
import { brand } from '@nextagent/agent-common';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityInvocationRequest } from '@nextagent/agent-contracts/capability';
import { createExecutionWorkspaceResolver } from '@nextagent/agent-runtime';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('read capability boundary', () => {
  it('discloses canonical file_path schema from Tool metadata without path aliases', async () => {
    const subsystem = createCapabilitySubsystem({ read: { workspaceDir: process.cwd() } });
    const descriptors = await subsystem.catalog.listAvailable({
      tenantId: tenantId(),
      subjectId: subjectId(),
      agentAssembly: assembly(),
      includeUnavailable: true,
    });
    const descriptor = descriptors.find((d) => d.capabilityId === readCapabilityId);
    expect(descriptor).toBeDefined();
    expect(descriptor?.description).toContain('relative paths resolve under `workspace/`');
    expect(descriptor?.description).toContain('use `workspace/...` for durable files');
    expect(descriptor?.description).toContain('`temp/...` for current-run files');
    expect(descriptor?.description).toContain('Read does not enumerate directories or search by name/content');

    expect(descriptor!.inputSchema).toMatchObject({
      required: ['file_path'],
      properties: {
        file_path: { type: 'string', description: expect.stringContaining('bare relative path aliases workspace/...') },
        offset: { type: 'integer', minimum: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 2000 },
      },
      additionalProperties: false,
    });
    expect(descriptor!.outputSchema).toMatchObject({
      required: ['file_path', 'offset', 'limit', 'content', 'truncated'],
      properties: {
        content: { type: 'string' },
        truncated: { type: 'boolean' },
      },
    });
    expect(JSON.stringify(descriptor!.inputSchema)).not.toContain('filePath');
    expect(JSON.stringify(descriptor!.inputSchema)).not.toContain('"path"');
  });

  it('reads an execution-view-relative bounded line slice with normalized success payload', async () => {
    const subsystem = createCapabilitySubsystem({ read: { workspaceDir: process.cwd(), maxLines: 3, maxOutputBytes: 1024 } });
    const result = await subsystem.invocationPort.invoke(request({ file_path: 'package.json', offset: 0, limit: 1 }), new AbortController().signal);

    expect(result.status).toBe('SUCCEEDED');
    expect(result.structuredPayload).toMatchObject({
      file_path: 'workspace/package.json',
      offset: 0,
      limit: 1,
      truncated: true,
    });
    expect(String(result.structuredPayload.content)).toContain('{');
    expect(result.structuredPayload.nextOffset).toBe(1);
    expect(JSON.stringify(result)).not.toContain(process.cwd());
  });

  it('returns PAGING_REQUIRED when the requested read slice exceeds the byte budget', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'nextagent-read-large-'));
    try {
      const filePath = join(workspaceDir, 'large.txt');
      await writeFile(filePath, Array.from({ length: 20 }, (_, index) => `${index}:` + 'x'.repeat(48)).join('\n'), 'utf8');
      const subsystem = createCapabilitySubsystem({ read: { workspaceDir, maxLines: 20, maxTextBytes: 120 } });

      const tooLarge = await subsystem.invocationPort.invoke(request({ file_path: 'large.txt' }), new AbortController().signal);
      expect(tooLarge).toMatchObject({
        status: 'FAILED',
        structuredPayload: {},
        safeError: { code: 'PAGING_REQUIRED', category: 'VALIDATION', retryable: false },
      });
      expect(tooLarge.safeError?.message).toContain('offset');
      expect(tooLarge.safeError?.message).toContain('limit');
      // Actionable paging guidance: a concrete suggestedLimit the model can
      // reuse verbatim instead of guessing. The executor path surfaces it via
      // safeError.safeDetails (structuredPayload stays empty on the result).
      const suggestedLimit = tooLarge.safeError?.safeDetails?.['suggestedLimit'];
      expect(typeof suggestedLimit).toBe('number');
      expect(Number(suggestedLimit)).toBeGreaterThanOrEqual(1);
      expect(Number(suggestedLimit)).toBeLessThanOrEqual(20);
      expect(tooLarge.safeError?.safeDetails).toMatchObject({ reasonCode: 'PAGING_REQUIRED' });

      const paged = await subsystem.invocationPort.invoke(
        request({ file_path: 'large.txt', offset: 0, limit: Number(suggestedLimit) }),
        new AbortController().signal,
      );
      expect(paged.status).toBe('SUCCEEDED');
      expect(paged.structuredPayload).toMatchObject({
        file_path: 'workspace/large.txt',
        offset: 0,
        limit: Number(suggestedLimit),
        truncated: true,
        nextOffset: Number(suggestedLimit),
      });
      expect(String(paged.structuredPayload.content)).toContain('0:');
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it('PAGING_REQUIRED suggestedLimit yields a succeeding page on the next Read (no blind guessing)', async () => {
    // Large-line log/tool-output scenario: each line is ~1 KB, far larger than
    // the 512-byte budget, so a default Read must page. The suggestedLimit must
    // be small enough that re-reading with it succeeds on the first retry.
    const workspaceDir = await mkdtemp(join(tmpdir(), 'nextagent-read-biglines-'));
    try {
      const filePath = join(workspaceDir, 'biglines.log');
      await writeFile(filePath, Array.from({ length: 40 }, (_, index) => `line-${index}:` + 'x'.repeat(1000)).join('\n'), 'utf8');
      const subsystem = createCapabilitySubsystem({ read: { workspaceDir, maxLines: 2000, maxTextBytes: 512 } });

      const tooLarge = await subsystem.invocationPort.invoke(request({ file_path: 'biglines.log' }), new AbortController().signal);
      expect(tooLarge).toMatchObject({ status: 'FAILED', safeError: { code: 'PAGING_REQUIRED' } });
      const suggestedLimit = Number(tooLarge.safeError?.safeDetails?.['suggestedLimit']);
      expect(suggestedLimit).toBeGreaterThanOrEqual(1);
      expect(suggestedLimit).toBeLessThanOrEqual(2000);

      const paged = await subsystem.invocationPort.invoke(
        request({ file_path: 'biglines.log', offset: 0, limit: suggestedLimit }),
        new AbortController().signal,
      );
      expect(paged.status).toBe('SUCCEEDED');
      expect(Buffer.byteLength(String(paged.structuredPayload.content), 'utf8')).toBeLessThanOrEqual(512);
      expect(String(paged.structuredPayload.content)).toContain('line-0:');
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it('falls back to a bounded head when a single line exceeds the byte budget (no PAGING_REQUIRED dead-lock)', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'nextagent-read-bigline-'));
    try {
      const filePath = join(workspaceDir, 'bigline.txt');
      // One line, no newline, larger than the byte budget; line-based paging
      // cannot subdivide it, so limit=1 must NOT throw PAGING_REQUIRED forever.
      await writeFile(filePath, 'x'.repeat(200), 'utf8');
      const subsystem = createCapabilitySubsystem({ read: { workspaceDir, maxLines: 20, maxTextBytes: 120 } });

      const result = await subsystem.invocationPort.invoke(request({ file_path: 'bigline.txt', offset: 0, limit: 1 }), new AbortController().signal);
      expect(result.status).toBe('SUCCEEDED');
      expect(result.structuredPayload).toMatchObject({
        file_path: 'workspace/bigline.txt',
        offset: 0,
        limit: 1,
        truncated: true,
      });
      expect(result.structuredPayload.error).toBeUndefined();
      // Bounded to the byte budget rather than the full 200-char line.
      expect(Buffer.byteLength(String(result.structuredPayload.content), 'utf8')).toBeLessThanOrEqual(120);
      expect(String(result.structuredPayload.content).length).toBeGreaterThan(0);
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it('rejects unsafe or non-canonical read inputs without leaking host paths', async () => {
    const subsystem = createCapabilitySubsystem({ read: { workspaceDir: process.cwd() } });
    const cases = [
      { file_path: 'package.json', path: 'package.json' },
      { path: 'package.json' },
      { filePath: 'package.json' },
      { file_path: '../package.json' },
      { file_path: process.cwd() },
      { file_path: '.' },
      { file_path: '*.json' },
      { file_path: 'package.json', offset: -1 },
      { file_path: 'package.json', limit: 0 },
      { file_path: 'package.json', limit: 2001 },
    ];

    for (const args of cases) {
      const result = await subsystem.invocationPort.invoke(request(args), new AbortController().signal);
      expect(result.status, JSON.stringify(args)).toBe('FAILED');
      expect(JSON.stringify(result), JSON.stringify(args)).not.toContain(process.cwd());
    }
    const invalidOffset = await subsystem.invocationPort.invoke(request({ file_path: 'safe.txt', offset: -1 }), new AbortController().signal);
    expect(invalidOffset.safeError?.message).toContain('Input validation failed for 1 constraint.');
    expect(invalidOffset.safeError?.safeDetails).toMatchObject({
      violations: [{ path: '/offset', constraint: 'minimum', expected: 'a number no less than 0' }],
    });
  });

  it('returns safe not-found failure for missing files and safe canceled failure for abort', async () => {
    const subsystem = createCapabilitySubsystem({ read: { workspaceDir: process.cwd() } });
    const missing = await subsystem.invocationPort.invoke(request({ file_path: 'missing-file-for-read.txt' }), new AbortController().signal);
    expect(missing).toMatchObject({
      status: 'FAILED',
      structuredPayload: {},
      safeError: { code: 'FILE_UNAVAILABLE', category: 'NOT_FOUND' },
    });

    const controller = new AbortController();
    controller.abort();
    const aborted = await subsystem.invocationPort.invoke(request({ file_path: 'package.json' }), controller.signal);
    expect(aborted).toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_ABORTED', category: 'CANCELED' },
    });
  });

  it('returns an empty non-error page when offset is beyond the end of the file', async () => {
    const subsystem = createCapabilitySubsystem({ read: { workspaceDir: process.cwd(), maxLines: 2000, maxOutputBytes: 1024 } });
    const result = await subsystem.invocationPort.invoke(
      request({ file_path: 'package.json', offset: 999_999, limit: 10 }),
      new AbortController().signal,
    );

    expect(result.status).toBe('SUCCEEDED');
    expect(result.structuredPayload).toMatchObject({
      file_path: 'workspace/package.json',
      offset: 999_999,
      limit: 10,
      content: '',
      truncated: false,
    });
    expect(result.structuredPayload.nextOffset).toBeUndefined();
  });

  it('reads tool-results as normal workspace files but does not cross owner scope', async () => {
    const runtimeWorkspaceRoot = await mkdtemp(join(tmpdir(), 'nextagent-read-scope-'));
    try {
      const read = {
        runtimeWorkspaceRoot,
        executionWorkspaceResolver: createExecutionWorkspaceResolver(),
        deploymentMode: 'LOCAL' as const,
        workspacePolicyProvider: {
          async require() {
            return assembly().workspacePolicy;
          },
        },
        maxTextBytes: 1024,
        readDirectories: ['shared-data'],
      };
      const workspaceFiles = createWorkspaceFilePort(read);
      const subsystem = createCapabilitySubsystem({
        read,
        toolDependencies: { workspaceFiles },
      });
      const secret = 'owner-a-private-tool-result';
      const ownerAContext = toolContext(request({ file_path: 'tool-results/result.txt' }));
      const ownerAView = await workspaceFiles.resolveView(ownerAContext);
      const ownerAWorkspace = ownerAView.roots.find((root) => root.kind === 'workspace')!;
      await mkdir(join(ownerAWorkspace.physicalPath, 'tool-results'), { recursive: true });
      await writeFile(join(ownerAWorkspace.physicalPath, 'tool-results', 'result.txt'), secret, 'utf8');

      const ownerARead = await subsystem.invocationPort.invoke(
        request({ file_path: 'workspace/tool-results/result.txt' }),
        new AbortController().signal,
      );
      expect(ownerARead.status).toBe('SUCCEEDED');
      expect(ownerARead.structuredPayload.content).toBe(secret);

      const ownerBRead = await subsystem.invocationPort.invoke(
        request(
          { file_path: 'workspace/tool-results/result.txt' },
          {
            identityContext: {
              tenantId: tenantId(),
              subjectId: brand<string, 'SubjectId'>('subject-read-other'),
              displayName: 'Read tester B',
            },
          },
        ),
        new AbortController().signal,
      );
      expect(ownerBRead).toMatchObject({
        status: 'FAILED',
        structuredPayload: {},
        safeError: { code: 'FILE_UNAVAILABLE', category: 'NOT_FOUND' },
      });
      expect(JSON.stringify(ownerBRead)).not.toContain(secret);
      expect(JSON.stringify(ownerBRead)).not.toContain('subject-read-other');
    } finally {
      await rm(runtimeWorkspaceRoot, { recursive: true, force: true });
    }
  });

  it('reads local shared-data through the resolver view but keeps it read-only', async () => {
    const runtimeWorkspaceRoot = await mkdtemp(join(tmpdir(), 'nextagent-read-shared-runtime-'));
    const sharedDataRoot = await mkdtemp(join(tmpdir(), 'nextagent-read-shared-data-'));
    try {
      await mkdir(join(sharedDataRoot, 'cases'), { recursive: true });
      await writeFile(join(sharedDataRoot, 'cases', 'alarm.json'), '{"alarm":true}', 'utf8');
      await writeFile(join(sharedDataRoot, 'cases', 'credential.pem'), 'alarm secret', 'utf8');
      const read = {
        runtimeWorkspaceRoot,
        sharedDataRoot,
        executionWorkspaceResolver: createExecutionWorkspaceResolver(),
        deploymentMode: 'LOCAL' as const,
        workspacePolicyProvider: {
          async require() {
            return sharedDataAssembly().workspacePolicy;
          },
        },
        workspaceFileExtensionPolicyProvider: {
          async require() {
            return { readAllowedExtensions: ['.json'] };
          },
        },
        maxTextBytes: 1024,
      };
      const workspaceFiles = createWorkspaceFilePort(read);
      const context = toolContext(request({ file_path: 'shared-data/cases/alarm.json' }));

      const result = await workspaceFiles.readText({ file_path: 'shared-data/cases/alarm.json' }, context);
      const glob = await workspaceFiles.globFiles({ pattern: '*.json', path: 'shared-data/cases' }, context);
      const grep = await workspaceFiles.grepFiles({ pattern: 'alarm', path: 'shared-data/cases' }, context);
      const filesystem = await workspaceFiles.sandboxFilesystem(context);
      expect(result).toMatchObject({
        file_path: 'shared-data/cases/alarm.json',
        content: '{"alarm":true}',
        truncated: false,
      });
      expect(glob).toMatchObject({ filenames: ['shared-data/cases/alarm.json'] });
      expect(grep).toMatchObject({ total_files_with_matches: 1 });
      expect(JSON.stringify(glob)).not.toContain('credential.pem');
      expect(JSON.stringify(grep)).not.toContain('credential.pem');
      await expect(workspaceFiles.readText({ file_path: 'shared-data/cases/credential.pem' }, context)).rejects.toMatchObject({
        code: 'CAPABILITY_PATH_REJECTED',
        category: 'AUTHORIZATION',
      });
      expect(filesystem.roots).toContainEqual({
        kind: 'sharedData',
        logicalPath: 'shared-data',
        physicalPath: sharedDataRoot,
        access: 'read',
      });
      expect(JSON.stringify(result)).not.toContain(sharedDataRoot);

      await expect(workspaceFiles.writeText({ file_path: 'shared-data/cases/alarm.json', content: '{}' }, context)).rejects.toMatchObject({
        code: 'CAPABILITY_PATH_REJECTED',
      });
      await expect(
        workspaceFiles.editText({ file_path: 'shared-data/cases/alarm.json', old_string: 'true', new_string: 'false' }, context),
      ).rejects.toMatchObject({ code: 'CAPABILITY_PATH_REJECTED' });
      await expect(workspaceFiles.grepFiles({ pattern: '(a+)+', path: 'shared-data/cases' }, context)).rejects.toMatchObject({
        code: 'CAPABILITY_INPUT_INVALID',
      });
    } finally {
      await rm(runtimeWorkspaceRoot, { recursive: true, force: true });
      await rm(sharedDataRoot, { recursive: true, force: true });
    }
  });

  it('forces paging for oversized tool-results readback even under the default workspace text budget', async () => {
    const runtimeWorkspaceRoot = await mkdtemp(join(tmpdir(), 'nextagent-readback-budget-'));
    try {
      const read = {
        runtimeWorkspaceRoot,
        executionWorkspaceResolver: createExecutionWorkspaceResolver(),
        deploymentMode: 'LOCAL' as const,
        workspacePolicyProvider: {
          async require() {
            return assembly().workspacePolicy;
          },
        },
      };
      const workspaceFiles = createWorkspaceFilePort(read);
      const subsystem = createCapabilitySubsystem({
        read,
        toolDependencies: { workspaceFiles },
      });
      const ownerContext = toolContext(request({ file_path: 'tool-results/big-result.txt' }));
      const ownerView = await workspaceFiles.resolveView(ownerContext);
      const ownerWorkspace = ownerView.roots.find((root) => root.kind === 'workspace')!;
      await mkdir(join(ownerWorkspace.physicalPath, 'tool-results'), { recursive: true });
      await writeFile(
        join(ownerWorkspace.physicalPath, 'tool-results', 'big-result.txt'),
        Array.from({ length: 1_000 }, (_, index) => `line-${index}:` + 'x'.repeat(200)).join('\n'),
        'utf8',
      );

      const tooLarge = await subsystem.invocationPort.invoke(
        request({ file_path: 'workspace/tool-results/big-result.txt' }),
        new AbortController().signal,
      );
      expect(tooLarge).toMatchObject({
        status: 'FAILED',
        structuredPayload: {},
        safeError: { code: 'PAGING_REQUIRED', category: 'VALIDATION' },
      });

      const paged = await subsystem.invocationPort.invoke(
        request({ file_path: 'workspace/tool-results/big-result.txt', offset: 0, limit: 20 }),
        new AbortController().signal,
      );
      expect(paged.status).toBe('SUCCEEDED');
      expect(paged.structuredPayload).toMatchObject({
        file_path: 'workspace/tool-results/big-result.txt',
        offset: 0,
        limit: 20,
        truncated: true,
        nextOffset: 20,
      });
      expect(Buffer.byteLength(String(paged.structuredPayload.content), 'utf8')).toBeLessThanOrEqual(65_536);
    } finally {
      await rm(runtimeWorkspaceRoot, { recursive: true, force: true });
    }
  });
});

function assembly(): AgentAssembly {
  return {
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'default-agent:v1',
    displayName: 'Default Agent',
    description: 'Telecom test agent.',
    workspacePolicy: {
      schemaVersion: 'nextagent.agent-workspace-policy.v1',
      isolationMode: 'subject',
      roots: [
        { kind: 'workspace', logicalPath: 'workspace', access: 'readWrite' },
        { kind: 'systemResources', logicalPath: '.nextagent', access: 'read' },
        { kind: 'temp', logicalPath: 'temp', access: 'readWrite' },
      ],
    },
    modelIds: ['test-model'],
    capabilityBindings: [{ capabilityId: readCapabilityId, capabilityType: 'TOOL', providerId: 'builtin-tools' }],
    userInvocable: true,
    agentInvocation: 'BOUND',
    runtimeSettings: { requestTimeoutMs: 1000 },
  };
}

function sharedDataAssembly(): AgentAssembly {
  const base = assembly();
  return {
    ...base,
    workspacePolicy: {
      ...base.workspacePolicy,
      roots: [...base.workspacePolicy.roots, { kind: 'sharedData', logicalPath: 'shared-data', access: 'read' }],
      files: { readDirectories: ['shared-data'], writeDirectories: [], maxTextBytes: 256_000 },
    },
  };
}

function request(
  argumentsValue: CapabilityInvocationRequest['arguments'],
  overrides: Partial<CapabilityInvocationRequest> = {},
): CapabilityInvocationRequest {
  return {
    invocationId: 'invoke-read',
    capabilityId: readCapabilityId,
    arguments: argumentsValue,
    sessionId: brand<string, 'SessionId'>('session-read'),
    requestId: brand<string, 'MessageId'>('request-read'),
    runId: brand<string, 'RequestRunId'>('run-read'),
    requestContextId: brand<string, 'RequestContextId'>('context-read'),
    stepId: 'turn-1',
    identityContext: {
      tenantId: tenantId(),
      subjectId: subjectId(),
      displayName: 'Read tester',
    },
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    timeoutMs: 30_000,
    idempotencyKey: brand<string, 'IdempotencyKey'>('idem-read'),
    ...overrides,
  };
}

function toolContext(value: CapabilityInvocationRequest): ToolExecutionContext {
  return {
    identityContext: value.identityContext,
    agentId: value.agentId,
    agentVersion: value.agentVersion,
    sessionId: value.sessionId,
    requestId: value.requestId,
    runId: value.runId,
    requestContextId: value.requestContextId,
    stepId: value.stepId,
    toolCallId: value.toolCallId ?? 'tool-read',
    timeoutMs: value.timeoutMs,
  };
}

function tenantId() {
  return brand<string, 'TenantId'>('tenant-read');
}

function subjectId() {
  return brand<string, 'SubjectId'>('subject-read');
}
