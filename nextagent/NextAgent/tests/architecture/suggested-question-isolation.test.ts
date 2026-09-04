import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Architecture gate for `add-ts-question-recommend` (task 7.2).
 *
 * The SuggestedQuestionService lives in
 * `packages/agent-session/src/services/suggested-question-service.ts`
 * and MUST NOT perform any runtime state mutations:
 *   - no import of `RuntimeCommandPort` (runtime lifecycle / command surface)
 *   - no import of `agent-runtime` (which owns the runtime timeline)
 *   - no call to `RunTimelineEventStoreGateway.appendEvent`
 *   - no call to `RequestRunStoreGateway` write methods (only loadRun read)
 *   - no call to `SessionMessageStoreGateway` write methods (only read)
 *
 * The service is a read-only post-terminal consumer: it loads run/messages/
 * timeline, calls the model, and returns questions. It MUST NOT mutate the
 * runtime state graph.
 */

const root = process.cwd();
const servicePath = join(root, 'packages/agent-session/src/services/suggested-question-service.ts');
const source = readFileSync(servicePath, 'utf8');

describe('SuggestedQuestionService isolation', () => {
  it('does not import RuntimeCommandPort', () => {
    expect(source).not.toContain('RuntimeCommandPort');
  });

  it('does not import from agent-runtime', () => {
    expect(source).not.toContain('@nextagent/agent-runtime');
  });

  it('does not call appendEvent on timeline gateway', () => {
    expect(source).not.toMatch(/\.appendEvent\s*\(/);
  });

  it('does not call commitTerminal on request run gateway', () => {
    expect(source).not.toMatch(/\.commitTerminal\s*\(/);
  });

  it('does not call claimRun on request run gateway', () => {
    expect(source).not.toMatch(/\.claimRun\s*\(/);
  });

  it('does not call appendSessionMessage on message gateway', () => {
    expect(source).not.toMatch(/\.appendSessionMessage\s*\(/);
  });

  it('does not call hideMessage on message gateway', () => {
    expect(source).not.toMatch(/\.hideMessage\s*\(/);
  });
});
