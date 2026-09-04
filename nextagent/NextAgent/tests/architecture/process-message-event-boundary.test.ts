import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('process message event architecture boundary', () => {
  it('keeps hidden process-message resolution server-only', () => {
    const webSource = readSourceTree(join(root, 'packages/agent-channel-web/src'));
    const webSchemas = readSourceTree(join(root, 'packages/agent-channel-web/src/schemas'));

    expect(webSource).toContain('resolveProcessMessages');
    expect(webSchemas).not.toContain('messageIds');
    expect(webSource).not.toMatch(/(?:get|post|route)\([^)]*process-message/iu);
  });

  it('keeps process event bodies message-backed and ref-only', () => {
    const policy = readFileSync(join(root, 'packages/agent-runtime/src/timeline/event-persistence-policy.ts'), 'utf8');
    const core = readSourceTree(join(root, 'packages/agent-core/src'));

    expect(policy).toContain('messageId');
    expect(policy).toContain('completed');
    expect(policy).toContain('hasRecoverableContent');
    expect(core).toContain('assistantToolUseMessageId');
    expect(core).toContain('capabilityResultMessageId');
  });

  it('does not add a Gateway process-message port, record or table', () => {
    const gatewayContracts = readSourceTree(join(root, 'packages/agent-contracts/src/gateway'));
    const gatewaySchema = readFileSync(join(root, 'packages/agent-platform-gateway-local/src/db/sqlite-gateway-core.ts'), 'utf8');

    expect(gatewayContracts).not.toMatch(/ProcessMessage(?:Store|Record|Gateway)/u);
    expect(gatewaySchema).not.toMatch(/CREATE TABLE IF NOT EXISTS process_messages/u);
    expect(gatewaySchema).toContain('idx_timeline_events_run_sequence');
  });

  it('keeps fork snapshots on the existing recursive remapper and rejects source ids', () => {
    const forkApplication = readFileSync(join(root, 'packages/agent-platform-gateway-local/src/db/sqlite-session-fork-application.ts'), 'utf8');

    expect(forkApplication).toContain('assertProcessMessageReference(event, idMaps)');
    expect(forkApplication).toContain('const result = visit(event.inlinePayload)');
    expect(forkApplication).toContain('SESSION_FORK_PROCESS_MESSAGE_REFERENCE_INVALID');
    expect(forkApplication).not.toContain('remapForkProcessMessagePayload');
  });
});

function readSourceTree(directory: string): string {
  const chunks: string[] = [];
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else if (entry.name.endsWith('.ts')) {
        chunks.push(readFileSync(path, 'utf8'));
      }
    }
  };
  visit(directory);
  return chunks.join('\n');
}
