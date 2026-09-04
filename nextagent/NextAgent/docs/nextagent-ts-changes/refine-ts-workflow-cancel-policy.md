# refine-ts-workflow-cancel-policy

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：P3 — Workflow 执行范式 / Workflow 生产硬化

状态：active
类型：实施 change（refinement）
主要 owner：`agent-workflow`（engine + contract）+ `agent-contracts/core`
依赖：`add-ts-workflow-persistence-recovery`（已 Complete，rollback 语义 owner 迁移源）、`refine-ts-workflow-recipe-v2-contracts`（active，controlPolicy 契约定义源）、`refine-ts-workflow-execution-engine-v2`（已 Complete，controlPolicy 解析实现源）

目标：
- 废弃旧 controlPolicy 设计（cancel 绑定节点失败、resume/modify/restart 空壳入口、六值 strategy 枚举），重构为只含 cancel 的外部取消回退策略。
- cancel 语义从"节点失败处置"改为"外部取消后的回退补偿"，由 runtime cancel 接口（controller.abort）触发，引擎检索 recipe 的 cancel 策略执行回退节点子路径再终止。
- cancel 与 next/exception 同形同策，复用 WorkflowBranchDef，支持 condition 预留。
- 节点失败从 controlPolicy 解耦，回归 retry + exception 两层。

owner 迁移说明：
- 原 `add-ts-workflow-persistence-recovery` 承接的 rollback 语义（ControlPolicy Rollback Execution requirement）由本 change 接管并重新定义。
- persistence-recovery 的 checkpoint 投影 / recovery / loop 语义不受影响，仍归 persistence-recovery。
- 本 change 只迁移 controlPolicy.cancel 的语义和执行路径，不迁移 checkpoint/recovery owner。

规格输入：
- `ControlPolicySchema` 重构：cancel 改为 `Record<WorkflowSafeId, WorkflowBranchDef>`，新增可选 `cancelTimeout`；废弃 `ControlPolicyStrategySchema`/`ControlPolicyEntrySchema`/resume/modify/restart。
- baseline `workflow-execution-engine` spec 的 Interrupt requirement MODIFIED：允许 abort 后启动 cancel 回退节点（独立子信号）。
- 三个 active change 的 ControlPolicy requirement 废弃标注：refine-ts-workflow-recipe-v2-contracts、refine-ts-workflow-execution-engine-v2、add-ts-workflow-persistence-recovery。

实现约束：
- cancel 回退用独立子 AbortController，不继承已 abort 的父 signal。
- 回退路径不写 checkpoint，不经过 exception/retry（rollbackMode）。
- 回退失败仅记 structured log，不改 runtime 终态映射（CANCELED 保持）。
- runtime 不感知 workflow cancel 策略，只做 abort 和 terminal commit。

非目标：
- 不改 runtime cancel 终态映射（canceling → CANCELED 保持）。
- 不实现 condition 动态求值（首版取第一个 entry）。
- 不实现 resume/modify/restart。
- 不新增 Web API / runtime command。
- 不引入 durable cancel recovery。

验收要点：
- contract test：新 ControlPolicy schema 形态、旧字段被拒
- engine test：外部 abort + cancel → 回退节点执行 → INTERRUPTED
- engine test：外部 abort + 无 cancel → 直接 INTERRUPTED（兼容）
- engine test：回退失败 → WORKFLOW_ROLLBACK_FAILED + INTERRUPTED，不走 exception/retry
- engine test：回退 retry 耗尽 → 视为回退失败
- engine test：回退 NODE_COMPLETED event timeline 可见
- contract test：MODIFIED Interrupt requirement 行为
- openspec validate --all --strict 通过

并行边界：
- 本 change 接管 controlPolicy.cancel 语义和执行路径。
- persistence-recovery 的 checkpoint/recovery/loop 语义不受影响。
- recipe-v2 的契约定义被本 change 废弃重写，需同步标注。
- execution-engine-v2 的 ControlPolicy Resolution requirement 被本 change 废弃标注。