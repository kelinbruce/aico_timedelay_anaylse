# add-ts-workflow-persistence-recovery

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：P3 — Workflow 执行范式 / Workflow 生产硬化

状态：candidate
类型：实施 change
主要 owner：`agent-workflow`（engine 侧）+ runtime checkpoint 体系（复用）
依赖：`add-ts-workflow-execution-engine`、`add-ts-workflow-gateway-nodes`

目标：
- 承接 workflow 执行坐标的 checkpoint 投影与单实例中断恢复。
- 承接超出最小 engine 范围的 rollback / degrade 执行语义。

owner 迁移说明：
- controlPolicy.cancel 的 rollback 语义和执行路径已迁移到 `refine-ts-workflow-cancel-policy`（active）。本 change 的 ControlPolicy Rollback Execution requirement 被该 change 废弃重写。
- checkpoint 投影 / recovery / loop 语义不受影响，仍归本 change。

规格输入：

- workflow 执行坐标投影到 runtime 已冻结的 `CheckpointRecord.flowVariables` 的 workflow 子结构（`recipeName`/`recipeVersion`/`contextVariables`/`nodeResults`/`completedNodeIds`/`readyNodeIds`），由 runtime `CheckpointStoreGateway` 持久化，不新增平行 `WorkflowStoreGateway` 或 `WorkflowExecutionSnapshot`。
- `CheckpointTriggerReason` 新增 workflow 触发值 `WORKFLOW_NODE_COMPLETED`、`WORKFLOW_ROLLBACK`、`WORKFLOW_DEGRADE`，归 `agent-common` durable vocabulary。
- 乐观并发复用 `CheckpointRecord.runVersion` CAS，不引入自有 `revision`。
- 恢复路径只覆盖单实例 sticky 执行，不覆盖跨实例 owner claim；恢复复用 runtime checkpoint 既有校验锚点（`runVersion`/`triggerReason`/`lastSequence`/`activeContextVersion`），workflow 层只额外校验 `recipeVersion` + `agentId`。
- `onError=ROLLBACK`、`onError=DEGRADE` 的 durable/recovery 语义由本 change 承接，而不是回写到最小 engine change；rollback/degrade 复用 `WorkflowExecutionResult.status = FAILED` + `safeError.reasonCode`，不新增 status 枚举值。

实现约束：

- checkpoint 投影 / recovery / rollback / degrade owner 在本 change，不得回写到 `add-ts-workflow-execution-engine`。
- distributed execution、多实例 join barrier、single-owner claim 不属于本 change，后置到 `add-ts-workflow-distributed-execution`。
- workflow durable event history 若需要独立事实表，归 `add-ts-workflow-event-history`。
- recipe durable registry 若需要独立持久化，归 `add-ts-workflow-recipe-registry-persistence`。

非目标：

- 跨实例 workflow 恢复
- workflow durable history query
- recipe registry 持久化
- workflow event table / query
- 新增 `WorkflowStoreGateway` 或 `WorkflowExecutionSnapshot` 平行 checkpoint 事实
- 新增 `ROLLED_BACK` / `DEGRADED` status 枚举值

验收要点：

- resilience test：中断后从 checkpoint 恢复
- resilience test：recipe version 不匹配时拒绝恢复
- integration test：rollback / degrade 路径按本 change 语义执行
- contract test：`flowVariables` workflow 投影不含敏感数据、不新增平行 gateway
- architecture test：不回写最小 engine 主线、不引入分布式/event table/recipe store

并行边界：

- 本 change 承接 checkpoint 投影 / recovery / rollback / degrade。
- 最小 engine change 保持单实例内存态，不偷带这些语义。
- runtime checkpoint 体系（`CheckpointStoreGateway`/`flowVariables`/`runVersion` CAS）仍是 request 级恢复唯一主承载，workflow 层只投影与消费。
