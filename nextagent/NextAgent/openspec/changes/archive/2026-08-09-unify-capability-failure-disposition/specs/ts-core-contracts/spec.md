# ts-core-contracts Delta Specification

## REMOVED Requirements

### Requirement: Runtime Command And RequestRun Baseline

**Reason**：该 legacy Requirement 同时覆盖 request acceptance、subagent linkage、scheduler priority、Capability locale 和 Workflow input variables 等多个 Functions，并在 no-nesting merge 场景中把 request-carried Tool-call 数量预算作为可保留字段，无法继续作为单一 Function 的 canonical Requirement。

**Migration**：`FN-2.1` 的 submit、session-bound Agent Scope、assembly pinning、RequestRun lifecycle 和无 loop-budget routing input 行为由 `routing-constraint-validation` 及既有 request-runtime 主规格承载；`FN-3.3` 的 parent linkage、no-nesting 和 child priority 行为继续由 `agent-tool` 承载；`FN-5.2` 的 locale 透传继续由 `capability-catalog` 统一调用边界承载；Workflow `inputVariables` 行为继续由 `workflow-contracts` 和既有 workflow execution 主规格承载；跨 lane priority 调度继续由既有 `RequestPriority for scheduling differentiation` Requirement 承载。上述行为语义不变，唯一删除的是 request-carried Tool-call 数量预算。

### Requirement: Checkpoint Recovery Contract Baseline

**Reason**：该 legacy Requirement 已属于 `FN-11.1 恢复运行状态`，并且缺少保证 `maxTurns` 在 pause、resume 和 crash recovery 后连续生效所需的 logical Agent turn coordinate。

**Migration**：完整行为迁入 `local-runtime-recovery / 检查点记录最小 Agent turn 恢复坐标`。既有 checkpoint identity、run/version/sequence/trigger/active-context anchors、closed trigger vocabulary、run-level lookup、Tool state 从 messages 重建和 no-op provider 主路径调用全部保留；payload 只增加 `agentTurnIndex`，normal/finalizing 由它和 accepted `maxTurns` 的关系推导。

### Requirement: RoutingConstraints fields are minimal and safe

**Reason**：该 legacy Requirement 把 request-carried Tool-call 数量预算与 routing preference 混在同一 contract，形成 Agent assembly 之外的第二个 loop-limit owner。

**Migration**：完整行为迁入 `routing-constraint-validation / Routing constraints use an allow-list schema`。安全 allow-list、schema 合法不授予 authority、owner/agent/provider/prompt/policy/tool authority 等受保护字段不可表达的行为全部保留；目标 allow-list 不包含任何 Tool-call 数量预算，model-only 只由 `executionMode=model-only` 表达。
