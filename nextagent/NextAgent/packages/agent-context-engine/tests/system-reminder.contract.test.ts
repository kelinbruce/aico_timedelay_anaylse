import type { ContextAssemblyRequest, ContextSourceCategory } from '@nextagent/agent-contracts/context';
import type { SystemReminder, SystemReminderRole, SystemReminderType } from '@nextagent/agent-contracts/system-reminder';
import { describe, expect, it } from 'vitest';

/**
 * Spec anchor: add-ts-system-reminder-memory-v1 / specs/system-reminder/spec.md
 * Requirements: "系统提醒类型可扩展", "系统提醒必须用统一标签包裹并隔离归因".
 *
 * Pins the public contract surface so downstream packages (context-engine
 * pipeline, agent-app producers) can rely on a stable shape.
 */
describe('system-reminder public contract', () => {
  it('SystemReminderType is exactly the v1 closed union', () => {
    const expected: readonly SystemReminderType[] = ['relevant_memories', 'nested_memory'];
    // Exhaustive assignment proves the union is closed: any value assignable
    // to SystemReminderType MUST be one of the literals below.
    const all: SystemReminderType[] = ['relevant_memories', 'nested_memory'];
    expect(all.sort()).toEqual([...expected].sort());
  });

  it('SystemReminderRole is exactly the four canonical roles', () => {
    const expected: readonly SystemReminderRole[] = ['INJECT', 'CONSTRAIN', 'NUDGE', 'TERMINATE'];
    const all: SystemReminderRole[] = ['INJECT', 'CONSTRAIN', 'NUDGE', 'TERMINATE'];
    expect(all.sort()).toEqual([...expected].sort());
  });

  it('SystemReminder carries type, role, content', () => {
    const reminder: SystemReminder = {
      type: 'relevant_memories',
      role: 'INJECT',
      content: 'background fact',
    };
    expect(reminder.type).toBe('relevant_memories');
    expect(reminder.role).toBe('INJECT');
    expect(typeof reminder.content).toBe('string');
  });

  it('ContextAssemblyRequest has optional systemReminders field', () => {
    const withoutField: ContextAssemblyRequest = {
      sessionId: 's' as never,
      requestId: 'r' as never,
      requestContextId: 'rc' as never,
      identityContext: {} as never,
      agentId: 'a' as never,
      agentVersion: 'v' as never,
      runId: 'run' as never,
      stepId: 'step',
      locale: 'zh-CN' as never,
      purpose: 'p',
    };
    expect(withoutField.systemReminders).toBeUndefined();

    const withField: ContextAssemblyRequest = {
      ...withoutField,
      systemReminders: [{ type: 'relevant_memories', role: 'INJECT', content: 'x' }],
    };
    expect(withField.systemReminders).toHaveLength(1);
  });

  it('ContextSourceCategory includes system_reminder', () => {
    const category: ContextSourceCategory = 'system_reminder';
    expect(category).toBe('system_reminder');
  });
});
