import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { writePassingCaseEvidence } from '../helpers/case-evidence.js';
import { runExternalConsumerScript } from '../helpers/external-consumer-process.js';
import { externalNextAgentArtifactsRoot, hashDirectoryTree } from '../helpers/external-consumer-root.js';
import { withRunScope } from '../helpers/run-scope.js';

type SkillHubMode = 'normal' | 'replacement-invalid' | 'traversal' | 'hash-mismatch' | 'http-failure' | 'delay';

interface ObservedSkillHubRequest {
  readonly pathname: string;
  readonly mode: SkillHubMode;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

interface InstalledSkillFact {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly agentId: string;
  readonly agentVersion: string;
  readonly agentAssemblyRef: string;
  readonly providerId: string;
  readonly skillId: string;
  readonly contentVersion?: string;
  readonly contentHash?: string;
  readonly manifestFile: string;
  readonly sourceIdentity: string;
  readonly frontmatterHash: string;
}

describe('TC-SI-114 SkillHub HTTP and filesystem', () => {
  it('installs a verified Skill atomically and preserves it across remote failures', async () => {
    const externalPackagesRoot = requiredExternalPackagesRoot();
    const artifactsRoot = externalNextAgentArtifactsRoot(externalPackagesRoot);
    const inputHashBefore = await hashDirectoryTree(artifactsRoot);

    await withRunScope(
      {
        outputBase: process.env.TESTCLAW_SYSTEM_INTEGRATION_OUTPUT_ROOT,
      },
      async (scope) => {
        const packages = createSkillPackages();
        const observed: ObservedSkillHubRequest[] = [];
        const state: { mode: SkillHubMode } = { mode: 'normal' };
        const server = createServer((request, response) => {
          void handleSkillHubRequest(request, response, state, packages, observed);
        });
        const port = await scope.listenOnRandomPort(server);
        const source = await readFile(new URL('./fixtures/TC-SI-114-consumer.mjs', import.meta.url), 'utf8');
        const execution = await runExternalConsumerScript({
          externalPackagesRoot,
          tempBase: scope.tempRoot,
          source,
          environment: {
            TESTCLAW_LOOPBACK_BASE_URL: `http://127.0.0.1:${port}`,
            TESTCLAW_SKILL_ROOT: scope.skillRoot,
          },
          registerChild: scope.registerChild,
        });

        expect(execution.code).toBe(0);
        expect(execution.stderr).toBe('');
        expect(JSON.parse(execution.stdout)).toEqual({
          atomicCommitObserved: true,
          cancellationRejected: true,
          failedReplacementPreserved: true,
          hashCheckedBeforeMaterialization: true,
          stagedFolderValidated: true,
          unsafeArchiveRejected: true,
        });

        const facts = await readInstalledFacts(scope.skillRoot);
        expect(facts).toHaveLength(1);
        const fact = facts[0];
        expect(fact).toMatchObject({
          tenantId: 'tenant-loopback',
          subjectId: 'subject-loopback',
          agentId: 'agent-loopback',
          agentVersion: 'v1',
          agentAssemblyRef: 'agent-loopback:v1',
          providerId: 'hub-loopback',
          skillId: 'radio-diag',
          contentVersion: 'v1',
          contentHash: packages.validHash,
        });
        expect(fact).not.toHaveProperty('gatewayId');
        expect(fact).not.toHaveProperty('packageRef');
        expect(fact).not.toHaveProperty('stagingRoot');
        expect(isPathInside(scope.skillRoot, fact.manifestFile)).toBe(true);
        expect(await readFile(fact.manifestFile, 'utf8')).toContain('Version one body.');
        expect(await readFile(path.join(path.dirname(fact.manifestFile), 'resources', 'guide.md'), 'utf8')).toBe('Radio guide.');
        expect(existsSync(path.join(scope.skillRoot, 'escape'))).toBe(false);
        expect(await listInstalledDirectories(scope.skillRoot)).toHaveLength(1);

        assertSkillHubProtocol(observed);

        await writePassingCaseEvidence({
          evidenceRoot: scope.evidenceRoot,
          caseId: 'TC-SI-114',
          observations: {
            atomicProviderNeutralFactCommitted: true,
            failedReplacementPreserved: true,
            filesystemNormalizedAndValidated: true,
            hashVerifiedBeforeMaterialization: true,
            httpAndCancellationFailuresLeftNoPartialInstall: true,
            unsafeArchiveEntryRejected: true,
          },
          canaries: [{ value: 'skillhub-canary', category: 'skill-body' }],
        });
      },
    );

    expect(await hashDirectoryTree(artifactsRoot)).toBe(inputHashBefore);
  }, 60_000);
});

function createSkillPackages(): {
  readonly valid: Buffer;
  readonly validHash: string;
  readonly invalidManifest: Buffer;
  readonly invalidManifestHash: string;
  readonly traversal: Buffer;
  readonly traversalHash: string;
} {
  const valid = zipPackage([
    {
      path: 'SKILL.md',
      content: [
        '---',
        'name: radio-diag',
        'description: Diagnose radio access degradation.',
        'context: inline',
        'user-invocable: true',
        'model-invocable: true',
        '---',
        'Version one body.',
      ].join('\n'),
    },
    { path: 'resources/guide.md', content: 'Radio guide.' },
  ]);
  const invalidManifest = zipPackage([{ path: 'SKILL.md', content: 'replacement without valid frontmatter' }]);
  const traversal = zipPackage([{ path: '../escape/SKILL.md', content: 'skillhub-canary' }]);
  return {
    valid,
    validHash: sha256(valid),
    invalidManifest,
    invalidManifestHash: sha256(invalidManifest),
    traversal,
    traversalHash: sha256(traversal),
  };
}

async function handleSkillHubRequest(
  request: IncomingMessage,
  response: ServerResponse,
  state: { mode: SkillHubMode },
  packages: ReturnType<typeof createSkillPackages>,
  observed: ObservedSkillHubRequest[],
): Promise<void> {
  try {
    const parsedUrl = new URL(request.url ?? '/', 'http://loopback.invalid');
    const body = await readRequestJson(request);
    if (parsedUrl.pathname === '/control') {
      if (!isRecord(body) || !isSkillHubMode(body.mode)) {
        respondJson(response, 400, { status: 'invalid-control' });
        return;
      }
      state.mode = body.mode;
      respondJson(response, 200, { status: 'ok' });
      return;
    }

    observed.push({
      pathname: parsedUrl.pathname,
      mode: state.mode,
      headers: selectedHeaders(request),
      body,
    });
    if (parsedUrl.pathname === '/skills/search') {
      respondCandidateList(response, state.mode, packages);
      return;
    }
    if (parsedUrl.pathname === '/skills/package') {
      await respondPackage(response, state.mode, packages);
      return;
    }
    respondJson(response, 404, { status: 'not-found' });
  } catch {
    respondJson(response, 500, { status: 'loopback-handler-failed' });
  }
}

function respondCandidateList(response: ServerResponse, mode: SkillHubMode, packages: ReturnType<typeof createSkillPackages>): void {
  const isReplacement = mode === 'replacement-invalid';
  respondJson(response, 200, {
    candidates: [
      {
        skillId: 'radio-diag',
        packageRef: isReplacement ? 'pkg-radio-diag-v2-invalid' : 'pkg-radio-diag-v1',
        packageVersion: isReplacement ? 'v2' : 'v1',
        packageHash: isReplacement ? packages.invalidManifestHash : packages.validHash,
        agentId: 'agent-loopback',
        agentVersion: 'v1',
        agentAssemblyRef: 'agent-loopback:v1',
      },
    ],
  });
}

async function respondPackage(response: ServerResponse, mode: SkillHubMode, packages: ReturnType<typeof createSkillPackages>): Promise<void> {
  if (mode === 'delay') {
    await delay(500);
    if (response.destroyed) {
      return;
    }
  }
  if (mode === 'http-failure') {
    response.writeHead(503, { 'content-type': 'text/plain' });
    response.end('skillhub-canary');
    return;
  }
  if (mode === 'traversal') {
    respondPackageBytes(response, packages.traversal, 'v-traversal', packages.traversalHash);
    return;
  }
  if (mode === 'hash-mismatch') {
    respondPackageBytes(response, packages.valid, 'v-hash', '0'.repeat(64));
    return;
  }
  if (mode === 'replacement-invalid') {
    respondPackageBytes(response, packages.invalidManifest, 'v2', packages.invalidManifestHash);
    return;
  }
  respondPackageBytes(response, packages.valid, 'v1', packages.validHash);
}

function respondPackageBytes(response: ServerResponse, bytes: Buffer, version: string, hash: string): void {
  respondJson(response, 200, {
    packageBytesBase64: bytes.toString('base64'),
    packageVersion: version,
    packageHash: hash,
  });
}

function assertSkillHubProtocol(observed: readonly ObservedSkillHubRequest[]): void {
  const search = findObserved(observed, '/skills/search', 'normal');
  expect(search.body).toMatchObject({
    tenantId: 'tenant-loopback',
    subjectId: 'subject-loopback',
    agentId: 'agent-loopback',
    agentVersion: 'v1',
    agentAssemblyRef: 'agent-loopback:v1',
  });
  expect(search.headers).toMatchObject({
    traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
    'x-task-event-id': 'skillhub-loopback',
  });

  const download = findObserved(observed, '/skills/package', 'normal');
  expect(download.body).toMatchObject({
    tenantId: 'tenant-loopback',
    subjectId: 'subject-loopback',
    agentId: 'agent-loopback',
    agentVersion: 'v1',
    agentAssemblyRef: 'agent-loopback:v1',
    packageRef: 'pkg-radio-diag-v1',
  });
  expect(observed).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ pathname: '/skills/package', mode: 'replacement-invalid' }),
      expect.objectContaining({ pathname: '/skills/package', mode: 'traversal' }),
      expect.objectContaining({ pathname: '/skills/package', mode: 'hash-mismatch' }),
      expect.objectContaining({ pathname: '/skills/package', mode: 'http-failure' }),
      expect.objectContaining({ pathname: '/skills/package', mode: 'delay' }),
    ]),
  );
}

async function readInstalledFacts(skillRoot: string): Promise<readonly InstalledSkillFact[]> {
  const content = await readFile(path.join(skillRoot, 'remote-skill-content-index.json'), 'utf8');
  const parsed = JSON.parse(content) as unknown;
  if (!Array.isArray(parsed) || !parsed.every(isInstalledSkillFact)) {
    throw new Error('installed-skill-fact-invalid');
  }
  return parsed;
}

function isInstalledSkillFact(value: unknown): value is InstalledSkillFact {
  return (
    isRecord(value) &&
    typeof value.tenantId === 'string' &&
    typeof value.subjectId === 'string' &&
    typeof value.agentId === 'string' &&
    typeof value.agentVersion === 'string' &&
    typeof value.agentAssemblyRef === 'string' &&
    typeof value.providerId === 'string' &&
    typeof value.skillId === 'string' &&
    typeof value.manifestFile === 'string' &&
    typeof value.sourceIdentity === 'string' &&
    typeof value.frontmatterHash === 'string'
  );
}

async function listInstalledDirectories(skillRoot: string): Promise<readonly string[]> {
  const entries = await readdir(path.join(skillRoot, 'installed'), { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

function zipPackage(entries: readonly { readonly path: string; readonly content: string }[]): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8');
    const content = Buffer.from(entry.content, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    localChunks.push(local, name, content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralChunks.push(central, name);
    offset += local.length + name.length + content.length;
  }
  const centralBytes = Buffer.concat(centralChunks);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localChunks, centralBytes, end]);
}

async function readRequestJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const content = Buffer.concat(chunks).toString('utf8');
  return content.length === 0 ? undefined : (JSON.parse(content) as unknown);
}

function selectedHeaders(request: IncomingMessage): Readonly<Record<string, string>> {
  return Object.freeze(
    Object.fromEntries(
      ['traceparent', 'x-task-event-id']
        .map((name) => [name, request.headers[name]])
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    ),
  );
}

function findObserved(observed: readonly ObservedSkillHubRequest[], pathname: string, mode: SkillHubMode): ObservedSkillHubRequest {
  const found = observed.find((entry) => entry.pathname === pathname && entry.mode === mode);
  if (found === undefined) {
    throw new Error('expected-skillhub-request-missing');
  }
  return found;
}

function respondJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSkillHubMode(value: unknown): value is SkillHubMode {
  return (
    value === 'normal' ||
    value === 'replacement-invalid' ||
    value === 'traversal' ||
    value === 'hash-mismatch' ||
    value === 'http-failure' ||
    value === 'delay'
  );
}

function isPathInside(parent: string, target: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function requiredExternalPackagesRoot(): string {
  const value = process.env.NEXTAGENT_EXTERNAL_PACKAGES_ROOT;
  if (value === undefined || value.trim().length === 0) {
    throw new Error('external-packages-root-unavailable');
  }
  return path.resolve(value);
}
