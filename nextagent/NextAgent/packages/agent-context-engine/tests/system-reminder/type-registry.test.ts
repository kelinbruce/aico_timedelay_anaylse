import { describe, expect, it } from 'vitest';
import type { SystemReminderRole, SystemReminderType } from '@nextagent/agent-contracts/system-reminder';
import { SYSTEM_REMINDER_ROLE_REGISTRY, resolveSystemReminderRole } from '../../src/system-reminder/type-registry.js';

describe('SYSTEM_REMINDER_ROLE_REGISTRY', () => {
  it('registers exactly the v1 type literals', () => {
    expect(Object.keys(SYSTEM_REMINDER_ROLE_REGISTRY).sort()).toEqual(['nested_memory', 'relevant_memories']);
  });

  it('every registered role is one of the four canonical roles', () => {
    const allowed: readonly SystemReminderRole[] = ['INJECT', 'CONSTRAIN', 'NUDGE', 'TERMINATE'];
    for (const role of Object.values(SYSTEM_REMINDER_ROLE_REGISTRY)) {
      expect((allowed as readonly string[]).includes(role)).toBe(true);
    }
  });

  it('relevant_memories is INJECT', () => {
    expect(SYSTEM_REMINDER_ROLE_REGISTRY.relevant_memories).toBe('INJECT');
  });
});

describe('resolveSystemReminderRole', () => {
  it('returns the registered role', () => {
    expect(resolveSystemReminderRole('relevant_memories')).toBe('INJECT');
    expect(resolveSystemReminderRole('nested_memory')).toBe('INJECT');
  });

  it('is exhaustive over SystemReminderType (compile-time guarantee)', () => {
    const types: SystemReminderType[] = ['relevant_memories', 'nested_memory'];
    for (const type of types) {
      expect(() => resolveSystemReminderRole(type)).not.toThrow();
    }
  });
});
