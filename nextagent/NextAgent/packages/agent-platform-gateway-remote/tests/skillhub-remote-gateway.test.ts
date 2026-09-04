import { createFetchSkillHubRemoteGatewayFactory } from '../src/index.js';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('SkillHub remote gateway adapter', () => {
  it('resolves credential references into authorization headers without exposing the raw credential', async () => {
    const headers: unknown[] = [];
    const factory = createFetchSkillHubRemoteGatewayFactory({
      credentialResolver: async () => 'resolved-hub-token',
      fetch: async (_url, init) => {
        headers.push(init?.headers);
        return {
          ok: true,
          status: 200,
          async json() {
            return { candidates: [] };
          },
        };
      },
    });
    const adapter = factory.create({ gatewayId: 'skillhub-main', endpoint: 'https://skillhub.example', credentialRef: 'env:HUB_TOKEN' });

    const result = await adapter.listCandidates(
      {
        tenantId: 'tenant-a',
        subjectId: 'subject-a',
        agentId: 'agent-a',
        agentVersion: 'v1',
        agentAssemblyRef: 'agent-a:v1',
      },
      new AbortController().signal,
    );

    expect(result).toEqual({ status: 'ok', candidates: [] });
    expect(headers[0]).toMatchObject({
      'content-type': 'application/json',
      authorization: 'Bearer resolved-hub-token',
    });
    expect(JSON.stringify(result)).not.toContain('resolved-hub-token');
  });

  it('adds active execution trace headers to SkillHub requests', async () => {
    const headers: unknown[] = [];
    const factory = createFetchSkillHubRemoteGatewayFactory({
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
      fetch: async (_url, init) => {
        headers.push(init?.headers);
        return {
          ok: true,
          status: 200,
          async json() {
            return { candidates: [] };
          },
        };
      },
    });
    const adapter = factory.create({
      gatewayId: 'skillhub-main',
      endpoint: 'https://skillhub.example',
    });

    await adapter.listCandidates(
      {
        tenantId: 'tenant-a',
        subjectId: 'subject-a',
        agentId: 'agent-a',
        agentVersion: 'v1',
        agentAssemblyRef: 'agent-a:v1',
      },
      new AbortController().signal,
    );

    expect(headers[0]).toMatchObject({
      traceparent: '00-11111111111111111111111111111111-2222222222222222-01',
      'x-task-event-id': 'task-01',
    });
  });

  it('sends trusted scope with package download requests', async () => {
    const bodies: unknown[] = [];
    const stagingRoot = await mkdtemp(join(tmpdir(), 'nextagent-skillhub-gateway-'));
    const packageBytes = zipPackage([{ path: 'SKILL.md', content: 'remote body' }]);
    const expectedHash = createHash('sha256').update(packageBytes).digest('hex');
    const factory = createFetchSkillHubRemoteGatewayFactory({
      fetch: async (_url, init) => {
        bodies.push(JSON.parse(init?.body ?? '{}') as unknown);
        return {
          ok: true,
          status: 200,
          async json() {
            return { packageBytesBase64: Buffer.from(packageBytes).toString('base64'), packageHash: expectedHash };
          },
        };
      },
    });
    const adapter = factory.create({ gatewayId: 'skillhub-main', endpoint: 'https://skillhub.example' });

    try {
      const result = await adapter.fetchContent(
        {
          tenantId: 'tenant-a',
          subjectId: 'subject-a',
          agentId: 'agent-a',
          agentVersion: 'v1',
          agentAssemblyRef: 'agent-a:v1',
          contentRef: 'pkg:scoped-skill',
          stagingRoot,
        },
        new AbortController().signal,
      );

      expect(result).toEqual(expect.objectContaining({ status: 'ok', stagingRoot, contentHash: expectedHash }));
      if (result.status !== 'ok') {
        throw new Error('expected normalized staged folder');
      }
      expect(result).not.toHaveProperty('packageHash');
      expect(result).not.toHaveProperty('packageVersion');
      await expect(readFile(join(result.stagedFolder, 'SKILL.md'), 'utf8')).resolves.toBe('remote body');
    } finally {
      await rm(stagingRoot, { recursive: true, force: true });
    }
    expect(bodies[0]).toEqual({
      tenantId: 'tenant-a',
      subjectId: 'subject-a',
      agentId: 'agent-a',
      agentVersion: 'v1',
      agentAssemblyRef: 'agent-a:v1',
      packageRef: 'pkg:scoped-skill',
    });
  });

  it('normalizes remote list and download failures without exposing raw provider facts', async () => {
    const factory = createFetchSkillHubRemoteGatewayFactory({
      fetch: async () => {
        throw new Error('C:/private/skillhub-client.ts token=very-secret https://download.example/pkg.zip');
      },
    });
    const adapter = factory.create({ gatewayId: 'skillhub-main', endpoint: 'https://skillhub.example', credentialRef: 'env:HUB_TOKEN' });

    const listed = await adapter.listCandidates(
      {
        tenantId: 'tenant-a',
        subjectId: 'subject-a',
        agentId: 'agent-a',
        agentVersion: 'v1',
        agentAssemblyRef: 'agent-a:v1',
      },
      new AbortController().signal,
    );
    const downloaded = await adapter.fetchContent(
      {
        tenantId: 'tenant-a',
        subjectId: 'subject-a',
        agentId: 'agent-a',
        agentVersion: 'v1',
        agentAssemblyRef: 'agent-a:v1',
        contentRef: 'pkg:a',
        stagingRoot: await mkdtemp(join(tmpdir(), 'nextagent-skillhub-gateway-')),
      },
      new AbortController().signal,
    );

    expect(listed).toEqual({ status: 'failed', reasonCode: 'unavailable', message: 'SkillHub remote access failed safely.' });
    expect(downloaded).toEqual({ status: 'failed', reasonCode: 'download-failed', message: 'SkillHub package download failed safely.' });
    const serialized = JSON.stringify([listed, downloaded]);
    expect(serialized).not.toContain('very-secret');
    expect(serialized).not.toContain('download.example');
    expect(serialized).not.toContain('skillhub-client.ts');
  });

  it('creates a fresh staged folder for each normalized package fetch', async () => {
    const stagingRoot = await mkdtemp(join(tmpdir(), 'nextagent-skillhub-gateway-'));
    const packageBytes = zipPackage([{ path: 'SKILL.md', content: 'remote body' }]);
    const factory = createFetchSkillHubRemoteGatewayFactory({
      fetch: async () => ({
        ok: true,
        status: 200,
        async json() {
          return { packageBytesBase64: Buffer.from(packageBytes).toString('base64') };
        },
      }),
    });
    const adapter = factory.create({ gatewayId: 'skillhub-main', endpoint: 'https://skillhub.example' });

    try {
      const first = await adapter.fetchContent(
        {
          tenantId: 'tenant-a',
          subjectId: 'subject-a',
          agentId: 'agent-a',
          agentVersion: 'v1',
          agentAssemblyRef: 'agent-a:v1',
          contentRef: 'pkg:scoped-skill',
          stagingRoot,
        },
        new AbortController().signal,
      );
      const second = await adapter.fetchContent(
        {
          tenantId: 'tenant-a',
          subjectId: 'subject-a',
          agentId: 'agent-a',
          agentVersion: 'v1',
          agentAssemblyRef: 'agent-a:v1',
          contentRef: 'pkg:scoped-skill',
          stagingRoot,
        },
        new AbortController().signal,
      );

      expect(first.status).toBe('ok');
      expect(second.status).toBe('ok');
      if (first.status !== 'ok' || second.status !== 'ok') {
        throw new Error('expected normalized staged folders');
      }
      expect(first.stagedFolder).not.toBe(second.stagedFolder);
      await expect(readFile(join(first.stagedFolder, 'SKILL.md'), 'utf8')).resolves.toBe('remote body');
      await expect(readFile(join(second.stagedFolder, 'SKILL.md'), 'utf8')).resolves.toBe('remote body');
    } finally {
      await rm(stagingRoot, { recursive: true, force: true });
    }
  });

  it('normalizes directory entries and safe subdirectory files into a staged folder', async () => {
    const stagingRoot = await mkdtemp(join(tmpdir(), 'nextagent-skillhub-gateway-'));
    const packageBytes = zipPackage([
      { path: 'SKILL.md', content: 'remote body' },
      { path: 'api/', content: '', externalAttributes: (0o040000 << 16) >>> 0 },
      { path: 'api/query.yaml', content: 'query: upf\n' },
      { path: 'references/runbook.md', content: 'Check UPF alarms.\n' },
    ]);
    const adapter = createPackageAdapter(packageBytes);

    try {
      const result = await adapter.fetchContent(remoteContentInput(stagingRoot, 'pkg:resource-skill'), new AbortController().signal);

      expect(result.status).toBe('ok');
      if (result.status !== 'ok') {
        throw new Error('expected normalized staged folder');
      }
      await expect(readFile(join(result.stagedFolder, 'SKILL.md'), 'utf8')).resolves.toBe('remote body');
      await expect(readFile(join(result.stagedFolder, 'api', 'query.yaml'), 'utf8')).resolves.toBe('query: upf\n');
      await expect(readFile(join(result.stagedFolder, 'references', 'runbook.md'), 'utf8')).resolves.toBe('Check UPF alarms.\n');
    } finally {
      await rm(stagingRoot, { recursive: true, force: true });
    }
  });

  it('rejects unsafe package entries before returning a staged folder', async () => {
    const unsafePackages: readonly Uint8Array[] = [
      zipPackage([{ path: '/SKILL.md', content: 'absolute' }]),
      zipPackage([{ path: 'C:/tmp/SKILL.md', content: 'drive' }]),
      zipPackage([{ path: '../escape/SKILL.md', content: 'traversal' }]),
      zipPackage([
        { path: 'SKILL.md', content: 'first' },
        { path: './SKILL.md', content: 'duplicate' },
      ]),
      zipPackage([{ path: 'bad\u0001/SKILL.md', content: 'control' }]),
      zipPackage([{ path: 'SKILL.md', content: 'encrypted', flags: 0x1 }]),
      zipPackage([{ path: 'SKILL.md', content: 'unsupported', method: 99 }]),
      zipPackage([{ path: 'SKILL.md', content: 'symlink', externalAttributes: (0o120000 << 16) >>> 0 }]),
    ];

    for (const [index, packageBytes] of unsafePackages.entries()) {
      const stagingRoot = await mkdtemp(join(tmpdir(), 'nextagent-skillhub-gateway-'));
      const adapter = createPackageAdapter(packageBytes);
      try {
        const result = await adapter.fetchContent(remoteContentInput(stagingRoot, `pkg:unsafe-${index}`), new AbortController().signal);
        expect(result).toEqual({ status: 'failed', reasonCode: 'invalid-response', message: 'SkillHub package download failed safely.' });
      } finally {
        await rm(stagingRoot, { recursive: true, force: true });
      }
    }
  });

  it('normalizes aborted remote calls as timeout', async () => {
    const factory = createFetchSkillHubRemoteGatewayFactory({
      fetch: async (_url, init) => {
        if (init?.signal?.aborted === true) {
          const error = new Error('operation aborted with raw timeout detail');
          error.name = 'AbortError';
          throw error;
        }
        throw new Error('expected aborted signal');
      },
    });
    const adapter = factory.create({ gatewayId: 'skillhub-main', endpoint: 'https://skillhub.example' });
    const controller = new AbortController();
    controller.abort();

    const listed = await adapter.listCandidates(
      {
        tenantId: 'tenant-a',
        subjectId: 'subject-a',
        agentId: 'agent-a',
        agentVersion: 'v1',
        agentAssemblyRef: 'agent-a:v1',
      },
      controller.signal,
    );
    const downloaded = await adapter.fetchContent(
      {
        tenantId: 'tenant-a',
        subjectId: 'subject-a',
        agentId: 'agent-a',
        agentVersion: 'v1',
        agentAssemblyRef: 'agent-a:v1',
        contentRef: 'pkg:a',
        stagingRoot: await mkdtemp(join(tmpdir(), 'nextagent-skillhub-gateway-')),
      },
      controller.signal,
    );

    expect(listed).toEqual({ status: 'failed', reasonCode: 'timeout', message: 'SkillHub remote access failed safely.' });
    expect(downloaded).toEqual({ status: 'failed', reasonCode: 'timeout', message: 'SkillHub package download failed safely.' });
    expect(JSON.stringify([listed, downloaded])).not.toContain('raw timeout detail');
  });

  it('rejects malformed remote response payloads before returning candidates or staged folders', async () => {
    const factory = createFetchSkillHubRemoteGatewayFactory({
      fetch: async (url) => ({
        ok: true,
        status: 200,
        async json() {
          return url.endsWith('/skills/search')
            ? { candidates: [{ skillId: '', packageRef: 'pkg:empty' }] }
            : { packageBytesBase64: 'not valid base64' };
        },
      }),
    });
    const adapter = factory.create({ gatewayId: 'skillhub-main', endpoint: 'https://skillhub.example' });

    const listed = await adapter.listCandidates(
      {
        tenantId: 'tenant-a',
        subjectId: 'subject-a',
        agentId: 'agent-a',
        agentVersion: 'v1',
        agentAssemblyRef: 'agent-a:v1',
      },
      new AbortController().signal,
    );
    const downloaded = await adapter.fetchContent(
      {
        tenantId: 'tenant-a',
        subjectId: 'subject-a',
        agentId: 'agent-a',
        agentVersion: 'v1',
        agentAssemblyRef: 'agent-a:v1',
        contentRef: 'pkg:a',
        stagingRoot: await mkdtemp(join(tmpdir(), 'nextagent-skillhub-gateway-')),
      },
      new AbortController().signal,
    );

    expect(listed).toEqual({ status: 'failed', reasonCode: 'invalid-response', message: 'SkillHub remote access failed safely.' });
    expect(downloaded).toEqual({ status: 'failed', reasonCode: 'invalid-response', message: 'SkillHub package download failed safely.' });
  });
});

function createPackageAdapter(packageBytes: Uint8Array) {
  const factory = createFetchSkillHubRemoteGatewayFactory({
    fetch: async () => ({
      ok: true,
      status: 200,
      async json() {
        return { packageBytesBase64: Buffer.from(packageBytes).toString('base64') };
      },
    }),
  });
  return factory.create({ gatewayId: 'skillhub-main', endpoint: 'https://skillhub.example' });
}

function remoteContentInput(stagingRoot: string, contentRef: string) {
  return {
    tenantId: 'tenant-a',
    subjectId: 'subject-a',
    agentId: 'agent-a',
    agentVersion: 'v1',
    agentAssemblyRef: 'agent-a:v1',
    contentRef,
    stagingRoot,
  };
}

function zipPackage(
  entries: ReadonlyArray<{
    readonly path: string;
    readonly content: string;
    readonly externalAttributes?: number;
    readonly flags?: number;
    readonly method?: number;
  }>,
): Uint8Array {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8');
    const content = Buffer.from(entry.content, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.flags ?? 0, 6);
    local.writeUInt16LE(entry.method ?? 0, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, content);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(entry.flags ?? 0, 8);
    header.writeUInt16LE(entry.method ?? 0, 10);
    header.writeUInt32LE(0, 16);
    header.writeUInt32LE(content.length, 20);
    header.writeUInt32LE(content.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(entry.externalAttributes ?? 0, 38);
    header.writeUInt32LE(offset, 42);
    central.push(header, name);
    offset += local.length + name.length + content.length;
  }
  const centralOffset = offset;
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([...chunks, centralBytes, end]);
}
