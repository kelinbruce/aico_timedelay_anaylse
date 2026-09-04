import { StaticCapabilityCatalog, builtinSkillsProvider, builtinToolsProvider, createCapabilitySubsystem } from '@nextagent/agent-capability';
import { bindRuntimeLoggerProvider, brand, type RuntimeLoggerProviderBinding } from '@nextagent/agent-common';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityDescriptor } from '@nextagent/agent-contracts/capability';
import { createBuiltinSkillDiscoveryForTesting, BuiltinSkillDiscovery } from '../src/builtins/skill-discovery.js';
import { readSkillFrontmatterSourceFromFile } from '../src/skills/skill-manifest.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';

let loggerBinding: RuntimeLoggerProviderBinding | undefined;
const bundledSkillId = 'skill-creator';
afterEach(() => loggerBinding?.unbind());

describe('BuiltinSkillDiscovery', () => {
  it('discovers package-owned first-level SKILL.md candidates through standard manifest mapping', async () => {
    const discovery = new BuiltinSkillDiscovery();
    const descriptors = await discovery.listAll(new AbortController().signal);

    expect(builtinSkillsProvider).toEqual({ providerId: 'builtin-skills', providerKind: 'BUNDLED' });
    expect(descriptors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capabilityId: bundledSkillId,
          kind: 'SKILL',
          provider: builtinSkillsProvider,
          availabilityStatus: 'AVAILABLE',
          metadata: expect.objectContaining({ metadataKind: 'nextagent.skill', context: 'inline' }),
        }),
      ]),
    );
    expect(descriptors.map((descriptor) => descriptor.capabilityId)).toContain('skill-creator');
    expect(descriptors.map((descriptor) => descriptor.capabilityId)).not.toContain('telecom-domain-qa');
    expect(JSON.stringify(descriptors)).not.toContain('SKILL.md');
    expect(JSON.stringify(descriptors)).not.toContain('builtins');
    const loadingFact = discovery.getInternalLoadingFact(brand<string, 'CapabilityId'>(bundledSkillId));
    expect(loadingFact).toMatchObject({
      providerId: 'builtin-skills',
      capabilityId: bundledSkillId,
    });
    expect(loadingFact?.frontmatterHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('ignores hidden and nested directories, reports safe diagnostics, and keeps source paths private', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-builtin-skills-'));
    try {
      await mkdir(join(root, '.hidden'), { recursive: true });
      await writeFile(join(root, '.hidden', 'SKILL.md'), validSkill('hidden-skill'), 'utf8');
      await mkdir(join(root, 'valid-skill'), { recursive: true });
      await writeFile(join(root, 'valid-skill', 'SKILL.md'), validSkill('valid-skill'), 'utf8');
      await mkdir(join(root, 'missing-skill'), { recursive: true });
      await mkdir(join(root, 'nested', 'child'), { recursive: true });
      await writeFile(join(root, 'nested', 'child', 'SKILL.md'), validSkill('child'), 'utf8');
      await mkdir(join(root, 'Invalid Name'), { recursive: true });
      const logs = captureLogs();

      const discovery = createBuiltinSkillDiscoveryForTesting({ resourceRoot: root });
      const descriptors = await discovery.listAll(new AbortController().signal);

      expect(descriptors.map((descriptor) => descriptor.capabilityId)).toEqual(['valid-skill']);
      expect(discovery.getReadinessEvidence()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ outcomeCode: 'BUILTIN_SKILL_MANIFEST_MISSING', skillId: 'missing-skill' }),
          expect.objectContaining({ outcomeCode: 'BUILTIN_SKILL_MANIFEST_MISSING', skillId: 'nested' }),
          expect.objectContaining({ outcomeCode: 'BUILTIN_SKILL_CANDIDATE_IGNORED', skillId: 'Invalid Name' }),
          expect.objectContaining({ outcomeCode: 'BUILTIN_SKILL_REGISTERED', skillId: 'valid-skill' }),
        ]),
      );
      expect(discovery.getReadinessEvidence()).toHaveLength(4);
      expect(JSON.stringify(discovery.getReadinessEvidence())).not.toContain(root);
      expect(JSON.stringify(logs.entries)).not.toContain(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reuses manifest diagnostics and supports trusted source disablement without catalog entries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-builtin-skills-'));
    try {
      await mkdir(join(root, 'bad-skill'), { recursive: true });
      await writeFile(join(root, 'bad-skill', 'SKILL.md'), invalidSkillWithDiagnosticCanary('bad-skill'), 'utf8');
      const logs = captureLogs();
      const invalid = createBuiltinSkillDiscoveryForTesting({ resourceRoot: root });
      await expect(invalid.listAll(new AbortController().signal)).resolves.toEqual([]);
      expect(invalid.getReadinessEvidence()).toEqual([
        expect.objectContaining({
          outcomeCode: 'BUILTIN_SKILL_MANIFEST_INVALID',
          skillId: 'bad-skill',
          message: 'Builtin Skill manifest is invalid.',
        }),
      ]);
      expect(logs.entries).toEqual([
        expect.objectContaining({
          level: 'warn',
          obj: expect.objectContaining({ diagnosticReasonCodes: ['INVALID_OFFICIAL_FIELD'], diagnosticCount: 1 }),
          msg: 'Skill bad-skill manifest validation failed with 1 diagnostic reason codes.',
        }),
      ]);
      expect(JSON.stringify({ evidence: invalid.getReadinessEvidence(), logs: logs.entries })).not.toContain('credential-sk-leak-canary');
      expect(JSON.stringify(logs.entries)).not.toContain('detailMessages');

      const disabled = createBuiltinSkillDiscoveryForTesting({ resourceRoot: root, enabled: false });
      await expect(disabled.listAll(new AbortController().signal)).resolves.toEqual([]);
      expect(disabled.getReadinessEvidence()).toEqual([expect.objectContaining({ outcomeCode: 'BUILTIN_SKILL_SOURCE_DISABLED' })]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('returns an empty result without synthesizing a required business Skill identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-empty-builtin-skills-'));
    try {
      const discovery = createBuiltinSkillDiscoveryForTesting({ resourceRoot: root });

      await expect(discovery.listAll(new AbortController().signal)).resolves.toEqual([]);
      expect(discovery.getReadinessEvidence()).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('is assembled as an internal builtin-skills provider contribution', async () => {
    const subsystem = createCapabilitySubsystem({ builtinSkillDiscoveryOptions: { enabled: false } });

    await expect(
      subsystem.catalog.listAvailable({ tenantId: tenantId(), subjectId: subjectId(), agentAssembly: assembly([]), includeUnavailable: true }),
    ).resolves.not.toEqual(expect.arrayContaining([expect.objectContaining({ provider: builtinSkillsProvider })]));
  });

  it('reads only the leading frontmatter, registers safe refs, and does not execute body commands during discovery', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-builtin-skills-'));
    try {
      const skillDir = join(root, 'body-skill');
      const manifestFile = join(skillDir, 'SKILL.md');
      await mkdir(skillDir, { recursive: true });
      await writeFile(manifestFile, `${validSkill('body-skill')}\nnode should-not-run.js\nFull body content must not enter discovery.\n`, 'utf8');

      const frontmatter = await readSkillFrontmatterSourceFromFile(manifestFile);
      const discovery = createBuiltinSkillDiscoveryForTesting({ resourceRoot: root });

      await expect(discovery.listAll(new AbortController().signal)).resolves.toEqual([expect.objectContaining({ capabilityId: 'body-skill' })]);
      expect(frontmatter).not.toContain('Full body content');
      expect(frontmatter).not.toContain('should-not-run');
      expect(JSON.stringify(discovery.getReadinessEvidence())).not.toContain('Full body content');
      expect(discovery.getInternalLoadingFact(brand<string, 'CapabilityId'>('body-skill'))).toMatchObject({
        capabilityId: 'body-skill',
        skillVersion: 'unversioned',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reads only the leading frontmatter from a UTF-8 BOM file and registers the skill', async () => {
    // The shared decode helper must strip the UTF-8 BOM so the frontmatter
    // boundary (`---`) is recognized on both the discovery read path and the
    // registration path. A BOM file MUST NOT be rejected as missing frontmatter.
    const root = await mkdtemp(join(tmpdir(), 'nextagent-builtin-skills-bom-'));
    try {
      const skillDir = join(root, 'bom-skill');
      const manifestFile = join(skillDir, 'SKILL.md');
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        manifestFile,
        Buffer.concat([
          Buffer.from([0xef, 0xbb, 0xbf]),
          Buffer.from(`${validSkill('bom-skill')}\nFull body content must not enter discovery.\n`, 'utf8'),
        ]),
      );

      const frontmatter = await readSkillFrontmatterSourceFromFile(manifestFile);
      expect(frontmatter.startsWith('﻿')).toBe(false);
      expect(frontmatter).toContain('---');
      expect(frontmatter).not.toContain('Full body content');

      const discovery = createBuiltinSkillDiscoveryForTesting({ resourceRoot: root });
      await expect(discovery.listAll(new AbortController().signal)).resolves.toEqual([expect.objectContaining({ capabilityId: 'bom-skill' })]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('lists Skill resource metadata separately from governed per-resource reads', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-builtin-skills-'));
    try {
      const skillDir = join(root, 'resource-skill');
      await mkdir(join(skillDir, 'references'), { recursive: true });
      await mkdir(join(skillDir, 'scripts'), { recursive: true });
      await mkdir(join(skillDir, 'assets', '.schemas'), { recursive: true });
      await mkdir(join(skillDir, 'assets', '.pnpm-store'), { recursive: true });
      await mkdir(join(skillDir, 'api'), { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), validSkill('resource-skill'), 'utf8');
      await writeFile(join(skillDir, 'references', 'guide.md'), 'radio guide', 'utf8');
      await writeFile(join(skillDir, 'scripts', 'query.py'), "print('ok')\n", 'utf8');
      await writeFile(join(skillDir, 'assets', '.schemas', 'chatbi.yaml'), 'openapi: 3.1.0\n', 'utf8');
      await writeFile(join(skillDir, 'assets', '.pnpm-store', 'skip.js'), 'module.exports = 1;\n', 'utf8');
      await writeFile(join(skillDir, 'api', 'a.yaml'), 'openapi: 3.1.0\n', 'utf8');
      await writeFile(join(skillDir, 'README.md'), 'not projected', 'utf8');
      const discovery = createBuiltinSkillDiscoveryForTesting({ resourceRoot: root });
      await expect(discovery.listAll(new AbortController().signal)).resolves.toHaveLength(1);
      const fact = { skillName: brand<string, 'CapabilityId'>('resource-skill'), skillVersion: 'unversioned' };

      const resources = await discovery.listSkillResources(fact, new AbortController().signal);
      expect(resources).toEqual([
        expect.objectContaining({ relativePath: 'api/a.yaml', kind: 'asset', sizeBytes: 15 }),
        expect.objectContaining({ relativePath: 'assets/.schemas/chatbi.yaml', kind: 'asset', sizeBytes: 15 }),
        expect.objectContaining({ relativePath: 'references/guide.md', kind: 'reference', sizeBytes: 11 }),
        expect.objectContaining({ relativePath: 'scripts/query.py', kind: 'script', sizeBytes: 12 }),
      ]);
      expect(resources).not.toEqual(expect.arrayContaining([expect.objectContaining({ relativePath: 'assets/.pnpm-store/skip.js' })]));
      expect(resources).not.toEqual(expect.arrayContaining([expect.objectContaining({ contentStream: expect.anything() })]));
      expect(JSON.stringify(resources)).not.toContain(root);

      const guide = resources.find((resource) => resource.relativePath === 'references/guide.md')!;
      const loaded = await discovery.readSkillResource({ ...fact, resource: guide }, new AbortController().signal);
      await expect(readStreamText(loaded?.contentStream)).resolves.toBe('radio guide');
      expect(loaded).toMatchObject(guide);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function readStreamText(stream?: AsyncIterable<Uint8Array>): Promise<string> {
  if (stream === undefined) {
    return '';
  }
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

describe('framework-default builtin catalog governance', () => {
  it('injects governed builtin Tool and Skill descriptors by default for every Agent', async () => {
    const catalog = new StaticCapabilityCatalog([toolDescriptor(), skillDescriptor()]);

    await expect(
      catalog.listAvailable({ tenantId: tenantId(), subjectId: subjectId(), agentAssembly: assembly([]), includeUnavailable: false }),
    ).resolves.toEqual([
      expect.objectContaining({ capabilityId: 'Read', kind: 'TOOL', provider: builtinToolsProvider }),
      expect.objectContaining({ capabilityId: bundledSkillId, kind: 'SKILL', provider: builtinSkillsProvider }),
    ]);
  });

  it('keeps framework-default builtin Skills visible without requiring explicit runtime bindings', async () => {
    const catalog = new StaticCapabilityCatalog([toolDescriptor(), skillDescriptor()]);
    const enabledAgain = assembly([{ capabilityId: bundledSkillId, capabilityType: 'SKILL', providerId: 'builtin-skills' }]);

    await expect(
      catalog.listAvailable({ tenantId: tenantId(), subjectId: subjectId(), agentAssembly: enabledAgain, includeUnavailable: false }),
    ).resolves.toHaveLength(2);
    await expect(
      catalog.resolve({
        tenantId: tenantId(),
        subjectId: subjectId(),
        agentAssembly: assembly([]),
        capabilityId: brand<string, 'CapabilityId'>(bundledSkillId),
      }),
    ).resolves.toEqual(expect.objectContaining({ capabilityId: bundledSkillId, kind: 'SKILL', provider: builtinSkillsProvider }));
  });
});

function validSkill(name: string): string {
  return `---\nname: ${name}\ndescription: Test telecom Skill.\ncontext: inline\nuser-invocable: true\nmodel-invocable: true\n---\n`;
}

function invalidSkillWithDiagnosticCanary(name: string): string {
  return `---\nname: ${name}\ndescription: Test telecom Skill.\nlicense:\n  credential-sk-leak-canary: do-not-log\n---\n`;
}

function toolDescriptor(): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>('Read'),
    kind: 'TOOL',
    provider: builtinToolsProvider,
    displayName: 'Read',
    description: 'Read workspace files.',
    modelInvocable: true,
    availabilityStatus: 'AVAILABLE',
  };
}

function skillDescriptor(): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>(bundledSkillId),
    kind: 'SKILL',
    provider: builtinSkillsProvider,
    displayName: bundledSkillId,
    description: 'Bundled Skill.',
    modelInvocable: true,
    availabilityStatus: 'AVAILABLE',
  };
}

function assembly(capabilityBindings: AgentAssembly['capabilityBindings']): AgentAssembly {
  return {
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'default-agent:v1',
    displayName: 'Default',
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
    capabilityBindings,
    userInvocable: true,
    agentInvocation: 'BOUND',
    runtimeSettings: { requestTimeoutMs: 1000 },
  };
}

function tenantId() {
  return brand<string, 'TenantId'>('tenant-builtin-skill');
}

function subjectId() {
  return brand<string, 'SubjectId'>('subject-builtin-skill');
}

function captureLogs() {
  const entries: Array<{ readonly level: string; readonly obj: object; readonly msg?: string }> = [];
  const logger = {
    error(caughtOrFields: unknown, fieldsOrMsg?: object | string, msg?: string) {
      const fields = typeof fieldsOrMsg === 'object' ? fieldsOrMsg : asObject(caughtOrFields);
      const message = typeof fieldsOrMsg === 'string' ? fieldsOrMsg : msg;
      entries.push({ level: 'error', obj: fields, ...(message === undefined ? {} : { msg: message }) });
    },
    warn(caughtOrFields: unknown, fieldsOrMsg?: object | string, msg?: string) {
      const fields = typeof fieldsOrMsg === 'object' ? fieldsOrMsg : asObject(caughtOrFields);
      const message = typeof fieldsOrMsg === 'string' ? fieldsOrMsg : msg;
      entries.push({ level: 'warn', obj: fields, ...(message === undefined ? {} : { msg: message }) });
    },
    info(obj: object, msg?: string) {
      entries.push({ level: 'info', obj, ...(msg === undefined ? {} : { msg }) });
    },
    debug(obj: object, msg?: string) {
      entries.push({ level: 'debug', obj, ...(msg === undefined ? {} : { msg }) });
    },
  };
  loggerBinding?.unbind();
  loggerBinding = bindRuntimeLoggerProvider({ getLogger: () => logger });
  return { entries, logger };
}

function asObject(value: unknown): object {
  return value !== null && typeof value === 'object' ? value : {};
}
