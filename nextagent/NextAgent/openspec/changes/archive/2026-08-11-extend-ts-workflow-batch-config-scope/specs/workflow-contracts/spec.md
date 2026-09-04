## MODIFIED Requirements

### Requirement: RestfulBatchConfig

`RESTFUL`、`KNOWLEDGE_SEARCH` 和 `LLM_ROUTER` 节点 MUST 通过节点级 `batchConfig` 子配置承载单节点并发批量调用能力。`batchConfig` 是 `WorkflowNodeDef` 的顶层可选字段，与 `loopConfig` 平行；batch 配置字段 MUST NOT 放在 `inputs` 中。loader MUST 将 snake_case `batch_config` 映射到 camelCase `batchConfig`。未提供 `batchConfig` 时为单次调用（现有行为不变）。

batchConfig 字段：
- batchInputDataItem: array 或引用上游数组变量的模板字符串（`${...}`）（启用 batch 时必填，提供时启用 batch 模式）。YAML 中写 `batchInputDataItem: ` 时，值为字符串占位符，loader MUST 接受；运行时 handler 解析模板字符串为实际数组。内联数组写法同样 MUST 接受。
- batchElementVariable?: string（默认 "element"；参数模板中通过 `${<batchElementVariable>}` 引用当前批次元素）
- batchSize?: int（默认 10，>0；每批参数量上限）
- batchMode?: "serial" | "parallel"（默认 "serial"；serial=串行逐批调用，parallel=多批并行调用）
- batchFailStrategy?: "continue" | "abort"（默认 "continue"；continue=部分批次失败时继续，abort=任一批次失败立即终止）
- batchParallelism?: int（默认 5，范围 [1,20]，仅 batchMode=parallel 时生效）
- batchResultMerge?: "append" | "map"（默认 "append"；append=所有批次结果追加为 List，map=按批次元素 key 合并为 Map）

触发机制：节点 ready 且 scheduler 触发 handler 时，handler 入口先检测 `batchConfig` 是否存在；存在且 `batchInputDataItem` 解析后为非空数组时进入 batch 分支，否则为单次调用。`batchInputDataItem` 可以是内联数组或模板字符串占位符（`${...}`），模板字符串在运行时解析为数组。

输入与前置条件：
- 节点 `inputs` 已解析
- `batchConfig.batchInputDataItem` 已解析为非空数组（模板字符串占位符解析后为非空数组，内联数组直接为非空数组）
- 可信 owner scope / agent scope / AbortSignal 可用
- 对应调用边界可用（RESTFUL: capabilityInvocation；KNOWLEDGE_SEARCH: retrieveKnowledge；LLM_ROUTER: modelInvocation）

输出与副作用：
- batch 模式产出 `batch_results`（合并后结果）、`failed_items`（失败项）、`invocation_trace`（RESTFUL 和 LLM_ROUTER 产出）
- RESTFUL 节点额外产出 `api_response`（最后一个元素的调用结果，按下标不按完成时序）
- LLM_ROUTER 额外产出 `llm_result` 和 `llm_completion`（最后一个元素的解析结果和增强完成对象，与单次模式绑定对齐）
- 单次模式产出各节点类型既有输出，MUST NOT 产出 batch_results/failed_items
- 每个批次 side effect MUST 与 executionId / nodeId / 批次序号可追溯
- batch_results / failed_items 只保留安全结果与 safe error summary，MUST NOT 保留 secret 明文

核心判断逻辑（handler 执行步骤；互斥校验在 loader 阶段完成，见 LoopBatchMutex）：
1. 读取节点 `batchConfig`；不存在时走单次调用分支。
2. 校验 `batchInputDataItem` 已解析且为非空数组；否则报 validation error（reason code `WORKFLOW_BATCH_INPUT_INVALID`），不得静默降级。
3. 将 `batchInputDataItem` 按 `batchSize` 分批。
4. 每批构造 per-element context：注入 `{ [batchElementVariable]: 当前批次元素 }` 到 `context.variables`，从 element context 重新解析节点 inputs。三个节点类型的注入方式一致（通过 element context），差异只在调用边界。
5. 按 `batchMode` 调度：serial 逐批串行，parallel 按 `batchParallelism` 限流并发。
6. 按 `batchFailStrategy` 处理失败：continue 记录失败项继续，abort 记录失败项后停止后续批次。
7. 按 `batchResultMerge` 合并成功结果：append 为 List（按原始元素下标顺序），map 为 Map（按批次元素 key）。
8. 节点类型专属的"最后一个元素结果"绑定（RESTFUL: `api_response`；LLM_ROUTER: `llm_result`）按下标绑定 `results[items.length - 1]`；若该元素未执行或失败则为 undefined，静默跳过。

节点类型差异：
- **RESTFUL**：per-element 调用 `capabilityInvocation.invoke`，baseArgs 为 inputs 去除 `api_name` 后的纯 API 调用参数。batch 优先于 `is_long_api`。
- **LLM_ROUTER**：per-element 复用 `executeLlmNode` 单次模式内部管线（prompt 准备 -> 模型调用 -> 结果解析），差异仅为注入 element 变量和强制非流式。batch 模式 MUST 强制非流式（`modelInvocation.complete`），MUST NOT 调用 `shouldUseStreamMode`。modelConfig 在 batch 入口解析一次，所有 element 共享。
- **其他 LLM 族节点**（`LLM`、`INTENT_RECOGNITION`、`QUESTION_REWRITING`、`TRANSLATION`、`DATA_ANALYSIS`、`PARAM_EXTRACT`）：MUST NOT 支持 batch。声明 `batchConfig` 时 handler MUST 报 `WORKFLOW_BATCH_UNSUPPORTED_NODE_TYPE`，不得静默降级为单次调用。
- **KNOWLEDGE_SEARCH**：per-element 调用 `retrieveKnowledge`，通过 element context 注入变量。单次模式下空检索结果 throw `WORKFLOW_KNOWLEDGE_SEARCH_EMPTY`；batch 模式下空检索结果 MUST 转为 failed item（不 throw），由 `batchFailStrategy` 决定继续或中止。

状态 / 产物契约：
- `batch_results`：合并后结果，生命周期与节点输出变量一致，由下游节点 `${batch_results}` 消费。
- `failed_items`：失败项数组，每项含 index/item/error{code,message}，由下游节点 `${failed_items}` 消费。
- `api_response`（RESTFUL）/ `llm_result`（LLM_ROUTER）：最后一个元素的调用结果，供下游复用单次模式绑定的场景。
- `invocation_trace`：调用诊断，可追溯（KNOWLEDGE_SEARCH 不产出）。
- secret 不得进入以上任何产物。

流程接入：
- 上游：gateway / llm / knowledge / interaction 节点产出 `batchInputDataItem` 引用的数组变量。
- 下游：任意消费 safe output 的节点。
- batch 仅在 handler 内生效，不新增 recipe registry / dispatch path / scheduler / pending store。

失败与降级：
- `batchConfig` 存在但 `batchInputDataItem` 缺失或解析后不是非空数组：报 validation error（reason code `WORKFLOW_BATCH_INPUT_INVALID`），MUST NOT 静默降级为单次调用。
- 非 `LLM_ROUTER` 的 LLM 族节点声明 `batchConfig`：handler MUST 报 `WORKFLOW_BATCH_UNSUPPORTED_NODE_TYPE`，MUST NOT 静默降级为单次调用。
- `batchFailStrategy: "continue"` 批次失败：记录 failed_items，继续执行其余批次，节点状态 NODE_COMPLETED。
- `batchFailStrategy: "abort"` 批次失败：记录 failed_items，停止后续批次，节点状态 NODE_FAILED。
- cancel / timeout：handler MUST 中断，MUST NOT 静默悬挂。
- `batchParallelism` 超过 20：clamp 到 20，不报错。
- 最后元素未执行（abort）或失败（continue）：节点类型专属绑定（api_response / llm_result / llm_completion）为 undefined，静默跳过，不报错。
- batch 模式下 LLM_ROUTER 不产出 diagnostic（budget/compression 诊断逐 element 产生，不汇聚到 batch 级；单次模式的 diagnostic 行为不变）。

#### Scenario: Single Call (No BatchConfig)
- **WHEN** 节点未提供 batchConfig
- **THEN** handler MUST 执行单次调用
- **AND** 输出各节点类型既有输出
- **AND** MUST NOT 产出 batch_results/failed_items

#### Scenario: BatchConfig In Node Level
- **WHEN** 节点在节点级提供 batchConfig（非 inputs 内）
- **THEN** loader MUST 将 batch_config 映射为 batchConfig
- **AND** handler MUST 从 context.node.batchConfig 读取配置
- **AND** inputs 中 MUST NOT 包含 batch 配置字段

#### Scenario: BatchConfig Normalized For All Node Types
- **WHEN** KNOWLEDGE_SEARCH 或 LLM_ROUTER 节点在节点级提供 batchConfig
- **THEN** loader MUST 将 batch_config 映射为 batchConfig
- **AND** MUST NOT 因节点类型不是 RESTFUL 而静默丢弃 batchConfig
- **AND** handler MUST 从 context.node.batchConfig 读取到归一化后的配置

#### Scenario: Restful Batch Serial Mode
- **WHEN** RESTFUL 节点提供 batchConfig.batchInputDataItem 且 batchMode: "serial"
- **THEN** handler MUST 将输入按 batchSize 分批，串行逐批调用 capabilityInvocation
- **AND** 输出 batch_results（合并后结果数组）、failed_items、api_response（最后元素结果）

#### Scenario: Restful Batch Parallel Mode
- **WHEN** RESTFUL 节点提供 batchConfig.batchInputDataItem 且 batchMode: "parallel" 且 batchParallelism: 3
- **THEN** handler MUST 以最大并发 3 执行批次调用

#### Scenario: LlmRouter Batch Parallel Mode
- **WHEN** LLM_ROUTER 节点提供 batchConfig.batchInputDataItem 且 batchMode: "parallel"
- **THEN** handler MUST 以 modelInvocation.complete（非流式）并发执行每个 element
- **AND** MUST NOT 调用 shouldUseStreamMode
- **AND** modelConfig MUST 只解析一次，所有 element 共享
- **AND** 输出 batch_results、failed_items、llm_result 和 llm_completion（最后元素结果）

#### Scenario: KnowledgeSearch Batch Parallel Mode
- **WHEN** KNOWLEDGE_SEARCH 节点提供 batchConfig.batchInputDataItem 且 batchMode: "parallel"
- **THEN** handler MUST 以 retrieveKnowledge 并发执行每个 element
- **AND** 每个 element 的 query 通过 batchElementVariable 注入解析
- **AND** 输出 batch_results、failed_items

#### Scenario: KnowledgeSearch Batch Empty Result As Failed Item
- **GIVEN** KNOWLEDGE_SEARCH 节点 batch 模式，某个 element 检索结果为空
- **WHEN** 该 element 执行完成
- **THEN** handler MUST 将该 element 记录为 failed_item
- **AND** MUST NOT throw WORKFLOW_KNOWLEDGE_SEARCH_EMPTY
- **AND** 若 batchFailStrategy 为 "continue" 则继续执行其余 element

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

#### Scenario: Restful Batch ApiResponse Binds Last Element
- **GIVEN** RESTFUL 节点 batchInputDataItem 含 3 个元素，全部成功
- **WHEN** 节点执行完成
- **THEN** api_response MUST 等于第 3 个元素的调用结果（按下标，不按完成时序）

#### Scenario: Batch Last Element Binding Undefined On Abort
- **GIVEN** batchFailStrategy: "abort"，第 2 批失败，共 3 批
- **WHEN** 节点执行
- **THEN** api_response / llm_result MUST 为 undefined（第 3 个元素未执行）
- **AND** MUST NOT 报错

#### Scenario: Batch Input Invalid Rejected
- **GIVEN** 节点声明 batchConfig 但 batchInputDataItem 缺失或解析后不是数组
- **WHEN** 节点执行
- **THEN** handler MUST 报 validation error
- **AND** reason code MUST 为 WORKFLOW_BATCH_INPUT_INVALID
- **AND** MUST NOT 静默降级为单次调用

#### Scenario: Non-LlmRouter Llm Family Node Rejects Batch
- **GIVEN** INTENT_RECOGNITION 节点声明了 batchConfig
- **WHEN** 节点执行
- **THEN** handler MUST 报错
- **AND** error code MUST 为 WORKFLOW_BATCH_UNSUPPORTED_NODE_TYPE
- **AND** MUST NOT 静默降级为单次调用

#### Scenario: Restful Batch And LongApi Are Orthogonal
- **WHEN** RESTFUL 节点同时定义 batchConfig 和 is_long_api: true
- **THEN** 两者 MUST 被视为正交能力，不报互斥错误
- **AND** batch 优先于 is_long_api

#### Scenario: Batch Parallelism Clamp
- **GIVEN** batchParallelism: 50
- **WHEN** 节点执行
- **THEN** 实际最大并发批次 MUST 为 20，不报错

#### Scenario: Batch Per-Element Variable Isolation
- **GIVEN** batch 模式，batchElementVariable: "sub_question"，batchInputDataItem 含 3 个子问题
- **WHEN** 并发执行 element
- **THEN** 每个 element MUST 只看到自己的 sub_question 值
- **AND** MUST NOT 看到其他 element 的 sub_question 值
- **AND** element 之间 MUST NOT 通过共享变量泄漏中间结果

#### Scenario: BatchInputDataItem As Template String
- **GIVEN** 节点声明 batchConfig 且 `batchInputDataItem` 为模板字符串占位符（如 `${sub_queries}`），上游节点产出 `sub_queries` 为非空数组
- **WHEN** loader 加载 recipe
- **THEN** loader MUST 接受模板字符串占位符，recipe 校验 MUST NOT 失败
- **AND** handler 执行时 MUST 将模板字符串解析为实际数组
- **AND** 解析后为非空数组时 MUST 进入 batch 分支
- **AND** 解析后非数组或空数组时 MUST 报 `WORKFLOW_BATCH_INPUT_INVALID`

#### Scenario: Recipe Validation Failure Diagnosable
- **GIVEN** recipe 校验失败（如 schema 类型不匹配）
- **WHEN** loader 加载 recipe
- **THEN** loader MUST 在 warn 日志中携带 `validationErrors` 摘要
- **AND** `validationErrors` 每条只含 `instancePath`（字段路径）和 `keyword`（校验关键词）
- **AND** MUST NOT 携带 `data` 或 `message` 等可能含 recipe 内容的字段
- **AND** `validationErrors` MUST NOT 进入 Web/SSE/timeline/SafeError

### Requirement: LoopBatchMutex

spec MUST 明确同一节点上 `loopConfig` 与 `batchConfig` 互斥：
- loopConfig：单节点或多节点间的串行循环编排，由 loop-control change 定义。
- batchConfig：`RESTFUL`、`KNOWLEDGE_SEARCH`、`LLM_ROUTER` 支持的单节点并发批量调用配置。
- 两者语义重叠（均对一组输入做迭代/分批），同节点同时声明会导致循环体执行与 batch 执行交织歧义。

同一 recipe 可以在不同节点分别使用 loop 和 batch。同一节点 MUST NOT 同时声明 loopConfig 和 batchConfig。

触发机制：loader 在 normalizeNodeDefinition 阶段检测同一节点是否同时存在 `loop_config`/`loopConfig` 与 `batch_config`/`batchConfig`。

失败与降级：同时声明时 loader MUST 拒绝加载 recipe，reason code `WORKFLOW_BATCH_LOOP_CONFLICT`，不得静默忽略任一配置。

#### Scenario: Loop And Batch On Same Node Rejected
- **WHEN** 同一节点同时声明 loopConfig 和 batchConfig
- **THEN** loader MUST 拒绝加载 recipe
- **AND** reason code MUST 为 WORKFLOW_BATCH_LOOP_CONFLICT

#### Scenario: Loop And Batch On Different Nodes Allowed
- **GIVEN** recipe 中节点 A 声明 loopConfig，节点 B 声明 batchConfig
- **WHEN** loader 加载 recipe
- **THEN** loader MUST 接受，两者独立执行互不影响
