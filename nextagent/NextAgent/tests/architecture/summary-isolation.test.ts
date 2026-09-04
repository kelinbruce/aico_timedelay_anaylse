import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Architecture gate for `add-ts-traceable-summary-generation` (task 7.16).
 *
 * The default summary generator lives in
 * `packages/agent-context-engine/src/summary/**` and MUST NOT perform
 * any persistence side effects:
 *   - no call to `ActiveContextStoreGateway.commitCompaction` or
 *     `.appendItem`
 *   - no call to `SessionMessageStoreGateway.appendSessionMessage`
 *   - no call to `CheckpointStoreGateway.saveCheckpoint`
 *   - no call to `RunTimelineEventStoreGateway.appendEvent`
 *   - no import of `agent-runtime` (which owns the runtime
 *     timeline / checkpoint / canonical timeline emitters)
 *   - no import of `agent-platform-gateway-local` (which owns the
 *     SQLite gateway used by commitCompaction / appendItem /
 *     appendSessionMessage)
 *
 * The generator is a sink: it consumes covered messages and emits
 * a draft. It MUST NOT mutate the runtime state graph. Any
 * persistence surface a future change adds (e.g. a summary cache)
 * must also be added to the allowlist explicitly via this test.
 */

const root = process.cwd();
const summaryDir = join(root, 'packages/agent-context-engine/src/summary');

function readAllSource(dir: string): string {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.name.endsWith('.ts')) {
        out.push(readFileSync(path, 'utf8'));
      }
    }
  };
  walk(dir);
  return out.join('\n');
}

const source = readAllSource(summaryDir);

describe('summary-isolation architecture gate (add-ts-traceable-summary-generation §7.16)', () => {
  it('the summary module exists and contains the expected public surface', () => {
    // Sanity check before we go any further: a missing file would silently
    // pass every negative assertion below, which is a false-positive.
    expect(statSync(summaryDir).isDirectory()).toBe(true);
    expect(source).toContain('DefaultTraceableSummaryGenerator');
    expect(source).toContain('TraceableSummaryGenerationPort');
  });

  it('does NOT import agent-runtime (no runtime timeline / checkpoint surfaces)', () => {
    expect(source).not.toMatch(/from\s+["']@nextagent\/agent-runtime["']/);
    expect(source).not.toMatch(/from\s+["']\.\.\/runtime/);
    expect(source).not.toMatch(/from\s+["']\.\.\/\.\.\/runtime/);
  });

  it('does NOT import agent-platform-gateway-local (no SQLite commitCompaction / appendItem / appendSessionMessage)', () => {
    expect(source).not.toMatch(/from\s+["']@nextagent\/agent-platform-gateway-local["']/);
    expect(source).not.toMatch(/from\s+["']\.\.\/\.\.\/\.\.\/agent-platform-gateway-local/);
  });

  it('does NOT call any persistence side-effect surface', () => {
    // The function-name occurrences below are the runtime-side mutation
    // surfaces the summary generator must NEVER invoke. They live in
    // agent-runtime, agent-platform-gateway-local, and the gateway
    // contract subpath. A grep on the source for any of these is the
    // canonical "I am not persisting anything" assertion.
    const forbidden = [
      'commitCompaction',
      'appendItem',
      'appendSessionMessage',
      'saveCheckpoint',
      'appendEvent',
      'emitEvent',
      'saveRuntimeCheckpoint',
    ];
    for (const name of forbidden) {
      // We strip string literals and comments before matching so a
      // doc comment like "// does not call appendSessionMessage" does
      // not false-positive.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code, `summary module must not call ${name}()`).not.toMatch(new RegExp(`\\b${name}\\s*\\(`));
    }
  });

  it('does NOT extend the cross-package firewall: context-engine still does not import agent-runtime or agent-platform-gateway-local', () => {
    // The summary module lives inside agent-context-engine; the broader
    // architecture firewall is already enforced by
    // `tests/architecture/context-assembly-contracts.test.ts`. This
    // test re-asserts the same boundary at the source level so a
    // future refactor that opens the gate cannot slip through.
    const engineDir = join(root, 'packages/agent-context-engine/src');
    const engineSource = readAllSource(engineDir);
    expect(engineSource).not.toMatch(/from\s+["']@nextagent\/agent-runtime["']/);
    expect(engineSource).not.toMatch(/from\s+["']@nextagent\/agent-platform-gateway-local["']/);
  });
});
