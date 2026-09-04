import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const gatewaySource = readFileSync(new URL('../../packages/agent-contracts/src/gateway/index.ts', import.meta.url), 'utf8');
const channelSource = readFileSync(new URL('../../packages/agent-contracts/src/channel/index.ts', import.meta.url), 'utf8');
const memorySource = readFileSync(new URL('../../packages/agent-memory/src/long-term-memory-management.ts', import.meta.url), 'utf8');

describe('user query gateway boundary', () => {
  it('owns one top-level binding without a single-member or memory binding aggregate', () => {
    const topLevelBindings = slice(gatewaySource, 'export interface GatewayBindings', 'export interface GuardrailGatewayPort');
    const workingMemoryBindings = slice(
      gatewaySource,
      'export interface WorkingMemoryGatewayBindings',
      'export interface LongTermMemoryGatewayBindings',
    );
    const longTermMemoryBindings = slice(
      gatewaySource,
      'export interface LongTermMemoryGatewayBindings',
      'export interface SqliteGatewayStoreBindings',
    );

    expect(topLevelBindings).toContain('readonly userQuery?: UserQueryGateway;');
    expect(gatewaySource).not.toContain('interface UserGatewayBindings');
    expect(workingMemoryBindings).not.toContain('userQuery');
    expect(longTermMemoryBindings).not.toContain('userQuery');
  });

  it('keeps the channel DTO independent from gateway contracts and maps users in agent-memory', () => {
    expect(channelSource).toContain('readonly ownerUserName?: string;');
    expect(channelSource).not.toContain('@nextagent/agent-contracts/gateway');
    expect(memorySource).toContain('UserQueryGateway');
    expect(memorySource).toContain('targetSubjectIds');
  });
});

function slice(source: string, start: string, end: string): string {
  return source.slice(source.indexOf(start), source.indexOf(end));
}
