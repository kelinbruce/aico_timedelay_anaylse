import { createNextAgentTestApp, type ReleaseCheckResult, type ReleaseCheckStatus } from '@nextagent/agent-platform-gateway-local/testing';
import type { NextAgentApp } from '@nextagent/agent-app';
import type { DeterministicModelStep } from '@nextagent/agent-model/testing';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll } from 'vitest';

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

export interface ProductJourneyTestContext {
  readonly app: NextAgentApp;
  readonly baseUrl: string;
  readonly workspaceDir: string;
}

export async function createProductJourneyTestContext(
  modelSteps: readonly DeterministicModelStep[],
  opts?: { readonly localAuthEnabled?: boolean },
): Promise<ProductJourneyTestContext> {
  const workspaceDir = await mkdtemp(join(tmpdir(), 'nextagent-pj-'));
  const port = await reserveFreePort();
  const app = createNextAgentTestApp({
    workspaceDir,
    channelPort: port,
    modelSteps,
    ...(opts?.localAuthEnabled === undefined ? {} : { localAuthEnabled: opts.localAuthEnabled }),
  });
  await app.start();
  return { app, baseUrl: `http://127.0.0.1:${port}`, workspaceDir };
}

export async function cleanupProductJourneyTestContext(ctx: ProductJourneyTestContext): Promise<void> {
  await ctx.app.close();
  await rm(ctx.workspaceDir, { recursive: true, force: true });
}

export function setupProductJourneyTest(): {
  ctx: () => ProductJourneyTestContext;
  createCtx: (modelSteps: readonly DeterministicModelStep[], opts?: { readonly localAuthEnabled?: boolean }) => Promise<ProductJourneyTestContext>;
} {
  let currentCtx: ProductJourneyTestContext | undefined;

  afterAll(async () => {
    if (currentCtx !== undefined) {
      await cleanupProductJourneyTestContext(currentCtx);
    }
  });

  return {
    ctx: () => {
      if (currentCtx === undefined) {
        throw new Error('Test context not created. Call createCtx first.');
      }
      return currentCtx;
    },
    createCtx: async (modelSteps, createOpts) => {
      if (currentCtx !== undefined) {
        await cleanupProductJourneyTestContext(currentCtx);
      }
      currentCtx = await createProductJourneyTestContext(modelSteps, createOpts);
      return currentCtx;
    },
  };
}

export { type ReleaseCheckResult, type ReleaseCheckStatus };
