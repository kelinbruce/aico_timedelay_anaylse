import { describe, expect, it } from 'vitest';
import { ShortcutRegistry, keyboardEventToCombo, normalizeCombo, shortcutRegistry } from '../src/shortcuts/shortcutRegistry.ts';

describe('shortcutRegistry', () => {
  it('normalizes Ctrl and Cmd combos to Mod', () => {
    expect(normalizeCombo('Ctrl+K')).toBe('Mod+K');
    expect(normalizeCombo('Cmd+K')).toBe('Mod+K');
  });

  it('rejects reserved browser shortcuts', () => {
    expect(
      () =>
        new ShortcutRegistry([
          {
            actionId: 'focus-composer',
            combo: 'Mod+R',
            scope: 'global',
            owner: 'sidebar',
            description: 'reserved',
          },
        ]),
    ).toThrow(/Reserved browser shortcut/);
  });

  it('rejects same-scope shortcut conflicts', () => {
    expect(
      () =>
        new ShortcutRegistry([
          {
            actionId: 'focus-composer',
            combo: 'Mod+K',
            scope: 'global',
            owner: 'sidebar',
            description: 'one',
          },
          {
            actionId: 'open-help',
            combo: 'Ctrl+K',
            scope: 'global',
            owner: 'chat-page',
            description: 'two',
          },
        ]),
    ).toThrow(/Shortcut conflict detected/);
  });

  it('resolves registered combos within the requested scope', () => {
    const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true });
    expect(keyboardEventToCombo(event)).toBe('Mod+K');

    const resolved = shortcutRegistry.resolve(event, { scope: 'global' });
    expect(resolved?.actionId).toBe('focus-composer');
  });
});
