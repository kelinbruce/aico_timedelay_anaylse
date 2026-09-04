import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('ExpandPanelStore architecture boundary', () => {
  it('does not depend on AICOConfigStore', () => {
    const storePath = resolve(__dirname, '../../frontend/agent-web/src/features/expand-panel/ExpandPanelStore.ts');
    const source = readFileSync(storePath, 'utf-8');
    expect(source).not.toMatch(/AICOConfig|aicoConfig|useAICOConfig/i);
  });

  it('does not import from aico-config directory', () => {
    const storePath = resolve(__dirname, '../../frontend/agent-web/src/features/expand-panel/ExpandPanelStore.ts');
    const source = readFileSync(storePath, 'utf-8');
    expect(source).not.toMatch(/aico-config/i);
  });
});
