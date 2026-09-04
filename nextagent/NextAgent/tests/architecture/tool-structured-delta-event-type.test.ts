import { describe, expect, it } from 'vitest';
import { TOOL_EVENT_TYPES, type TimelineEventType, type ToolEventType } from '@nextagent/agent-common';
import type { StreamEventType } from '@nextagent/agent-contracts/channel';

describe('TOOL_STRUCTURED_DELTA event type boundary', () => {
  it('includes TOOL_STRUCTURED_DELTA in TimelineEventType', () => {
    const type: TimelineEventType = 'TOOL_STRUCTURED_DELTA';
    expect(type).toBe('TOOL_STRUCTURED_DELTA');
  });

  it('includes TOOL_STRUCTURED_DELTA in StreamEventType', () => {
    const type: StreamEventType = 'TOOL_STRUCTURED_DELTA';
    expect(type).toBe('TOOL_STRUCTURED_DELTA');
  });

  it('includes EXPAND_PANEL in ToolEventType', () => {
    const type: ToolEventType = 'EXPAND_PANEL';
    expect(type).toBe('EXPAND_PANEL');
    expect(TOOL_EVENT_TYPES).toContain('EXPAND_PANEL');
  });
});
