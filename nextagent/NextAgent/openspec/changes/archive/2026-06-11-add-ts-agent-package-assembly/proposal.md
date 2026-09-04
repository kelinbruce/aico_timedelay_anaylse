## 背景与问题（Why）

当前主干已经在多个 stable spec 中冻结了与 Agent assembly 相关的关键约束：

- `agent-app` 必须在启动期把 Agent 定义编译成 runtime-safe `AgentAssemblyRegistry`
- Runtime 在 acceptance 阶段只通过 `AgentAssemblyRegistry.active(agentId)` 解析 active assembly
- accepted request、recovery、core、context 和 capability routing 只能通过 `require(agentId, agentVersion)` 读取冻结 assembly
- `AgentAssembly.capabilityBindings` 是 runtime-facing enabled binding facts，不是 capability discovery 快照；explicit disable fact 不进入该字段集合

但这些约束目前分散在 `ts-minimal-agent-kernel`、`capability-catalog`、`ts-core-contracts` 和架构设计文档中，没有一份独立 change 把 **Agent package 输入如何被读取、校验、编译并发布为 runtime-facing assembly** 收敛成单一边界。结果是：

- `agent-app` 容易把产品入口选择、打包布局、运行时装配和启动期诊断混写成一个复合职责
- assembly compiler 容易越界承担 capability discovery / availability 判断
- runtime-facing package 输入边界、compile 顺序和失败收敛规则缺少独立审查入口

本次 change 重新建立一个独立的 `agent-package-assembly` change，只处理 **已被 app composition 选中的 Agent package root 如何编译成 runtime-ready assembly 并被主路径唯一消费**，不再把产品入口选择、default-agent 打包同步或 release packaging 合并进来。

## 变更范围（What Changes）

- 新增独立的 `add-ts-agent-package-assembly` change，定义 Agent package assembly 的启动期 compile 边界、输入权威、编译顺序、runtime-facing 产物和失败/降级规则。
- 新增 `agent-package-assembly` capability，作为 package assembly 行为契约的独立主承载文档。
- 明确 package assembly 的前置条件：app composition 决定哪些 package root 参与 compile；本 change 不定义“如何选择 package root”。
- 明确 `agent.yaml` 是权威业务装配输入；`skills/`、`subagents/`、`prompts/` 和 assembly-scoped provider/source 只提供候选事实，不直接形成 runtime-facing assembly。
- 明确 assembly compiler 只负责 compile-time shape / identity / workspace / registered-ref 校验与 runtime-facing 结果生成；capability descriptor existence、availability、conflict 和 executability 继续由 capability catalog 负责。
- 明确 request path 只能消费 compiled `AgentAssemblyRegistry` 或 accepted assembly facts，不得重新读取 package 输入。
- 修改 `AgentCapabilityBinding` 语义：compiler 不再过滤 `enabled=false` 的 binding，而是透传全部 binding facts 到 runtime-facing assembly。`enabled` 字段继续保留在契约中，用于 Capability Catalog 计算默认 builtin 的显式禁用结果。

## Capability 影响（Capabilities）

### 新增 Capability
- `agent-package-assembly`: 定义 Agent package root 在启动期如何被编译为 runtime-ready `AgentAssembly`、如何填充 `AgentAssemblyRegistry`，以及请求路径如何唯一消费该结果。

### 修改的 Capability
- 无

## 与冻结基线的一致性说明（Consistency With Frozen Baselines）

- 本 change 与 `establish-ts-backend-architecture` 一致：继续由 `agent-app` 作为唯一 composition root 拥有 package assembly compile，runtime、core、context、capability 和 recovery 只消费 compiled assembly facts。
- 本 change 与 `establish-ts-core-contracts` 一致：只复用已冻结的 `AgentAssembly` / `AgentAssemblyRegistry` lookup 语义，其中 runtime-facing `AgentAssembly` 继续包含 `agentAssemblyRef` 作为冻结执行坐标；`active(agentId)` / `require(agentId, agentVersion)` contract 保持不变。
- 本 change 新增的是一个独立 capability 文档入口，用来集中承载 package assembly 的黑盒边界；compiler 透传全部 capability binding facts（含 `enabled`）到 runtime-facing assembly。`enabled` 字段继续保留在契约中，compiler 只校验 binding shape 和 provider registration，不替 catalog 做 enabled/disabled 决策。这与 `establish-ts-core-contracts` 一致。

## 影响范围（Impact）

- `packages/agent-app/src/assembly/*`：package 读取、definition parse、startup compile、registry 填充和 assembly compile diagnostics。
- `packages/agent-app/src/composition/*`：启动期 compile 的唯一接入点，以及向 runtime/core/context/capability 注入 runtime-facing assembly lookup。
- `packages/agent-contracts/src/agent-assembly/*`：`AgentCapabilityBinding.enabled` 字段保留，compiler 由过滤改为透传。
- `packages/agent-capability/*`：需要继续遵守 capability catalog 和 assembly compiler 的边界，不得要求 assembly compiler 先完成 descriptor discovery。
- `packages/agent-runtime`、`packages/agent-core`、`packages/agent-context-engine`：继续只消费 compiled registry / accepted assembly facts。
- `tests/agent-kernel/config-assembly.test.ts` 及相关 characterization tests：覆盖 compile 顺序、request-path no-reparse、workspace 校验、missing assembly 和 capability binding compile boundary。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/agent-package-assembly/spec.md`：新增独立长期 capability，承载 package assembly 的可验证行为契约

长期背景：
- `openspec/overview.md`：补充为什么 package assembly 需要独立于最小内核和 capability catalog 的长期背景

设计视图：
- `openspec/designs/architecture/core-contracts.md`：如需补充 assembly compile 与 runtime lookup 的边界导航，则更新；否则无
- `openspec/designs/architecture/configuration-boundary.md`：如需补充 package root selection 是 app-composition 前置条件，则更新；否则无
- `openspec/designs/modules/agent-app.md`：补充 `agent-app` 对 package assembly compile、registry 和 diagnostics 的职责
- `openspec/designs/spec-to-design-map.md`：新增 `agent-package-assembly` capability 到 architecture/modules 的导航
- `openspec/designs/adr/<id>.md`：无

验证入口：
- `npm test -- tests/agent-kernel/config-assembly.test.ts`
- `npm run build`
- `npm test`
- `npm run test:contract`
- `npm run lint:architecture`
- `openspec validate --all --strict`
