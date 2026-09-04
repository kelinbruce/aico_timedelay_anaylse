import { createNextAgentTestApp, loadBuiltInDefaultAgentDefinition } from '@nextagent/agent-platform-gateway-local/testing';
import { brand } from '@nextagent/agent-common';
import type { ModelInvocationRequest } from '@nextagent/agent-contracts/model';
import type { RunTimelineEvent } from '@nextagent/agent-contracts/runtime';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const tempDirectories: string[] = [];
const tenantId = brand<string, 'TenantId'>('tenant-1');
const subjectId = brand<string, 'SubjectId'>('subject-1');
const agentId = brand<string, 'AgentId'>('default-agent');
const agentVersion = brand<string, 'AgentVersion'>('v1');

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('runtime skill acquisition loop', () => {
  it('acquires a missing SkillHub Skill and uses it in a later model step without mutating the active invocation', async () => {
    const workspaceDir = await makeRoot();
    const captured: ModelInvocationRequest[] = [];
    const logs: unknown[] = [];
    const skillHub = acquisitionOnlySkillHub();
    const app = createNextAgentTestApp({
      workspaceDir,
      modelRequestSink: captured,
      observationLogger: {
        debug(entry) {
          logs.push({ entry, message: String((entry as { event?: unknown }).event) });
        },
        info(entry) {
          logs.push({ entry, message: String((entry as { event?: unknown }).event) });
        },
        warn(entry) {
          logs.push({ entry, message: String((entry as { event?: unknown }).event) });
        },
        error(entry) {
          logs.push({ entry, message: String((entry as { event?: unknown }).event) });
        },
      },
      skillHubAccessFactory: () => skillHub,
      agentDefinition: agentDefinitionWithSkillHubAcquisition(),
      modelSteps: [
        {
          toolCalls: [
            {
              toolCallId: 'tool-acquire-ran-qos',
              toolName: 'acquire_skill',
              arguments: { requested_capability_id: 'ran-qos-skill', provider_id: 'hub-local' },
            },
          ],
        },
        {
          toolCalls: [
            {
              toolCallId: 'tool-load-ran-qos',
              toolName: 'Skill',
              arguments: { name: 'ran-qos-skill' },
            },
          ],
        },
        { content: 'RAN QoS Skill executed.' },
      ],
    });
    try {
      const accepted = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: { inputText: 'diagnose ran qos degradation', idempotencyKey: 'idem-runtime-skill-acquisition' },
      });
      expect(accepted.statusCode).toBe(200);
      const body = accepted.json<{ sessionId: string; requestId: string; runId: string }>();
      await waitForRunTerminal(app, body.runId);

      expect(captured).toHaveLength(3);
      const firstToolNames = captured[0]?.tools.map((tool) => tool.name) ?? [];
      expect(firstToolNames).toContain('acquire_skill');
      expect(firstToolNames).toContain('Skill');
      expect(JSON.stringify(captured[0]?.messages)).not.toContain('RAN QoS acquisition body.');
      expect(JSON.stringify(captured[0]?.messages)).not.toContain('capability_id=ran-qos-skill');

      expect(skillHub.searches).toEqual(
        expect.arrayContaining([
          expect.not.objectContaining({ requestedCapabilityId: 'ran-qos-skill' }),
          expect.objectContaining({ requestedCapabilityId: 'ran-qos-skill' }),
        ]),
      );
      expect(skillHub.fetches).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            contentRef: 'pkg:ran-qos-skill',
            stagingRoot: expect.stringContaining('skillhub-managed'),
          }),
        ]),
      );
      expect(skillHub.fetches).toHaveLength(2);
      await expect(readFile(join(workspaceDir, 'skillhub-managed', 'remote-skill-content-index.json'), 'utf8')).resolves.toContain('ran-qos-skill');

      const secondModelInput = JSON.stringify(captured[1]?.messages);
      expect(secondModelInput).toContain('capability_id=ran-qos-skill');
      expect(secondModelInput).not.toContain(workspaceDir);
      expect(secondModelInput).not.toContain('pkg:ran-qos-skill');
      const thirdModelInput = JSON.stringify(captured[2]?.messages);
      expect(thirdModelInput).toContain('RAN QoS acquisition body.');
      expect(thirdModelInput).not.toContain(workspaceDir);
      expect(thirdModelInput).not.toContain('pkg:ran-qos-skill');

      const events = await listEvents(app, body.sessionId, body.runId);
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'CAPABILITY_COMPLETED',
            inlinePayload: expect.objectContaining({
              capabilityId: 'acquire_skill',
              toolCallId: 'tool-acquire-ran-qos',
              result: expect.objectContaining({
                outcomeCode: 'ACQUIRED_REQUIRES_REPLAN',
                providerKind: 'SKILL_HUB',
                providerId: 'hub-local',
                skillId: 'ran-qos-skill',
              }),
            }),
          }),
        ]),
      );
      expect(events).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'SKILL_ACQUISITION_COMPLETED' }),
          expect.objectContaining({ type: 'CAPABILITY_SNAPSHOT_REBUILT' }),
        ]),
      );
      const serializedEvents = JSON.stringify(events);
      expect(serializedEvents).not.toContain(workspaceDir);
      expect(serializedEvents).not.toContain('pkg:ran-qos-skill');
      expect(serializedEvents).not.toContain('staging');
      expect(serializedEvents).not.toContain('raw');
      const stream = await app.server.inject({
        method: 'GET',
        url: `/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`,
      });
      expect(stream.statusCode).toBe(200);
      expect(stream.body).not.toContain(workspaceDir);
      expect(stream.body).not.toContain('pkg:ran-qos-skill');
      expect(stream.body).not.toContain('staging');
      expect(stream.body).not.toContain('sourceIdentity');
      expect(stream.body).not.toContain('credential');
      const serializedLogs = JSON.stringify(logs);
      expect(serializedLogs).not.toContain(workspaceDir);
      expect(serializedLogs).not.toContain('pkg:ran-qos-skill');
      expect(serializedLogs).not.toContain('staging');
      expect(serializedLogs).not.toContain('sourceIdentity');
      expect(serializedLogs).not.toContain('credential');
      expect(serializedLogs).not.toContain('endpoint');
      expect(serializedLogs).not.toContain('raw');
    } finally {
      await app.close();
    }
  }, 15_000);

  it('loads an acquired Skill from the published SkillHub index after restart without replaying remote content', async () => {
    const workspaceDir = await makeRoot();
    const acquiringSkillHub = acquisitionOnlySkillHub();
    const acquiringApp = createNextAgentTestApp({
      workspaceDir,
      skillHubAccessFactory: () => acquiringSkillHub,
      agentDefinition: agentDefinitionWithSkillHubAcquisition(),
      modelSteps: [
        {
          toolCalls: [
            {
              toolCallId: 'tool-acquire-ran-qos-for-recovery',
              toolName: 'acquire_skill',
              arguments: { requested_capability_id: 'ran-qos-skill', provider_id: 'hub-local' },
            },
          ],
        },
        { content: 'installed' },
      ],
    });
    try {
      const accepted = await acquiringApp.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: { inputText: 'install ran qos skill', idempotencyKey: 'idem-runtime-skill-acquisition-recovery-install' },
      });
      expect(accepted.statusCode).toBe(200);
      const body = accepted.json<{ sessionId: string; runId: string }>();
      await waitForRunTerminal(acquiringApp, body.runId);
    } finally {
      await acquiringApp.close();
    }

    await rm(join(workspaceDir, 'skillhub-managed', 'staging'), { recursive: true, force: true });
    await expect(readFile(join(workspaceDir, 'skillhub-managed', 'remote-skill-content-index.json'), 'utf8')).resolves.toContain('ran-qos-skill');

    const captured: ModelInvocationRequest[] = [];
    const unavailableSkillHub = unavailableSkillHubForRecovery();
    const resumedApp = createNextAgentTestApp({
      workspaceDir,
      modelRequestSink: captured,
      skillHubAccessFactory: () => unavailableSkillHub,
      agentDefinition: agentDefinitionWithSkillHubAcquisition(),
      modelSteps: [
        {
          toolCalls: [
            {
              toolCallId: 'tool-load-recovered-ran-qos',
              toolName: 'Skill',
              arguments: { name: 'ran-qos-skill' },
            },
          ],
        },
        { content: 'Recovered RAN QoS Skill executed.' },
      ],
    });
    try {
      const accepted = await resumedApp.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: { inputText: 'use recovered ran qos skill', idempotencyKey: 'idem-runtime-skill-acquisition-recovery-use' },
      });
      expect(accepted.statusCode).toBe(200);
      const body = accepted.json<{ sessionId: string; runId: string }>();
      await waitForRunTerminal(resumedApp, body.runId);

      expect(unavailableSkillHub.fetches).toEqual([]);
      expect(captured).toHaveLength(2);
      const firstModelInput = JSON.stringify(captured[0]?.messages);
      expect(firstModelInput).toContain('ran-qos-skill');
      expect(firstModelInput).not.toContain('RAN QoS acquisition body.');
      const secondModelInput = JSON.stringify(captured[1]?.messages);
      expect(secondModelInput).toContain('RAN QoS acquisition body.');
      expect(secondModelInput).not.toContain(workspaceDir);
      expect(secondModelInput).not.toContain('skillhub-managed');
      expect(secondModelInput).not.toContain('pkg:ran-qos-skill');
    } finally {
      await resumedApp.close();
    }
  }, 20_000);

  it('uses a runtime-generated Skill in a later model step without synchronizing SkillHub', async () => {
    const workspaceDir = await makeRoot();
    const captured: ModelInvocationRequest[] = [];
    const skillHub = emptySkillHub();
    const app = createNextAgentTestApp({
      workspaceDir,
      modelRequestSink: captured,
      skillHubAccessFactory: () => skillHub,
      agentDefinition: agentDefinitionWithoutSkillHubBindings(),
      modelSteps: [
        {
          toolCalls: [
            {
              toolCallId: 'tool-write-generated-skill',
              toolName: 'Write',
              arguments: {
                file_path: 'generated-skills/local-ran-planner/SKILL.md',
                content: [
                  '---',
                  'name: local-ran-planner',
                  'description: Plan local RAN diagnostics.',
                  'context: inline',
                  'user-invocable: true',
                  'model-invocable: true',
                  '---',
                  'Local RAN planner body.',
                ].join('\n'),
              },
            },
          ],
        },
        {
          toolCalls: [
            {
              toolCallId: 'tool-load-generated-skill',
              toolName: 'Skill',
              arguments: { name: 'local-ran-planner' },
            },
          ],
        },
        { content: 'Local generated Skill executed.' },
      ],
    });
    try {
      const accepted = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: { inputText: 'create and use a local ran planner skill', idempotencyKey: 'idem-runtime-generated-skill' },
      });
      expect(accepted.statusCode).toBe(200);
      const body = accepted.json<{ sessionId: string; requestId: string; runId: string }>();
      await waitForRunTerminal(app, body.runId);

      expect(captured).toHaveLength(3);
      expect(JSON.stringify(captured[0]?.messages)).not.toContain('local-ran-planner');
      expect(JSON.stringify(captured[1]?.messages)).toContain('local-ran-planner');
      expect(JSON.stringify(captured[2]?.messages)).toContain('Local RAN planner body.');
      expect(skillHub.searches).toEqual([]);
      expect(skillHub.fetches).toEqual([]);
      await expect(readFile(join(workspaceDir, 'skillhub-managed', 'remote-skill-content-index.json'), 'utf8')).rejects.toThrow();
    } finally {
      await app.close();
    }
  }, 15_000);
});

type SkillHubRemoteAccessPort =
  NonNullable<Parameters<typeof createNextAgentTestApp>[0]['skillHubAccessFactory']> extends (...args: never[]) => infer Port ? Port : never;

function agentDefinitionWithSkillHubAcquisition(): ReturnType<typeof loadBuiltInDefaultAgentDefinition> {
  const base = loadBuiltInDefaultAgentDefinition();
  return {
    ...base,
    capabilityBindings: [
      ...base.capabilityBindings,
      { capabilityId: brand<string, 'CapabilityId'>('ran-qos-skill'), capabilityType: 'SKILL', providerId: 'hub-local', enabled: true },
      { capabilityId: brand<string, 'CapabilityId'>('acquire_skill'), capabilityType: 'TOOL', providerId: 'hub-local', enabled: true },
    ],
  };
}

function agentDefinitionWithoutSkillHubBindings(): ReturnType<typeof loadBuiltInDefaultAgentDefinition> {
  const base = loadBuiltInDefaultAgentDefinition();
  return {
    ...base,
    capabilityBindings: base.capabilityBindings.filter((binding) => binding.providerId !== 'hub-local'),
  };
}

function acquisitionOnlySkillHub(): SkillHubRemoteAccessPort & { readonly searches: unknown[]; readonly fetches: unknown[] } {
  const searches: unknown[] = [];
  const fetches: unknown[] = [];
  return {
    searches,
    fetches,
    async listCandidates(input) {
      searches.push(input);
      if (input.requestedCapabilityId !== 'ran-qos-skill') {
        return { status: 'ok', candidates: [] };
      }
      return {
        status: 'ok',
        candidates: [
          {
            skillId: 'ran-qos-skill',
            contentRef: 'pkg:ran-qos-skill',
            contentHash: 'ran-qos-skill-hash',
            agentId,
            agentVersion,
            agentAssemblyRef: 'default-agent:v1',
          },
        ],
      };
    },
    async fetchContent(input) {
      fetches.push(input);
      const stagedFolder = join(input.stagingRoot, 'pkg_ran-qos-skill');
      await rm(stagedFolder, { recursive: true, force: true });
      await mkdir(stagedFolder, { recursive: true });
      await writeFile(
        join(stagedFolder, 'SKILL.md'),
        [
          '---',
          'name: ran-qos-skill',
          'description: Diagnose RAN QoS degradation.',
          'context: inline',
          'user-invocable: true',
          'model-invocable: true',
          '---',
          'RAN QoS acquisition body.',
        ].join('\n'),
        'utf8',
      );
      return { status: 'ok', stagingRoot: input.stagingRoot, stagedFolder, contentHash: 'ran-qos-skill-hash' };
    },
  };
}

function emptySkillHub(): SkillHubRemoteAccessPort & { readonly searches: unknown[]; readonly fetches: unknown[] } {
  const searches: unknown[] = [];
  const fetches: unknown[] = [];
  return {
    searches,
    fetches,
    async listCandidates(input) {
      searches.push(input);
      return { status: 'ok', candidates: [] };
    },
    async fetchContent(input) {
      fetches.push(input);
      return { status: 'failed', reasonCode: 'download-failed' };
    },
  };
}

function unavailableSkillHubForRecovery(): SkillHubRemoteAccessPort & { readonly searches: unknown[]; readonly fetches: unknown[] } {
  const searches: unknown[] = [];
  const fetches: unknown[] = [];
  return {
    searches,
    fetches,
    async listCandidates(input) {
      searches.push(input);
      return { status: 'failed', reasonCode: 'unavailable', message: 'remote unavailable' };
    },
    async fetchContent(input) {
      fetches.push(input);
      throw new Error('recovery must not fetch remote content');
    },
  };
}

async function makeRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'nextagent-runtime-skill-acquisition-'));
  tempDirectories.push(directory);
  return directory;
}

async function waitForRunTerminal(app: ReturnType<typeof createNextAgentTestApp>, runId: string, timeoutMs = 5_000): Promise<void> {
  await waitFor(async () => {
    const run = await app.gateway.requestRuns.loadRun({ tenantId, subjectId, agentId, runId: brand<string, 'RequestRunId'>(runId) });
    return run?.terminalCommitState === 'COMMITTED';
  }, timeoutMs);
}

async function listEvents(app: ReturnType<typeof createNextAgentTestApp>, sessionId: string, runId: string): Promise<readonly RunTimelineEvent[]> {
  const events = await app.gateway.timeline.listEvents({
    tenantId,
    subjectId,
    agentId,
    sessionId: brand<string, 'SessionId'>(sessionId),
    runId: brand<string, 'RequestRunId'>(runId),
    afterSequence: brand<number, 'TimelineSequence'>(0),
    limit: 200,
  });
  return events as unknown as readonly RunTimelineEvent[];
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  expect(await predicate()).toBe(true);
}
