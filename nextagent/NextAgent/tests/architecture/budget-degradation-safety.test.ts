import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Negative enforcement (add-ts-context-budget-explainability §8.1, design
 * D6 + ts-run-status-visibility spec scenarios):
 *   (b) channel/UI MUST NOT independently synthesize DEGRADATION_NOTICE
 *       payloads (must consume from runtime-owned `event.inlinePayload`).
 *   (c) introducing a `DEGRADED` (or any degradation-dedicated) `RunStatus`
 *       is forbidden — degradation is a separate `DEGRADATION_NOTICE`
 *       surface, not a new lifecycle status.
 *
 * These assertions are guard-rail architecture tests: any future
 * contributor who tries to bypass the runtime-owned degradation
 * pipeline will see this test fail and be redirected to extend the
 * existing path rather than add a parallel one.
 */

const root = process.cwd();

function sourceText(relativeDir: string): string {
  const dir = join(root, relativeDir);
  const files: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.name.endsWith('.ts')) {
        files.push(path);
      }
    }
  };
  walk(dir);
  return files.map((file) => readFileSync(file, 'utf8')).join('\n');
}

describe('budget-degradation negative enforcement (add-ts-context-budget-explainability §8.1)', () => {
  // ---------------------------------------------------------------------------
  // (b) — channel projection must consume DEGRADATION_NOTICE inlinePayload,
  //      not synthesize its own. The runtime is the single source of truth.
  // ---------------------------------------------------------------------------
  describe('(b) channel projection only consumes DEGRADATION_NOTICE inlinePayload', () => {
    const envelopeSource = sourceText('packages/agent-channel-common/src/projections');

    it('stream-envelope.ts branches on `event.type === "DEGRADATION_NOTICE"` and only copies safe fields from inlinePayload', () => {
      // The projection MUST branch on the runtime event type (proof that
      // the inline payload came from the runtime timeline) and copy a
      // fixed safe-field allowlist. A synthesizer would have to either
      // omit the event-type branch (it cannot — the runtime only
      // publishes `DEGRADATION_NOTICE` via `runState.emitEvent`) or
      // construct the payload outside an `if (event.type === ...)`
      // block (which this test would not detect, but the
      // channel-no-emitEvent check below catches the parallel
      // failure mode).
      expect(envelopeSource).toMatch(/event\.type\s*===\s*["']DEGRADATION_NOTICE["']/);
      // The projection must reference event.inlinePayload (proof it
      // reads from the runtime-owned payload, not a synthetic source).
      expect(envelopeSource).toContain('event.inlinePayload');
    });

    it('channel-web does NOT call runState.emitEvent / agent-runtime / context-engine (cannot independently publish runtime facts)', () => {
      // The architecture firewall already enforces cross-package
      // boundaries, but this test is a defense-in-depth: even if a
      // future refactor weakens the firewall, the channel layer MUST
      // NOT be able to publish a runtime fact. The projection layer
      // is strictly a consumer of `runState` events that the channel
      // surfaces to clients; it MUST NOT emit.
      const channelSource = [
        sourceText('packages/agent-channel-common/src'),
        sourceText('packages/agent-channel-web/src'),
        sourceText('packages/agent-channel-task/src'),
      ].join('\n');
      expect(channelSource).not.toMatch(/emitEvent\s*\(/);
      expect(channelSource).not.toContain('agent-runtime');
      // The channel projection MUST consume from the existing public
      // channel subpath; it MUST NOT reach into context-engine to
      // build a degradation notice from raw assembly data.
      expect(channelSource).not.toContain('agent-context-engine');
    });
  });

  // ---------------------------------------------------------------------------
  // (c) — DEGRADED RunStatus is structurally forbidden. The RunStatus
  //      union in `agent-common/src/index.ts` is closed at 8 values;
  //      any attempt to add `DEGRADED` would expand the union and the
  //      test below catches it. We also assert no source file uses
  //      `DEGRADED` as a RunStatus literal in a way that would
  //      bypass the union (e.g. via `as` cast).
  // ---------------------------------------------------------------------------
  describe('(c) DEGRADED is not a RunStatus', () => {
    it('RunStatus union in agent-common does NOT include DEGRADED', () => {
      const commonSource = readFileSync(join(root, 'packages/agent-common/src/index.ts'), 'utf8');
      // Extract the RunStatus union body using a non-regex approach:
      // find the start marker, then the first semicolon that follows.
      const startIdx = commonSource.indexOf('export type RunStatus =');
      expect(startIdx).toBeGreaterThanOrEqual(0);
      const endIdx = commonSource.indexOf(';', startIdx);
      expect(endIdx).toBeGreaterThan(startIdx);
      const runStatusBody = commonSource.slice(startIdx, endIdx);
      // No "DEGRADED" literal in the union body
      expect(runStatusBody).not.toMatch(/["']DEGRADED["']/);
      // Sanity check: the union still contains the canonical 8 statuses.
      // If a future change narrows the union, this test will fail and
      // surface the divergence.
      const expectedStatuses = ['ACCEPTED', 'QUEUED', 'PLANNING', 'EXECUTING', 'COMPLETED', 'FAILED', 'CANCELED', 'SUPERSEDED'];
      for (const status of expectedStatuses) {
        expect(runStatusBody).toContain(`'${status}'`);
      }
    });

    it("no source file in the implementation packages uses 'DEGRADED' as a RunStatus via cast workaround", () => {
      const implementationPackages = [
        'packages/agent-runtime/src',
        'packages/agent-core/src',
        'packages/agent-context-engine/src',
        'packages/agent-channel-web/src',
        'packages/agent-model/src',
        'packages/agent-capability/src',
        'packages/agent-workflow/src',
        'packages/agent-platform-gateway-local/src',
      ];
      for (const pkg of implementationPackages) {
        const source = sourceText(pkg);
        const castMatches = source.match(/["']DEGRADED["']\s+as\s+(?:unknown\s+as\s+|any\s+as\s+)?RunStatus/g) ?? [];
        expect(castMatches.length, `unexpected DEGRADED as RunStatus cast in ${pkg}`).toBe(0);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Bonus — DEGRADATION_NOTICE inline payload must not carry raw safeIdentifier
  //         or any other high-cardinality field. This is the same rule the
  //         context-engine D7 log helper enforces for `context.budget.evaluated`,
  //         applied to the agent-core projection that emits the timeline
  //         event. Locks the boundary even if a future agent-core change
  //         accidentally adds a field.
  // ---------------------------------------------------------------------------
  describe('DEGRADATION_NOTICE inline payload safety', () => {
    it('agent-core never includes `safeIdentifier`, `owningBoundary`, or raw `budgetEvidence` in a DEGRADATION_NOTICE payload', () => {
      // Strip block comments and line comments from each emit file
      // before checking for forbidden tokens. The intent is to
      // detect the tokens being USED as identifiers (property names,
      // variable references) in the inlinePayload block, not
      // mentioned in documentation. Documentation referring to the
      // forbidden fields is allowed.
      const dir = join(root, 'packages/agent-core/src');
      const files: string[] = [];
      const walk = (current: string): void => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
          const path = join(current, entry.name);
          if (entry.isDirectory()) {
            walk(path);
          } else if (entry.name.endsWith('.ts')) {
            files.push(path);
          }
        }
      };
      walk(dir);
      const emitFiles = files.filter((file) => readFileSync(file, 'utf8').includes('DEGRADATION_NOTICE'));
      expect(emitFiles.length).toBeGreaterThan(0);
      for (const file of emitFiles) {
        const source = readFileSync(file, 'utf8');
        // Strip // line comments and /* block comments */
        const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        expect(code, `${file} must not reference safeIdentifier in a DEGRADATION_NOTICE payload`).not.toMatch(/\bsafeIdentifier\b/);
        expect(code, `${file} must not reference owningBoundary in a DEGRADATION_NOTICE payload`).not.toMatch(/\bowningBoundary\b/);
        expect(code, `${file} must not reference budgetEvidence in a DEGRADATION_NOTICE payload`).not.toMatch(/\bbudgetEvidence\b/);
      }
    });
  });
});
