import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

/**
 * Task 6.0 — prerequisite archived gate.
 *
 * The `add-ts-context-prompt-shaping` change is permitted to enter
 * implementation verification only AFTER the following upstream
 * contract / sibling changes have been archived. Each listed change
 * is a hard dependency — the prompt-shaping change consumes their
 * public contract deltas (`SystemPromptSection.sectionId`,
 * `ContextAssemblyRequest.capabilityContextPatch`, history
 * selection invariants, large-content replacement forms, summary
 * generation port, agent package assembly registry, capability
 * core governance) and tests its wire-in.
 *
 * If any prerequisite is still under `openspec/changes/`, the test
 * lists the missing ids and the gate fails. This is the single
 * source of truth for the prompt-shaping change's archive
 * readiness.
 */
const PREREQUISITES = [
  'refine-ts-context-assembly-contracts',
  'add-ts-context-history-selection',
  'add-ts-large-content-references',
  'add-ts-context-compression',
  'add-ts-traceable-summary-generation',
  'add-ts-agent-package-assembly',
  'add-ts-capability-core-governance',
] as const;

describe('prompt-shaping prerequisite archive gate (task 6.0)', () => {
  it('blocks implementation verification until every prerequisite change is archived', () => {
    const archiveDir = join(root, 'openspec/changes/archive');
    const activeDir = join(root, 'openspec/changes');
    // Archived entries are prefixed with the archive date
    // (e.g. `2026-06-10-refine-ts-context-assembly-contracts`);
    // match by suffix so the gate stays correct as the archive
    // directory grows new date-prefixed entries.
    const archivedEntries = readdirSync(archiveDir).map((entry) => entry.split(/[\\/]/).pop() ?? entry);
    const activeEntries = statSync(activeDir).isDirectory()
      ? readdirSync(activeDir)
          .filter((entry) => entry !== 'archive')
          .map((entry) => entry.split(/[\\/]/).pop() ?? entry)
      : [];
    const isArchived = (change: string): boolean => archivedEntries.some((entry) => entry === change || entry.endsWith(`-${change}`));
    const isActive = (change: string): boolean => activeEntries.some((entry) => entry === change);

    const stillPending = PREREQUISITES.filter((change) => !isArchived(change));
    const stillActive = PREREQUISITES.filter((change) => isActive(change));

    if (stillPending.length > 0) {
      const detail = stillPending
        .map((change) => {
          const status = isActive(change) ? 'still-active' : 'missing';
          return `- ${change} (${status})`;
        })
        .join('\n  ');
      throw new Error(
        `add-ts-context-prompt-shaping cannot enter implementation verification — the following prerequisite changes have not been archived:\n  ${detail}\n` +
          `Gate per tasks.md §6.0: this change MUST wait for all listed prerequisites to be archived under openspec/changes/archive/ before continuing verification.`,
      );
    }

    // Sanity: nothing on the prerequisite list is still in the active
    // changes directory either.
    expect(stillActive).toEqual([]);
  });
});
