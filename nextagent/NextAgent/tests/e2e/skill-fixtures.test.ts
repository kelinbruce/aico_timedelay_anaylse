import { createSystemLocalSkillDiscoveryForTesting } from '@nextagent/agent-capability';
import { brand } from '@nextagent/agent-common';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('e2e Skill fixtures', () => {
  it('loads the workspace Tool Calling fixture Skill with the expected tool constraints', async () => {
    const skillName = brand<string, 'CapabilityId'>('workspace-tool-calling-load-test');
    const root = await mkdtemp(join(tmpdir(), 'nextagent-skill-fixtures-'));
    try {
      await cp(
        join(process.cwd(), 'tests', 'e2e', 'fixtures', 'skills', 'workspace-tool-calling-load-test'),
        join(root, 'workspace-tool-calling-load-test'),
        { recursive: true },
      );
      const discovery = createSystemLocalSkillDiscoveryForTesting({
        systemSkillsRoot: root,
      });

      const descriptors = await discovery.listAll(new AbortController().signal);
      const descriptor = descriptors.find((item) => item.capabilityId === skillName);

      expect(descriptor).toMatchObject({
        capabilityId: 'workspace-tool-calling-load-test',
        kind: 'SKILL',
        modelInvocable: true,
        metadata: expect.objectContaining({
          metadataKind: 'nextagent.skill',
          userInvocable: true,
          modelInvocable: true,
          allowedTools: ['Write', 'Glob', 'Read', 'Edit', 'Grep'],
        }),
      });
      expect(discovery.getReadinessEvidence()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            outcomeCode: 'LOCAL_SKILL_REGISTERED',
            skillId: 'workspace-tool-calling-load-test',
          }),
        ]),
      );

      const loadingFact = discovery.getInternalLoadingFact(skillName);
      expect(loadingFact).toBeDefined();
      const loaded = await discovery.loadCanonicalBodyView(
        {
          skillName,
          skillVersion: loadingFact?.skillVersion ?? 'unversioned',
        },
        new AbortController().signal,
      );

      expect(loaded?.body).toContain('Write -> Glob -> Read -> Edit -> Grep');
      expect(loaded?.body).toContain('Workspace tool calling skill load verified.');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('loads the workspace file extension policy fixture Skill with recoverable file Tool constraints', async () => {
    const skillName = brand<string, 'CapabilityId'>('workspace-file-extension-policy-test');
    const root = await mkdtemp(join(tmpdir(), 'nextagent-extension-skill-fixture-'));
    try {
      await cp(
        join(process.cwd(), 'tests', 'e2e', 'fixtures', 'skills', 'workspace-file-extension-policy-test'),
        join(root, 'workspace-file-extension-policy-test'),
        { recursive: true },
      );
      const discovery = createSystemLocalSkillDiscoveryForTesting({
        systemSkillsRoot: root,
      });

      const descriptors = await discovery.listAll(new AbortController().signal);
      expect(descriptors.find((item) => item.capabilityId === skillName)).toMatchObject({
        capabilityId: 'workspace-file-extension-policy-test',
        kind: 'SKILL',
        modelInvocable: true,
        metadata: expect.objectContaining({
          metadataKind: 'nextagent.skill',
          userInvocable: true,
          modelInvocable: true,
          allowedTools: ['Write', 'Read', 'Edit', 'Glob', 'Grep'],
        }),
      });
      expect(discovery.getReadinessEvidence()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            outcomeCode: 'LOCAL_SKILL_REGISTERED',
            skillId: 'workspace-file-extension-policy-test',
          }),
        ]),
      );

      const loadingFact = discovery.getInternalLoadingFact(skillName);
      expect(loadingFact).toBeDefined();
      const loaded = await discovery.loadCanonicalBodyView(
        {
          skillName,
          skillVersion: loadingFact?.skillVersion ?? 'unversioned',
        },
        new AbortController().signal,
      );

      expect(loaded?.body).toContain('A `.pem` write is rejected by deny-first precedence.');
      expect(loaded?.body).toContain('A `.csv` write is rejected because it is absent from the write allowlist.');
      expect(loaded?.body).toContain('Write, Read, Edit, Glob, and Grep sequence succeeds.');
      expect(loaded?.body).toContain('extension-policy/deny-first.pem');
      expect(loaded?.body).toContain('CAPABILITY_PATH_REJECTED');
      expect(loaded?.body).toContain('Workspace file extension policy verified.');
      expect(loaded?.body).not.toMatch(/(?:[A-Za-z]:\\|\/(?:Users|home|var|etc|tmp)\/|api[_-]?key|authorization|credential|password|secret|token)/iu);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
