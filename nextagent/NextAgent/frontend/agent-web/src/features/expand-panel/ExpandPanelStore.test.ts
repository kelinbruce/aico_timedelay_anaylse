import { describe, it, expect, beforeEach, vi } from 'vitest';
import { expandPanelStore } from './ExpandPanelStore.ts';

describe('ExpandPanelStore', () => {
  beforeEach(() => {
    expandPanelStore.getState().registerDslClearHandler(null);
    expandPanelStore.getState().close();
  });

  it('open() sets isOpen to true without modifying content', () => {
    expandPanelStore.getState().open();
    expect(expandPanelStore.getState().isOpen).toBe(true);
    expect(expandPanelStore.getState().content).toBeNull();
    expect(expandPanelStore.getState().contentSource).toBeNull();
  });

  it('openDsl() sets isOpen to true and contentSource to dsl', () => {
    expandPanelStore.getState().openDsl();
    expect(expandPanelStore.getState().isOpen).toBe(true);
    expect(expandPanelStore.getState().contentSource).toBe('dsl');
    expect(expandPanelStore.getState().content).toBeNull();
  });

  it('close() clears content and sourceKey', () => {
    expandPanelStore.getState().setContent({ toolMessageType: 'TEXT', content: 'test' }, 'live-stream');
    expandPanelStore.getState().open();
    expandPanelStore.getState().close();
    expect(expandPanelStore.getState().isOpen).toBe(false);
    expect(expandPanelStore.getState().content).toBeNull();
    expect(expandPanelStore.getState().sourceKey).toBeNull();
    expect(expandPanelStore.getState().contentSource).toBeNull();
  });

  it('closeDsl() clears contentSource without triggering dsl clear handler', () => {
    const handler = vi.fn();
    expandPanelStore.getState().registerDslClearHandler(handler);
    expandPanelStore.getState().openDsl();
    expandPanelStore.getState().closeDsl();
    expect(expandPanelStore.getState().isOpen).toBe(false);
    expect(expandPanelStore.getState().contentSource).toBeNull();
    expect(handler).not.toHaveBeenCalled();
  });

  it('close() triggers dsl clear handler when source is dsl', () => {
    const handler = vi.fn();
    expandPanelStore.getState().registerDslClearHandler(handler);
    expandPanelStore.getState().openDsl();
    expandPanelStore.getState().close();
    expect(expandPanelStore.getState().isOpen).toBe(false);
    expect(expandPanelStore.getState().contentSource).toBeNull();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('setContent() triggers dsl clear handler when source is dsl', () => {
    const handler = vi.fn();
    expandPanelStore.getState().registerDslClearHandler(handler);
    expandPanelStore.getState().openDsl();
    expandPanelStore.getState().setContent({ toolMessageType: 'TEXT', content: 'test' }, 'test');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(expandPanelStore.getState().contentSource).toBe('react');
  });

  it('setView() triggers dsl clear handler when source is dsl', () => {
    const handler = vi.fn();
    expandPanelStore.getState().registerDslClearHandler(handler);
    expandPanelStore.getState().openDsl();
    expandPanelStore.getState().setView('view');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(expandPanelStore.getState().contentSource).toBe('view');
  });

  it('setContent() uses last-write-wins', () => {
    expandPanelStore.getState().setContent({ toolMessageType: 'TEXT', content: 'first' }, 'source-1');
    expandPanelStore.getState().setContent({ toolMessageType: 'PIU', content: 'second' }, 'source-2');
    const state = expandPanelStore.getState();
    expect(state.content?.content).toBe('second');
    expect(state.content?.toolMessageType).toBe('PIU');
    expect(state.sourceKey).toBe('source-2');
    expect(state.contentSource).toBe('react');
  });

  it('does not depend on AICOConfigStore', () => {
    const state = expandPanelStore.getState();
    expect(state).not.toHaveProperty('aicoConfig');
    expect(state).not.toHaveProperty('layoutConfig');
  });
});
