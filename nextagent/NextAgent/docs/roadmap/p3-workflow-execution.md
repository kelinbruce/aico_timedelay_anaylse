[返回 Roadmap V2](../nextagent-ts-change-roadmap-v2.md)

## P3 — Workflow 执行范式

在 Agent 单链问答（conversation loop）基础上，增加基于 DAG 的工作流编排能力，支撑电信运维场景中的多步骤诊断流程、审批流程、数据管道和自动化 Runbook。Workflow 与 Conversation 是 agent-core RouterModule 下的两个并列执行范式，共用 `ModelInvocationService` 和 `CapabilityInvocationService` 边界。

### Workflow 架构定位

- `WorkflowExecutionService` port 定义在 `agent-contracts/core`，与 `ModelInvocationService` 同级——作为 agent-core 依赖的抽象，`agent-workflow`（新 package）实现，`agent-app` 注入。
- agent-core RouterModule 扩展 recipe 匹配和分发：显式 `recipeId` 优先 → 意图识别匹配 → 降级 conversation loop。
- Recipe 是静态 Recipe DSL 资源；加载为运行时可执行能力后，以 `WORKFLOW` capability descriptor 注册到当前 Agent Scope 的 capability catalog。`RECIPE` 不作为 runtime capability kind，模型通过 builtin `Workflow` Tool adapter 调用已治理的 workflow。
- recipe 以 YAML 定义在 `agents/{agentId}/recipes/<recipeId>.yaml`，与 `skills/` 平级，启动期由 `AgentPackageAssembly` 扫描加载。
- workflow 引擎内部节点通过标准 `ModelInvocationService`、`CapabilityInvocationService`、sandbox gateway 等 port 调用，不另建调用路径。
- 可观测性（trace/audit/metric）由 `agent-observability` 通过 engine lifecycle hooks 承载，engine 不自行创建 logger/span/audit writer。

### Workflow 生产硬化

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`add-ts-workflow-persistence-recovery`](../nextagent-ts-changes/add-ts-workflow-persistence-recovery.md) | candidate | 复用 runtime `CheckpointStoreGateway` + `flowVariables` 承接 workflow 执行坐标投影、单实例中断恢复、降级/回滚执行（`ROLLBACK`/`DEGRADE`）；不新增平行 checkpoint store。 | [详情](../nextagent-ts-changes/add-ts-workflow-persistence-recovery.md) |
| [`refine-ts-workflow-cancel-policy`](../nextagent-ts-changes/refine-ts-workflow-cancel-policy.md) | active | 废弃旧 controlPolicy（cancel 绑定节点失败），重构为外部取消回退策略；接管原属 persistence-recovery 的 rollback 语义。 | [详情](../nextagent-ts-changes/refine-ts-workflow-cancel-policy.md) |
| [`add-ts-workflow-loop-control`](../nextagent-ts-changes/add-ts-workflow-loop-control.md) | candidate | 如需通用 `loop` 控制流，由本 change 承接 loop contract refinement、迭代调度和与 retry/interrupt/recovery 的交互。 | [详情](../nextagent-ts-changes/add-ts-workflow-loop-control.md) |
| [`add-ts-workflow-recipe-registry-persistence`](../nextagent-ts-changes/add-ts-workflow-recipe-registry-persistence.md) | candidate | 如需 recipe durable registry，由本 change 澄清文件加载与持久化真相边界，并承接落库 owner。 | [详情](../nextagent-ts-changes/add-ts-workflow-recipe-registry-persistence.md) |
| [`persist-ts-refresh-stable-completed-turns`](../nextagent-ts-changes/persist-ts-refresh-stable-completed-turns.md) | active | 统一 Direct 与 Workflow-as-Tool 的产品过程 durable owner、上下文边界和 live/history 恢复；terminal continuation/recovery 不在范围，归档排在两个已完成 `tool-structured-delta` change 之后。 | [详情](../nextagent-ts-changes/persist-ts-refresh-stable-completed-turns.md) |
| [`add-ts-workflow-event-history`](../nextagent-ts-changes/add-ts-workflow-event-history.md) | blocked | 当前 change 归档后重新设计审计/诊断级全节点历史；不得再拥有用户可见 product body 或 inner Capability Result 路径。 | [详情](../nextagent-ts-changes/add-ts-workflow-event-history.md) |
| [`add-ts-workflow-distributed-execution`](../nextagent-ts-changes/add-ts-workflow-distributed-execution.md) | candidate | 如需 workflow 多实例执行、ready node/branch 分发、single-owner claim 和跨实例 join barrier，由本 change 承接。 | [详情](../nextagent-ts-changes/add-ts-workflow-distributed-execution.md) |

### 长期记忆

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`add-ts-memory-maintenance`](../nextagent-ts-changes/add-ts-memory-maintenance.md) | candidate | 记忆可被维护和清理，维护操作可审计。 | [详情](../nextagent-ts-changes/add-ts-memory-maintenance.md) |
| [`add-ts-memory-sharing`](../nextagent-ts-changes/add-ts-memory-sharing.md) | candidate | 记忆可在多个会话间共享，受 owner scope 约束。 | [详情](../nextagent-ts-changes/add-ts-memory-sharing.md) |

### 执行核心扩展

下列 candidate 延续 P3 执行范式主题，承接 Skill fork 执行、多 Host Agent 选择、AF 1.0 Skill 规范支持和 AgenticLoop 上限总结。

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`add-ts-skill-fork-execution`](../nextagent-ts-changes/add-ts-skill-fork-execution.md) | candidate | `Skill` manifest `context=fork` 的独立模型循环、隔离上下文、受限工具集、nested invocation 防护和结果回流。 | [详情](../nextagent-ts-changes/add-ts-skill-fork-execution.md) |
| [`add-ts-runtime-host-agent-selection`](../nextagent-ts-changes/add-ts-runtime-host-agent-selection.md) | candidate | 多 Host Agent 共存时的可信选择、session 创建绑定、权限校验、审计和 fallback。 | [详情](../nextagent-ts-changes/add-ts-runtime-host-agent-selection.md) |
| [`add-ts-framework-skill-compatibility`](../nextagent-ts-changes/add-ts-framework-skill-compatibility.md) | candidate | AF 1.0 的 `API` / `StreamingAPI` / `Recipe` / `Subagent` 四种 provider kind 兼容，走统一 governance 入口和 AI2H 自定义转发函数。 | [详情](../nextagent-ts-changes/add-ts-framework-skill-compatibility.md) |
| [`add-ts-loop-limit-summary`](../nextagent-ts-changes/add-ts-loop-limit-summary.md) | candidate | AgenticLoop `maxDurationMs` / `maxIterations` 上限检测、`LIMIT_REACHED` 状态、finalization model round 和总结输出。 | [详情](../nextagent-ts-changes/add-ts-loop-limit-summary.md) |
