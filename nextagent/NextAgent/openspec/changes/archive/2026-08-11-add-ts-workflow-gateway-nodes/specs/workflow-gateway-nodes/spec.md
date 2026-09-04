## ADDED Requirements

### Requirement: Gateway Node Shared Constraints

Workflow engine MUST 在不调整 Recipe YAML DSL 的前提下，将 `start-event`、`end-event`、`exclusive-gateway` 视为纯流程控制节点，并满足以下统一约束：

gateway 节点的外部 DSL MUST 以 [docs/Recipe specification.md](/D:/code/NextAgent/docs/Recipe%20specification.md) 为准；node-specific schema MUST 由本 change owner 定义；`agent-contracts/core` 中的 `WorkflowNodeDef.inputs`、`outputs`、`outputParser` 只作为 opaque 容器，不得在 core contracts 中枚举 gateway 私有字段。

**触发机制：**
- 由 `WorkflowExecutionService` scheduler 在节点 ready 且依赖满足时触发
- 位于 request lifecycle 的 workflow execution 阶段，在 route 决策之后、terminal commit 之前
- 节点状态变更为同步完成

**输入与前置条件：**
- 已校验注册的 `RecipeDefinition` 和 `FlowGraph.nodes`
- 当前 execution 的 `contextVariables`、`nodeResults`、`completedNodeIds`
- 可信 `AbortSignal`、owner scope、agent scope

**输出与副作用：**
- 产出 `WorkflowNodeResult` 生命周期状态
- 产出 `WorkflowExecutionEvent`
- 不产生业务 output，不写 model prompt、capability result、knowledge result

**核心判断逻辑：**
1. 根据 `WorkflowNodeDef.type` 路由到 gateway handler
2. handler 只更新 graph 调度状态，不执行业务能力调用
3. 节点完成后推进 `next` 或 execution 终态

**状态 / 产物契约：**
- gateway 节点 `WorkflowNodeResult.output` MUST 为 `undefined`
- gateway 生命周期事件只允许包含安全摘要，不得包含业务 payload
- safe diagnostic event MUST 至少包含 `nodeId`、`nodeType`、`reasonCode`，并只可按场景附加 `selectedBranchId`、`conditionIndex` 等安全标量字段
- `start-event` / `end-event` MUST 不要求 `inputs` / `outputs`
- `exclusive-gateway` MUST 不向 DSL 暴露 `default` 等新增顶层字段

**流程接入：**
- 上游：engine scheduler
- 下游：后继节点调度、execution 终态归并

**失败与降级：**
- gateway 节点不得静默吞掉 `AbortSignal`
- recipe timeout / cancel 时 gateway 必须立即停止放行新的下游节点

#### Scenario: No Business Payload
- **WHEN** 任一 gateway 节点执行完成
- **THEN** `WorkflowNodeResult.output` MUST 为 `undefined`

#### Scenario: Sensitive Data Exclusion
- **WHEN** gateway 节点发出 lifecycle event
- **THEN** 事件 MUST NOT 包含 prompt、secret、raw capability result 或原始文档内容

### Requirement: Start Event

`start-event` MUST 作为 workflow graph 的唯一入口节点。

**触发机制：**
- 由 `WorkflowExecutionService.execute()` 在 execution 初始化后立即触发
- 同步触发，是 workflow 生命周期中的第一个节点

**输入与前置条件：**
- 已找到唯一 `start-event`
- execution context 已加载 `inputVariables`

**输出与副作用：**
- 激活第一批 `next` 节点
- 产出 `NODE_COMPLETED` 事件

**核心判断逻辑：**
1. 验证 graph 中存在且仅存在一个 `start-event`
2. 标记 `start-event` completed
3. 解析其 `next` 并激活下游节点

**流程接入：**
- 上游：`RouterModule` 决定 `DETERMINISTIC_FLOW`
- 下游：第一批业务节点或 gateway 节点

**失败与降级：**
- 缺少或存在多个 `start-event` -> execution MUST `FAILED`

#### Scenario: Single Start Event
- **WHEN** workflow execution 被接受
- **THEN** engine MUST 从唯一 `start-event` 开始调度

### Requirement: End Event

`end-event` MUST 作为 workflow graph 的出口节点，并负责触发 execution 正常完成。

**触发机制：**
- 当某条执行路径到达 `end-event` 且未被更高优先级中断打断时同步触发

**输入与前置条件：**
- 当前 execution 的 `nodeResults`、`contextVariables`
- 上游依赖已完成

**输出与副作用：**
- 产出 `WorkflowExecutionResult.status = COMPLETED`
- 终止新的节点调度

**核心判断逻辑：**
1. 标记 `end-event` completed
2. 汇总 execution 当前 `nodeResults`
3. 返回 `COMPLETED`

**状态 / 产物契约：**
- `end-event` 不单独产出 summary / ref
- execution result 与 `nodeResults` 保持可追溯关系

**失败与降级：**
- 已收到外部 cancel / recipe timeout 时，不得把 execution 错误标成 `COMPLETED`

#### Scenario: Complete On End Event
- **WHEN** 执行路径到达 `end-event`
- **THEN** engine MUST 返回 `WorkflowExecutionResult.status = COMPLETED`

### Requirement: Exclusive Gateway

`exclusive-gateway` MUST 以声明顺序求值 condition，并选择单个下游分支。

**触发机制：**
- 由 engine 在节点 ready 后同步执行 condition 求值

**输入与前置条件：**
- `next` 条件集合；如需 fallback，只能通过按声明顺序放置的最后一个 `condition: ""` 分支表达
- 当前 execution `contextVariables`
- condition evaluator MUST 只读取 `contextVariables` 中的可信标量视图；业务节点输出如需参与判断，必须先映射为 `contextVariables`，不得直接读取 `nodeResults.output`

**输出与副作用：**
- 选择唯一命中分支或按 DSL 表达的 fallback 分支
- 产出 condition 命中结果的 safe diagnostic event

**核心判断逻辑：**
1. 按 `next` 声明顺序逐一求值
2. 首个 true 分支成为唯一目标
3. 全部 false 时检查是否存在最后一个 `condition: ""` fallback 分支
4. 无 fallback 分支时执行失败

**状态 / 产物契约：**
- condition 诊断只保留安全摘要，不记录原始敏感值
- condition 缺字段、类型不匹配或表达式解析失败时，safe diagnostic MUST 记录 `reasonCode` 和 `conditionIndex`

**流程接入：**
- 上游：前置业务节点或 gateway
- 下游：命中的唯一分支

**失败与降级：**
- condition 解析失败 / 字段缺失 -> 按 false 处理，并记录 safe diagnostic
- 全部 false 且无 fallback 分支 -> execution MUST `FAILED`

#### Scenario: First True Wins
- **WHEN** 前两个 condition 都为 true
- **THEN** engine MUST 只选择第一个 true 分支

#### Scenario: Default Branch
- **WHEN** 全部 condition 为 false 且最后一个分支声明 `condition: ""`
- **THEN** engine MUST 走该 fallback 分支

#### Scenario: No Match No Default
- **WHEN** 全部 condition 为 false 且未声明 fallback 分支
- **THEN** engine MUST 返回明确失败，不得静默跳过
 
 ### Requirement: Inclusive Gateway Alias
 
 `inclusive-gateway` MUST 作为 `PARALLEL` 节点类型的 BPMN DSL 别名，由 recipe loader 的 `normalizeNodeType` 映射到 canonical `WorkflowNodeType = "PARALLEL"`，不引入新 node type。
 
 **触发机制：**
 - recipe 加载阶段，`normalizeNodeType` 遇到 `inclusive-gateway` 类型时映射为 `PARALLEL`
 
 **输入与前置条件：**
 - recipe YAML 中节点 `type` 为 `inclusive-gateway`
 
 **输出与副作用：**
 - 产出 canonical `WorkflowNodeType = "PARALLEL"` 的节点定义
 - 不产出额外 schema 或新 node type
 
 **核心判断逻辑：**
 1. recipe loader 识别 `inclusive-gateway` 为 BPMN 别名
 2. 映射到 `PARALLEL`，与 `parallel-gateway` 别名一致
 3. 执行语义复用 `PARALLEL` handler：评估所有分支条件，激活所有条件为 true 的分支，多分支匹配时执行 fork-join
 
 **状态 / 产物契约：**
 - `inclusive-gateway` 不新增独立 `WorkflowNodeType` enum 值
 - `inclusive-gateway` 的 gateway 约束（无业务 payload、safe diagnostic）与 `PARALLEL` 一致
 
 **流程接入：**
 - 上游：recipe loader normalization
 - 下游：`PARALLEL` handler 执行
 
 **失败与降级：**
 - 未知节点类型不属于本别名范围，仍按原有 `Unknown workflow node type` 错误处理
 
 #### Scenario: Inclusive Gateway Loads As PARALLEL
 - **WHEN** recipe 中包含 `type: "inclusive-gateway"` 的节点
 - **THEN** recipe loader MUST 将其映射为 `PARALLEL` 类型
 - **AND** recipe 加载 MUST NOT 产出 `WORKFLOW_RECIPE_INVALID` 警告
 
 #### Scenario: Inclusive Gateway Alias Consistency
 - **WHEN** recipe 中使用 `inclusive-gateway` 或 `parallel-gateway`
 - **THEN** 两者 MUST 映射到同一个 canonical `WorkflowNodeType = "PARALLEL"`
 - **AND** 两者 MUST 共享相同的执行语义
