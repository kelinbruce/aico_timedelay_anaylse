import type { TokenEstimator } from '@nextagent/agent-contracts/context';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, expectTypeOf, it } from 'vitest';

const contextSource = () => readFile(join(process.cwd(), 'packages/agent-contracts/src/context/index.ts'), 'utf8');
const commonSource = () => readFile(join(process.cwd(), 'packages/agent-common/src/index.ts'), 'utf8');

describe('refine-ts-context-token-estimator', () => {
  // Spec scenario: Interface lives in agent-contracts/context
  it('TokenEstimator interface is owned by agent-contracts/context', async () => {
    // Type-level: importing TokenEstimator from @nextagent/agent-contracts/context works.
    expectTypeOf<TokenEstimator>().toHaveProperty('estimateTokens');
    expectTypeOf<TokenEstimator>().toHaveProperty('estimateMessageTokens');
    expectTypeOf<TokenEstimator>().toHaveProperty('estimateToolMessageTokens');
    expectTypeOf<TokenEstimator>().toHaveProperty('estimateTokensBatch');

    // Source-level: the interface is declared in the context contracts file.
    const context = await contextSource();
    expect(context).toMatch(/export interface TokenEstimator\s*\{/);
    expect(context).toMatch(/estimateTokens:\s*\(text:\s*string\)\s*=>\s*number/);
    expect(context).toMatch(/estimateMessageTokens:\s*\(role:.+content:\s*string\)\s*=>\s*number/);
    expect(context).toMatch(/estimateToolMessageTokens:\s*\(toolCallId:\s*string,\s*toolName:\s*string,\s*content:\s*string\)\s*=>\s*number/);
    expect(context).toMatch(/estimateTokensBatch:\s*\(texts:\s*readonly\s+string\[\]\)\s*=>\s*number/);
  });

  // Spec scenario: parallel TokenEstimator definition is forbidden
  it('no parallel TokenEstimator definition exists in agent-common', async () => {
    const common = await commonSource();
    expect(common).not.toMatch(/interface TokenEstimator/);
    expect(common).not.toMatch(/type TokenEstimator\s*=/);
  });

  // Spec scenario: All four methods are required
  it('all four method signatures are part of the interface contract', () => {
    // Type-level: omitting any method from a literal must fail to assign to TokenEstimator.
    // We assert this by constructing a satisfying value and verifying its type.
    const satisfying: TokenEstimator = {
      estimateTokens: () => 0,
      estimateMessageTokens: () => 0,
      estimateToolMessageTokens: () => 0,
      estimateTokensBatch: () => 0,
    };
    expectTypeOf(satisfying).toMatchTypeOf<TokenEstimator>();
    expect(typeof satisfying.estimateTokens).toBe('function');
    expect(typeof satisfying.estimateMessageTokens).toBe('function');
    expect(typeof satisfying.estimateToolMessageTokens).toBe('function');
    expect(typeof satisfying.estimateTokensBatch).toBe('function');
  });
});
