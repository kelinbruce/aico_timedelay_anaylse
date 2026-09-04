import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const gatewaySource = readFileSync(join(process.cwd(), 'packages', 'agent-contracts', 'src', 'gateway', 'index.ts'), 'utf8');

const runtimeSource = readFileSync(join(process.cwd(), 'packages', 'agent-contracts', 'src', 'runtime', 'index.ts'), 'utf8');

const serviceSource = readFileSync(join(process.cwd(), 'packages', 'agent-session', 'src', 'services', 'frequent-question-service.ts'), 'utf8');

function slice(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  expect(startIndex, start).toBeGreaterThanOrEqual(0);
  expect(endIndex, end).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe('question pin migration boundary', () => {
  it('removes pinQuestion and listPinned from UserQuestionActivityStoreGateway', () => {
    const storeGateway = slice(gatewaySource, 'export interface UserQuestionActivityStoreGateway', 'export interface LongTermMemoryStoreGateway');
    expect(storeGateway).not.toMatch(/\bpinQuestion\b/u);
    expect(storeGateway).not.toMatch(/\blistPinned\b/u);
  });

  it('removes PinQuestionCommand from runtime contract', () => {
    expect(runtimeSource).not.toMatch(/\bPinQuestionCommand\b/u);
  });

  it('removes pinQuestion from FrequentQuestionPort', () => {
    const frequentPort = slice(runtimeSource, 'export interface FrequentQuestionPort', 'export interface QuestionAssociationQuery');
    expect(frequentPort).not.toMatch(/\bpinQuestion\b/u);
  });

  it('keeps QuestionAssociationSource with all four labels', () => {
    const sourceType = slice(runtimeSource, 'export type QuestionAssociationSource', 'export interface QuestionAssociationEntryDto');
    expect(sourceType).toContain("'pinned'");
    expect(sourceType).toContain("'high-frequency'");
    expect(sourceType).toContain("'recommended'");
    expect(sourceType).toContain("'static'");
  });

  it('binds QuestionRecommendationGateway only in WorkingMemoryGatewayBindings', () => {
    const gatewayBindings = slice(gatewaySource, 'export interface GatewayBindings', 'export interface GuardrailGatewayPort');
    const workingMemoryBindings = slice(
      gatewaySource,
      'export interface WorkingMemoryGatewayBindings',
      'export interface LongTermMemoryGatewayBindings',
    );
    expect(gatewayBindings).not.toContain('questionRecommendations');
    expect(workingMemoryBindings).toContain('readonly questionRecommendations?: QuestionRecommendationGateway');
  });

  it('does not let frequent-question-service directly depend on local or remote gateway packages', () => {
    expect(serviceSource).not.toMatch(/agent-platform-gateway-local/u);
    expect(serviceSource).not.toMatch(/agent-platform-gateway-remote/u);
  });

  it('adds listQuestionFavoriteTurns to ConversationAnnotationStoreGateway', () => {
    const annotationStore = slice(gatewaySource, 'export interface ConversationAnnotationStoreGateway', 'export interface ConversationShareRecord');
    expect(annotationStore).toContain('listQuestionFavoriteTurns');
  });

  it('adds isQuestionFavorited to ConversationAnnotationView and RuntimeUpsertAnnotationCommand', () => {
    const view = slice(runtimeSource, 'export interface ConversationAnnotationView', 'export interface ConversationFavoriteTurnEntry');
    expect(view).toContain('isQuestionFavorited');

    const command = slice(runtimeSource, 'export interface RuntimeUpsertAnnotationCommand', 'export interface RuntimeListFavoriteTurnsQuery');
    expect(command).toContain('isQuestionFavorited');
  });
});
