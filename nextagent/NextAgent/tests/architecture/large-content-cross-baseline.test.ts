import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const changeDir = join(root, 'openspec/changes/add-ts-large-content-references');

/**
 * Tasks §1.3 + §1.4 — large-content-references cross-baseline
 * boundary checks. The change MUST NOT introduce modifications
 * to baselines owned by sibling changes; the proposal §"Capability
 * 影响" carries explicit "不修改" statements for each, and this
 * test pins the corresponding filesystem invariant so a future
 * rebase or merge cannot silently drift the change into someone
 * else's baseline.
 *
 * The forbidden baselines and their owners:
 *   - request-attachments      → add-ts-attachment-request-context-flow
 *   - query-policy             → add-ts-context-budget-explainability
 *   - summary-message          → add-ts-context-compression
 *   - context-compression      → add-ts-context-compression
 *   - traceable-summary        → add-ts-traceable-summary-generation
 *   - attachment-intake        → add-ts-attachment-intake
 *
 * The change's specs/ directory must contain EXACTLY:
 *   - large-content-references (new capability baseline, task 1.1)
 *   - context-engine           (increment, task 1.2)
 */
const ALLOWED_SPEC_SUBDIRS = ['large-content-references', 'context-engine'] as const;
const FORBIDDEN_BASELINES = ['request-attachments', 'query-policy', 'context-compression', 'traceable-summary', 'attachment-intake'] as const;

describe('large-content-references cross-baseline boundary (tasks 1.3 + 1.4)', () => {
  // The change's specs/ may have been moved to openspec/changes/archive/
  // when the change was archived. The gate works for both the
  // pre-archive (change in openspec/changes/) and post-archive
  // (change in openspec/changes/archive/) states.
  function resolveSpecsRoot(): string {
    const active = join(changeDir, 'specs');
    if (existsSync(active)) {
      return active;
    }
    // Look in openspec/changes/archive/ for an entry whose
    // basename ends with -add-ts-large-content-references.
    const archiveRoot = join(root, 'openspec/changes/archive');
    for (const entry of readdirSync(archiveRoot)) {
      if (entry === 'add-ts-large-content-references' || entry.endsWith('-add-ts-large-content-references')) {
        return join(archiveRoot, entry, 'specs');
      }
    }
    throw new Error(`could not locate specs/ for add-ts-large-content-references (active=${active}, archiveRoot=${archiveRoot})`);
  }

  it('specs/ contains only the two allowed capability subdirs', () => {
    const specsRoot = resolveSpecsRoot();
    const entries = readdirSync(specsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect(entries.sort()).toEqual([...ALLOWED_SPEC_SUBDIRS].sort());
  });

  it('does not introduce a request-attachments / query-policy / summary / compression / traceable-summary / attachment-intake baseline under specs/', () => {
    const specsRoot = resolveSpecsRoot();
    for (const forbidden of FORBIDDEN_BASELINES) {
      const forbiddenPath = join(specsRoot, forbidden);
      let exists = false;
      try {
        readdirSync(forbiddenPath);
        exists = true;
      } catch {
        exists = false;
      }
      expect(exists, `forbidden baseline '${forbidden}' must not exist under ${specsRoot}`).toBe(false);
    }
  });

  it("proposal carries explicit '不修改' statements for every forbidden baseline", () => {
    // Look in both the active and archived locations.
    const activeProposal = join(changeDir, 'proposal.md');
    let proposal: string = '';
    if (existsSync(activeProposal)) {
      proposal = readFileSync(activeProposal, 'utf8');
    } else {
      const archiveRoot = join(root, 'openspec/changes/archive');
      for (const entry of readdirSync(archiveRoot)) {
        if (entry === 'add-ts-large-content-references' || entry.endsWith('-add-ts-large-content-references')) {
          proposal = readFileSync(join(archiveRoot, entry, 'proposal.md'), 'utf8');
          break;
        }
      }
      if (proposal === '') {
        throw new Error(`could not locate proposal.md for add-ts-large-content-references`);
      }
    }
    for (const forbidden of FORBIDDEN_BASELINES) {
      // The proposal must say it does NOT modify each forbidden
      // baseline (its sibling change owns that baseline). Accept
      // either the bare baseline name or the `add-ts-...` change
      // id, since the proposal sometimes references the change
      // rather than the capability directly.
      const re = new RegExp(`不修改[\\s\\S]{0,80}(add-ts-)?${forbidden}`);
      expect(re.test(proposal), `proposal must carry a '不修改 ... ${forbidden}' statement`).toBe(true);
    }
  });
});
