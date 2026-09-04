import { describe, expect, it } from 'vitest';
import { getExactComposerCommand, getMatchingComposerCommands } from '../src/features/composer/commandCatalog.ts';

describe('commandCatalog', () => {
  it('matches slash command prefixes and preserves command order', () => {
    const matches = getMatchingComposerCommands('/', {
      hasRetryTarget: false,
      hasEditTarget: false,
      isExecuting: false,
      hasWritePermission: true,
    });

    expect(matches.map((command) => command.key)).toEqual(['/help', '/retry', '/edit']);
  });

  it('does not expose clear as a slash command', () => {
    const context = {
      hasRetryTarget: true,
      hasEditTarget: true,
      isExecuting: false,
      hasWritePermission: true,
    };

    expect(getMatchingComposerCommands('/clear', context)).toEqual([]);
    expect(getExactComposerCommand('/clear', context)).toBeNull();
  });

  it('does not expose transport switching as a slash command', () => {
    const matches = getMatchingComposerCommands('/transport', {
      hasRetryTarget: true,
      hasEditTarget: true,
      isExecuting: false,
      hasWritePermission: true,
    });

    expect(matches).toEqual([]);
    expect(
      getExactComposerCommand('/transport ws', {
        hasRetryTarget: true,
        hasEditTarget: true,
        isExecuting: false,
        hasWritePermission: true,
      }),
    ).toBeNull();
  });

  it('disables retry and edit when there is no eligible latest target', () => {
    const retry = getExactComposerCommand('/retry', {
      hasRetryTarget: false,
      hasEditTarget: false,
      isExecuting: false,
      hasWritePermission: true,
    });
    const edit = getExactComposerCommand('/edit', {
      hasRetryTarget: false,
      hasEditTarget: false,
      isExecuting: false,
      hasWritePermission: true,
    });

    expect(retry?.enabled).toBe(false);
    expect(retry?.disabledReason).toContain('没有可重试');
    expect(edit?.enabled).toBe(false);
    expect(edit?.disabledReason).toContain('没有可编辑');
  });

  it('prefers execution-state disabled reasons when a request is still running', () => {
    const retry = getExactComposerCommand('/retry', {
      hasRetryTarget: true,
      hasEditTarget: true,
      isExecuting: true,
      hasWritePermission: true,
    });

    expect(retry?.enabled).toBe(false);
    expect(retry?.disabledReason).toContain('仍在执行');
  });

  it('returns no matches when input does not start with a slash command prefix', () => {
    const matches = getMatchingComposerCommands('hello /re', {
      hasRetryTarget: true,
      hasEditTarget: true,
      isExecuting: false,
      hasWritePermission: true,
    });

    expect(matches).toEqual([]);
  });
});
