# workflow-capability-nodes Specification

## Purpose
定义 Workflow 中 Tool-choice、RESTful、Python 和 Agent Capability 节点的统一执行契约，包括 node-specific 输入输出、受治理调用、最终失败上升、取消传播以及与显式 exception 的衔接。

## Function

- **所属 Function**：`FN-9.4 执行能力节点`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格
## Requirements
### Requirement: Capability Node Shared Execution

Workflow engine MUST 在不调整 [Recipe YAML.md](D:/code/ADNClaw-TS/docs/Recipe%20YAML.md) DSL 的前提下，以统一方式执行 `tool-choice`、`restful`、`python`、`agent`；具体节点统一命名规范默认采用 `{}-{}`，现存 `tool_choice` MUST 被兼容解析到标准 `tool-choice`。

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

`tool` 节点（DSL `type: "tool"`）首版暂不实现（deferred）：当前无 recipe 使用该节点类型，engine MUST NOT 注册 `TOOL` handler，recipe loader MUST NOT 识别 `type: "tool"` 并 MUST 按未知节点类型拒绝加载。
后续若有 recipe 需要直接在 workflow 中调用已治理 tool capability，MUST 经独立 OpenSpec change 启用实现；现网需要 tool 调用时使用 `tool-choice` 选择 + `restful`/`agent` 等执行节点组合，或在 conversation loop 中由 model tool loop 完成。

#### Scenario: Tool Node Type Rejected At Load Time
- **WHEN** recipe DSL contains a node with `type: "tool"`
- **THEN** recipe loader MUST reject the recipe as unknown node type
- **AND** engine MUST NOT register a `TOOL` handler

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

`restful` MUST 对齐标准 Recipe YAML 的 API 调用语义，并通过安全 gateway 发起请求。参数追问反思（reflection）创建的 pending input 超时 resume 时 MUST 抛 `WORKFLOW_NODE_TIMEOUT`（category: TIMEOUT），由 engine exception 分支处理，无 exception 则 `terminalState: FAILED`。

**触发机制：**
- 节点 ready 时触发
- 同步启动，异步等待 capability 边界完成
- reflection pending input 超时后由 runtime resume 机制重新触发

**输入与前置条件：**
- 标准输入 `api_name`
- 可选 `fm_extract_parameter` — 大模型参数提取开关（默认 false）
- 可选 `open_reflection` — 参数追问反思开关（默认 false）
- secret reference 解析能力可用
- runtimeCapabilityResolver 可用（fm_extract_parameter=true 时获取 API 参数定义）
- modelInvocation 可用（fm_extract_parameter=true 时调用大模型）
- runtime pending input boundary 可用（open_reflection=true 时）

**输出与副作用：**
- safe API 调用结果
- API 调用 diagnostic
- 提参结果合并到 API 调用参数中，不作为独立输出
- reflection 创建 pending input 事实（`USER_INPUT_REQUIRED` timeline event）
- reflection 超时：抛错产生 `NODE_FAILED` timeline event，`safeError` 携带 `WORKFLOW_NODE_TIMEOUT` code 和 `TIMEOUT` category

**核心判断逻辑：**
1. 解析 `api_name` 和请求参数
2. 若有 secret reference，则先解析安全注入
3. 若 `fm_extract_parameter=true` 且非参数追问模式：
   a. 通过 runtimeCapabilityResolver 获取 API 参数定义（inputSchema）
   b. 筛选尚未提供的参数
   c. 构造提参 prompt（自定义模板 > 模板库 > 默认 > 动态 API）
   d. 通过 modelInvocation 调用大模型提取参数
   e. 合并提取参数到已解析参数（DSL 已声明优先）
   f. 若 `open_reflection=true` 且模型返回 NEED_MORE_KEY → 创建 pending input
4. 若 `resumeState` 存在且 `resumeState.answers === undefined`（reflection 超时恢复）→ 抛 `WORKFLOW_NODE_TIMEOUT`（category: TIMEOUT），防止超时 resume 后重复调用模型创建新 reflection pending input
5. 时间参数处理：从 inputSchema 识别 isTimeParam=true 的参数，做 NLP 或 AI 结构化时间转换
6. 若 `retry_times > 0` 且首次调用 FAILED/TIMED_OUT → 等待 retry_wait_time 后重试
7. 通过 gateway 发起 API 调用
8. 对结果做 safe 映射

**状态 / 产物契约：**
- secret 仅在调用边界内短暂解引用，不进入 output / log / snapshot
- API 级重试不产生独立产物，最终结果与单次调用输出同形
- 追问反思创建 pending input，owner 为 `agent-runtime`
- reflection 超时 resume 不创建 replacement pending input；resume 后 engine handler throw 产生 `NODE_FAILED` 事件，exception 分支中的新 pending input 属于新节点产生

**流程接入：**
- 上游：任意普通节点
- 下游：API 调用结果供后续节点消费；reflection 超时走 exception 分支或 FAILED 终止

**失败与降级：**
- reflection 超时 → 抛 `WORKFLOW_NODE_TIMEOUT`，走 exception，无 exception 则 FAILED
- `fm_extract_parameter=true` 但 runtimeCapabilityResolver 不可用 → 跳过提参，仅用 DSL 已声明参数，不得报错中断流程
- API 调用失败且重试耗尽 → 返回最后一次失败结果
- pending input boundary 不可用 → 节点失败

**需求类别**：功能性需求

#### Scenario: Param Extract Reflection
- **WHEN** `open_reflection=true` 且大模型返回 `NEED_MORE_KEY`
- **THEN** 实现 MUST 创建 pending input（kind 为 QUESTION），暂停流程
- **AND** 节点状态为 NODE_WAITING
- **AND** 用户回答后恢复执行，将答案加入提参上下文重新提取参数

#### Scenario: Reflection Timeout Resume Throws Workflow Node Timeout
- **WHEN** `restful` 节点的 reflection pending input 超时后 runtime resume 原 run
- **AND** `resumeState.answers` 为 `undefined`
- **THEN** handler MUST 抛 `WORKFLOW_NODE_TIMEOUT`（category: TIMEOUT）
- **AND** engine MUST 路由到匹配的 exception 分支（若配置）
- **AND** 无 exception 匹配时 terminal 状态 MUST 为 `FAILED`

#### Scenario: Reflection Timeout Resume Does Not Create New Pending Input
- **WHEN** `restful` 节点的 reflection pending input 超时后 runtime resume 原 run
- **AND** `resumeState.answers` 为 `undefined`
- **THEN** handler MUST NOT 调用 `requestPendingInput` 创建新 reflection pending input
- **AND** handler MUST NOT 进入 fall-through 重复调用模型提取参数的代码路径

### Requirement: Restful Batch Execution

当 `restful` 节点配置了 `batchConfig` 时，MUST 对 `batchInputDataItem` 中的每个元素独立调用 capability，并按 `batchMode` 决定执行策略。`batchConfig` 的字段定义、loader 归一化、互斥校验和跨节点类型通用语义由 `workflow-contracts` 的 `NodeBatchConfig` requirement 承载；本 requirement 只定义 `RESTFUL` 节点 per-element 调用边界的执行细节。`KNOWLEDGE_SEARCH` 和 `LLM_ROUTER` 节点的 batch 执行细节由各自节点 spec 承载。

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

`python` MUST 通过 sandbox gateway 执行脚本，并按 print 输出条数产出纯结果。Python 节点 MUST NOT 经过 `python` capability 路径，MUST NOT 触发 nl2py guardrail 检查。`agent-capability` SHALL 通过 `WorkflowSandboxExecutionPort` public export 暴露窄 sandbox 执行 port，由 `agent-app` composition 注入到 Workflow node catalog。

当 `WorkflowSandboxExecutionPort` 未注入时，Python 节点 MAY fallback 到现有 `capabilityInvocation` 路径以保持兼容；但 `agent-app` composition MUST 在 sandbox gateway 可用时注入 `WorkflowSandboxExecutionPort`。

**触发机制：**
- 节点 ready 时触发

**输入与前置条件：**
- `script`（必填）：Python 脚本内容，缺失或为空则报错终止
- `param_to_json_str`（可选，默认 `false`）：是否将参数值统一序列化为 JSON 字符串并用 `r'''...'''` 三引号包裹注入
- 其他自定义参数：注入为 Python 变量（跳过 `script` 和 `param_to_json_str`）
- `WorkflowSandboxExecutionPort` 可用（优先）或 `capabilityInvocation` 可用（fallback）

**参数注入语义：**

当 `param_to_json_str=false`（默认，普通模式）时，按参数值类型生成 Python 原生字面量：

| 参数值类型 | Python 变量赋值形式 |
|-----------|-------------------|
| `null` / `undefined` | `None` |
| `true` | `True` |
| `false` | `False` |
| 数字（整数、浮点数） | 原样输出 |
| 数字字符串 | 原样输出，不加引号 |
| 其他（字符串、对象、数组） | JSON 序列化 |

当 `param_to_json_str=true`（JSON 字符串模式）时，所有参数值统一序列化为 JSON 字符串并用 Python 原始三引号字符串包裹：`key=r'''JSON序列化值'''`。

`script` 和 `param_to_json_str` MUST NOT 作为变量注入。fallback 到 `capabilityInvocation` 路径时，变量声明 MUST 作为 Python capability input 的 `preamble` 字段传递，MUST NOT 拼接到 `code` 字段；`code` 字段 MUST 只包含用户 `script`。通过 `WorkflowSandboxExecutionPort.runPython` 直接执行时，变量声明拼接到 `script` 头部作为完整 `code` 传入 sandbox gateway，不经过 capability executor 或 nl2py guardrail。

**输出与副作用：**
- `python_result`：按 print 输出条数解析的纯结果
- `invocation_trace`：capability 调用摘要

**输出处理语义：**

脚本执行返回 stdout 原始字符串。按换行分割近似 print 输出条数：

- 0 条 print 输出 → `python_result = null`
- 1 条 print 输出 → `python_result = 该条解析结果`（合法 JSON 对象/数组则解析，否则保持原始字符串）
- 多条 print 输出 → `python_result = 列表`，每条按上述规则分别解析

`python_result` MUST NOT 包含 `exit_code`、`stderr`、`timed_out` 或 `_trace` 等执行元数据。

**核心判断逻辑：**
1. 校验 `script` 非空
2. 读取 `param_to_json_str`，跳过 `script` 和 `param_to_json_str` 取变量输入
3. 按模式生成变量声明文本
4. 当 `WorkflowSandboxExecutionPort` 已注入时，把变量声明拼接到 `script` 头部形成完整 `code`，通过 `WorkflowSandboxExecutionPort.runPython` 直接执行；否则 fallback 到 `capabilityInvocation`，把变量声明放入 `preamble` 字段、`code` 字段只包含用户 `script`
5. 从返回 stdout 按 print 输出条数解析并产出 `python_result`

**失败与降级：**
- `script` 缺失或空 → 明确失败
- sandbox denial / timeout → 明确失败

#### Scenario: Sandbox Only
- **WHEN** `python` 节点执行
- **THEN** 系统 MUST 通过 sandbox gateway 执行
- **AND** MUST NOT 直接使用宿主进程权限

#### Scenario: Python Node Does Not Trigger Nl2py Guardrail
- **WHEN** `python` 节点通过 `WorkflowSandboxExecutionPort` 执行脚本
- **THEN** 系统 MUST NOT 调用 `checkNl2Python`
- **AND** MUST NOT 产生 `NL2PY_GUARD_BLOCKED` 错误

#### Scenario: Param Injection Normal Mode
- **WHEN** `python` 节点输入 `script="print(x)"` 且 `x=10`（`param_to_json_str` 未设置）
- **THEN** 注入代码 MUST 生成 `x=10`
- **AND** fallback 路径下 `preamble` MUST 为 `x=10`，`code` MUST 为 `print(x)`
- **AND** `python_result` MUST 为 `10`（单条 print，数字字符串解析）

#### Scenario: Param Injection JSON String Mode
- **WHEN** `python` 节点输入 `param_to_json_str=true` 且参数 `x={"k":"v"}`
- **THEN** 注入代码 MUST 生成 `x=r'''{"k":"v"}'''`
- **AND** fallback 路径下该文本 MUST 作为 `preamble` 字段传递，`code` 字段 MUST 只包含用户 `script`

#### Scenario: Reserved Keys Not Injected
- **WHEN** `python` 节点输入包含 `script` 和 `param_to_json_str`
- **THEN** `script` 和 `param_to_json_str` MUST NOT 作为 Python 变量注入

#### Scenario: Single Print JSON Object Result
- **WHEN** 脚本 print 输出一条合法 JSON 对象 `{"a":1}`
- **THEN** `python_result` MUST 为 `{a:1}`（解析为对象，不包装为数组）

#### Scenario: Multiple Print Results
- **WHEN** 脚本 print 输出多条（如 `["a", "b"]`）
- **THEN** `python_result` MUST 为列表，每条分别解析

#### Scenario: No Print Output
- **WHEN** 脚本无 print 输出
- **THEN** `python_result` MUST 为 `null`

#### Scenario: Result Excludes Execution Metadata
- **WHEN** `python` 节点完成
- **THEN** `python_result` MUST NOT 包含 `exit_code`、`stderr`、`timed_out` 或 `_trace`

#### Scenario: Preamble Isolation from Guardrail
- **WHEN** `python` 节点 fallback 到 `capabilityInvocation` 路径且有变量参数注入
- **THEN** 变量声明 MUST 作为 `preamble` 字段传递给 Python capability
- **AND** `code` 字段 MUST 只包含用户 `script`
- **AND** nl2py guardrail MUST NOT 检查 `preamble` 内容

#### Scenario: Fallback To Capability Invocation When Port Not Injected
- **WHEN** `WorkflowSandboxExecutionPort` 未注入且 `capabilityInvocation` 可用
- **THEN** Python 节点 MUST fallback 到 `capabilityInvocation` 路径执行
- **AND** 行为与变更前一致

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

### Requirement: Capability 节点上升统一最终失败

Workflow 中 RESTFUL single、RESTFUL poll、RESTFUL batch、RESTFUL 参数提取的 `PromptSplicing`、PYTHON 和 AGENT 调用 MUST 通过统一 Capability invocation contract 消费最终 `CapabilityInvocationResult`。节点 MUST 保留 `safeError.code`、`safeError.message`、`safeError.category` 和 `safeError.retryable`，MUST NOT 使用 `WORKFLOW_CAPABILITY_FAILED` 或其他框架码覆盖非空上游业务 code。

`SUCCEEDED` 和合法 `DEGRADED` MUST 保持正常节点结果。非取消的 `FAILED` 或 `TIMED_OUT` MUST 上升为当前节点失败，交给 Workflow engine 统一求值 exception。`safeError.category=CANCELED` MUST 立即传播取消，MUST NOT 求值 exception。

节点处理器 MUST NOT 对最终 Capability 失败执行自动重试。RESTFUL poll 的正常“尚未完成”结果 MUST 保持正常节点结果。Recipe 显式声明 `on_poll_error=skip` 或 `batchFailStrategy=continue` 时，节点 MUST 按该声明把单项安全失败事实写入节点 output 并继续未执行项，MUST NOT 重放失败 item；声明 `on_poll_error=terminate` 或 `batchFailStrategy=abort` 时，节点 MUST 把最终失败上升给 Workflow engine 求值 exception。

`PromptSplicing` boundary 未装配时，RESTFUL 参数提取 MUST 使用静态 prompt 路径且不得合成 Capability 失败；一旦发起 `PromptSplicing` 调用，其最终失败 MUST 上升为当前节点失败并求值显式 exception，MUST NOT 静默回退到静态 prompt。每个 poll ordinal 和 batch item MUST 使用独立的逻辑调用身份；统一执行边界对同一逻辑调用的内部 retry MUST 复用该身份。

节点 retry 次数 MUST 按节点显式 `retry`、兼容字段 `retryPolicy`、Recipe `runtime.defaultRetry` 的顺序选择第一个已声明值。存在解析结果时，节点发起的每个逻辑 Capability invocation MUST 把该次数写入 `CapabilityInvocationRequest.maxRetries`；三者均缺失时 MUST 省略该字段，使统一执行边界使用其 canonical 缺省行为。RESTFUL inputs 中的兼容字段 `retry_times` / `retry_wait_time` MUST NOT 进入该映射。节点 retry 配置只约束统一执行边界内部的额外 attempt 数，MUST NOT 使 Workflow engine 在最终 Capability 失败后重新执行节点。

**需求类别**：功能性需求

#### Scenario: RESTFUL single 保留业务错误

- **WHEN** RESTFUL single 调用返回 `safeError.code=ORDER_CONFLICT`
- **THEN** 节点上升的失败 MUST 保持 `ORDER_CONFLICT` 和原安全 message
- **AND** 节点 MUST NOT 使用通用框架错误覆盖业务错误

#### Scenario: Capability 节点不执行第二层重试

- **WHEN** 统一调用边界返回最终 `TIMEOUT + retryable=true`
- **THEN** 节点 MUST 立即把最终失败交给 Workflow engine
- **AND** 节点本地 invocation count MUST 不再增加

#### Scenario: 节点重试次数限制 Capability 内部重试

- **GIVEN** Capability 节点声明的有效 retry 次数为 `0`
- **WHEN** 该节点发起逻辑 Capability invocation
- **THEN** `CapabilityInvocationRequest.maxRetries` MUST 为 `0`
- **AND** 即使初始 attempt 返回满足其他全部安全门禁的瞬态失败，execution attempt 数 MUST 为 `1`
- **AND** Workflow engine MUST NOT 重新执行该节点

#### Scenario: 未配置节点重试时使用 Capability 默认值

- **GIVEN** 节点没有 `retry` 或兼容字段 `retryPolicy`，且 Recipe 没有 `runtime.defaultRetry`
- **WHEN** 该节点发起逻辑 Capability invocation
- **THEN** `CapabilityInvocationRequest.maxRetries` MUST 缺失
- **AND** 统一执行边界 MUST 使用 `capability-catalog` 定义的 canonical 缺省行为

#### Scenario: 节点取消阻止内部 retry

- **GIVEN** Recipe 的显式 node timeout 同时形成父 node-scoped `AbortSignal`，且 Capability request 把该时长作为每个 execution attempt 的 `timeoutMs`
- **WHEN** 第一次 attempt 结束后父 node-scoped signal 已取消
- **THEN** 统一 Capability 边界 MUST NOT 启动第二次 attempt
- **AND** 节点 MUST 传播取消结果

#### Scenario: Capability 节点取消

- **WHEN** Capability 返回 `safeError.category=CANCELED` 或 Workflow signal 已取消
- **THEN** 节点 MUST 立即传播取消
- **AND** 节点 MUST NOT 产生 exception 分支输入

#### Scenario: Poll 和 batch 显式失败策略保持不变

- **WHEN** RESTFUL poll 返回业务协议定义的未完成结果
- **THEN** 节点 MUST 按声明的 poll 规则继续
- **AND** 系统 MUST NOT 把该正常控制结果改写为 `CapabilityInvocationResult.safeError`
- **AND** 当 Recipe 显式声明跳过 poll failure 或继续 batch item failure 时，节点 MUST 记录安全失败事实并继续
- **AND** 节点 MUST NOT 自动重放失败的 poll 或 batch item

#### Scenario: PromptSplicing 失败不被静默吞掉

- **WHEN** RESTFUL 参数提取已发起 `PromptSplicing` Capability 调用并收到最终失败
- **THEN** 当前节点 MUST 保留安全 `safeError` 并上升失败
- **AND** Workflow engine MUST 求值当前节点显式 `exception`
- **AND** 节点 MUST NOT 使用静态 prompt 掩盖该失败

#### Scenario: Poll 和 batch 调用身份彼此独立

- **WHEN** RESTFUL poll 进入新的 poll ordinal 或 RESTFUL batch 开始新的 item
- **THEN** 该次执行 MUST 使用不同于其他 ordinal 或 item 的逻辑调用身份
- **AND** 同一逻辑调用内部的安全 retry MUST 复用原身份
