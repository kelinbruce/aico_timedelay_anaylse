/**
 * Design-only test-first skeleton. This directory is not discovered by TestClaw.
 * Rationale: package acquisition is only useful when a subsequent real request can
 * discover source metadata and localized display name, then execute the Skill
 * under the same disclosure and resource-projection governance rules.
 */
import { describe, it } from 'vitest';

describe('TC-SI-117 SkillHub acquire to execute', () => {
  it('acquires, installs and publishes a Skill before a later request executes it', async () => {
    // Negative branches: invalid content remains unavailable and SKILL.md body
    // never becomes a model-readable resource projection.
    throw new Error('Design skeleton: move into tests/suites and implement TC-SI-117');
  });
});
