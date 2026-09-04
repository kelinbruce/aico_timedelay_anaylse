import { describe, it, expect } from 'vitest';
import { TOOL_EVENT_TYPES, type ToolEventType } from '../src/index.js';

describe('ToolEventType contract', () => {
  it('TOOL_EVENT_TYPES includes EXPAND_PANEL', () => {
    expect(TOOL_EVENT_TYPES).toContain('EXPAND_PANEL');
  });

  it('EXPAND_PANEL is assignable to ToolEventType', () => {
    const value: ToolEventType = 'EXPAND_PANEL';
    expect(value).toBe('EXPAND_PANEL');
  });
});
