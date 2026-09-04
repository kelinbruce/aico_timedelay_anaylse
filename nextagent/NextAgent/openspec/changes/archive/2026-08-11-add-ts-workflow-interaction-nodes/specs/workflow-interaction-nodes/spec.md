## ADDED Requirements

### Requirement: User Check

`user-check` MUST 暂停 workflow execution，创建等待用户回答的 pending input，并在收到回答后继续执行。

interaction 节点的 node-specific schema MUST 由本 change owner 定义；`agent-contracts/core` 中的 `WorkflowNodeDef.inputs`、`outputs`、`outputParser` 只作为 opaque 容器，不得在 core contracts 中枚举 interaction 私有字段。

**触发机制：**
- 节点 ready 时由 scheduler 触发
- 在 workflow execution 阶段同步创建 pending input，随后异步等待用户动作
- 用户回答属于 request lifecycle 之外的外部动作，由 runtime resume 机制重新触发

**输入与前置条件：**
- 问题文本
- 选项列表或输入约束
- runtime pending input boundary 可用

**输出与副作用：**
- 创建 pending input 事实
- 收到回答后输出 safe `selectedOption` 或等价回答结果

**核心判断逻辑：**
1. 校验问题和选项配置
2. 创建 pending input
3. 暂停当前 execution
4. 回答到达后恢复 execution 并映射回答结果

**状态 / 产物契约：**
- pending input 的 owner MUST 是 `agent-runtime`
- pending input 生命周期直到回答、超时或 cancel

**流程接入：**
- 上游：任意普通节点
- 下游：回答结果供后续节点消费

**失败与降级：**
- 超时 -> 明确失败或按 `onError`
- 无效回答 -> validation 失败，不得静默接受

#### Scenario: Pause And Resume On User Answer
- **WHEN** `user-check` 创建 pending input 后收到合法回答
- **THEN** execution MUST 恢复并继续下游

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

**触发机制：**
- 节点 ready 时触发

**输入与前置条件：**
- safe text / markdown 内容

**输出与副作用：**
- stream projection
- 可选 safe output summary

**核心判断逻辑：**
1. 校验内容为允许格式
2. 发送到 stream projection
3. 标记节点完成并继续下游

**状态 / 产物契约：**
- 投影内容与 execution / nodeId / retryCount 或等价安全可追溯键可追溯
- 不得包含 raw HTML / script

**流程接入：**
- 消费方为 `agent-channel-web`

**失败与降级：**
- 内容不安全 -> 明确拒绝

#### Scenario: Safe Projection Only
- **WHEN** `display-content` 投影内容
- **THEN** 内容 MUST 只包含 safe text / markdown

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

`interrupt-gateway` MUST 暂停 workflow，等待外部 resume 动作，而不是主动向用户提问。

**触发机制：**
- 节点 ready 时触发
- 同步创建等待态，异步等待外部 resume

**输入与前置条件：**
- runtime resume boundary 可用

**输出与副作用：**
- 创建 `WORKFLOW_INTERRUPT` 等待事实
- resume 后恢复 execution

**状态 / 产物契约：**
- 等待事实 owner MUST 是 `agent-runtime`

**失败与降级：**
- 未收到 resume -> execution 保持等待，不得静默继续

#### Scenario: External Resume Required
- **WHEN** `interrupt-gateway` 进入等待态
- **THEN** execution MUST 仅在外部 resume 后继续

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
