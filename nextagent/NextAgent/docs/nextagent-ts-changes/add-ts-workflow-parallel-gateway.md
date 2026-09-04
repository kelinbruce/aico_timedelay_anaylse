## add-ts-workflow-parallel-gateway

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：P2 — 正式版

状态：active
类型：实施 change
主要 owner：`agent-workflow`
依赖：`add-ts-workflow-execution-engine`

目标：
- 为 `parallel-gateway` 建立独立的 OpenSpec owner，从 `add-ts-workflow-gateway-nodes` 拆分。
- 明确 `parallel-gateway` 的 fork / join、branch barrier、waiting branch、budget 和恢复语义的归属。
- 当前本地实现明确延期，不承接任何生产代码。
- 保持基础 gateway 节点（`start-event`、`end-event`、`exclusive-gateway`）的单一职责。

规格输入：

**Parallel Gateway Ownership**

- `parallel-gateway` 的行为语义（fork / join、branch barrier、waiting branch、budget、恢复）MUST 由本 change 承接。
- `add-ts-workflow-gateway-nodes` MUST 不再作为 `parallel-gateway` 的规范主承载。

**Local Implementation Deferred**

- 当前本地 workflow 执行路径 MUST NOT 声称已经提供 `parallel-gateway` 的本地执行语义。
- 本 change 只承接 owner 拆分和 deferred implementation 声明，不提前发明预算、waiting branch 或恢复 contract。

**Fork / Join 语义（后续实现）**

- fork 语境：上游为单节点，下游为多条边，触发并行分支。
- 每个分支复制父 context（`inputVariables` + 已累积 `nodeResults`），独立推进。
- 并行分支数受 recipe 级 `maxParallelBranches` 约束，超出时剩余分支等待。
- join 语境：所有进入边到达后，合并各分支的 `nodeResults`，继续下游单节点。
- gateway 节点本身不计入重试和超时统计。

实现约束：
- `parallel-gateway` 的具体语义、配置解释和 handler 行为归本 change。
- `add-ts-workflow-execution-engine` 只消费 parallel gateway semantics，不直接拥有这些节点语义。
- `parallel-gateway` 不产生 `structuredPayload`，`WorkflowNodeResult.structuredPayload` 为 `undefined`。
- `parallel-gateway` 不进入 retry 路径（`retryPolicy` 被忽略）。
- `parallel-gateway` 执行不计入超时计时（由 recipe 级超时兜底）。

非目标：
- 不在当前 change 中落任何生产代码。
- 不定义完整 branch budget / recovery 细节（后续实现时补充）。
- 不修改基础 gateway 已完成能力（`start-event`、`end-event`、`exclusive-gateway`）。

验收要点：
- `openspec validate --all --strict` 通过，确认 `parallel-gateway` 独立 owner 已建立。
- code review 检查点：当前本地实现明确延期，不存在半实现或错误执行语义。
- 后续真实实现时补充：integration test 验证 fork 2 分支各自执行 tool 节点 → join → end，分支输出正确合并。

并行边界：
- execution-engine 不拥有 `parallel-gateway` 的具体节点语义；本 change 只通过注册 handler 和控制语义对接 engine。
- `parallel-gateway` 实现不依赖 `agent-model` 或 `agent-capability`。
- 基础 gateway 节点（`start-event`、`end-event`、`exclusive-gateway`）归 `add-ts-workflow-gateway-nodes` 所有，本 change 不触碰。
