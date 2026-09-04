import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('builtin Tool framework architecture', () => {
  it('uses explicit Tool definitions instead of scanning, decorators, self-registration, or config-created Tools', () => {
    const toolFrameworkSource =
      readSources(join(root, 'packages', 'agent-capability', 'src', 'tools')) +
      readSources(join(root, 'packages', 'agent-capability', 'src', 'builtins', 'read')) +
      read('packages/agent-capability/src/builtins/index.ts') +
      read('packages/agent-capability/src/subsystem.ts');

    expect(toolFrameworkSource).not.toContain('scanAndRegister');
    expect(toolFrameworkSource).not.toContain('discover(toolName');
    expect(toolFrameworkSource).not.toContain('@Tool');
    expect(toolFrameworkSource).not.toContain('Reflect.metadata');
    expect(toolFrameworkSource).not.toContain('readdir');
    expect(toolFrameworkSource).not.toContain('glob(');
    expect(toolFrameworkSource).not.toContain('import.meta.glob');
    expect(toolFrameworkSource).not.toContain('new Function');
    expect(toolFrameworkSource).not.toContain('config-created');
    expect(read('packages/agent-capability/src/tools/tool-spi.ts')).not.toContain('register');
  });

  it('keeps Tool implementation paths away from host workspace roots, process APIs, and gateway private contracts', () => {
    const toolSpi = read('packages/agent-capability/src/tools/tool-spi.ts');
    const toolImplementationSource =
      readSources(join(root, 'packages', 'agent-capability', 'src', 'builtins', 'glob')) +
      read('packages/agent-capability/src/builtins/read/read-tool.ts') +
      read('packages/agent-capability/src/builtins/write/write-tool.ts') +
      readSources(join(root, 'packages', 'agent-capability', 'src', 'builtins', 'bash'));

    expect(toolSpi).toContain("readonly workspaceDir: 'workspace/';");
    expect(toolImplementationSource).not.toContain('workspaceRoot');
    expect(toolImplementationSource).not.toContain('workspaceDir');
    expect(toolImplementationSource).not.toContain('node:fs');
    expect(toolImplementationSource).not.toContain('node:path');
    expect(toolImplementationSource).not.toContain('child_process');
    expect(toolImplementationSource).not.toContain('process.');
    expect(toolImplementationSource).not.toContain('@nextagent/agent-platform-gateway-local');
    expect(readSources(join(root, 'packages', 'agent-capability', 'src'))).not.toContain('@nextagent/agent-platform-gateway-local');
  });

  it('keeps Write on the explicit Tool path and available without fabricated approval readiness', () => {
    const builtins = read('packages/agent-capability/src/builtins/index.ts');
    const writeTool = read('packages/agent-capability/src/builtins/write/write-tool.ts');
    const writeDirectory = readSources(join(root, 'packages', 'agent-capability', 'src', 'builtins', 'write'));

    expect(builtins).toContain('writeToolDefinition');
    expect(writeTool).toContain("requiredDependencies: ['workspaceFiles']");
    expect(writeTool).not.toContain('deps.approval');
    expect(writeTool).toContain("replayPolicy: 'NON_IDEMPOTENT'");
    expect(writeDirectory).not.toContain('node:fs');
    expect(writeDirectory).not.toContain('node:path');
    expect(writeDirectory).not.toContain('CapabilityInvocationRequest');
    expect(existsSync(join(root, 'packages', 'agent-capability', 'src', 'builtins', 'write', 'Write.yaml'))).toBe(false);
    const requestRuntimeComposition = read('packages/agent-app/src/composition/request-runtime-composition.ts');
    expect(requestRuntimeComposition).toContain('capabilitySubsystem.runLifecycle.onTerminalRun');
    expect(requestRuntimeComposition).not.toContain('capabilitySubsystem.workspaceFiles');
    expect(requestRuntimeComposition).not.toContain('WorkspaceFilePort');
    expect(requestRuntimeComposition).not.toContain('createWorkspaceFilePort');
    expect(requestRuntimeComposition).not.toContain('.clearRun(');
  });

  it('keeps Glob on the explicit Tool path and filesystem traversal inside workspaceFiles', () => {
    const builtins = read('packages/agent-capability/src/builtins/index.ts');
    const globTool = read('packages/agent-capability/src/builtins/glob/glob-tool.ts');
    const globDirectory = readSources(join(root, 'packages', 'agent-capability', 'src', 'builtins', 'glob'));
    const workspaceFiles = read('packages/agent-capability/src/builtins/workspace-files/workspace-file-port.ts');
    const manifest = read('packages/agent-capability/package.json');

    expect(builtins).toContain('globToolDefinition');
    expect(globTool).toContain("requiredDependencies: ['workspaceFiles']");
    expect(globTool).toContain("replayPolicy: 'IDEMPOTENT'");
    expect(globDirectory).not.toContain('node:fs');
    expect(globDirectory).not.toContain('node:path');
    expect(globDirectory).not.toContain('CapabilityInvocationRequest');
    expect(workspaceFiles).toContain('picomatch');
    expect(workspaceFiles).toContain('globFiles');
    expect(workspaceFiles).not.toContain('child_process');
    expect(workspaceFiles).not.toContain('ripgrep');
    expect(manifest).toContain('"picomatch": "4.0.5"');
    expect(existsSync(join(root, 'packages', 'agent-capability', 'src', 'builtins', 'glob', 'Glob.yaml'))).toBe(false);
  });

  it('keeps TodoWrite on the explicit Tool path with scoped state injected through a controlled dependency', () => {
    const builtins = read('packages/agent-capability/src/builtins/index.ts');
    const todoTool = read('packages/agent-capability/src/builtins/todo-write/todo-write-tool.ts');
    const todoDirectory = readSources(join(root, 'packages', 'agent-capability', 'src', 'builtins', 'todo-write'));
    const toolSpi = read('packages/agent-capability/src/tools/tool-spi.ts');
    const capabilitySource = readSources(join(root, 'packages', 'agent-capability', 'src'));
    const coreSource = readSources(join(root, 'packages', 'agent-core', 'src'));
    const runtimeSource = readSources(join(root, 'packages', 'agent-runtime', 'src'));
    const appComposition = read('packages/agent-app/src/composition/create-app.ts');
    const gatewayComposition = read('packages/agent-app/src/composition/gateway-composition.ts');
    const capabilityComposition = read('packages/agent-app/src/composition/capability-composition.ts');

    expect(builtins).toContain('todoWriteToolDefinition');
    expect(todoTool).toContain('name: todoWriteCapabilityId');
    expect(todoTool).toContain("requiredDependencies: ['todoState']");
    expect(todoTool).toContain("replayPolicy: 'IDEMPOTENT'");
    expect(todoTool).not.toContain('observability:');
    expect(todoTool).not.toContain('safeCompletionDiagnostics');
    expect(todoDirectory).not.toContain('@nextagent/agent-runtime');
    expect(todoDirectory).not.toContain('@nextagent/agent-channel-web');
    expect(todoDirectory).not.toContain('@nextagent/agent-app');
    expect(todoDirectory).not.toContain('node:fs');
    expect(todoDirectory).not.toContain('node:path');
    expect(todoDirectory).not.toContain('CapabilityInvocationRequest');
    expect(toolSpi).toContain('readonly todoState?: TodoStatePort;');
    expect(capabilitySource).not.toContain('TodoWriteInvocation');
    expect(coreSource).not.toContain('TodoWriteInvocation');
    expect(runtimeSource).not.toContain('@nextagent/agent-capability');
    expect(gatewayComposition).toContain('createGatewayTodoState');
    expect(runtimeSource).not.toContain('createInMemoryTodoState');
    expect(runtimeSource).not.toContain('todosByScope');
    expect(capabilityComposition).toContain('todoState');
    expect(appComposition).toContain('todoState');
  });

  it('keeps Cron tools backed by gateway injection instead of product in-memory state', () => {
    const builtins = read('packages/agent-capability/src/builtins/index.ts');
    const cronDirectory = readSources(join(root, 'packages', 'agent-capability', 'src', 'builtins', 'cron'));
    const appComposition = read('packages/agent-app/src/composition/create-app.ts');
    const appLifecycle = read('packages/agent-app/src/composition/app-lifecycle-composition.ts');
    const cronDeliveryComposition = read('packages/agent-app/src/composition/cron-delivery-composition.ts');
    const cronRuntimeComposition = read('packages/agent-app/src/cron/cron-runtime-composition.ts');
    const gatewayComposition = read('packages/agent-app/src/composition/gateway-composition.ts');
    const localRuntimePackage = read('packages/agent-app/src/local-runtime-package/index.ts');
    const localProvider = read('packages/agent-platform-gateway-local/src/local-gateway-provider.ts');
    const localGatewayIndex = read('packages/agent-platform-gateway-local/src/index.ts');
    const localCronGateway = read('packages/agent-platform-gateway-local/src/db/sqlite-cron-task-gateway.ts');
    const localCronScheduler = read('packages/agent-platform-gateway-local/src/scheduled/local-cron-task-scheduler.ts');
    const gatewayContract = read('packages/agent-contracts/src/gateway/index.ts');
    const cronTaskRecord = sourceBlock(gatewayContract, 'export interface CronTaskRecord', 'export interface CronTriggerRecord');
    const cronTriggerRecord = sourceBlock(gatewayContract, 'export interface CronTriggerRecord', 'export interface CronTaskWriteOptions');
    const cronContractBlock = sourceBlock(gatewayContract, 'export interface CronTaskRecord', 'export interface GatewayBindingReadiness');

    expect(builtins).toContain('cronToolDefinition');
    expect(builtins).not.toContain('cronCreateToolDefinition');
    expect(builtins).not.toContain('cronListToolDefinition');
    expect(builtins).not.toContain('cronDeleteToolDefinition');
    expect(cronDirectory).toContain('createGatewayCronTaskPort');
    expect(cronDirectory).not.toContain('@nextagent/agent-platform-gateway-local');
    expect(cronDirectory).not.toContain('CapabilityInvocationRequest');
    expect(cronRuntimeComposition).toContain('createGatewayCronTaskPort');
    expect(appComposition).toContain('composeCronRuntimeLayer');
    expect(cronRuntimeComposition).toContain("input.deploymentSelection === 'DISABLED'");
    expect(cronRuntimeComposition).toContain('createRuntimeCronTriggerDelivery');
    expect(appComposition).not.toContain('createInMemoryCronTaskPort');
    expect(appLifecycle).toContain('input.cronTaskScheduler?.start()');
    expect(appLifecycle).toContain("await finalize(() => input.cronTaskScheduler?.stop(), 'cron-scheduler')");
    expect(cronDeliveryComposition).toContain('runtime.submit');
    expect(cronDeliveryComposition).toContain('bindCronTriggerRun');
    expect(cronDeliveryComposition).toContain('cron-trigger:${trigger.triggerId}');
    expect(gatewayComposition).toContain("'cron-tasks'");
    expect(localProvider).toContain('createSqliteCronTaskGateway');
    expect(localRuntimePackage).toContain('cronTaskSchedulerFactory: prepared.localRuntimeBindings.createLocalCronTaskScheduler');
    expect(localGatewayIndex).toContain("export * from './scheduled/local-cron-task-scheduler.js';");

    expect(cronTaskRecord).toContain('extends OwnerScoped');
    expect(cronTaskRecord).toContain('readonly agentId: AgentId;');
    expect(cronTaskRecord).not.toContain('readonly sessionId');
    expect(cronTriggerRecord).toContain('extends OwnerScoped');
    expect(cronTriggerRecord).toContain('readonly agentId: AgentId;');
    expect(cronTriggerRecord).toContain('readonly sessionId?: SessionId;');
    expect(cronTaskRecord).not.toMatch(/idempotencyKey|expectedVersion/u);
    expect(cronTriggerRecord).not.toMatch(/idempotencyKey|expectedVersion/u);
    expect(cronContractBlock).toContain('export interface CronTaskWriteOptions extends IdempotentWriteOptions');
    expect(cronContractBlock).toContain('readonly expectedVersion?: number;');

    expect(localCronGateway).toContain('CREATE TABLE IF NOT EXISTS cron_tasks');
    expect(localCronGateway).toContain('CREATE TABLE IF NOT EXISTS cron_triggers');
    expect(localCronGateway).toContain('tenant_id TEXT NOT NULL');
    expect(localCronGateway).toContain('subject_id TEXT NOT NULL');
    expect(localCronGateway).toContain('agent_id TEXT NOT NULL');
    expect(localCronGateway).toContain('session_id TEXT');
    expect(localCronGateway).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_cron_trigger_anchor');
    expect(localCronGateway).not.toContain('CREATE TABLE IF NOT EXISTS records');
    expect(localCronGateway).not.toContain('json TEXT NOT NULL');
    expect(localCronScheduler).toContain('this.batchSize = options.batchSize ?? 100');
    expect(localCronScheduler).toContain('this.cadenceMs = options.cadenceMs ?? 1000');
    expect(localCronScheduler).toContain('listClaimedTriggers');
    expect(localCronScheduler).toContain('claimCronTrigger');
    expect(localCronScheduler).toContain('AbortController');
  });

  it('keeps Bash host process execution, validated rejection, and trusted shell mode inside the local gateway adapter', () => {
    const capabilitySource = readSources(join(root, 'packages', 'agent-capability', 'src'));
    const coreRuntime = readSources(join(root, 'packages', 'agent-core', 'src')) + readSources(join(root, 'packages', 'agent-runtime', 'src'));
    const gatewaySource = read('packages/agent-platform-gateway-local/src/sandbox/restricted-local-sandbox.ts');

    expect(capabilitySource).not.toContain('node:child_process');
    expect(coreRuntime).not.toContain('node:child_process');
    expect(gatewaySource).toContain('node:child_process');
    expect(gatewaySource).toContain('shell: false');
    expect(gatewaySource).toContain('shell-composition-not-allowed');
    expect(gatewaySource).toContain('requiresShellInterpretation');
    expect(gatewaySource).toContain('resolveTrustedShellExecution');
    expect(gatewaySource).toContain('resolveWindowsCmd');
    expect(gatewaySource).toContain('resolvePosixShell');
    expect(gatewaySource).not.toContain('return command;');
  });

  it('has a single builtin read product path through ToolCatalog and BuiltinToolExecutor', () => {
    const capabilitySource = readSources(join(root, 'packages', 'agent-capability', 'src'));

    expect(existsSync(join(root, 'packages', 'agent-capability', 'src', 'builtins', 'read', 'read-capability.ts'))).toBe(false);
    expect(existsSync(join(root, 'packages', 'agent-capability', 'src', 'builtins', 'read', 'descriptor.ts'))).toBe(false);
    expect(capabilitySource).not.toContain('BuiltinToolsDiscovery');
    expect(capabilitySource).not.toContain('ReadCapabilityInvocationPort');
    expect(capabilitySource).not.toContain('createReadCapabilityDescriptor');
    expect(capabilitySource).not.toContain('createReadCapabilityInvocationPort');
    expect(read('packages/agent-capability/src/catalog/catalog.ts')).not.toContain('readToolDefinition');
    expect(read('packages/agent-capability/src/index.ts')).not.toContain('read-capability');
  });

  it('keeps agent app as composition root and core/runtime away from Tool executor internals', () => {
    const productPaths = [
      'packages/agent-app/src',
      'packages/agent-core/src',
      'packages/agent-runtime/src',
      'packages/agent-capability/src/subsystem.ts',
    ];
    const coreRuntime = readSources(join(root, 'packages', 'agent-core', 'src')) + readSources(join(root, 'packages', 'agent-runtime', 'src'));

    for (const path of productPaths) {
      const source = path.endsWith('.ts') ? read(path) : readSources(join(root, path));
      expect(source).not.toContain('createReadCapabilityDescriptor');
      expect(source).not.toContain('createReadCapabilityInvocationPort');
    }
    expect(coreRuntime).not.toContain('BuiltinToolsExecutor');
    expect(coreRuntime).not.toContain('ToolCatalog');
    expect(coreRuntime).not.toContain('readToolDefinition');
  });

  it('keeps Agent Tool delegation behind capability resolver and subagent execution port', () => {
    const builtins = read('packages/agent-capability/src/builtins/index.ts');
    const agentTool = read('packages/agent-capability/src/builtins/agent/agent-tool.ts');
    const toolSpi = read('packages/agent-capability/src/tools/tool-spi.ts');
    const runtimeSubagentPort = read('packages/agent-runtime/src/lifecycle/subagent-execution-port.ts');
    const runtimeSubmit = read('packages/agent-runtime/src/lifecycle/submit.ts');
    const appComposition = read('packages/agent-app/src/composition/create-app.ts');
    const requestRuntimeComposition = read('packages/agent-app/src/composition/request-runtime-composition.ts');
    const capabilityComposition = read('packages/agent-app/src/composition/capability-composition.ts');
    const capabilityContracts = read('packages/agent-contracts/src/capability/index.ts');
    const runtimeContracts = read('packages/agent-contracts/src/runtime/index.ts');

    expect(builtins).toContain('agentToolDefinition');
    expect(agentTool).toContain("requiredDependencies: ['subagentExecution']");
    expect(agentTool).toContain('@nextagent/agent-contracts/capability');
    expect(agentTool).toContain('resolveCapability');
    expect(agentTool).toContain("kind: 'AGENT'");
    expect(agentTool).toContain('executeSubagent');
    expect(agentTool).not.toContain('@nextagent/agent-contracts/runtime');
    expect(agentTool).not.toContain('@nextagent/agent-runtime');
    expect(agentTool).not.toContain('createRequestLifecycleCoordinator');
    expect(agentTool).not.toContain('.submit(');
    expect(agentTool).not.toContain('agent.yaml');
    expect(agentTool).not.toContain('createSession');
    expect(toolSpi).toContain('@nextagent/agent-contracts/capability');
    expect(toolSpi).not.toContain('@nextagent/agent-contracts/runtime');
    expect(capabilityContracts).toContain('interface SubagentExecutionPort');
    expect(runtimeContracts).not.toContain('interface SubagentExecutionPort');
    expect(runtimeSubagentPort).toContain('this.deps.runtime.submit');
    expect(runtimeSubagentPort).not.toContain('AgentInstanceManager');
    expect(runtimeSubagentPort).not.toContain('.execute(run');
    expect(runtimeSubagentPort).toContain('createDeferredSubagentExecutionPort');
    expect(requestRuntimeComposition).toContain('createRuntimeSubagentExecutionPort');
    expect(capabilityComposition).toContain('createDeferredSubagentExecutionPort');
    expect(appComposition).not.toContain('function lazySubagentExecutionPort');
    expect(runtimeSubmit).toContain('wakeScheduler()');
    expect(runtimeSubmit).toContain('runSchedulerLoop()');
    expect(runtimeSubmit).toContain('reserveNextWork()');
    expect(runtimeSubmit).toContain('dispatchReservedWork');
    expect(runtimeSubmit).toContain('inflightCount');
    expect(runtimeSubmit).toContain('priorityRank');
    expect(runtimeSubmit).not.toContain('private async drainLane');
    expect(runtimeSubmit).not.toContain('drainAllLanes');
  });

  it('injects sandbox execution through a replaceable gateway port', () => {
    const contractsSource = read('packages/agent-app/src/composition/composition-contracts.ts');

    expect(contractsSource).toContain('sandboxGateway?: AppSandboxGatewayPort');
    expect(contractsSource).not.toContain('sandboxGateway?: ReturnType<typeof createRestrictedLocalSandboxGateway>');
    expect(read('packages/agent-platform-gateway-local/src/index.ts')).not.toContain('export type { SandboxGatewayPort }');
  });
});

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

function sourceBlock(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

function readSources(directory: string): string {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return readSources(path);
      }
      return entry.isFile() && entry.name.endsWith('.ts') ? readFileSync(path, 'utf8') : '';
    })
    .join('\n');
}
