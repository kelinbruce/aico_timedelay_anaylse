# 验证结果（Verification Results）

## 2026-06-18 builtin root 扫描与 workspace 配置清理验证

- `node node_modules/typescript/bin/tsc -b --pretty false`
  - 结果：PASS。

- `npm.cmd test -- tests/agent-kernel/config-assembly.test.ts tests/agent-kernel/invoked-agent-discovery-config.test.ts packages/agent-capability/tests/invoked-agent-discovery.test.ts packages/agent-context-engine/tests/skill-disclosure-render.test.ts tests/local-runtime-package.test.ts`
  - 结果：PASS，5 个文件 / 80 个测试通过。
  - 覆盖：从可信 root 发现 builtin Agent package、builtin 配置中无 legacy `workspaceDir` / `workspaceFiles`、默认 Agent 绑定到 `network-explorer`、`network-explorer` 禁用副作用 builtin tool 而非显式启用默认 read/search tool，以及既有 Agent discovery/catalog/prompt 行为。

- `npm.cmd test -- tests/agent-kernel/config-assembly.test.ts tests/agent-kernel/invoked-agent-discovery-config.test.ts tests/e2e/write-product-path.test.ts`
  - 结果：PASS，3 个文件 / 46 个测试通过。
  - 覆盖：省略 `workspaceFiles` 时推导产品默认 workspace 写授权、显式 `workspaceFiles.writeDirectories=[]` 仍禁用写入，以及写产品路径在无 legacy builtin Agent 配置字段时保持可用。

- `openspec.cmd validate add-ts-invoked-agent-discovery --strict`
  - 结果：PASS，change 有效。

- `git diff --check`
  - 结果：PASS。

- `npm.cmd run build`
  - 结果：PASS。

- `npm.cmd run test:contract`
  - 结果：PASS，6 个文件 / 46 个测试通过。

- `npm.cmd run lint:architecture`
  - 结果：PASS，无依赖违规且 package manifest policy 通过。

- `openspec.cmd validate --all --strict`
  - 结果：PASS，74 项通过。

- `npm.cmd test`
  - 结果：PASS。

- 源码卫生：
  - `rg -n 'export interface BuiltinAgentPackage|function builtinAgentPackages|builtinAgentPackages\(|agentId: "network-explorer"' packages/agent-core/src packages/agent-app/src tests/agent-kernel/invoked-agent-discovery-config.test.ts`
  - `rg -n 'local-agents-parent-owned|localAgentsParentOwnedProvider|LocalAgentCapabilityDiscovery|BuiltinAgentCandidate|LocalAgentPackageCandidate|subagentPackageLocator|AgentPackageSourceLocator\.listSubagentPackages|AgentPackageSourceLocator\.locateSubagentPackage|SubagentDiscoverySource|SubagentDescriptor|InvokedAgentAssembly|BuiltinAgentAssembly|SubagentAssembly' packages/agent-app/src packages/agent-capability/src packages/agent-contracts/src packages/agent-core/src`
  - 结果：PASS，手工维护的 builtin Agent package 列表已移除，且生产 Agent discovery 无第二路径。

## 2026-06-18 builtin Agent package owner 迁移验证

- `node node_modules/typescript/bin/tsc -b --pretty false`
  - 结果：PASS。

- `npm.cmd test -- tests/agent-kernel/config-assembly.test.ts tests/agent-kernel/invoked-agent-discovery-config.test.ts packages/agent-capability/tests/invoked-agent-discovery.test.ts packages/agent-context-engine/tests/skill-disclosure-render.test.ts tests/local-runtime-package.test.ts`
  - 结果：PASS，5 个文件 / 80 个测试通过。
  - 覆盖：builtin 默认 Agent 和 `network-explorer` 通过 package 形态定义加载、builtin prompt 注册来自 package 本地 `prompts/`、默认 Agent 绑定到 `network-explorer`、本地 runtime 打包配置样例，以及既有 Agent discovery/catalog/prompt 行为。

- `openspec.cmd validate add-ts-invoked-agent-discovery --strict`
  - 结果：PASS，change 有效。

- `npm.cmd run build`
  - 结果：PASS。
  - 构建后资源检查：
    - `packages/agent-core/dist/builtin-agents/default-agent/agent.yaml`：存在。
    - `packages/agent-core/dist/builtin-agents/network-explorer/prompts/SYSTEM_PROMPT/template.yaml`：存在。
    - `packages/agent-app/dist/assembly/builtin-agents`：不存在，确认过期的旧 owner 产物已被清理。

- `git diff --check`
  - 结果：PASS。

- `npm.cmd run test:contract`
  - 结果：PASS，6 个文件 / 46 个测试通过。

- `npm.cmd run lint:architecture`
  - 结果：PASS，无依赖违规且 package manifest policy 通过。

- `openspec.cmd validate --all --strict`
  - 结果：PASS，74 项通过。

- `npm.cmd test`
  - 结果：PASS。

- 源码卫生：
  - `rg -n "createNetworkExplorerDefinition|packages/agent-app/src/assembly/builtin-agents|packages[\\/]agent-app[\\/]config[\\/]default-agent.yaml" packages/agent-app/src packages/agent-core/src scripts`
  - `rg -n "local-agents-parent-owned|localAgentsParentOwnedProvider|LocalAgentCapabilityDiscovery|BuiltinAgentCandidate|LocalAgentPackageCandidate|subagentPackageLocator|AgentPackageSourceLocator\\.listSubagentPackages|AgentPackageSourceLocator\\.locateSubagentPackage|SubagentDiscoverySource|SubagentDescriptor|InvokedAgentAssembly|BuiltinAgentAssembly|SubagentAssembly" packages/agent-app/src packages/agent-capability/src packages/agent-contracts/src packages/agent-core/src`
  - 结果：PASS，手工构建的 `network-explorer` 定义已移除、app 拥有的 builtin Agent package 资源已移除、app 拥有的默认 Agent 配置源已移除，且生产 Agent discovery 无第二路径。

## 2026-06-18 实现检视清理验证

- `node node_modules/typescript/bin/tsc -b --pretty false`
  - 结果：PASS。

- `npm.cmd test -- tests/agent-kernel/config-assembly.test.ts tests/agent-kernel/invoked-agent-discovery-config.test.ts packages/agent-capability/tests/invoked-agent-discovery.test.ts packages/agent-context-engine/tests/skill-disclosure-render.test.ts`
  - 结果：PASS，4 个文件 / 66 个测试通过。
  - 覆盖：省略 `userInvocable` / `agentInvocation` 时默认为 `true` / `BOUND`、builtin prompt 注册由 builtin discovery 记录推导、受治理 prompt 披露仍包含 `network-explorer`，以及既有 Agent discovery/catalog 行为仍有覆盖。

- `openspec.cmd validate add-ts-invoked-agent-discovery --strict`
  - 结果：PASS，change 有效。

- `npm.cmd run build`
  - 结果：PASS。

- `npm.cmd run test:contract`
  - 结果：PASS，6 个文件 / 46 个测试通过。

- `npm.cmd run lint:architecture`
  - 结果：PASS，无依赖违规且 package manifest policy 通过。

- `openspec.cmd validate --all --strict`
  - 结果：PASS，74 项通过。

- `npm.cmd test`
  - 结果：PASS。

- 源码卫生：
  - `rg -n 'agentId: "network-explorer"|builtinNetworkExplorerPromptRoot|CompiledAgentAssemblyRegistry|export type AgentAssemblySourceKind|export interface AgentDiscoveryAssemblyRecordsInput' packages/agent-app/src tests`
  - 结果：PASS，硬编码的 builtin prompt 注册已移除、不必要的导出实现类型已移除；剩余命中只有 `createCompiledAgentAssemblyRegistry`。

## 2026-06-18 builtin 到 builtin 的 subagent 绑定验证

- `node node_modules/typescript/bin/tsc -b --pretty false`
  - 结果：PASS。

- `npm.cmd test -- tests/agent-kernel/config-assembly.test.ts tests/agent-kernel/invoked-agent-discovery-config.test.ts`
  - 结果：PASS，2 个文件 / 45 个测试通过。
  - 覆盖：默认 builtin Agent 配置/回退 assembly 保留 builtin `network-explorer` `AGENT` 绑定，以及生产 app composition 通过受治理的 `### Available agents` 披露渲染 `network-explorer`。

- `openspec.cmd validate add-ts-invoked-agent-discovery --strict`
  - 结果：PASS，change 有效。

- `git diff --check`
  - 结果：PASS。

- `npm.cmd run build`
  - 结果：PASS。

- `npm.cmd run test:contract`
  - 结果：PASS，6 个文件 / 46 个测试通过。

- `npm.cmd run lint:architecture`
  - 结果：PASS，无依赖违规且 package manifest policy 通过。

- `openspec.cmd validate --all --strict`
  - 结果：PASS，74 项通过。

- `npm.cmd test`
  - 结果：PASS。

- 源码卫生：
  - `rg -n "local-agents-parent-owned|localAgentsParentOwnedProvider|LocalAgentCapabilityDiscovery|BuiltinAgentCandidate|LocalAgentPackageCandidate|subagentPackageLocator|AgentPackageSourceLocator\\.listSubagentPackages|AgentPackageSourceLocator\\.locateSubagentPackage|SubagentDiscoverySource|SubagentDescriptor|InvokedAgentAssembly|BuiltinAgentAssembly|SubagentAssembly" packages/agent-app/src packages/agent-capability/src packages/agent-contracts/src`
  - 结果：PASS，生产代码无命中。

## 2026-06-17 检视 follow-up 2 验证

- `npm.cmd test -- packages/agent-capability/tests/invoked-agent-discovery.test.ts`
  - 修复前 RED：失败，原因是 locator 在工作中 abort 时本地 Agent discovery 仍发布 descriptor，且同一 scope 的前一次搜索 readiness 证据在之后针对同一父 Agent scope 的搜索后仍然可见。
  - 修复后 GREEN：PASS，1 个文件 / 17 个测试通过。
  - 覆盖：locator 工作中 abort 返回空的 safe discovery 结果、当前 scope readiness 证据在下一次搜索时被替换、其他父 Agent scope 不被全局清除，以及既有 Agent discovery 治理覆盖保持完整。

- `npm.cmd run build`
  - 修复期间 RED：在 TypeScript 收窄的 `signal.aborted === true` 比较上失败。
  - 清理后 GREEN：PASS。

- `npm.cmd run test:contract`
  - 结果：PASS，6 个文件 / 45 个测试通过。

- `npm.cmd run lint:architecture`
  - 结果：PASS，无依赖违规且 package manifest policy 通过。

- `openspec.cmd validate add-ts-invoked-agent-discovery --strict`
  - 结果：PASS，change 有效。

- 残余风险：
  - 本次 follow-up 未重跑 `npm test` 全量套件；此前的宽范围验证仍以下方 2026-06-15 那一轮为准。

## 2026-06-17 无契约取消边界验证

- `npm.cmd test -- packages/agent-capability/tests/invoked-agent-discovery.test.ts`
  - 修复前 RED：失败，原因是移除非法的 `CapabilityCatalogRequest.signal` 测试路径后 `StaticCapabilityCatalog.listAvailableWithSignal` 不存在。
  - 修复后 GREEN：PASS，1 个文件 / 16 个测试通过。
  - 覆盖：公开 `CapabilityCatalogRequest` 不得走私 `signal`、实现侧 Catalog signal 传播进入 SEARCH discovery、discovery 到 locator 的 signal 传播、按 scope 的本地 Agent 加载事实/readiness 证据，以及 Agent discovery 治理覆盖。

- `npm.cmd run build`
  - 结果：PASS。

- `npm.cmd run test:contract`
  - 结果：PASS，6 个文件 / 45 个测试通过。

- `npm.cmd run lint:architecture`
  - 结果：PASS，无依赖违规且 package manifest policy 通过。

- `openspec.cmd validate add-ts-invoked-agent-discovery --strict`
  - 结果：PASS。

- 契约边界说明：
  - 本次 follow-up 有意不修改 `packages/agent-contracts`。
  - 公开的 `CapabilityCatalog.listAvailable(request)` 和 `CapabilityCatalogRequest` 保持不变。
  - 通过 Catalog contract 的公开 request-lifecycle 取消推迟到后续 contract refinement change。
  - 本次 follow-up 未重跑 `npm test` 全量套件；此前的宽范围验证仍以下方 2026-06-15 那一轮为准。

## 2026-06-17 检视 follow-up 验证

- `npm.cmd test -- packages/agent-capability/tests/invoked-agent-discovery.test.ts`
  - 修复前 RED：失败于缺少 locator signal 传播、未按 scope 的本地 Agent 加载事实查找，以及 LOCAL_DIRECTORY provider 消息措辞。
  - 修复后 GREEN：PASS，1 个文件 / 16 个测试通过。
  - 覆盖：Catalog 到 discovery 的 signal 传播、discovery 到 locator 的 signal 传播、按 scope 的本地 Agent 加载事实、按 scope 的本地 Agent readiness 证据、中性的保留 LOCAL_DIRECTORY provider 消息、既有 Agent discovery 治理覆盖。

- `npm.cmd run build`
  - 结果：PASS。

- `openspec.cmd validate add-ts-invoked-agent-discovery --strict`
  - 结果：PASS。

- `npm.cmd test -- packages/agent-context-engine/tests/skill-disclosure-render.test.ts tests/agent-kernel/invoked-agent-discovery-config.test.ts tests/architecture/local-skill-source-boundary.test.ts`
  - 结果：PASS，3 个文件 / 17 个测试通过。
  - 覆盖：生产 app composition 本地 Agent discovery 装配、受治理的 Agent prompt 渲染，以及 architecture 源码扫描边界。

- `npm.cmd run test:contract`
  - 结果：PASS，6 个文件 / 45 个测试通过。

- `npm.cmd run lint:architecture`
  - 结果：PASS，无依赖违规且 package manifest policy 通过。

- `npm test`
  - 结果：本次 follow-up 未重跑；此前的宽范围验证仍以下方 2026-06-15 那一轮为准。

## 2026-06-16 follow-up 验证

- `npm.cmd test -- packages/agent-capability/tests/invoked-agent-discovery.test.ts packages/agent-context-engine/tests/skill-disclosure-render.test.ts tests/agent-kernel/invoked-agent-discovery-config.test.ts`
  - 结果：PASS，3 个文件 / 25 个测试通过。
  - 覆盖：builtin Agent metadata 脱敏、本地 Agent discovery 生产 composition 装配、受治理的 Agent 模型可见披露，以及既有 invoked Agent discovery 聚焦覆盖。

- `openspec.cmd validate add-ts-invoked-agent-discovery --strict`
  - 结果：PASS。
- `npm.cmd run build`
  - 结果：PASS。

## 2026-06-15 宽范围验证

- `npm.cmd run test:contract`
  - 结果：PASS，6 个文件 / 44 个测试通过。
- `npm.cmd run lint:architecture`
  - 结果：PASS，无依赖违规且 package manifest policy 通过。
- `npm.cmd test`
  - 结果：PASS，120 个文件 / 1021 个测试通过，5 个文件 / 14 个测试跳过。
