import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

describe('Workflow builtin tool architecture', () => {
  it('registers workflowToolDefinition in builtinToolDefinitions', () => {
    const builtins = read('packages/agent-capability/src/builtins/index.ts');
    expect(builtins).toContain('workflowToolDefinition');
    expect(builtins).toContain('workflow/workflow-tool.js');
  });

  it('declares requiredDependencies: workflowExecution in the tool definition', () => {
    const tool = read('packages/agent-capability/src/builtins/workflow/workflow-tool.ts');
    expect(tool).toContain("requiredDependencies: ['workflowExecution']");
    expect(tool).toContain('returnsCapabilityResult: true');
    expect(tool).toContain("replayPolicy: 'NON_IDEMPOTENT'");
    expect(tool).toContain("disclosurePolicy: { mode: 'EAGER' }");
  });

  it('syncs workflowExecution in dual ToolDependencyName definitions', () => {
    const contracts = read('packages/agent-contracts/src/capability/index.ts');
    const spi = read('packages/agent-capability/src/tools/tool-spi.ts');
    expect(contracts).toContain("'workflowExecution'");
    expect(spi).toContain("'workflowExecution'");
    expect(contracts).toContain('workflowExecution?: unknown');
    expect(spi).toContain('workflowExecution?: WorkflowExecutionToolPort');
  });

  it('adds workflowExecution to allowedDependencyNames in tool-catalog', () => {
    const catalog = read('packages/agent-capability/src/tools/tool-catalog.ts');
    expect(catalog).toContain("'workflowExecution'");
  });

  it('exports workflow tool from agent-capability index', () => {
    const index = read('packages/agent-capability/src/index.ts');
    expect(index).toContain('workflow/workflow-schemas.js');
    expect(index).toContain('workflow/workflow-tool.js');
  });

  it('wires workflowExecution in create-app toolDependencies', () => {
    const app = read('packages/agent-app/src/composition/create-app.ts');
    const capabilityComposition = read('packages/agent-app/src/composition/capability-composition.ts');
    expect(app).toContain('composeCapabilityLayer');
    expect(capabilityComposition).toContain('createWorkflowToolPort');
    expect(capabilityComposition).toContain('workflowExecution: createWorkflowToolPort');
  });

  it('keeps Workflow tool away from runtime, gateway, and process APIs', () => {
    const toolSource = read('packages/agent-capability/src/builtins/workflow/workflow-tool.ts');
    expect(toolSource).not.toContain('node:fs');
    expect(toolSource).not.toContain('node:path');
    expect(toolSource).not.toContain('child_process');
    expect(toolSource).not.toContain('process.');
    expect(toolSource).not.toContain('@nextagent/agent-platform-gateway-local');
    expect(toolSource).not.toContain('@nextagent/agent-runtime');
  });

  it('uses WorkflowExecutionToolPort as minimal adaptation contract', () => {
    const spi = read('packages/agent-capability/src/tools/tool-spi.ts');
    expect(spi).toContain('interface WorkflowExecutionToolPort');
    expect(spi).toContain('execute: (input: {');
    expect(spi).toContain('readonly recipeName: string');
    expect(spi).toContain('readonly inputText?');
    expect(spi).toContain('readonly inputVariables: JsonObject');
    expect(spi).toContain('readonly context: ToolExecutionContext');
    expect(spi).toContain('readonly signal: AbortSignal');
  });
});
