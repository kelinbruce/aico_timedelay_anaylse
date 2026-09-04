## MODIFIED Requirements

### Requirement: RecipeName Constraint

`RecipeDefinition.recipeName` MUST 仅限制为 `Type.String({ maxLength: 255 })`，MUST NOT 施加 pattern 约束（如 `^[A-Za-z0-9._:-]+$`）或 minLength 约束。此约束修正 v1 将 `recipeName` 复用 `WorkflowSafeIdSchema` 的问题——`WorkflowSafeIdSchema` 同时服务 node-id 标识符，其 pattern 和 128 上限不应传递给 recipeName。maxLength 255 与 1.0 DSL 规范一致（1.0: Recipe 名称最长 255）。

loader MUST 接受不满足 `WorkflowSafeIdSchema` pattern 但长度不超过 255 的 recipeName 值。

#### Scenario: Free-form RecipeName Accepted

- **WHEN** recipe 定义 `recipeName: "alarm diagnosis v2"`
- **THEN** loader MUST 接受该 recipe
- **AND** MUST NOT 因 pattern 不匹配而拒绝

#### Scenario: RecipeName Length Exceeded

- **WHEN** recipe 定义 `recipeName` 长度超过 255 字符
- **THEN** loader MUST 拒绝该 recipe

#### Scenario: RecipeName Distinct From NodeId

- **GIVEN** `WorkflowSafeIdSchema` 仍用于 node-id 和其他结构化标识符
- **WHEN** contract schema 定义 `RecipeDefinition.recipeName`
- **THEN** `recipeName` MUST 使用独立 schema，MUST NOT 复用 `WorkflowSafeIdSchema`

### Requirement: RecipeDefinition

`RecipeDefinition` MUST 在 v1 基础上扩展以下可选字段：

- `runtime?: RuntimeConfig`
- `inputs?: Record<string, InputDef>`
- `metadata?: Record<string, unknown>`
- `presentation?: RecipePresentation`

`metadata` MUST 替代 v1 `expandFields`，loader MUST 将 v1 `expandFields` 映射到 `metadata`。

#### Scenario: Runtime Config Attached
- **WHEN** recipe 定义 `runtime.timeout`
- **THEN** 解析结果 `RecipeDefinition.runtime.timeout` MUST 为秒整数
- **AND** MUST NOT 使用毫秒为单位

#### Scenario: Inputs Contract
- **WHEN** recipe 定义 `inputs.input_question.type = "string"`
- **THEN** 解析结果 `RecipeDefinition.inputs["input_question"]` MUST 符合 `InputDef`
- **AND** 节点 MUST 能通过 `${input.input_question}` 引用

#### Scenario: ExpandFields Compat
- **WHEN** v1 recipe 使用 `expandFields`
- **THEN** loader MUST 将其合并到 `metadata`
- **AND** MUST NOT 保留 `expandFields` 作为独立字段

### Requirement: FlowGraph

`WorkflowNodeDef` MUST 在 v1 基础上扩展以下可选字段：

- `dependsOn?: string[]`
- `retry?: RetryPolicy`
- `timeout?: number`（秒）
- `presentation?: NodePresentation`

`WorkflowNodeDef` MUST 保留 `retryPolicy`/`onError`/`outputParser` 为 deprecated 兼容字段，loader MUST 对 `retryPolicy` 到 `retry` 做归一映射。

`onError` MUST 被标记为 deprecated，engine MUST NOT 消费 `onError`；节点级异常转移 MUST 使用 `exception`（与 `next` 同级）。

#### Scenario: DependsOn Declaration
- **WHEN** 节点声明 `dependsOn: ["node-a"]`
- **THEN** 解析结果 MUST 保留 `dependsOn` 数组
- **AND** engine MAY 据 `dependsOn` 做 DAG 调度（本 change 不强制实现）

#### Scenario: Retry Compat
- **WHEN** v1 节点使用 `retryPolicy: { maxRetries: 2, delay: 100 }`
- **THEN** loader MUST 透传 `retryPolicy`
- **AND** loader SHOULD 尝试结构化为 `retry: { maxAttempts, backoff, delay }`

#### Scenario: OnError Deprecated
- **WHEN** 节点定义 `onError`
- **THEN** loader MUST 保留该字段
- **AND** engine MUST NOT 读取或消费 `onError`

#### Scenario: EndNodeNextOptional

- **WHEN** recipe 定义 END 节点且不携带 `next` 字段
- **THEN** `RecipeDefinitionSchema` MUST 校验通过（`WorkflowNodeDef.next` 为 Optional）
- **AND** loader MUST 将缺失的 `next` 视为空 record（`{}`）
- **AND** engine MUST 将空 `next` 的节点解析为 TERMINAL 转移，MUST NOT 抛 `Cannot convert undefined or null to object`

## ADDED Requirements

### Requirement: RuntimeConfig

TS 后端 MUST 在 `agent-contracts/core` 定义 `RuntimeConfigSchema`，承载流程级执行器策略。

`RuntimeConfig` MUST 包含可选字段：
- `timeout?: number`（秒，>0）
- `incremental?: boolean`
- `persistence?: { checkpoint?: boolean }`
- `defaultRetry?: RetryPolicy`
- `controlPolicy?: ControlPolicy`

`RuntimeConfig` MUST NOT 包含 `profile` 和 `resourcePolicy`（延期）。

#### Scenario: Timeout In Seconds
- **WHEN** recipe 定义 `runtime.timeout: 3600`
- **THEN** 解析结果 `RuntimeConfig.timeout` MUST 为 `3600`（秒）
- **AND** MUST NOT 解释为毫秒

#### Scenario: ControlPolicy Attached
- **WHEN** recipe 定义 `runtime.controlPolicy.resume`
- **THEN** 解析结果 MUST 符合 `ControlPolicy`

### Requirement: ControlPolicy

TS 后端 MUST 定义 `ControlPolicySchema`，定义流程级暂停/恢复/取消/重启策略。

`ControlPolicy` MUST 包含可选字段：
- `resume?: ControlPolicyEntry`
- `modify?: ControlPolicyEntry`
- `cancel?: ControlPolicyEntry`
- `restart?: ControlPolicyEntry`

`ControlPolicyEntry` MUST 包含：
- `strategy: ControlPolicyStrategy`
- `rollbackNode?: string`

`ControlPolicyStrategy` MUST 为枚举：`ROLLBACK_THEN_CONTINUE` | `ROLLBACK_THEN_RESTART` | `ROLLBACK_THEN_STOP` | `RESTART` | `STOP` | `CONTINUE`。

不配置 `controlPolicy` 时 MUST 默认不回滚。

#### Scenario: Resume With Rollback
- **WHEN** `controlPolicy.resume.strategy = "ROLLBACK_THEN_CONTINUE"` 且 `rollbackNode = "rollback_node"`
- **THEN** 恢复时 MUST 先回退到 `rollbackNode` 再从暂停点继续

#### Scenario: Cancel Default Stop
- **WHEN** 未配置 `controlPolicy.cancel`
- **THEN** 取消时 MUST 默认 `STOP`（直接终止，不回退）

### Requirement: RetryPolicy

TS 后端 MUST 定义 `RetryPolicySchema`，结构化重试策略。

`RetryPolicy` MUST 包含可选字段：
- `maxAttempts?: number`（>=0）
- `backoff?: "fixed" | "exponential"`
- `delay?: number`（>=0，秒）

#### Scenario: Structured Retry
- **WHEN** 节点定义 `retry: { maxAttempts: 3, backoff: "exponential", delay: 100 }`
- **THEN** 解析结果 MUST 符合 `RetryPolicy`
- **AND** `delay` MUST 为秒

### Requirement: InputDef

TS 后端 MUST 定义 `InputDefSchema`，显式输入契约。

`InputDef` MUST 包含：
- `type: "string" | "number" | "boolean" | "array" | "object"`

`InputDef` MAY 包含：
- `required?: boolean`
- `default?: unknown`
- `description?: string`

#### Scenario: Required Input
- **WHEN** `inputs.alarm_ids.required = true`
- **THEN** recipe 加载时 MUST 校验该输入存在

### Requirement: Presentation

TS 后端 MUST 定义 `NodePresentationSchema` 和 `RecipePresentationSchema`。

`NodePresentation` MAY 包含：
- `outputParser?: object`
- `recommends?: string[]`
- `tag?: string`

`RecipePresentation` MAY 包含：
- `recommends?: { enabled?: boolean; topN?: number }`

#### Scenario: OutputParser normalization
- **WHEN** 输入节点在顶层声明 `outputParser`
- **THEN** loader MAY 将其规范化为 `presentation.outputParser`

### Requirement: NodeType Alias Compat

loader MUST 在 `normalizeNodeType` 中接受以下别名并归一化到内部 enum：

- `tool-invoke` 归一化为 `TOOL`
- `api-invoke` 归一化为 `RESTFUL`
- `suspend` 归一化为 `INTERRUPT`

#### Scenario: Alias Normalization
- **WHEN** recipe 节点 `type` 为 `api-invoke`
- **THEN** loader MUST 归一化为 `RESTFUL`
- **AND** contract `WorkflowNodeType` enum MUST NOT 新增别名值
### Requirement: DeprecatedNodeWarning

loader MUST 对以下节点类型产出 deprecation warning：
- AGENT
- TOOL_CHOICE
- DATA_ANALYSIS
- TOOL（原 tool-invoke）

warning MUST 使用 structured log（runtimeLogger.warn），MUST NOT 阻断 recipe 加载或节点执行。handler MUST 保持现有执行能力不变。

#### Scenario: Deprecated Node Warning
- **WHEN** recipe 节点 type 归一化后为 AGENT
- **THEN** loader MUST 产出 structured warning log
- **AND** recipe 加载 MUST NOT 被阻断
- **AND** handler MUST 继续执行

#### Scenario: Non-Deprecated Node No Warning
- **WHEN** recipe 节点 type 归一化后为 RESTFUL
- **THEN** loader MUST NOT 产出 deprecation warning

### Requirement: UserCheckEnhancedInput

user-check 节点输入 MUST 支持 action_type 字段（必填），支持三种交互模式。

inputs MUST 包含：
- action_type: "choice" | "input" | "confirm"（必填）
- options?: Array<{ label: string; value: string }>（action_type=choice 时必填且非空）
- tips?: string（提示文本）
- timeout?: number（秒，可选）
- timeout_result?: string（超时 fallback 值，可选，缺省为空字符串）

outputs MUST 产出：
- user_check_result：用户选择的 value（choice）、"true"/"false"（confirm）、超时 fallback 值
- user_check_input：用户输入文本（仅 action_type=input 时产出）

#### Scenario: Choice Mode
- **WHEN** user-check 节点定义 action_type: "choice" 且 options: [{ label: "执行", value: "execute" }]
- **THEN** handler MUST 通过 pendingInput 请求用户选择
- **AND** 输出 user_check_result MUST 为用户选择的 value

#### Scenario: Input Mode
- **WHEN** user-check 节点定义 action_type: "input"
- **THEN** handler MUST 通过 pendingInput 请求用户输入文本
- **AND** 输出 user_check_input MUST 为用户输入文本

#### Scenario: Confirm Mode
- **WHEN** user-check 节点定义 action_type: "confirm"
- **THEN** handler MUST 通过 pendingInput 请求用户确认
- **AND** 输出 user_check_result MUST 为 "true" 或 "false"

#### Scenario: Timeout Fallback
- **WHEN** user-check 节点定义 timeout: 30 和 timeout_result: "cancel"
- **AND** 用户未在 30s 内响应
- **THEN** 输出 user_check_result MUST 为 "cancel"

#### Scenario: Choice Without Options Error
- **WHEN** user-check 节点定义 action_type: "choice" 但未提供 options
- **THEN** handler MUST 抛出 invalidNodeInput 错误

### Requirement: RestfulBatchConfig

restful(api-invoke) 节点 MUST 通过节点级 `batchConfig` 子配置承载分批 API 调用能力。`batchConfig` 是 `WorkflowNodeDef` 的顶层可选字段，与 `loopConfig` 平行；batch 配置字段 MUST NOT 放在 `inputs` 中。loader MUST 将 snake_case `batch_config` 映射到 camelCase `batchConfig`。未提供 `batchConfig` 时为单次调用（现有行为不变）。

batchConfig 字段：
- batchInputDataItem: array（启用 batch 时必填，提供时启用 batch 模式）
- batchElementVariable?: string（默认 "element"；API 参数模板中通过 `${<batchElementVariable>}` 引用当前批次元素）
- batchSize?: int（默认 10，>0；每批参数量上限）
- batchMode?: "serial" | "parallel"（默认 "serial"；serial=串行逐批调用，parallel=多批并行调用）
- batchFailStrategy?: "continue" | "abort"（默认 "continue"；continue=部分批次失败时继续，abort=任一批次失败立即终止）
- batchParallelism?: int（默认 5，范围 [1,20]，仅 batchMode=parallel 时生效）
- batchResultMerge?: "append" | "map"（默认 "append"；append=所有批次结果追加为 List，map=按批次元素 key 合并为 Map）

触发机制：restful 节点 ready 且 scheduler 触发 handler 时，handler 入口先检测 `batchConfig` 是否存在；存在且 `batchInputDataItem` 为非空数组时进入 batch 分支，否则为单次调用。batch 优先于 is_long_api。

输入与前置条件：
- 节点 `inputs` 中的 `api_name` 已解析且非空
- `batchConfig.batchInputDataItem` 已解析为非空数组
- secret reference 在分批前完成解析
- 可信 owner scope / agent scope / AbortSignal 可用
- 已注册且允许调用的 capability invocation 边界可用

输出与副作用：
- batch 模式产出 `batch_results`（合并后结果）、`failed_items`（失败项）、`api_response`（最后一个元素的调用结果，按下标不按完成时序）、`invocation_trace`
- 单次模式产出 `api_response`、`invocation_trace`，MUST NOT 产出 batch_results/failed_items
- 每个批次 side effect MUST 与 executionId / nodeId / 批次序号可追溯
- batch_results / api_response / failed_items 只保留安全结果与 safe error summary，MUST NOT 保留 secret 明文

核心判断逻辑（handler 执行步骤；互斥校验在 loader 阶段完成，见 LoopBatchMutex，handler 执行时 recipe 已加载通过）：
1. 读取节点 `batchConfig`；不存在时走单次调用分支。
2. 校验 `batchInputDataItem` 已解析且为非空数组；否则报 validation error（reason code `WORKFLOW_BATCH_INPUT_INVALID`），不得静默降级。
3. 将 `batchInputDataItem` 按 `batchSize` 分批。
4. 每批构造 invocation args：baseArgs（`inputs` 去除 `api_name` 后的纯 API 调用参数）+ `{ [batchElementVariable]: 当前批次元素 }`。
5. 按 `batchMode` 调度：serial 逐批串行，parallel 按 `batchParallelism` 限流并发。
6. 按 `batchFailStrategy` 处理失败：continue 记录失败项继续，abort 记录失败项后停止后续批次。
7. 按 `batchResultMerge` 合并成功结果：append 为 List（按原始元素下标顺序），map 为 Map（按批次元素 key）。
8. `api_response` 绑定为 `results[items.length - 1]`（最后一个元素的结果；若该元素未执行或失败则为 undefined，静默跳过）。

状态 / 产物契约：
- `batch_results`：合并后结果，生命周期与节点输出变量一致，由下游节点 `${batch_results}` 消费。
- `failed_items`：失败项数组，每项含 index/item/error{code,message}，由下游节点 `${failed_items}` 消费。
- `api_response`：最后一个元素的调用结果，供下游复用单次模式绑定的场景。
- `invocation_trace`：调用诊断，可追溯。
- secret 不得进入以上任何产物。

流程接入：
- 上游：gateway / llm / knowledge / interaction 节点产出 `batchInputDataItem` 引用的数组变量。
- 下游：任意消费 safe output 的节点。
- batch 仅在 restful handler 内生效，不新增 recipe registry / dispatch path / scheduler / pending store。

失败与降级：
- `batchConfig` 存在但 `batchInputDataItem` 缺失或解析后不是非空数组：报 validation error（reason code `WORKFLOW_BATCH_INPUT_INVALID`），MUST NOT 静默降级为单次调用。声明 batchConfig 即表达 batch 意图，输入不满足是配置错误而非未配 batch。
- `batchFailStrategy: "continue"` 批次失败：记录 failed_items，继续执行其余批次，节点状态 NODE_COMPLETED。
- `batchFailStrategy: "abort"` 批次失败：记录 failed_items，停止后续批次，节点状态 NODE_FAILED。
- cancel / timeout：handler MUST 中断，MUST NOT 静默悬挂。
- `batchParallelism` 超过 20：clamp 到 20，不报错。
- 最后元素未执行（abort）或失败（continue）：api_response 为 undefined，静默跳过，不报错。

#### Scenario: Single Call (No BatchConfig)
- **WHEN** restful 节点未提供 batchConfig
- **THEN** handler MUST 执行单次 API 调用
- **AND** 输出 api_response
- **AND** MUST NOT 产出 batch_results/failed_items

#### Scenario: BatchConfig In Node Level
- **WHEN** restful 节点在节点级提供 batchConfig（非 inputs 内）
- **THEN** loader MUST 将 batch_config 映射为 batchConfig
- **AND** handler MUST 从 context.node.batchConfig 读取配置
- **AND** inputs 中 MUST NOT 包含 batch 配置字段

#### Scenario: Batch Serial Mode
- **WHEN** restful 节点提供 batchConfig.batchInputDataItem 且 batchMode: "serial"
- **THEN** handler MUST 将输入按 batchSize 分批，串行逐批调用
- **AND** 输出 batch_results（合并后结果数组）、failed_items、api_response（最后元素结果）

#### Scenario: Batch Parallel Mode
- **WHEN** restful 节点提供 batchConfig.batchInputDataItem 且 batchMode: "parallel" 且 batchParallelism: 3
- **THEN** handler MUST 以最大并发 3 执行批次调用

#### Scenario: Batch Fail Continue
- **GIVEN** batchFailStrategy: "continue"，批次中第 2 批失败
- **WHEN** 节点执行
- **THEN** handler MUST 继续执行第 3 批
- **AND** batch_results MUST 包含成功结果，failed_items MUST 包含第 2 批失败项
- **AND** 节点状态 MUST 为 NODE_COMPLETED

#### Scenario: Batch Fail Abort
- **GIVEN** batchFailStrategy: "abort"，批次中第 2 批失败
- **WHEN** 节点执行
- **THEN** handler MUST NOT 执行第 3 批
- **AND** batch_results MUST 包含第 1 批结果，failed_items MUST 包含第 2 批失败项
- **AND** 节点状态 MUST 为 NODE_FAILED

#### Scenario: Batch Result Merge Append
- **GIVEN** batchResultMerge: "append"，3 批次
- **WHEN** 节点执行完成
- **THEN** batch_results MUST 为 List，包含成功结果按原始元素下标顺序追加

#### Scenario: Batch Result Merge Map
- **WHEN** batchResultMerge: "map"
- **THEN** batch_results MUST 为 Map（按批次元素 key 合并），而非 List

#### Scenario: Batch ApiResponse Binds Last Element
- **GIVEN** batchInputDataItem 含 3 个元素，全部成功
- **WHEN** 节点执行完成
- **THEN** api_response MUST 等于第 3 个元素的调用结果（按下标，不按完成时序）

#### Scenario: Batch ApiResponse Undefined On Abort
- **GIVEN** batchFailStrategy: "abort"，第 2 批失败，共 3 批
- **WHEN** 节点执行
- **THEN** api_response MUST 为 undefined（第 3 个元素未执行）
- **AND** MUST NOT 报错

#### Scenario: Batch Input Invalid Rejected
- **GIVEN** restful 节点声明 batchConfig 但 batchInputDataItem 缺失或解析后不是数组
- **WHEN** 节点执行
- **THEN** handler MUST 报 validation error
- **AND** reason code MUST 为 WORKFLOW_BATCH_INPUT_INVALID
- **AND** MUST NOT 静默降级为单次调用

#### Scenario: Batch And LongApi Are Orthogonal
- **WHEN** 节点同时定义 batchConfig 和 is_long_api: true
- **THEN** 两者 MUST 被视为正交能力，不报互斥错误
- **AND** batch 优先于 is_long_api（batch 分支内每批调用是否轮询由后续 change 承接）

#### Scenario: Batch Parallelism Clamp
- **GIVEN** batchParallelism: 50
- **WHEN** 节点执行
- **THEN** 实际最大并发批次 MUST 为 20，不报错

### Requirement: LoopBatchMutex

spec MUST 明确同一节点上 `loopConfig` 与 `batchConfig` 互斥：
- loopConfig：单节点或多节点间的串行循环编排，由 loop-control change 定义。
- batchConfig：仅 restful(api-invoke) 节点支持的批量 API 调用配置。
- 两者语义重叠（均对一组输入做迭代/分批），同节点同时声明会导致循环体执行与 batch 执行交织歧义。

同一 recipe 可以在不同节点分别使用 loop 和 batch。同一节点 MUST NOT 同时声明 loopConfig 和 batchConfig。

触发机制：loader 在 normalizeNodeDefinition 阶段检测同一节点是否同时存在 `loop_config`/`loopConfig` 与 `batch_config`/`batchConfig`。

失败与降级：同时声明时 loader MUST 拒绝加载 recipe，reason code `WORKFLOW_BATCH_LOOP_CONFLICT`，不得静默忽略任一配置。

#### Scenario: Loop And Batch On Same Node Rejected
- **WHEN** 同一节点同时声明 loopConfig 和 batchConfig
- **THEN** loader MUST 拒绝加载 recipe
- **AND** reason code MUST 为 WORKFLOW_BATCH_LOOP_CONFLICT

#### Scenario: Loop And Batch On Different Nodes Allowed
- **GIVEN** recipe 中节点 A 声明 loopConfig，节点 B（restful）声明 batchConfig
- **WHEN** loader 加载 recipe
- **THEN** loader MUST 接受，两者独立执行互不影响
