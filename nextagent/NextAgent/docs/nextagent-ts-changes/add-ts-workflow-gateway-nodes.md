## add-ts-workflow-gateway-nodes

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：P3 — Workflow 执行范式

状态：candidate
类型：实施 change
主要 owner：`agent-workflow`
依赖：`add-ts-workflow-execution-engine`

目标：
- 实现基础流程控制网关节点：`start-event`、`end-event`、`exclusive-gateway`。
- 这类节点不产生业务 payload，只控制 FlowGraph 的执行流程。
- 本 change 是 `start/end/exclusive` 具体节点语义和 handler 注册的唯一 owner。
- `parallel-gateway` 已拆分为独立 change `add-ts-workflow-parallel-gateway`，不在本 change 范围内。

规格输入：

**start-event**

- recipe 入口节点，无业务逻辑。
- 执行时直接触达第一个下游节点。
- `nodeConfig` 为空或仅携带 metadata。

**end-event**

- recipe 出口节点。
- 聚合上游节点的 `nodeResults` 和 `outputVariables`，产出 `WorkflowExecutionResult.status=COMPLETED`。
- 不产生自身的 `structuredPayload`。

**parallel-gateway（fork + join）**

- fork 语境：上游为单节点，下游为多条边，触发并行分支。
- 每个分支复制父 context（`inputVariables` + 已累积 `nodeResults`），独立推进。
- 并行分支数受 recipe 级 `maxParallelBranches` 约束，超出时剩余分支等待。
- join 语境：所有进入边到达后，合并各分支的 `nodeResults`，继续下游单节点。
- gateway 节点本身不计入重试和超时统计。

**exclusive-gateway**

- 按 `nodeConfig.conditions` 列表依次求值，首个 `true` 激活对应分支。
- `condition` 表达式来自 #1 定义的受限 DSL，引用上游节点的 `structuredPayload` 字段。
- 所有 `condition` 为 `false` 时走 `nodeConfig.defaultBranch`，无 `defaultBranch` 则 `FAIL`。
- 求值异常（类型不匹配、字段缺失、DSL 解析失败）视为 `false`。
- condition evaluator 输入边界扩展：求值节点 `exception` map 时额外可读 `safeError`/`reasonCode`（engine 在 exception 求值前映射进 `contextVariables`）；`next` 与 `exception` 复用同一套 evaluator，差异仅在输入边界。
- `exception` 是节点级配置，与 `next` 同级；key=目标节点名，value=异常 condition 表达式，在节点失败优先级链 retry -> exception -> onError -> FAILED 中求值。

实现约束：
- gateway 节点的具体语义、配置解释和 handler 行为归本 change。
- `add-ts-workflow-execution-engine` 只消费 gateway control semantics，不直接拥有这些节点语义。
- 所有 gateway 节点不产生 `structuredPayload`，`WorkflowNodeResult.structuredPayload` 为 `undefined`。
- gateway 节点不进入 retry 路径（`retryPolicy` 被忽略）。
- gateway 节点执行不计入超时计时（由 recipe 级超时兜底）。

非目标：
- 不支持 `inclusive-gateway`（多分支并行+条件选择）、`complex-gateway`、`event-based gateway`。
- `condition` 表达式不支持函数调用或外部服务查询。

验收要点：
- integration test：`start → tool → end` 完整执行，`end-event` 产出正确 `COMPLETED` 结果。
- integration test：parallel fork 2 分支各自执行 tool 节点 → join → end，分支输出正确合并。
- integration test：exclusive condition 命中分支 A，分支 A 的 tool 被执行，分支 B 未执行。
- integration test：exclusive 全部 condition false + default 存在 → 走 default。
- integration test：exclusive 全部 condition false + 无 default → recipe FAIL。
- contract test：gateway 节点的 `WorkflowNodeResult.structuredPayload` 恒为 `undefined`。

并行边界：
- execution-engine 不拥有 `start/end/parallel/exclusive` 的具体节点语义；本 change 只通过注册 handler 和控制语义对接 engine。
- gateway 节点实现不依赖 `agent-model` 或 `agent-capability`。
