## 背景与问题（Why）

NextAgent workflow 已有 `runtime.controlPolicy` 契约，定义了 `resume`/`modify`/`cancel`/`restart` 四个入口，每个入口是 `{ strategy, rollbackNode? }`，strategy 取六值枚举。但该设计存在两个结构性问题：

- **语义错位**：规范把 "cancel" 绑定到"节点失败"（`terminalState === "FAILED"`），不是"外部取消"。`applyControlPolicy` 唯一触发点是节点失败，外部 `controller.abort()` 路径直接返回 `INTERRUPTED`，完全绕过 controlPolicy。导致名为 cancel 的策略实际管的是节点失败，真正的外部取消无处安放。
- **空壳入口**：`resume`/`modify`/`restart` 三个入口已定义契约但无场景、无实现、未归档，留存意义不大。

controlPolicy 整体尚未归档进 baseline spec（`openspec/specs/workflow-contracts`、`openspec/specs/workflow-execution-engine` 中无 controlPolicy），全仓无任何 recipe 在用。这是废弃重构成本最低的时机。

电信运维场景存在明确诉求：一些 workflow 操作在取消后需要做写操作的回退（补偿），例如配置回滚、资源释放、状态复位。当前外部 cancel 只 abort signal，无法表达"取消后先回退补偿再终止"。

## 变更范围（What Changes）

- **废弃** 旧 `ControlPolicy` 设计：移除 `ControlPolicyStrategySchema`（六值枚举）、`ControlPolicyEntrySchema`（`{ strategy, rollbackNode? }`）、`ControlPolicySchema`（`resume`/`modify`/`cancel`/`restart` 四入口）。
- **废弃** `resume`/`modify`/`restart` 三个入口（无场景、无实现、未归档）。
- **废弃** 引擎中"节点失败触发 controlPolicy"路径（`applyControlPolicy`、`skipControlPolicy` 参数、`terminalState === "FAILED"` 分支）。
- **重构** `ControlPolicy` 为只含 `cancel` 的外部取消策略：`cancel` 复用 `WorkflowBranchDef`（`Record<nodeId, { condition? }>`），与 `next`/`exception` 同形同策；新增 `cancelTimeout`（秒）作为 cancel 回退专属超时。
- **新增** 外部 cancel 触发路径：runtime `controller.abort()` 后，引擎检测 `signal.aborted` 时检索 `controlPolicy.cancel`；有回退目标则用独立子信号（`cancelTimeout`）执行回退节点子路径再终止，无则直接终止（兼容当前 INTERRUPTED 行为）。
- **明确** 节点失败不再进 controlPolicy，完全由 `retry`（节点级重试）和 `exception` 分支（节点级异常转移）承载，无 exception 则直接 FAILED 终止。
- **明确** `condition` 字段为预留能力，首版不求值；未来支持根据条件/变量跳转到不同回退分支。
- **明确** 回退路径不写 checkpoint（补偿非正向流程），继承原 run 的 agent scope / owner scope。
- **明确** 回退失败仅记录诊断日志（`WORKFLOW_ROLLBACK_FAILED` / `WORKFLOW_CANCEL_TIMEOUT`），不改终态；runtime 的 cancel 终态逻辑暂不动，cancel 上下文终态仍为 CANCELED。

## 不在范围内（Explicit Non-Goals）

- 不改 runtime cancel 终态映射（CANCELED 保持），但修改 cancel 对 executing run 的终态提交时序：从 cancel() 立即提交改为等 agent.execute() 返回后提交，保留 cancel 回退内容。
- 不实现 `condition` 的动态求值（首版预留，不参与回退分支选择）。
- 不实现 `resume`/`modify`/`restart` 策略（已废弃，未来如需另起 change）。
- 不新增 Web API 或 runtime command；外部 cancel 接口保持现有 `POST /cancel` → `controller.abort()`。
- 不引入 workflow durable cancel recovery / snapshot；回退是同步补偿，不持久化。
- 不改 runtime `exposesUserCancelRoute` 边界（保持现有 cancel 接口可达性）。

## Roadmap 关系

所属分组：P3 — Workflow 执行范式 / Workflow 生产硬化。roadmap 输入：[refine-ts-workflow-cancel-policy](../docs/nextagent-ts-changes/refine-ts-workflow-cancel-policy.md)。

owner 迁移：原 dd-ts-workflow-persistence-recovery（已 Complete）承接的 controlPolicy.cancel rollback 语义和执行路径由本 change 接管并重新定义。persistence-recovery 的 checkpoint 投影 / recovery / loop 语义不受影响。本 change 废弃三个 active change 的 ControlPolicy requirement：efine-ts-workflow-recipe-v2-contracts（active）、efine-ts-workflow-execution-engine-v2（已 Complete）、dd-ts-workflow-persistence-recovery（已 Complete）。三个 change 的 controlPolicy requirement 均未归档进 baseline spec，废弃不破坏冻结契约。

依赖：dd-ts-workflow-persistence-recovery（rollback 语义 owner 迁移源）、efine-ts-workflow-recipe-v2-contracts（controlPolicy 契约定义源）、efine-ts-workflow-execution-engine-v2（controlPolicy 解析实现源）。

## Capability 影响（Capabilities）

### 修改的 Capability

- `workflow-contracts`：重构 `ControlPolicy` schema，移除 `ControlPolicyStrategy`/`ControlPolicyEntry`/`resume`/`modify`/`restart`，`cancel` 改为 `Record<nodeId, WorkflowBranchDef>`，新增 `cancelTimeout`。
- `workflow-execution-engine`：废弃节点失败 controlPolicy 路径，新增外部 cancel 触发的回退执行路径。

## 影响范围（Impact）

- `agent-contracts/core`：`ControlPolicySchema` 重构，`RuntimeConfigSchema.controlPolicy` 类型随之改变；移除 `ControlPolicyStrategySchema`/`ControlPolicyEntrySchema` 导出。
- `agent-workflow/engine`：移除 `applyControlPolicy`/`skipControlPolicy`；新增 cancel 回退执行（独立子信号、超时、诊断）。
- `agent-workflow/workflow-recipe-loader`：controlPolicy normalize 重写（`cancel` 为 Record，`cancel_timeout`→`cancelTimeout`）。
- `agent-runtime`：不改（cancel 仍只 `controller.abort()`，终态仍 CANCELED）。
- 测试：废弃 `workflow-control-policy.test.ts`（节点失败场景），新增外部 cancel 回退测试。
- 跨 package 边界不变，loader 通过 public export 消费 contract schema。
