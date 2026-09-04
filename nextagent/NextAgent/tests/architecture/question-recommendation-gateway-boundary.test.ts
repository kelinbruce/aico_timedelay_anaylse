import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'packages', 'agent-contracts', 'src', 'gateway', 'index.ts'), 'utf8');

function contractSlice(start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  expect(startIndex, start).toBeGreaterThanOrEqual(0);
  expect(endIndex, end).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe('question recommendation gateway boundary', () => {
  it('binds question recommendation only below Working Memory', () => {
    const gatewayBindings = contractSlice('export interface GatewayBindings', 'export interface GuardrailGatewayPort');
    const workingMemoryBindings = contractSlice('export interface WorkingMemoryGatewayBindings', 'export interface LongTermMemoryGatewayBindings');

    expect(gatewayBindings).not.toContain('questionRecommendations');
    expect(workingMemoryBindings).toContain('readonly questionRecommendations?: QuestionRecommendationGateway;');
  });

  it('does not create a recommendation adapter kind or SQLite binding', () => {
    const adapterKinds = contractSlice('export type GatewayAdapterKind', 'export type GatewayBindingReadinessState');
    const sqliteBindings = contractSlice('export interface SqliteGatewayStoreBindings', 'export type AuditAttributeValue');

    expect(adapterKinds).not.toMatch(/recommend/iu);
    expect(sqliteBindings).not.toMatch(/recommend/iu);
  });

  it('keeps provider wire fields out of the public recommendation contract', () => {
    const recommendationContract = contractSlice(
      'export interface ListFrequentHistoryQuestionsRequest',
      'export interface WorkingMemoryGatewayBindings',
    );

    for (const providerField of ['userId', 'portraitType', 'topn', 'errorCode', 'errorMsg', 'agentName']) {
      expect(recommendationContract, providerField).not.toMatch(new RegExp(`\\b${providerField}\\b`, 'u'));
    }
  });
});
