import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function readAllSource(dir: string): string {
  const chunks: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.name.endsWith('.ts')) {
        chunks.push(readFileSync(path, 'utf8'));
      }
    }
  };
  walk(dir);
  return chunks.join('\n');
}

describe('session fork architecture boundaries', () => {
  it('keeps Web fork route out of gateway fork records', () => {
    const webSource = readAllSource(join(root, 'packages/agent-channel-web/src'));
    expect(webSource).not.toMatch(/SessionForkSourceRecord|ForkPromotedContentRecord|ForkSessionFromMessageWriteRequest/u);
    expect(webSource).not.toMatch(/@nextagent\/agent-contracts\/gateway/u);
  });

  it('keeps runtime independent from context-engine and channel implementations', () => {
    const runtimeSource = readAllSource(join(root, 'packages/agent-runtime/src'));
    expect(runtimeSource).not.toMatch(/@nextagent\/agent-context-engine/u);
    expect(runtimeSource).not.toMatch(/@nextagent\/agent-channel-web/u);
  });

  it('keeps fork active context selection inside the local provider application without importing the context contract', () => {
    const runtimeSubmit = readFileSync(join(root, 'packages/agent-runtime/src/lifecycle/submit.ts'), 'utf8');
    const localApplication = readFileSync(join(root, 'packages/agent-platform-gateway-local/src/db/sqlite-session-fork-application.ts'), 'utf8');
    expect(runtimeSubmit).not.toContain('ForkActiveContextSelectionPort');
    expect(localApplication).toContain('LocalForkActiveContextSelector');
    expect(localApplication).not.toContain('@nextagent/agent-contracts/context');
  });

  it('keeps gateway-local independent from runtime/session/context-engine implementations', () => {
    const gatewaySource = readAllSource(join(root, 'packages/agent-platform-gateway-local/src'));
    expect(gatewaySource).not.toMatch(/@nextagent\/agent-runtime/u);
    expect(gatewaySource).not.toMatch(/@nextagent\/agent-session/u);
    expect(gatewaySource).not.toMatch(/@nextagent\/agent-context-engine/u);
  });

  it('does not implement session fork through subagent execution, task tools or async detach', () => {
    const runtimeSubmit = readFileSync(join(root, 'packages/agent-runtime/src/lifecycle/submit.ts'), 'utf8');
    const forkMethod = runtimeSubmit.slice(runtimeSubmit.indexOf('async forkFromMessage'), runtimeSubmit.indexOf('async listMessages'));
    expect(forkMethod).toContain('prepareFork');
    expect(forkMethod).toContain('stageForkPromotion');
    expect(forkMethod).toContain('forkSession');
    expect(forkMethod).not.toMatch(/listSessionMessagePrefixThroughAnchor|loadForkedSessionByIdempotency|forkSessionFromMessage/u);
    expect(forkMethod).not.toMatch(/executeSubagent|Subagent|Task|detach|setTimeout|queueMicrotask/u);
  });

  it('registers fork promotion cleanup through scheduled maintenance only', () => {
    const gatewayComposition = readFileSync(join(root, 'packages/agent-app/src/composition/gateway-composition.ts'), 'utf8');
    const cleanupJob = readFileSync(join(root, 'packages/agent-runtime/src/lifecycle/fork-promotion-cleanup-job.ts'), 'utf8');
    expect(gatewayComposition).toContain('scheduledMaintenance.register(createForkPromotionCleanupJob({ sessionForkStore: gateway.sessionForks }))');
    expect(cleanupJob).toContain("jobId: 'agent-runtime.fork-promotion-cleanup'");
    expect(cleanupJob).toContain("overlapPolicy: 'SKIP'");
    expect(cleanupJob).toContain('cleanupExpiredForkPromotions');
    expect(cleanupJob).not.toMatch(/forkSessionFromMessage|abortForkPromotions/u);
  });
});
