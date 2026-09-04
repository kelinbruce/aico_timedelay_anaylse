# workflow-interaction-nodes Specification

## Purpose
TBD - created by archiving change add-ts-workflow-interaction-nodes. Update Purpose after archive.

## Function

- **所属 Function**：`FN-9.5 执行交互节点`
- **spec 角色**：主规格
## Requirements
### Requirement: User Check

`user-check` MUST 按 `inputs.kind` 场景值（缺省 `QUESTION`）映射到 pending input kind，创建对应 pending input 并暂停 workflow execution，在收到回答后继续执行；`HUMAN_HANDOFF` 场景 MUST 通知后立即失败退出，不创建 pending input。

interaction 节点的 node-specific schema MUST 由本 capability owner 定义；`agent-contracts/core` 中的 `WorkflowNodeDef.inputs`、`outputs`、`outputParser` 只作为 opaque 容器，不得在 core contracts 中枚举 interaction 私有字段。

**场景与 kind 映射：**
- `inputs.kind` 为可选字段，取值为 `QUESTION`、`CONFIRMATION`、`AUTHORIZATION` 或 `HUMAN_HANDOFF`；缺省时 MUST 等价于 `QUESTION`。
- `QUESTION`：创建 `kind: "QUESTION"` pending input，recipe 通过 `tips`/`action_type`/`options`（choice 场景）或 `fields`（input 场景）定义提问内容。
- `CONFIRMATION`：创建 `kind: "CONFIRMATION"` pending input，handler MUST 自动构造固定二元 options（`approve`/`reject`），recipe 不写 `options` 和 `action_type`。
- `AUTHORIZATION`：创建 `kind: "AUTHORIZATION"` pending input，handler MUST 自动构造固定二元 options（`approve`/`deny`），recipe 不写 `options` 和 `action_type`。
- `HUMAN_HANDOFF`：MUST NOT 创建 pending input。handler MUST 通过 `emitOutputDelta` 将 `tips` 内容投影到 CONTENT channel，然后抛 `WORKFLOW_HUMAN_HANDOFF`（category: INTERNAL, retryable: false），走 exception 分支，无 exception 则 `terminalState: FAILED`。

**action_type 与 kind 交互规则：**
- `kind` 为 `QUESTION` 或缺省时，`action_type` 仍必填（`choice`/`input`/`confirm`），决定 question 结构和输出绑定。`confirm` 为兼容值，保留现有行为。
- `kind` 为 `CONFIRMATION`/`AUTHORIZATION`/`HUMAN_HANDOFF` 时，`action_type` MUST NOT 出现，handler MUST NOT 读取它。

**等待超时：**
- `user-check` 等待超时 MUST 复用节点顶层 `node.timeout`（秒），handler 读取 `context.node.timeout` 转换为 `timeoutAt`。
- 等待超时上限 MUST 为 48h (DEFERRED，拆到后续 change)（172800 秒），最小为 1s。
- 超时 MUST NOT 走兜底恢复。超时 MUST 抛 `WORKFLOW_NODE_TIMEOUT`（category: TIMEOUT），由 engine exception 分支处理（支持 `error.category == "TIMEOUT"` 和自定义 condition 匹配），无 exception 则 `terminalState: FAILED`。
- `HUMAN_HANDOFF` 不需要等待超时（不等待回答，立即退出）。
- 废弃 `inputs.timeout`、`inputs.timeout_result`、`inputs.timeoutResult`、`timed_out` 输出变量。

**填空题格式约束（inputFormat）— DEFERRED，拆到后续 change：**
- `QUESTION` + `action_type: input` 场景 MUST 支持通过 `inputs.fields` 定义填空题字段列表。`fields` 中每个 field 的字段不做约束，产品按需定义（如 `name`、`description`、`placeholder`、`pattern`、`maxLength` 等）。
- handler MUST 为每个 field 创建一个 `PendingInputQuestion`（`prompt` 取 `description`，`options` 为空，`custom: true`，`inputFormat` 携带 field 中除 `name`/`description` 外的格式约束字段）。
- `inputFormat` 随 `PendingInputQuestion` 透传给 task channel，task channel 据此渲染带前端校验的输入框。
- `inputFormat` 随 `PendingInputQuestionRecord` 持久化到 `PendingInputRecord`，stream gap 恢复后 task channel 仍可从 record 读取 `inputFormat` 重建 UI。
- resume 后 handler MUST 用 recipe `fields[].name` 做 key 组装结构化 `user_check_result`（多 field 时为对象，单 field 时为字符串）。`inputFormat` 本身 MUST NOT 进入 outputVariables。
- `CONFIRMATION`/`AUTHORIZATION`/`HUMAN_HANDOFF` 场景 MUST NOT 使用 `inputFormat`。

**触发机制：**
- 节点 ready 时由 scheduler 触发
- `QUESTION`/`CONFIRMATION`/`AUTHORIZATION` 在 workflow execution 阶段同步创建 pending input，随后异步等待用户动作
- `HUMAN_HANDOFF` 同步投影通知后立即抛错，不等待
- 用户回答属于 request lifecycle 之外的外部动作，由 runtime resume 机制重新触发

**输入与前置条件：**
- `inputs.kind`（可选，缺省 `QUESTION`）
- `tips`（提示/通知内容）
- `QUESTION` + choice 场景：`action_type: choice`、`options`
- `QUESTION` + input 场景：`action_type: input`、`fields`
- `CONFIRMATION`/`AUTHORIZATION` 场景：仅需 `tips`，无需 `options`/`action_type`
- `HUMAN_HANDOFF` 场景：仅需 `tips` 作通知内容
- `node.timeout`（`QUESTION`/`CONFIRMATION`/`AUTHORIZATION` 必填，`HUMAN_HANDOFF` 不需要）
- runtime pending input boundary 可用（`HUMAN_HANDOFF` 不需要）

**输出与副作用：**
- `QUESTION`/`CONFIRMATION`/`AUTHORIZATION`：创建 pending input 事实（`USER_INPUT_REQUIRED` timeline event），收到回答后输出 safe `user_check_result` 或等价回答结果
- `HUMAN_HANDOFF`：投影通知内容到 CONTENT channel（`emitOutputDelta` 产生 visible delta），无输出变量（抛错不产出）；抛错产生 `NODE_FAILED` timeline event，`safeError` 携带 `WORKFLOW_HUMAN_HANDOFF` code
- 超时：抛错产生 `NODE_FAILED` timeline event，`safeError` 携带 `WORKFLOW_NODE_TIMEOUT` code 和 `TIMEOUT` category

**核心判断逻辑：**
1. 读取 `inputs.kind`（缺省 `QUESTION`）
2. `HUMAN_HANDOFF` → `emitOutputDelta` + 抛 `WORKFLOW_HUMAN_HANDOFF`
3. 其他 kind → 校验 `tips` 和场景特定配置，按 kind 组装 pending input（CONFIRMATION/AUTHORIZATION 自动构造二元 options；QUESTION + input 从 fields 创建多 question）
4. 创建 pending input，暂停当前 execution
5. 回答到达后恢复 execution，按 kind 映射回答结果到输出变量

**状态 / 产物契约：**
- pending input 的 owner MUST 是 `agent-runtime`
- pending input 生命周期直到回答、超时或 cancel
- `HUMAN_HANDOFF` 不产生 pending input
- `inputFormat` 随 `PendingInputQuestionRecord` 持久化，消费方为 task channel，不进入 answer payload 或 outputVariables
- `emitOutputDelta` 投影内容与 execution / nodeId / retryCount 可追溯

**流程接入：**
- 上游：任意普通节点
- 下游：`QUESTION`/`CONFIRMATION`/`AUTHORIZATION` 回答结果供后续节点消费；`HUMAN_HANDOFF` 和超时走 exception 分支或 FAILED 终止

**失败与降级：**
- 超时 → 抛 `WORKFLOW_NODE_TIMEOUT`，走 exception，无 exception 则 FAILED
- `HUMAN_HANDOFF` → 抛 `WORKFLOW_HUMAN_HANDOFF`，走 exception，无 exception 则 FAILED
- CONFIRMATION reject / AUTHORIZATION deny → runtime 直接终态化 FAILED，workflow 不恢复
- pending input boundary 不可用 → 抛 `WORKFLOW_PENDING_INPUT_BOUNDARY_UNAVAILABLE`，节点失败
- 无效回答 → validation 失败，不得静默接受

#### Scenario: Pause And Resume On User Answer
- **WHEN** `user-check`（`kind: QUESTION`/`CONFIRMATION`/`AUTHORIZATION`）创建 pending input 后收到合法回答
- **THEN** execution MUST 恢复并继续下游

#### Scenario: Kind Defaults To Question
- **WHEN** `user-check` 节点未提供 `inputs.kind`
- **THEN** handler MUST 等价于 `kind: QUESTION` 处理
- **AND** `action_type`/`options`/`fields` 逻辑 MUST 与现有行为一致

#### Scenario: Confirmation Auto-Constructs Binary Options
- **WHEN** `user-check` 配置 `kind: CONFIRMATION` 且 recipe 未写 `options`
- **THEN** handler MUST 自动构造 options 为 `[{label:"approve", value:"approve"}, {label:"reject", value:"reject"}]`
- **AND** pending input kind MUST 为 `CONFIRMATION`

#### Scenario: Authorization Auto-Constructs Binary Options
- **WHEN** `user-check` 配置 `kind: AUTHORIZATION` 且 recipe 未写 `options`
- **THEN** handler MUST 自动构造 options 为 `[{label:"approve", value:"approve"}, {label:"deny", value:"deny"}]`
- **AND** pending input kind MUST 为 `AUTHORIZATION`

#### Scenario: Human Handoff Notifies And Exits
- **WHEN** `user-check` 配置 `kind: HUMAN_HANDOFF`
- **THEN** handler MUST 通过 `emitOutputDelta` 将 `tips` 投影到 CONTENT channel
- **AND** MUST 抛 `WORKFLOW_HUMAN_HANDOFF`（category: INTERNAL）
- **AND** MUST NOT 创建 pending input
- **AND** 无 exception 分支时 execution MUST 以 `terminalState: FAILED` 中断

#### Scenario: Timeout Is Failure Not Fallback
- **WHEN** `user-check`（`kind: QUESTION`/`CONFIRMATION`/`AUTHORIZATION`）等待超时且 `node.timeout` 到达
- **THEN** handler MUST 抛 `WORKFLOW_NODE_TIMEOUT`（category: TIMEOUT）
- **AND** MUST NOT 使用兜底值冒充用户回答
- **AND** 无 exception 分支时 execution MUST 以 `terminalState: FAILED` 中断

#### Scenario: Timeout Routes Via Exception Condition
- **WHEN** `user-check` 超时抛 `WORKFLOW_NODE_TIMEOUT` 且节点定义了 `exception` 分支
- **THEN** exception condition MUST 能通过 `error.category == "TIMEOUT"` 或 `error.code == "WORKFLOW_NODE_TIMEOUT"` 匹配

#### Scenario: Node Timeout Reused As Wait Timeout
- **WHEN** `user-check` 配置节点顶层 `node.timeout`（秒）
- **THEN** handler MUST 读取 `context.node.timeout` 转换为 `timeoutAt`
- **AND** `inputs.timeout` MUST NOT 被读取

#### Scenario: Input Fields Create Questions With InputFormat
- **WHEN** `user-check` 配置 `kind: QUESTION`、`action_type: input` 且 `fields` 含多个字段定义
- **THEN** handler MUST 为每个 field 创建一个 `PendingInputQuestion`
- **AND** 每个 question 的 `prompt` MUST 取 field 的 `description`
- **AND** 每个 question 的 `options` MUST 为空、`custom` MUST 为 `true`
- **AND** 每个 question 的 `inputFormat` MUST 携带 field 中除 `name`/`description` 外的格式约束字段

#### Scenario: InputFormat Passed Through To Task Channel
- **WHEN** `user-check` 填空题场景创建带 `inputFormat` 的 pending input
- **THEN** pending input request 的 questions MUST 携带 `inputFormat`
- **AND** `inputFormat` MUST 随 `PendingInputQuestion` 透传给 task channel
- **AND** `inputFormat` MUST 随 `PendingInputQuestionRecord` 持久化到 `PendingInputRecord`
- **AND** resume 后 `inputFormat` MUST NOT 出现在 outputVariables

#### Scenario: Structured User Check Result For Multiple Fields
- **WHEN** `user-check` 填空题场景有多个 `fields` 且用户已回答
- **THEN** `user_check_result` MUST 为对象，key 取自 recipe `fields[].name`，value 取自对应 question 的回答
- **AND** 单 field 时 `user_check_result` MUST 为字符串

#### Scenario: Confirmation Reject Terminates Without Resume
- **WHEN** `user-check`（`kind: CONFIRMATION`）收到 `reject` 回答
- **THEN** runtime MUST 直接终态化为 FAILED
- **AND** workflow MUST NOT 恢复执行

#### Scenario: Pending Input Boundary Unavailable
- **WHEN** `user-check`（`kind: QUESTION`/`CONFIRMATION`/`AUTHORIZATION`）执行时 runtime pending input boundary 不可用
- **THEN** handler MUST 抛 `WORKFLOW_PENDING_INPUT_BOUNDARY_UNAVAILABLE`
- **AND** 节点 MUST 失败

### Requirement: Interaction Family Boundary

workflow interaction 节点 MUST 只 owner pending / projection / guardrail / delay / interrupt / sub-recipe 语义，不得与已完成 workflow 基础 change 或其他未开始节点族重叠。

#### Scenario: Respect Runtime And Routing Owners
- **GIVEN** runtime pending input、channel projection、workflow routing 和 execution 生命周期已有 owner
- **WHEN** 实现 interaction 节点族
- **THEN** interaction 节点 MUST NOT 新增 pending store、stream lifecycle owner、recipe registry 或主请求 dispatch path
- **AND** `sub-recipe` MUST 只消费 `recipe-choice` 或静态 DSL 提供的 `recipe_name`
- **AND** `sub-recipe` MUST 通过 app composition 提供的 recipe definition source 按当前 `agentId + recipe_name` 解析目标 recipe，并与当前 Agent Scope 的 WORKFLOW capability 可见性一致
- **AND** interaction 节点 MUST NOT 重复实现 candidate recipe selection、tool invocation 或通用 LLM transformation

### Requirement: Display Content

`display-content` MUST 将安全文本内容投影给用户，并立即继续下游。

节点 MUST 按既有优先级解析 output parser 来源：`node.presentation.outputParser`、`node.outputParser`、`node.outputs.output_parser`。解析 `output_parser` 模板时，节点 MUST 能引用当前 workflow 上游变量，同时节点自有输出和自有展示字段 MUST 能覆盖同名上游变量。

当有效 output parser 的 `data` 是非空 object 时，`display-content` MUST 保留该 object 数据供既有 projector 构建 structured delta，MUST NOT 把该 object 当作单值 string 输出校验失败，也 MUST NOT 对该 object 数据执行字符串 HTML 安全校验。

当有效 output parser 的 `data` 是非空 object 且节点没有可投影文本输入时，`display-content` MUST NOT 发出冗余文本 `NODE_OUTPUT_DELTA`；workflow engine MUST NOT 为该节点生成兜底文本 delta。当节点存在文本输入时，文本输入 MUST 继续按既有 safe text / markdown 语义投影并接受 HTML 安全校验。

当有效 output parser 的 `type` 为 `OBJECT` 且节点没有可投影文本输入时，`display-content` MUST 将解析后的 object 输出序列化为 JSON 字符串并作为 `NODE_OUTPUT_DELTA` 的文本内容投影；MUST NOT 将多个字段值用换行拼接为值列表。

需求类别：功能性需求

**触发机制：**

- 节点 ready 时触发

**输入与前置条件：**

- safe text / markdown 内容，或有效 output parser 的非空 object `data`
- output parser 模板可引用当前上游变量

**输出与副作用：**

- 文本输入存在时产生 stream projection
- output parser `data` 存在时产生可被 projector 消费的 resolved `output_parser`
- 无文本输入且 `data` 为非空 object 时不产生文本 delta

**核心判断逻辑：**

1. 按既有优先级解析 output parser 来源
2. 使用上游变量和节点 runtime bindings 解析模板
3. 文本输入存在时校验内容为允许格式并投影
4. object `data` 存在时传递给 projected output，由 projector 构建 structured delta
5. 标记节点完成并继续下游

**状态 / 产物契约：**

- 投影内容与 execution / nodeId / retryCount 或等价安全可追溯键可追溯
- 文本内容不得包含 raw HTML / script
- `output_parser` 不得泄漏给下游变量

**流程接入：**

- 消费方为 `agent-channel-web` 与既有 workflow structured delta projector

**失败与降级：**

- 文本内容不安全 -> 明确拒绝
- 无文本输入且无有效展示数据 -> 既有输入校验失败

#### Scenario: Safe Projection Only

- **WHEN** `display-content` 投影文本内容
- **THEN** 内容 MUST 只包含 safe text / markdown

#### Scenario: PIU Object Data Reaches Structured Delta

- **GIVEN** 上游变量 `pyresult` 是 JSON object
- **AND** `display-content` 的有效 output parser 为 `type: PIU`，且 `data` 是引用 `pyresult` 的模板
- **WHEN** 节点执行完成
- **THEN** projected output 的 `output_parser.data` MUST 保留解析后的 object
- **AND** 节点 MUST NOT 因 object 不是 string 而失败

#### Scenario: Output Parser Source Precedence Applies

- **GIVEN** 节点同时声明 `node.outputParser` 和 `node.outputs.output_parser`
- **WHEN** `display-content` 解析 output parser
- **THEN** 系统 MUST 使用 `node.outputParser`
- **AND** MUST NOT 合并或覆盖它

#### Scenario: Presentation Parser Takes Precedence

- **GIVEN** 节点同时声明 `node.presentation.outputParser` 和 `node.outputParser`
- **WHEN** `display-content` 解析 output parser
- **THEN** 系统 MUST 使用 `node.presentation.outputParser`
- **AND** MUST NOT 合并或覆盖它

#### Scenario: No Redundant Text Delta For Object Data

- **GIVEN** `display-content` 的有效 output parser `data` 是非空 object
- **AND** 节点没有文本输入
- **WHEN** 节点执行完成
- **THEN** 节点 MUST NOT 发出文本 `NODE_OUTPUT_DELTA`
- **AND** engine MUST NOT 发出兜底文本 delta

#### Scenario: Text Input Remains Safe Projection

- **GIVEN** `display-content` 的有效 output parser `data` 是非空 object
- **AND** 节点存在文本输入
- **WHEN** 节点执行完成
- **THEN** 文本输入 MUST 继续接受既有 HTML 安全校验并按 safe text / markdown 语义投影

#### Scenario: OBJECT Content Serializes As JSON

- **GIVEN** `display-content` 的有效 output parser 为 `type: OBJECT`
- **AND** 节点输出包含 `cell_id: NB123` 和 `status: 告警恢复`
- **WHEN** 节点执行完成
- **THEN** 文本 `NODE_OUTPUT_DELTA` 内容 MUST 为 JSON 字符串 `{"cell_id":"NB123","status":"告警恢复"}`
- **AND** MUST NOT 为 `NB123\n告警恢复`

### Requirement: Guardrail Check

`guardrail-check` MUST 通过既有 policy / hook 体系对输入内容执行安全检查；现存 `guardrail_check` MUST 被兼容解析到标准 `guardrail-check`。

**触发机制：**
- 节点 ready 时触发

**输入与前置条件：**
- 要检查的内容
- `policyId`

**输出与副作用：**
- `result = pass | block`
- `reason`

**核心判断逻辑：**
1. 读取 policy hook
2. 执行检查
3. 输出 `pass` 或 `block`

**流程接入：**
- 下游：后续 gateway 或失败路径

**失败与降级：**
- policy 不存在 / hook 失败 -> 明确失败
- `block` -> 不得静默放行

#### Scenario: Block Result
- **WHEN** 内容违反护栏规则
- **THEN** 节点 MUST 输出 `block`

### Requirement: Delay Gateway

`delay-gateway` MUST 在指定时长后继续下游，并响应 cancel / timeout。

**触发机制：**
- 节点 ready 时触发

**输入与前置条件：**
- `inputs.delay_time`：等待时长，单位为秒（正整数），值为字符串形式（与 1.0 DSL “参数值只支持字符串”一致），handler MUST 将字符串转为数字并乘以 1000 转换为毫秒

**输出与副作用：**
- 等待完成事件

**核心判断逻辑：**
1. 解析 `delay_time`（字符串 -> 数字，秒单位）
2. 启动等待计时器（秒 × 1000 = 毫秒）
3. 到时后继续下游

**失败与降级：**
- 等待过程中收到 `AbortSignal` -> 立即中断
- `delay_time` 非正整数或为负数 -> 抛出 invalidNodeInput

#### Scenario: Delayed Continue
- **WHEN** `inputs.delay_time` 指定正整数秒且时长到达未被中断
- **THEN** 节点 MUST 继续下游

#### Scenario: Delay Time String Coercion
- **WHEN** `inputs.delay_time` 为字符串 `"10"`
- **THEN** handler MUST 将其转为数字 10（秒）并等待 10 秒

### Requirement: Interrupt Gateway

`interrupt` 节点 MUST 创建 pending input 暂停 workflow execution，在收到外部恢复后继续执行。超时 resume 时 MUST 抛 `WORKFLOW_NODE_TIMEOUT`（category: TIMEOUT），由 engine exception 分支处理，无 exception 则 `terminalState: FAILED`。

**触发机制：**
- 节点 ready 时由 scheduler 触发
- 创建 pending input 后暂停当前 execution，等待外部恢复
- 外部恢复属于 request lifecycle 之外的动作，由 runtime resume 机制重新触发

**输入与前置条件：**
- `inputs.timeoutAt`（可选，秒级时间戳）
- runtime pending input boundary 可用

**输出与副作用：**
- 创建 pending input 事实（`USER_INPUT_REQUIRED` timeline event），收到恢复后输出 `interrupt_result`
- 超时：抛错产生 `NODE_FAILED` timeline event，`safeError` 携带 `WORKFLOW_NODE_TIMEOUT` code 和 `TIMEOUT` category

**状态 / 产物契约：**
- pending input 的 owner MUST 是 `agent-runtime`
- pending input 生命周期直到回答、超时或 cancel
- 超时 resume 不创建 replacement pending input；resume 后 engine handler throw 产生 `NODE_FAILED` 事件，exception 分支中的新 pending input 属于新节点产生

**流程接入：**
- 上游：任意普通节点
- 下游：`interrupt_result` 供后续节点消费；超时走 exception 分支或 FAILED 终止

**核心判断逻辑：**
1. 读取 `resumeState`（若存在）
2. 若 `resumeState.answers !== undefined`（有恢复答案）→ 输出 `interrupt_result`，继续执行
3. 若 `resumeState.answers === undefined`（超时恢复）→ 抛 `WORKFLOW_NODE_TIMEOUT`（category: TIMEOUT）
4. 无 `resumeState`（首次执行）→ 创建 pending input，暂停 execution

**失败与降级：**
- 超时 → 抛 `WORKFLOW_NODE_TIMEOUT`，走 exception，无 exception 则 FAILED
- pending input boundary 不可用 → 抛 `WORKFLOW_PENDING_INPUT_BOUNDARY_UNAVAILABLE`，节点失败

**需求类别**：功能性需求

#### Scenario: Pause And Resume On External Recovery
- **WHEN** `interrupt` 节点创建 pending input 后收到外部恢复
- **THEN** execution MUST 恢复并继续下游

#### Scenario: Timeout Resume Throws Workflow Node Timeout
- **WHEN** `interrupt` 节点的 pending input 超时后 runtime resume 原 run
- **AND** `resumeState.answers` 为 `undefined`
- **THEN** handler MUST 抛 `WORKFLOW_NODE_TIMEOUT`（category: TIMEOUT）
- **AND** engine MUST 路由到匹配的 exception 分支（若配置）
- **AND** 无 exception 匹配时 terminal 状态 MUST 为 `FAILED`

#### Scenario: Timeout Resume Does Not Create New Pending Input
- **WHEN** `interrupt` 节点的 pending input 超时后 runtime resume 原 run
- **AND** `resumeState.answers` 为 `undefined`
- **THEN** handler MUST NOT 调用 `requestPendingInput` 创建新 pending input
- **AND** handler MUST NOT 进入 fall-through 创建 pending input 的代码路径

### Requirement: Sub Recipe

`sub-recipe` MUST 在不调整 Recipe YAML DSL 的前提下，继续使用 DSL 字段 `recipe_name` 加载并执行子 recipe，且仅通过显式 mapping 交换输入输出。

**触发机制：**
- 节点 ready 时触发

**输入与前置条件：**
- `recipe_name`
- `inputMapping`
- 可选 `outputMapping`
- 子 recipe 已注册，嵌套深度未超限

**输出与副作用：**
- safe 子流程结果
- 子执行 summary

**核心判断逻辑：**
1. 通过 app composition 提供的 recipe definition source 按当前 `agentId + recipe_name` 校验目标 recipe 已可用
2. 按 `inputMapping` 构造子 execution 输入
3. 递归调用 workflow execution
4. 按 `outputMapping` 映射回父 execution

**状态 / 产物契约：**
- `recipe_name` 在 DSL 中对应子流程标识，其解析结果 MUST 通过 recipe definition source `require(agentId, recipe_name)` 指向当前 agent scope 下的 `RecipeDefinition.name`
- 子结果与父节点 output 通过显式 mapping 建立可追溯关系
- `recipe_name` 支持变量模板（如 `${input_question}`）；解析失败时 handler MUST 抛出 `WORKFLOW_NODE_INPUT_INVALID`（category `VALIDATION`），`safeDetails` MUST 携带 `recipeNameTemplate`（原始模板串）、`resolvedType`（解析结果类型）、`availableVariableKeys`（当前可用变量键），不得静默失败
- 父节点 `outputs` 中 `${recipe_result}` 绑定 MUST 指向子 recipe answer node 的 `nodeResult.output`（map 结构）；`sub_recipe_result` 绑定 MUST 指向子执行 summary（`recipe_name`、`executionId`、`status`）。answer node 定义见 `Sub Recipe Answer Node Resolution` requirement
- 父节点 `outputs` 中其他 key 可通过 `outputMapping` 引用子 recipe `outputVariables` 的任意变量，用于消费中间节点输出；`recipe_result` 默认只暴露 answer node output，中间节点输出需要父节点显式 mapping
- 子 recipe answer node 的 `nodeResult.output` 为 `undefined`（answer node 未执行或无输出）时，`${recipe_result}` MUST 为空对象 `{}`，MUST NOT 回退为完整 `outputVariables`
- 子 recipe 执行期间产生的 `WorkflowExecutionEvent`（NODE_STARTED / NODE_OUTPUT_DELTA / NODE_COMPLETED 等）MUST 转发给父 execution observer，事件 MUST 携带子 execution 的 `executionId` 和 `nodeId`，用于轨迹还原

**流程接入：**
- 上游：`recipe-choice` 或其他提供 DSL `recipe_name` 值的节点
- 下游：消费子结果的节点

**失败与降级：**
- 深度超限 -> 明确失败
- 子 recipe 未注册 -> 明确失败
- 不得隐式共享变量

#### Scenario: Explicit Mapping Only
- **WHEN** `sub-recipe` 完成
- **THEN** 父子 execution 之间的变量交换 MUST 仅通过显式 mapping 发生

#### Scenario: Recipe Name Field Preserved In DSL
- **WHEN** `sub-recipe` 选择子流程
- **THEN** DSL 字段 MUST 保持为 `recipe_name`
- **AND** implementation MUST NOT 借本 change 调整该 DSL 字段名

#### Scenario: Dynamic Recipe Name Resolution Failure Reports Diagnostics
- **WHEN** `recipe_name` 使用变量模板（如 `${input_question}`）且变量不存在或解析为 undefined
- **THEN** handler MUST 抛出 `WORKFLOW_NODE_INPUT_INVALID`（category `VALIDATION`）
- **AND** `safeDetails` MUST 携带 `recipeNameTemplate`、`resolvedType`、`availableVariableKeys`
- **AND** 不得静默失败或使用空字符串作为 recipe name

#### Scenario: Recipe Result Binding Exposes Answer Node Output
- **WHEN** 父节点 `outputs` 配置 `${recipe_result}` 绑定
- **THEN** 绑定值 MUST 为子 recipe answer node 的 `nodeResult.output`（map 结构）
- **AND** 父节点 `outputs` 中其他 key 可通过 `outputMapping` 引用子 recipe `outputVariables` 任意变量消费中间节点输出
- **AND** answer node `nodeResult.output` 为 `undefined` 时，`${recipe_result}` MUST 为空对象 `{}`
- **AND** `sub_recipe_result` 绑定值 MUST 为子执行 summary（`recipe_name`、`executionId`、`status`）

### Requirement: Sub Recipe Answer Node Resolution

`sub-recipe` 的 `${recipe_result}` 绑定 MUST 指向子 recipe answer node 的 `nodeResult.output`。answer node 定义为子 recipe 的"最后一个节点"：从 `END` 节点沿单前驱链反向遍历，跳过 gateway 节点（START/END/CONDITION/PARALLEL），取第一个非 gateway 节点。该解析 MUST 仅依赖子 recipe `flowGraph` 结构，不依赖执行时序。

该 answer node 解析与父 recipe 的 runtime event projector answer 解析采用同一套 END 反向算法（从 END 沿单前驱链、跳过 gateway、取第一个非 gateway 节点），使同一 recipe 不论作父还是作子，answer 节点解析结果一致。父 recipe projector 用该节点决定哪个完成事件以 ANSWER 级高亮；子 recipe 用该节点决定 `${recipe_result}` 绑定哪个 output。两者用途不同（呈现 vs 数据流）但算法相同，fork/join 之前的分支结构不影响 answer node 解析。

**解析规则：**
1. 找到 `type === "END"` 的节点作为反向起点
2. 构建反向邻接（`next` 反向映射到前驱列表）
3. 从 END 沿单前驱链（当前节点仅有 1 个前驱时继续）反向遍历
4. 跳过 gateway 节点（START/END/CONDITION/PARALLEL）
5. 取反向链上第一个非 gateway 节点作为 answer node
6. 从子执行 `nodeResults` 中按 `nodeId` 匹配 answer node 的 `nodeResult.output`

**边界：**
- 子 recipe 无 END 节点 -> answer node 未定义 -> `${recipe_result}` 为空对象
- END 无前驱 -> answer node 未定义 -> `${recipe_result}` 为空对象
- END 直接前驱为非 gateway 节点 -> 该前驱即 answer node（常见"最后一个节点"形态）
- END 前驱为 gateway 且该 gateway 仅有 1 个前驱 -> 继续反向遍历
- END 前驱为 gateway 且该 gateway 有多个前驱（如 fork-join 直接接 END）-> 无法沿单前驱链回溯 -> answer node 未定义 -> `${recipe_result}` 为空对象
- answer node 在执行中失败或被跳过 -> `nodeResult.output` 为 `undefined` -> `${recipe_result}` 为空对象

#### Scenario: Answer Node Resolved As End-Adjacent Node
- **GIVEN** 子 recipe 结构为 `START -> display_a -> display_b -> END`
- **WHEN** `sub-recipe` 执行完成
- **THEN** answer node MUST 为 `display_b`（END 的直接前驱）
- **AND** `${recipe_result}` MUST 为 `display_b` 的 `nodeResult.output`

#### Scenario: Gateway Nodes Excluded From Answer Chain
- **GIVEN** 子 recipe 结构为 `START -> display_a -> END`
- **WHEN** `sub-recipe` 执行完成
- **THEN** answer node MUST 为 `display_a`（END 被排除为 gateway，取其前驱）
- **AND** `${recipe_result}` MUST 为 `display_a` 的 `nodeResult.output`

#### Scenario: Fork Join Does Not Change Answer Node
- **GIVEN** 子 recipe 结构含 fork/join：`START -> init -> parallel_fork -> [branch_a, branch_b] -> join_node -> summary -> END`
- **AND** `parallel_fork` 为 PARALLEL gateway，`join_node` 与 `summary` 为非 gateway 节点
- **WHEN** `sub-recipe` 执行完成
- **THEN** answer node MUST 为 `summary`（END 的直接前驱）
- **AND** `${recipe_result}` MUST 为 `summary` 的 `nodeResult.output`
- **AND** MUST NOT 取 `init` 或 fork 前节点作为 answer node

#### Scenario: Answer Node Output Empty Fallback
- **GIVEN** 子 recipe answer node 执行完成但无 `outputVariables`
- **WHEN** `sub-recipe` 执行完成
- **THEN** `${recipe_result}` MUST 为空对象 `{}`
- **AND** MUST NOT 回退为完整 `outputVariables`

#### Scenario: Middle Node Output Via Explicit Mapping
- **GIVEN** 子 recipe `display_a` 产出 `mid_var`，`display_b` 为 answer node
- **AND** 父 sub-recipe 节点 `outputMapping` 配置 `mid_result: ${outputs.mid_var}`
- **WHEN** `sub-recipe` 执行完成
- **THEN** 父节点 `mid_result` MUST 取自子 recipe `outputVariables.mid_var`
- **AND** `${recipe_result}` MUST 仍为 `display_b` 的 output，不受中间 mapping 影响

#### Scenario: No End Node Yields Empty Recipe Result
- **GIVEN** 子 recipe 无 `type === "END"` 节点
- **WHEN** `sub-recipe` 执行完成
- **THEN** answer node MUST 未定义
- **AND** `${recipe_result}` MUST 为空对象 `{}`

#### Scenario: Fork Join Directly At End Yields Empty Recipe Result
- **GIVEN** 子 recipe `parallel_join`（PARALLEL gateway）直接接 END，且 `parallel_join` 有多个前驱
- **WHEN** 解析 answer node
- **THEN** 反向遍历 MUST 在多前驱 gateway 处停止
- **AND** answer node MUST 未定义
- **AND** `${recipe_result}` MUST 为空对象 `{}`
#### Scenario: Sub Recipe Events Forwarded To Parent Observer
- **WHEN** 子 recipe 执行期间产生 `WorkflowExecutionEvent`
- **THEN** 事件 MUST 转发给父 execution observer
- **AND** 事件 MUST 携带子 execution 的 `executionId` 和 `nodeId`
- **AND** observer MUST 能按 `executionId` 查找对应 recipe 定义用于轨迹还原

### Requirement: Sub Recipe Node Record Info

`sub-recipe` MUST 在子流程执行完成后，从子执行结果中构建步骤记录列表，写入流程上下文变量 `node_record_info`，供后续节点通过 `${node_record_info}` 引用。

**触发机制：**
- 子流程执行完成且状态为 `COMPLETED` 后触发

**输入与前置条件：**
- 子流程已执行完成
- `childResult.nodeResults` 可用

**输出与副作用：**
- `node_record_info`：步骤记录数组，每条记录包含 `name`、`type`、`description`、`inputs`、`outputs`、`outputDefine`

**核心判断逻辑：**
1. 遍历 `childResult.nodeResults`，对每个节点结果构建一条步骤记录
2. `name` 取 `nodeResult.nodeId`
3. `type` 取 `nodeResult.nodeType`
4. `description` 从 `RecipeDefinition.flowGraph.nodes[nodeId].description` 获取（若存在）
5. 从 `nodeResult.output` 中按固定字段名分类为 `inputs` 和 `outputs`
6. `recipe_result` 按归属规则决定是否包含在 `outputs` 中
7. restful 类型节点从 `outputs` 提取 `api_resp_define` 为 `outputDefine`，并从 `outputs` 移除

**输入/输出变量分类规则：**
- 输入参数固定字段：`api_name`、`prompt_template` → 归入 `inputs`
- 输出参数固定字段：`api_response`、`llm_completion`、`api_resp_define`、`user_check_result` → 归入 `outputs`
- 其他非输入类字段 → 归入 `outputs`

**`recipe_result` 归属规则：**
- `is_node_record_with_recipe_result` 为 `true` → 归入 `outputs`
- 系统部署环境 `scene` 为 `MAE-CN` → 归入 `outputs`
- 以上都不满足 → 不归入 `outputs`（被过滤掉）

**`is_node_record_with_recipe_result`：**
- 布尔类型节点输入参数，默认 `false`
- 当值为 `true` 时，`recipe_result` 被包含在步骤记录的 `outputs` 中

**状态 / 产物契约：**
- `node_record_info` 是只读步骤记录数组，不得被后续节点修改
- 步骤记录中的变量值来自子流程节点执行结果，不得包含未执行的节点

**流程接入：**
- 上游：`sub-recipe` 节点自身产出
- 下游：任意后续节点通过 `${node_record_info}` 引用

**失败与降级：**
- 子流程失败时，`executeSubRecipeNode` 已在 `node_record_info` 构建前抛出异常，不产出 `node_record_info`
- `nodeResult.output` 为 `undefined` 时，该节点步骤记录的 `inputs` 和 `outputs` 为空对象

#### Scenario: Build Node Record Info From Child Node Results
- **GIVEN** 子流程执行完成，`childResult.nodeResults` 包含多个节点结果
- **WHEN** `sub-recipe` 节点构建步骤记录
- **THEN** `node_record_info` MUST 为数组，每条记录包含 `name`、`type`、`description`、`inputs`、`outputs`
- **AND** 记录顺序 MUST 与 `nodeResults` 顺序一致

#### Scenario: Classify Input And Output Fields
- **WHEN** 节点输出变量包含 `api_name`、`prompt_template`、`api_response`、`llm_completion`
- **THEN** `api_name`、`prompt_template` MUST 归入 `inputs`
- **AND** `api_response`、`llm_completion` MUST 归入 `outputs`

#### Scenario: Filter Recipe Result By Default
- **GIVEN** `is_node_record_with_recipe_result` 未设置或为 `false`，且 `scene` 不为 `MAE-CN`
- **WHEN** 节点输出变量包含 `recipe_result`
- **THEN** `recipe_result` MUST NOT 出现在步骤记录的 `inputs` 或 `outputs` 中

#### Scenario: Include Recipe Result When Flag Enabled
- **GIVEN** `is_node_record_with_recipe_result` 为 `true`
- **WHEN** 节点输出变量包含 `recipe_result`
- **THEN** `recipe_result` MUST 归入步骤记录的 `outputs`

#### Scenario: Include Recipe Result When Scene Is MAE-CN
- **GIVEN** 系统部署环境 `scene` 为 `MAE-CN`
- **WHEN** 节点输出变量包含 `recipe_result`
- **THEN** `recipe_result` MUST 归入步骤记录的 `outputs`

#### Scenario: Extract OutputDefine For Restful Node
- **GIVEN** 节点类型为 `RESTFUL`，节点输出变量包含 `api_resp_define`
- **WHEN** 构建步骤记录
- **THEN** `api_resp_define` MUST 被提取为 `outputDefine` 字段
- **AND** `outputs` MUST NOT 包含 `api_resp_define`

#### Scenario: Empty Output When Node Result Has No Output
- **GIVEN** `nodeResult.output` 为 `undefined`
- **WHEN** 构建步骤记录
- **THEN** `inputs` MUST 为空对象 `{}`
- **AND** `outputs` MUST 为空对象 `{}`
