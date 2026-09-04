export type ShortcutScope = 'global' | 'composer' | 'session-list';
export type ShortcutOwner = 'sidebar' | 'composer' | 'sessions' | 'chat-page';

export type ShortcutActionId =
  'focus-composer' | 'open-help' | 'composer-enter' | 'composer-escape' | 'session-prev' | 'session-next' | 'session-open';

export interface ShortcutDescriptor {
  readonly actionId: ShortcutActionId;
  readonly combo: string;
  readonly scope: ShortcutScope;
  readonly owner: ShortcutOwner;
  readonly description?: string;
  readonly descriptionKey?: string;
  readonly showInHelp?: boolean;
}

export interface ShortcutResolveContext {
  readonly scope: ShortcutScope;
}

const RESERVED_BROWSER_COMBOS = new Set<string>(['Mod+E', 'Mod+L', 'Mod+R', 'Mod+S', 'Mod+T', 'Mod+W', 'F5']);

function normalizeKey(key: string): string {
  if (key.length === 1) {
    return key.toUpperCase();
  }
  return key;
}

export function normalizeCombo(input: string): string {
  return input
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (part === 'Ctrl' || part === 'Cmd') {
        return 'Mod';
      }
      if (part === 'Option') {
        return 'Alt';
      }
      return normalizeKey(part);
    })
    .sort((left, right) => {
      const modifierOrder = ['Mod', 'Alt', 'Shift'];
      const leftIndex = modifierOrder.indexOf(left);
      const rightIndex = modifierOrder.indexOf(right);
      if (leftIndex >= 0 || rightIndex >= 0) {
        return (leftIndex >= 0 ? leftIndex : 999) - (rightIndex >= 0 ? rightIndex : 999);
      }
      return left.localeCompare(right);
    })
    .join('+');
}

export function keyboardEventToCombo(event: KeyboardEvent): string {
  const isMac = typeof navigator !== 'undefined' && /mac|iphone|ipad|ipod/i.test(`${navigator.platform} ${navigator.userAgent}`);

  const parts: string[] = [];
  if (isMac ? event.metaKey : event.ctrlKey) {
    parts.push('Mod');
  }
  if (event.altKey) {
    parts.push('Alt');
  }
  if (event.shiftKey) {
    parts.push('Shift');
  }
  parts.push(normalizeKey(event.key));
  return normalizeCombo(parts.join('+'));
}

export function formatShortcutCombo(combo: string): string {
  const isMac = typeof navigator !== 'undefined' && /mac|iphone|ipad|ipod/i.test(`${navigator.platform} ${navigator.userAgent}`);

  return combo
    .split('+')
    .map((part) => {
      if (part === 'Mod') {
        return isMac ? '⌘' : 'Ctrl';
      }
      if (part === 'Alt') {
        return isMac ? '⌥' : 'Alt';
      }
      if (part === 'Shift') {
        return isMac ? '⇧' : 'Shift';
      }
      return part;
    })
    .join(isMac ? '' : '+');
}

export class ShortcutRegistry {
  private readonly descriptors: readonly ShortcutDescriptor[];

  constructor(descriptors: readonly ShortcutDescriptor[]) {
    const seen = new Set<string>();
    for (const descriptor of descriptors) {
      const normalizedCombo = normalizeCombo(descriptor.combo);
      if (RESERVED_BROWSER_COMBOS.has(normalizedCombo)) {
        throw new Error(`Reserved browser shortcut is not allowed: ${normalizedCombo}`);
      }

      const conflictKey = `${descriptor.scope}:${normalizedCombo}`;
      if (seen.has(conflictKey)) {
        throw new Error(`Shortcut conflict detected for ${conflictKey}`);
      }
      seen.add(conflictKey);
    }

    this.descriptors = descriptors.map((descriptor) => ({
      ...descriptor,
      combo: normalizeCombo(descriptor.combo),
    }));
  }

  resolve(event: KeyboardEvent, context: ShortcutResolveContext): ShortcutDescriptor | null {
    const combo = keyboardEventToCombo(event);
    return this.descriptors.find((descriptor) => descriptor.scope === context.scope && descriptor.combo === combo) ?? null;
  }

  list(scope?: ShortcutScope): readonly ShortcutDescriptor[] {
    if (!scope) {
      return this.descriptors;
    }
    return this.descriptors.filter((descriptor) => descriptor.scope === scope);
  }
}

export const shortcutRegistry = new ShortcutRegistry([
  {
    actionId: 'focus-composer',
    combo: 'Mod+K',
    scope: 'global',
    owner: 'sidebar',
    descriptionKey: 'shortcuts.focusComposer',
    showInHelp: true,
  },
  {
    actionId: 'open-help',
    combo: 'Mod+/',
    scope: 'global',
    owner: 'chat-page',
    descriptionKey: 'shortcuts.openHelp',
    showInHelp: true,
  },
  {
    actionId: 'session-prev',
    combo: 'Mod+[',
    scope: 'global',
    owner: 'sidebar',
    descriptionKey: 'shortcuts.previousSession',
    showInHelp: true,
  },
  {
    actionId: 'session-next',
    combo: 'Mod+]',
    scope: 'global',
    owner: 'sidebar',
    descriptionKey: 'shortcuts.nextSession',
    showInHelp: true,
  },
  {
    actionId: 'composer-enter',
    combo: 'Enter',
    scope: 'composer',
    owner: 'composer',
    descriptionKey: 'shortcuts.completeOrSend',
    showInHelp: true,
  },
  {
    actionId: 'composer-escape',
    combo: 'Escape',
    scope: 'composer',
    owner: 'composer',
    descriptionKey: 'shortcuts.closeOverlayOrCancel',
    showInHelp: true,
  },
  {
    actionId: 'session-prev',
    combo: 'ArrowUp',
    scope: 'session-list',
    owner: 'sessions',
    descriptionKey: 'shortcuts.selectPreviousSession',
    showInHelp: true,
  },
  {
    actionId: 'session-next',
    combo: 'ArrowDown',
    scope: 'session-list',
    owner: 'sessions',
    descriptionKey: 'shortcuts.selectNextSession',
    showInHelp: true,
  },
  {
    actionId: 'session-open',
    combo: 'Enter',
    scope: 'session-list',
    owner: 'sessions',
    descriptionKey: 'shortcuts.openSelectedSession',
    showInHelp: true,
  },
] as const);
