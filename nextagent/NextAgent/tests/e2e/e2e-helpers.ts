import { createNextAgentTestApp, type ReleaseCheckResult, type ReleaseCheckStatus } from '@nextagent/agent-platform-gateway-local/testing';
import type { NextAgentApp } from '@nextagent/agent-app';
import type { DeterministicModelStep } from '@nextagent/agent-model/testing';
import type { IdentityContext } from '@nextagent/agent-common';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function reserveFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address !== 'object' || address === null) {
        server.close(() => reject(new Error('Unable to reserve a TCP port.')));
        return;
      }
      const port = address.port;
      server.close((error) => (error === undefined ? resolve(port) : reject(error)));
    });
  });
}

export interface E2ETestContext {
  readonly app: NextAgentApp;
  readonly baseUrl: string;
  readonly workspaceDir: string;
}

export interface CreateE2ETestContextOptions {
  readonly modelSteps: readonly DeterministicModelStep[];
  readonly agentDefinition?: Parameters<typeof createNextAgentTestApp>[0]['agentDefinition'];
  readonly tempPrefix?: string;
  readonly identity?: IdentityContext;
  readonly localAuthEnabled?: boolean;
  readonly prepareWorkspace?: (workspaceDir: string) => Promise<void>;
  readonly modelRequestSink?: Parameters<typeof createNextAgentTestApp>[0]['modelRequestSink'];
  readonly modelProfiles?: Parameters<typeof createNextAgentTestApp>[0]['modelProfiles'];
  readonly toolDisclosureMode?: Parameters<typeof createNextAgentTestApp>[0]['toolDisclosureMode'];
  readonly skillDisclosureMode?: Parameters<typeof createNextAgentTestApp>[0]['skillDisclosureMode'];
  readonly clipcDisclosureMode?: Parameters<typeof createNextAgentTestApp>[0]['clipcDisclosureMode'];
  readonly capabilityProviders?: Parameters<typeof createNextAgentTestApp>[0]['capabilityProviders'];
  readonly clipCommandRunner?: Parameters<typeof createNextAgentTestApp>[0]['clipCommandRunner'];
  readonly cronTaskGatewayFactory?: Parameters<typeof createNextAgentTestApp>[0]['cronTaskGatewayFactory'];
  readonly cronTaskIdFactory?: Parameters<typeof createNextAgentTestApp>[0]['cronTaskIdFactory'];
  readonly skillFixtures?: readonly string[];
}

export async function createE2ETestContext(options: CreateE2ETestContextOptions): Promise<E2ETestContext> {
  const workspaceDir = await mkdtemp(join(tmpdir(), options.tempPrefix ?? 'nextagent-e2e-'));
  await options.prepareWorkspace?.(workspaceDir);
  await copySkillFixturesToWorkspace(workspaceDir, options.skillFixtures ?? []);
  const port = await reserveFreePort();
  const appOpts: Record<string, unknown> = {
    workspaceDir,
    channelPort: port,
    modelSteps: options.modelSteps,
  };
  if (options.agentDefinition !== undefined) {
    appOpts.agentDefinition = options.agentDefinition;
  }
  if (options.identity !== undefined) {
    appOpts.identity = options.identity;
  }
  if (options.localAuthEnabled === true) {
    appOpts.localAuthEnabled = true;
  }
  if (options.modelRequestSink !== undefined) {
    appOpts.modelRequestSink = options.modelRequestSink;
  }
  if (options.modelProfiles !== undefined) {
    appOpts.modelProfiles = options.modelProfiles;
  }
  if (options.toolDisclosureMode !== undefined) {
    appOpts.toolDisclosureMode = options.toolDisclosureMode;
  }
  if (options.skillDisclosureMode !== undefined) {
    appOpts.skillDisclosureMode = options.skillDisclosureMode;
  }
  if (options.clipcDisclosureMode !== undefined) {
    appOpts.clipcDisclosureMode = options.clipcDisclosureMode;
  }
  if (options.capabilityProviders !== undefined) {
    appOpts.capabilityProviders = options.capabilityProviders;
  }
  if (options.clipCommandRunner !== undefined) {
    appOpts.clipCommandRunner = options.clipCommandRunner;
  }
  if (options.cronTaskGatewayFactory !== undefined) {
    appOpts.cronTaskGatewayFactory = options.cronTaskGatewayFactory;
  }
  if (options.cronTaskIdFactory !== undefined) {
    appOpts.cronTaskIdFactory = options.cronTaskIdFactory;
  }
  const app = createNextAgentTestApp(appOpts as unknown as Parameters<typeof createNextAgentTestApp>[0]);
  await app.start();
  return { app, baseUrl: `http://127.0.0.1:${port}`, workspaceDir };
}

export async function cleanupE2ETestContext(ctx: E2ETestContext): Promise<void> {
  await ctx.app.close();
  await rm(ctx.workspaceDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}

export async function copySkillFixturesToWorkspace(workspaceDir: string, skillFixtures: readonly string[]): Promise<void> {
  if (skillFixtures.length === 0) {
    return;
  }
  const skillsRoot = join(workspaceDir, 'skills');
  const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'skills');
  await mkdir(skillsRoot, { recursive: true });
  for (const skillName of skillFixtures) {
    await cp(join(fixtureRoot, skillName), join(skillsRoot, skillName), { recursive: true });
  }
}

export { type ReleaseCheckResult, type ReleaseCheckStatus };
