import { beforeEach, describe, expect, it } from 'vitest';
import { validateAICOConfig } from './validateAICOConfig.ts';
import { aicoConfigStore, resetAICOConfigStoreForTesting } from './AICOConfigStore.ts';

describe('Regression: no config vs empty config', () => {
  beforeEach(() => {
    resetAICOConfigStoreForTesting();
  });

  it('validateAICOConfig({}) returns an empty config object', () => {
    const result = validateAICOConfig({});
    expect(result).toEqual({});
  });

  it('validateAICOConfig(null) returns null', () => {
    const result = validateAICOConfig(null);
    expect(result).toBeNull();
  });

  it('empty config and null config produce the same store state', () => {
    // With null config
    const nullSnapshot = aicoConfigStore.getSnapshot();
    expect(nullSnapshot.config).toBeNull();

    // With empty config
    aicoConfigStore.setConfig({});
    const emptySnapshot = aicoConfigStore.getSnapshot();
    expect(emptySnapshot.config).toEqual({});

    // Both should have panelType CONVERSATION_PANEL
    expect(nullSnapshot.panelType).toBe('CONVERSATION_PANEL');
    expect(emptySnapshot.panelType).toBe('CONVERSATION_PANEL');

    // Both should have no active panel/modal operators
    expect(nullSnapshot.activePanelOperatorData).toBeNull();
    expect(emptySnapshot.activePanelOperatorData).toBeNull();
    expect(nullSnapshot.activeModalOperator).toBeNull();
    expect(emptySnapshot.activeModalOperator).toBeNull();
  });

  it('operators field defaults to absent (undefined) when not provided', () => {
    const result = validateAICOConfig({ name: 'Test' });
    expect(result?.operators).toBeUndefined();
  });

  it('empty operators array is treated as absent', () => {
    const result = validateAICOConfig({ operators: [] });
    expect(result?.operators).toBeUndefined();
  });

  it('showThinkingChain defaults to absent (true)', () => {
    const result = validateAICOConfig({});
    expect(result?.showThinkingChain).toBeUndefined();
  });

  it('showAskTime defaults to absent (false)', () => {
    const result = validateAICOConfig({});
    expect(result?.showAskTime).toBeUndefined();
  });

  it('clearStorage defaults to absent (false)', () => {
    const result = validateAICOConfig({});
    expect(result?.clearStorage).toBeUndefined();
  });

  it('declaration defaults to absent (true)', () => {
    const result = validateAICOConfig({});
    expect(result?.declaration).toBeUndefined();
  });
});

describe('Regression: extractAnswerText', () => {
  it('returns empty string for no segments', () => {
    const { extractAnswerText } = require('./extractAnswerText.ts') as typeof import('./extractAnswerText.ts');
    expect(extractAnswerText([])).toBe('');
  });

  it('extracts text from text segments', () => {
    const { extractAnswerText } = require('./extractAnswerText.ts') as typeof import('./extractAnswerText.ts');
    const segments = [
      { kind: 'text' as const, content: 'Hello ', sequence: 1 },
      { kind: 'text' as const, content: 'World', sequence: 2 },
    ];
    expect(extractAnswerText(segments)).toBe('Hello World');
  });

  it('includes TEXT structured segments', () => {
    const { extractAnswerText } = require('./extractAnswerText.ts') as typeof import('./extractAnswerText.ts');
    const segments = [
      { kind: 'text' as const, content: 'Hello ', sequence: 1 },
      { kind: 'structured' as const, toolMessageType: 'TEXT' as const, content: 'World', sequence: 2 },
    ];
    expect(extractAnswerText(segments)).toBe('Hello World');
  });

  it('excludes PIU, DSL, FILE, ACTION, OPERATOR segments', () => {
    const { extractAnswerText } = require('./extractAnswerText.ts') as typeof import('./extractAnswerText.ts');
    const segments = [
      { kind: 'text' as const, content: 'Hello', sequence: 1 },
      { kind: 'structured' as const, toolMessageType: 'PIU' as const, content: 'piu-data', sequence: 2 },
      { kind: 'structured' as const, toolMessageType: 'DSL' as const, content: 'dsl-data', sequence: 3 },
      { kind: 'structured' as const, toolMessageType: 'FILE' as const, content: 'file-data', sequence: 4 },
      { kind: 'structured' as const, toolMessageType: 'ACTION' as const, content: 'action-data', sequence: 5 },
      { kind: 'structured' as const, toolMessageType: 'OPERATOR' as const, content: 'operator-data', sequence: 6 },
    ];
    expect(extractAnswerText(segments)).toBe('Hello');
  });
});
