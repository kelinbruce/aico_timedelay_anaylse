import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

/**
 * Architecture negative enforcement for unify-capability-failure-disposition
 * §11.2 consumer migration. The unified Capability failure contract must stay
 * inside the implementation boundary:
 *  - agent-contracts/capability exposes no new export for this change
 *  - the strict runtime result schema lives in agent-capability (implementation)
 *  - the workflow Capability failure marker is package-private (never exported
 *    from the agent-workflow public API)
 */
describe('capability failure unification stays inside the implementation boundary', () => {
  it('keeps production Capability consumers on CapabilityInvocationPort instead of direct executor or Tool calls', () => {
    const consumerRoots = [
      'packages/agent-app/src',
      'packages/agent-channel-web/src',
      'packages/agent-core/src',
      'packages/agent-memory/src',
      'packages/agent-runtime/src',
      'packages/agent-workflow/src',
    ];
    for (const dir of consumerRoots) {
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
      walk(join(root, dir));
      const source = files.map((file) => readFileSync(file, 'utf8')).join('\n');
      expect(source, `${dir} must not execute a Tool definition directly`).not.toMatch(/\.tool\.execute\s*\(/u);
      expect(source, `${dir} must not invoke a provider executor directly`).not.toMatch(/(?:\.executor|\bexecutor)\.invoke\s*\(/u);
    }
  });

  it('does not add a workflow Capability failure marker to the agent-workflow public API', () => {
    const workflowIndexSource = readFileSync(join(root, 'packages/agent-workflow/src/index.ts'), 'utf8');
    expect(workflowIndexSource).not.toContain('CapabilityNodeExecutionError');
  });

  it('keeps the strict result schema inside agent-capability and out of agent-contracts', () => {
    const capabilityContractsSource = readFileSync(join(root, 'packages/agent-contracts/src/capability/index.ts'), 'utf8');
    expect(capabilityContractsSource).not.toContain('validateCapabilityInvocationResult');
    expect(capabilityContractsSource).not.toContain('CapabilityInputViolation');
    const capabilityIndexSource = readFileSync(join(root, 'packages/agent-capability/src/index.ts'), 'utf8');
    expect(capabilityIndexSource).not.toContain('result-schema');
    expect(capabilityIndexSource).not.toContain('validation-violations');
  });

  it('keeps public input schema validation in the governed invocation boundary', () => {
    const executorSource = readFileSync(join(root, 'packages/agent-capability/src/execution/executor.ts'), 'utf8');
    const toolCatalogSource = readFileSync(join(root, 'packages/agent-capability/src/tools/tool-catalog.ts'), 'utf8');
    const clipExecutorSource = readFileSync(join(root, 'packages/agent-capability/src/clip/clip-tool-source.ts'), 'utf8');

    expect(executorSource).toContain('collectInputViolations');
    expect(executorSource).not.toContain('validateJsonInput');
    expect(toolCatalogSource).not.toContain('validateJsonInput');
    expect(clipExecutorSource).not.toContain('validateJsonInput');
  });

  it('keeps Ajv compilation out of executor, CLIP and Tool catalog paths', () => {
    const checked = [
      'packages/agent-capability/src/execution/executor.ts',
      'packages/agent-capability/src/clip/clip-tool-source.ts',
      'packages/agent-capability/src/tools/tool-catalog.ts',
    ];
    for (const file of checked) {
      const source = readFileSync(join(root, file), 'utf8');
      expect(source, `${file} must not construct Ajv`).not.toMatch(/new\s+Ajv\s*\(/u);
      expect(source, `${file} must not compile schemas`).not.toMatch(/\.compile\s*\(/u);
    }
  });

  it('keeps ordinary output validation and capacity ownership in the governed boundary', () => {
    const executorSource = readFileSync(join(root, 'packages/agent-capability/src/execution/executor.ts'), 'utf8');
    const toolCatalogSource = readFileSync(join(root, 'packages/agent-capability/src/tools/tool-catalog.ts'), 'utf8');
    const clipExecutorSource = readFileSync(join(root, 'packages/agent-capability/src/clip/clip-tool-source.ts'), 'utf8');

    for (const ownedToken of ['RESULT_CAPACITY_EXCEEDED', 'capacityExceededResult']) {
      expect(executorSource).toContain(ownedToken);
      expect(toolCatalogSource).not.toContain(ownedToken);
      expect(clipExecutorSource).not.toContain(ownedToken);
    }
  });

  it('does not use the failed-with-safe-payload carrier for first-party Tools without usable results', () => {
    const builtinsRoot = join(root, 'packages/agent-capability/src/builtins');
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
    walk(builtinsRoot);

    expect(files.map((file) => readFileSync(file, 'utf8')).join('\n')).not.toContain('new ToolFailedResultError');
  });

  it('keeps automatic same-argument retry owned by the governed invocation boundary', () => {
    const productionRoots = ['packages/agent-capability/src', 'packages/agent-core/src', 'packages/agent-memory/src', 'packages/agent-workflow/src'];
    const owners: string[] = [];
    for (const dir of productionRoots) {
      const walk = (current: string): void => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
          const path = join(current, entry.name);
          if (entry.isDirectory()) {
            walk(path);
          } else if (entry.name.endsWith('.ts') && readFileSync(path, 'utf8').includes('capability.retry.same_arguments')) {
            owners.push(path);
          }
        }
      };
      walk(join(root, dir));
    }

    expect(owners).toEqual([join(root, 'packages/agent-capability/src/execution/executor.ts')]);
  });

  it('does not add error handling read branches to channel, session, context-engine or frontend', () => {
    const forbidden = ['buildFailedCapabilityPayload', 'CAPABILITY_NODE_EXECUTION', 'safeErrorContent(terminalError)'];
    const checked = ['packages/agent-channel-common/src', 'packages/agent-session/src', 'packages/agent-context-engine/src'];
    for (const dir of checked) {
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
      walk(join(root, dir));
      const source = files.map((file) => readFileSync(file, 'utf8')).join('\n');
      for (const token of forbidden) {
        expect(source, `${dir} must not introduce ${token}`).not.toContain(token);
      }
    }
  });
});
