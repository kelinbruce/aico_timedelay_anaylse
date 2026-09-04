import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aicoConfigStore, resetAICOConfigStoreForTesting } from './AICOConfigStore.ts';

describe('AICOConfigStore', () => {
  beforeEach(() => {
    resetAICOConfigStoreForTesting();
  });

  it('returns initial snapshot with null config', () => {
    const snapshot = aicoConfigStore.getSnapshot();
    expect(snapshot.config).toBeNull();
    expect(snapshot.panelType).toBe('CONVERSATION_PANEL');
    expect(snapshot.activePanelOperatorData).toBeNull();
    expect(snapshot.activeModalOperator).toBeNull();
  });

  it('setConfig stores config and resets panel state', () => {
    aicoConfigStore.setConfig({ name: 'Test' });
    const snapshot = aicoConfigStore.getSnapshot();
    expect(snapshot.config).toEqual({ name: 'Test' });
    expect(snapshot.panelType).toBe('CONVERSATION_PANEL');
  });

  it('setConfig replaces previous config fully (not merge)', () => {
    aicoConfigStore.setConfig({ name: 'A', welcome: 'W' });
    aicoConfigStore.setConfig({ name: 'B' });
    const snapshot = aicoConfigStore.getSnapshot();
    expect(snapshot.config).toEqual({ name: 'B' });
    expect((snapshot.config as Record<string, unknown>)?.welcome).toBeUndefined();
  });

  it('setConfig resets panelType to CONVERSATION_PANEL', () => {
    aicoConfigStore.setConfig({ name: 'A' });
    aicoConfigStore.setActivePanelOperator({ piuName: 'p', piuVersion: '1', renderFunc: 'r' });
    expect(aicoConfigStore.getSnapshot().panelType).toBe('CUSTOM_PANEL');
    aicoConfigStore.setConfig({ name: 'B' });
    expect(aicoConfigStore.getSnapshot().panelType).toBe('CONVERSATION_PANEL');
    expect(aicoConfigStore.getSnapshot().activePanelOperatorData).toBeNull();
  });

  it('clearConfig resets to initial state', () => {
    aicoConfigStore.setConfig({ name: 'A' });
    aicoConfigStore.clearConfig();
    expect(aicoConfigStore.getSnapshot().config).toBeNull();
  });

  it('setActivePanelOperator switches to CUSTOM_PANEL', () => {
    aicoConfigStore.setConfig({ name: 'A' });
    const data = { piuName: 'panel', piuVersion: '1', renderFunc: 'render' };
    aicoConfigStore.setActivePanelOperator(data);
    const snapshot = aicoConfigStore.getSnapshot();
    expect(snapshot.panelType).toBe('CUSTOM_PANEL');
    expect(snapshot.activePanelOperatorData).toEqual(data);
  });

  it('setActivePanelOperator(null) returns to CONVERSATION_PANEL', () => {
    aicoConfigStore.setConfig({ name: 'A' });
    aicoConfigStore.setActivePanelOperator({ piuName: 'p', piuVersion: '1', renderFunc: 'r' });
    aicoConfigStore.setActivePanelOperator(null);
    expect(aicoConfigStore.getSnapshot().panelType).toBe('CONVERSATION_PANEL');
    expect(aicoConfigStore.getSnapshot().activePanelOperatorData).toBeNull();
  });

  it('setActiveModalOperator sets modal operator', () => {
    aicoConfigStore.setConfig({ name: 'A' });
    const operator = {
      lightIcon: 'x',
      darkIcon: 'x',
      enName: 'M',
      zhName: '模态',
      position: 'OUTER' as const,
      type: 'MODAL' as const,
      data: { piuName: 'modal', piuVersion: '1', renderFunc: 'render' },
    };
    aicoConfigStore.setActiveModalOperator(operator);
    expect(aicoConfigStore.getSnapshot().activeModalOperator).toEqual(operator);
  });

  it('setActiveModalOperator replaces current modal (single modal)', () => {
    aicoConfigStore.setConfig({ name: 'A' });
    aicoConfigStore.setActiveModalOperator({
      lightIcon: 'x',
      darkIcon: 'x',
      enName: 'M1',
      zhName: '一',
      position: 'OUTER',
      type: 'MODAL',
      data: { piuName: 'm1', piuVersion: '1', renderFunc: 'r' },
    });
    aicoConfigStore.setActiveModalOperator({
      lightIcon: 'x',
      darkIcon: 'x',
      enName: 'M2',
      zhName: '二',
      position: 'OUTER',
      type: 'MODAL',
      data: { piuName: 'm2', piuVersion: '1', renderFunc: 'r' },
    });
    expect(aicoConfigStore.getSnapshot().activeModalOperator?.data.piuName).toBe('m2');
  });

  it('subscribe notifies listeners on state change', () => {
    const listener = vi.fn();
    const unsubscribe = aicoConfigStore.subscribe(listener);
    aicoConfigStore.setConfig({ name: 'A' });
    expect(listener).toHaveBeenCalledTimes(1);
    aicoConfigStore.setActiveModalOperator({
      lightIcon: 'x',
      darkIcon: 'x',
      enName: 'M',
      zhName: '模态',
      position: 'OUTER',
      type: 'MODAL',
      data: { piuName: 'm', piuVersion: '1', renderFunc: 'r' },
    });
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    aicoConfigStore.setConfig({ name: 'B' });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
