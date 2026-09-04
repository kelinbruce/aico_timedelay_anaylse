import i18n from '../../i18n/index.ts';

export type ComposerCommandKey = '/help' | '/retry' | '/edit';

export interface ComposerCommandContext {
  readonly hasRetryTarget: boolean;
  readonly hasEditTarget: boolean;
  readonly isExecuting: boolean;
  readonly hasWritePermission: boolean;
}

export interface ComposerCommandDefinition {
  readonly key: ComposerCommandKey;
  readonly descriptionKey: string;
  readonly isEnabled: (context: ComposerCommandContext) => boolean;
  readonly disabledReason?: (context: ComposerCommandContext) => string | null;
}

export interface ResolvedComposerCommand {
  readonly key: ComposerCommandKey;
  readonly description: string;
  readonly enabled: boolean;
  readonly disabledReason: string | null;
}

export const COMPOSER_COMMANDS: readonly ComposerCommandDefinition[] = [
  {
    key: '/help',
    descriptionKey: 'composer.commands.help',
    isEnabled: () => true,
  },
  {
    key: '/retry',
    descriptionKey: 'composer.commands.retry',
    isEnabled: (context) => context.hasWritePermission && context.hasRetryTarget && !context.isExecuting,
    disabledReason: (context) =>
      !context.hasWritePermission
        ? i18n.t('auth.slashNoWritePermission')
        : context.isExecuting
          ? i18n.t('composer.disabledReasons.retryExecuting')
          : i18n.t('composer.disabledReasons.retryUnavailable'),
  },
  {
    key: '/edit',
    descriptionKey: 'composer.commands.edit',
    isEnabled: (context) => context.hasWritePermission && context.hasEditTarget && !context.isExecuting,
    disabledReason: (context) =>
      !context.hasWritePermission
        ? i18n.t('auth.slashNoWritePermission')
        : context.isExecuting
          ? i18n.t('composer.disabledReasons.editExecuting')
          : i18n.t('composer.disabledReasons.editUnavailable'),
  },
] as const;

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

function resolveCommand(command: ComposerCommandDefinition, context: ComposerCommandContext): ResolvedComposerCommand {
  const enabled = command.isEnabled(context);
  return {
    key: command.key,
    description: i18n.t(command.descriptionKey),
    enabled,
    disabledReason: enabled ? null : (command.disabledReason?.(context) ?? null),
  };
}

export function getMatchingComposerCommands(query: string, context: ComposerCommandContext): ResolvedComposerCommand[] {
  if (!query.startsWith('/')) {
    return [];
  }
  const normalizedQuery = normalizeQuery(query);
  return COMPOSER_COMMANDS.filter((command) => command.key.startsWith(normalizedQuery)).map((command) => resolveCommand(command, context));
}

export function getExactComposerCommand(input: string, context: ComposerCommandContext): ResolvedComposerCommand | null {
  const normalizedInput = normalizeQuery(input);
  const matched = COMPOSER_COMMANDS.find((command) => command.key === normalizedInput);
  return matched ? resolveCommand(matched, context) : null;
}
