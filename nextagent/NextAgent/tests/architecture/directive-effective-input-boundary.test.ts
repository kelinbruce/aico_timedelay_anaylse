import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const coreParserSource = readFileSync(join(root, 'packages', 'agent-core', 'src', 'routing', 'capability-directive-parser.ts'), 'utf8');
const runtimeLifecycleSource = readFileSync(join(root, 'packages', 'agent-runtime', 'src', 'lifecycle', 'submit.ts'), 'utf8');
const appCompositionSource = readFileSync(join(root, 'packages', 'agent-app', 'src', 'composition', 'request-runtime-composition.ts'), 'utf8');

describe('directive effective input ownership', () => {
  it('keeps directive grammar in agent-core and out of agent-runtime', () => {
    expect(coreParserSource).toContain('normalizeCapabilityDirectiveInput');
    expect(coreParserSource).toContain('\\$(skill|workflow)');
    expect(runtimeLifecycleSource).not.toContain('\\$(skill|workflow)');
    expect(runtimeLifecycleSource).not.toContain('parseCapabilityDirective');
  });

  it('injects the core-owned projector at the product composition root', () => {
    expect(appCompositionSource).toContain('normalizeCapabilityDirectiveInput');
    expect(appCompositionSource).toMatch(/acceptedInputProjector:\s*normalizeCapabilityDirectiveInput/u);
  });
});
