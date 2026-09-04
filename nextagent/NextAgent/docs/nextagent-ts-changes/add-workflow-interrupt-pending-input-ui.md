# add-workflow-interrupt-pending-input-ui

规划入口：[UCD 能力差距交付里程碑](../roadmap/ucd-capability-delivery.md)
所属分组：UCD-P3

状态：clarify
类型：candidate contract refinement + UI change
主要 owner：待 pending-input contract 决策；UI consumer 为 `frontend/agent-web`
协作 owner：`agent-workflow`、`agent-runtime`、`agent-channel-web`
认领人：不可认领
依赖：`establish-agent-web-pending-input-ui`、`add-ts-workflow-interaction-nodes` 和 workflow persistence/recovery 均已完成

当前状态：
- `PendingInputKind` 只有 `QUESTION`、`CONFIRMATION`、`AUTHORIZATION`、`HUMAN_HANDOFF`。
- workflow interrupt 当前创建 `kind: QUESTION`、零 questions 的 pending fact，并通过 `producerRef.kind = WORKFLOW_NODE`、`nodeType = INTERRUPT` 保留来源。
- runtime 已能识别该 producerRef 并处理 workflow interrupt 的恢复路径；问题不是 foundation 缺失，而是 durable kind 与 presentation kind 是否同一词汇尚未决定。

目标：
- 当 workflow 等待 external resume 时，前端呈现专用、不可误答的等待状态，并由 canonical pending resolution/run state 收敛。

进入 `ready` 前必须二选一并完成群内确认：
- 路线 A：新增 durable `PendingInputKind.WORKFLOW_INTERRUPT`，同步修改 `agent-common`、runtime、gateway、Web schema/projection 和 frontend exhaustive handling。
- 路线 B：保持 durable `QUESTION`，从可信 `PendingInputProducerRef.WORKFLOW_NODE/INTERRUPT` 派生独立 presentation/wait kind，并明确零 questions 的合法性与非法 answer 拒绝。

正式 design 只能保留一条路线，并明确 pause、external resume、cancel、timeout、reload/replay 和 unknown producer 的端到端行为。

实现约束：
- workflow 只生产 pending intent，不拥有 Web UI；frontend 只呈现，不拥有 resume authority。
- 前端不得根据 message 文案猜测 interrupt，也不得把 unknown kind/producer 默认映射为普通 clarification 后提交答案。
- 任何 durable vocabulary 或 public DTO 变化必须先 contract refinement 和群内确认。

非目标：
- 不实现 workflow engine、external resume API 或 persistence/recovery。
- 不重新定义已有 QUESTION/CONFIRMATION/AUTHORIZATION/HUMAN_HANDOFF UI。

转为 `ready` 后的验收出口：
- contract tests 覆盖选定 kind/producer 语义、schema 和非法 answer 拒绝。
- producer-to-UI integration tests 覆盖 pause、external resume、cancel、reload/replay 和 unknown input。
- architecture tests 证明 frontend 不写 pending store，workflow 不投递私有 Web event。

并行边界：
- clarify 状态不可实施，不得创建 frontend-only fallback。
- contract 路线确认后，应先完成 contract refinement，再创建单一 frontend presentation implementation change。

需群内确认：
- durable `WORKFLOW_INTERRUPT` kind 与 producerRef-derived presentation kind 两条路线的唯一选择。
