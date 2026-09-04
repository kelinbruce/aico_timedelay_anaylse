## ADDED Requirements

### Requirement: Capability Node Shared Execution

Workflow engine MUST 在不调整 [Recipe YAML.md](D:/code/ADNClaw-TS/docs/Recipe%20YAML.md) DSL 的前提下，以统一方式执行 `tool`、`tool-choice`、`restful`、`python`、`agent`；具体节点统一命名规范默认采用 `{}-{}`，现存 `tool_choice` MUST 被兼容解析到标准 `tool-choice`。

capability 节点的 node-specific schema MUST 由本 change owner 定义；`agent-contracts/core` 中的 `WorkflowNodeDef.inputs`、`outputs`、`outputParser` 只作为 opaque 容器，不得在 core contracts 中枚举 capability 私有字段。

**触发机制：**
- 当 capability 节点 ready 且前置依赖满足时由 scheduler 触发
- 位于 workflow execution 阶段，属于同步启动 + 异步等待外部边界完成
- 受 recipe / node timeout、budget、cancel、retry 约束

**输入与前置条件：**
- 节点 `inputs`
- 当前 `contextVariables`
- 已注册且允许调用的 capability / API / sandbox / target agent
- 可信 owner scope、agent scope、`AbortSignal`

**输出与副作用：**
- 产出 safe `WorkflowNodeResult.output`
- 可能产生真实 side effect
- 产出 capability diagnostic / audit event

**核心判断逻辑：**
1. 校验调用目标存在且允许调用
2. 解析输入变量、引用和 secret reference
3. 调用对应统一边界
4. 将返回结果映射为 safe output

**状态 / 产物契约：**
- side effect MUST 与 executionId / nodeId / retryCount 或等价安全可追溯键绑定
- output 只保留安全结果，不保留 secret 明文

**流程接入：**
- 上游：gateway / llm / knowledge / interaction 节点
- 下游：任意消费 safe output 的节点

**失败与降级：**
- 目标不存在 / 不可用 -> 明确失败
- cancel / timeout -> 节点 MUST 中断，不得静默悬挂

#### Scenario: Traceable Side Effect
- **WHEN** capability 节点触发外部调用
- **THEN** side effect MUST 能追溯到 executionId 和节点级安全可追溯键

### Requirement: Capability Family Boundary

workflow capability 节点 MUST 只 owner capability invocation 语义，不得与已完成 workflow 基础 change 的职责重叠。

#### Scenario: Respect Completed Workflow Owners
- **GIVEN** `workflow-package-composition`、`workflow-routing`、`workflow-execution-engine`、`workflow-gateway-nodes` 已定义各自 owner 边界
- **WHEN** 实现 `tool`、`tool-choice`、`restful`、`python`、`agent`
- **THEN** capability 节点 MUST NOT 新增 recipe registry、dispatch path、scheduler、pending store 或 gateway control semantics
- **AND** `tool-choice` MUST 只返回选择结果，不得直接执行 tool side effect
- **AND** `api-choice` / `recipe-choice` 一类候选选择 MUST 继续由其他 change owner，不得在 capability change 内重复实现

### Requirement: Tool Node

`tool` MUST 通过 `CapabilityInvocationService` 调用已治理的 tool capability。

**触发机制：**
- 节点 ready 时触发

**输入与前置条件：**
- 标准输入中的 `tool_name` 或等价 capability 标识
- capability 状态 MUST 为 `AVAILABLE`

**输出与副作用：**
- safe tool result

**核心判断逻辑：**
1. 校验 tool 存在并可调用
2. 解析参数
3. 发起 capability 调用

**失败与降级：**
- tool 不存在 / 不可调用 -> MUST 失败

#### Scenario: Available Tool Only
- **WHEN** tool 状态不是 `AVAILABLE`
- **THEN** 节点 MUST 拒绝调用

### Requirement: Tool Choice Node

`tool-choice` MUST 在 bounded candidate set 中选择最合适的 tool，不直接执行 side effect。

**触发机制：**
- 节点 ready 时触发

**输入与前置条件：**
- `taskDescription`
- bounded `candidateTools`

**输出与副作用：**
- `selectedToolId`
- 可选 `mappedArguments`

**核心判断逻辑：**
1. 调用模型进行选择
2. 校验返回的 tool 在候选集中
3. 输出选择结果，不执行 tool

**失败与降级：**
- 返回候选集外的 tool -> validation 失败

#### Scenario: No Side Effect On Choice
- **WHEN** `tool-choice` 完成，或 DSL 中出现现存 `tool_choice`
- **THEN** system MUST NOT 执行所选 tool

### Requirement: Restful Node

`restful` MUST 对齐标准 Recipe YAML 的 API 调用语义，并通过安全 gateway 发起请求。

**触发机制：**
- 节点 ready 时触发

**输入与前置条件：**
- 标准输入 `api_name`
- 可选 `api_group`、`fm_extract_parameter`、`is_long_api`、`retry_times`、`retry_wait_time`、`intervals`、`overtime`、`singleOvertime`
- secret reference 解析能力可用
-- 可选 `batchConfig`：非空时触发 batch 执行子行为（见 `Restful Batch Execution` requirement）

**输出与副作用：**
- safe API 调用结果
- API 调用 diagnostic

**核心判断逻辑：**
1. 解析 `api_name` 和请求参数
2. 若有 secret reference，则先解析安全注入
3. 通过 gateway 发起 API 调用
4. 对结果做 safe 映射

**状态 / 产物契约：**
- secret 仅在调用边界内短暂解引用，不进入 output / log / snapshot

**失败与降级：**
- secret 解析失败、API 超时、长任务轮询耗尽 -> 明确失败或走 `onError`

#### Scenario: Secret Exclusion
- **WHEN** `restful` 节点完成
- **THEN** `WorkflowNodeResult.output` MUST NOT 包含 secret 明文

### Requirement: Restful Batch Execution

当 `restful` 节点配置了 `batchConfig` 时，MUST 对 `batchInputDataItem` 中的每个元素独立调用 capability，并按 `batchMode` 决定执行策略。

**触发机制：**
- 当 `restful` 节点 ready 且 `batchConfig` 解析出非空 `batchInputDataItem` 时触发
- 属于 `restful` 节点的子行为，不独立注册 handler
- 同步启动 + 异步等待每个元素的 capability 调用完成

**输入与前置条件：**
- `batchInputDataItem`：非空数组，每个元素作为独立调用参数
- `batchElementVariable`：元素注入变量名，默认 `element`
- `batchSize`：serial 模式下的分组大小，默认 `10`
- `batchMode`：`serial`（默认）或 `parallel`
- `batchParallelism`：parallel 模式下的元素级最大并发度，默认 `5`，上限 `20`
- `batchFailStrategy`：`continue`（默认）或 `abort`
- `batchResultMerge`：`append`（默认）或 `map`

**核心判断逻辑：**
1. 解析 `batchConfig`，校验 `batchInputDataItem` 为非空数组
2. 为每个元素构造调用参数：`baseArgs` + `{ [elementVariable]: element }`
3. 按 `batchMode` 选择执行策略：
   - `serial`：元素按 `batchSize` 分组，组内逐个串行执行
   - `parallel`：使用 worker pool，`batchParallelism` 直接控制元素级并发度
4. 每个元素调用 `capabilityInvocation.invoke`，传入 `AbortSignal`
5. 按 `batchResultMerge` 合并结果

**输出与副作用：**
- 产出 `batch_results`、`failed_items`、`api_response` output 变量
- 每个元素产生独立 capability 调用 side effect，可追溯到 execution / node / element index
- 不产生独立 diagnostic event；batch 执行的诊断信息合并到 `invocation_trace`

**失败与降级：**
- `batchFailStrategy: "continue"`：失败元素记入 `failed_items`，继续处理剩余元素
- `batchFailStrategy: "abort"`：失败元素记入 `failed_items` 并设置 abort 标志；parallel 模式下已启动的元素允许完成，未启动的元素不再执行
- cancel / timeout -> 节点 MUST 中断，已完成的元素结果保留

**状态 / 产物契约：**
- `batch_results`：按原始索引排列的成功结果（`append`）或按 `key` 映射的结果（`map`）
- `failed_items`：失败元素的 index、item 和 safe error
- `api_response`：最后一个元素的结果（若存在）

**流程接入：**
- 上游 / 下游：与 `Restful Node` 一致
- 消费方：后续节点消费 `batch_results` / `failed_items` / `api_response`

#### Scenario: Parallel Mode Element-Level Concurrency
- **GIVEN** `batchMode: "parallel"`，`batchParallelism: N`，元素数量 M
- **WHEN** 执行 batch
- **THEN** 同时运行的元素调用数量 MUST NOT 超过 N
- **AND** 当 M <= `batchSize` 时 `batchParallelism` MUST 仍然生效

#### Scenario: Serial Mode Sequential Execution
- **GIVEN** `batchMode: "serial"`
- **WHEN** 执行 batch
- **THEN** 元素 MUST 按顺序逐个执行
- **AND** `batchParallelism` MUST NOT 影响执行行为

#### Scenario: Abort Stops Remaining Elements
- **GIVEN** `batchFailStrategy: "abort"`，某元素失败
- **WHEN** 执行 batch
- **THEN** 未启动的元素 MUST NOT 执行
- **AND** 已启动的元素允许完成
- **AND** 节点状态 MUST 为 `NODE_FAILED`

#### Scenario: Continue Strategy Collects Failures
- **GIVEN** `batchFailStrategy: "continue"`，部分元素失败
- **WHEN** 执行 batch
- **THEN** 所有元素 MUST 被执行
- **AND** 失败元素记入 `failed_items`，成功元素记入 `batch_results`
- **AND** 节点状态 MUST NOT 为 `NODE_FAILED`

### Requirement: Python Node

`python` MUST 通过 sandbox gateway 执行脚本。

**触发机制：**
- 节点 ready 时触发

**输入与前置条件：**
- `script`
- 可选额外参数
- sandbox gateway 可用

**输出与副作用：**
- safe `stdout`
- safe `stderr`
- `exitCode`

**核心判断逻辑：**
1. 校验脚本输入存在
2. 将脚本和参数发送到 sandbox gateway
3. 返回安全裁剪后的执行结果

**失败与降级：**
- sandbox denial / timeout -> 明确失败

#### Scenario: Sandbox Only
- **WHEN** `python` 节点执行
- **THEN** 系统 MUST 通过 sandbox gateway 执行
- **AND** MUST NOT 直接使用宿主进程权限

### Requirement: Agent Node

`agent` MUST 通过统一 capability 路径调用本地子 agent，且不得改变父 execution 的 scope。

**触发机制：**
- 节点 ready 时触发

**输入与前置条件：**
- 标准输入 `agent_name`
- 可选 `recipe_name`
- 可选 `input_question`

**输出与副作用：**
- safe child agent result
- child invocation summary

**核心判断逻辑：**
1. 解析目标 agent
2. 继承父 owner scope 和 agent scope 约束
3. 以 capability 方式调用子 agent
4. 将结果映射回当前节点 output

**失败与降级：**
- 子 agent 失败 -> 当前节点失败或走 `onError`
- MUST NOT 覆盖父 execution 的 `agentId` / `identityContext`

#### Scenario: Parent Scope Preservation
- **WHEN** `agent` 节点调用子 agent
- **THEN** 父 execution 的 owner scope 和 agent scope MUST 保持不变
