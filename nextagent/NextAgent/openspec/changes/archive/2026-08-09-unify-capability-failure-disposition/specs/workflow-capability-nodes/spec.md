# workflow-capability-nodes Delta Specification

所属 Function：`FN-9.4 执行能力节点`

Function 变更类型：修改

spec 角色：主规格

## MODIFIED Requirements

### Requirement: Restful Node

`restful` MUST 对齐标准 Recipe YAML 的 API 调用语义，并通过安全 gateway 发起请求。

**触发机制：**
- 节点 ready 时 MUST 触发
- 系统 MUST 同步启动并异步等待 Capability 边界完成

**输入与前置条件：**
- 标准输入 `api_name`
- 可选 `fm_extract_parameter` — 大模型参数提取开关（默认 false）
- 可选 `model` / `modelGroup` — 节点级模型路由覆盖
- 可选 `param_extract_prompt_template` — 自定义提参 prompt（优先级最高）
- 可选 `param_extract_prompt_template_name` — 提参模板名称
- 可选 `open_reflection` — 参数追问反思开关（默认 false）
- 可选兼容字段 `retry_times` / `retry_wait_time` — schema MUST 可解析，但字段 MUST NOT 触发最终 Capability 失败的节点级重试
- 可选 `is_long_api` — 长任务轮询开关
- 可选轮询参数 `poll_max_times`、`poll_interval`、`poll_timeout`、`poll_single_timeout`、`on_poll_error`
- 1.0 DSL 别名兼容：`intervals` → `poll_interval`、`overtime` → `poll_timeout`、`singleOvertime` → `poll_single_timeout`，TS 字段名优先
- 可选 `api_group` — 暂不实现
- secret reference 解析能力可用
- API 参数定义解析能力可用（`fm_extract_parameter=true` 时）
- 模型调用能力可用（`fm_extract_parameter=true` 时）

**输出与副作用：**
- 系统 MUST 产生 safe API 调用结果和 API 调用 diagnostic
- 系统 MUST 把提参结果合并到 API 调用参数，MUST NOT 把它作为独立输出

**核心判断逻辑：**
1. 系统 MUST 解析 `api_name` 和请求参数。
2. 系统 MUST 解析并只在调用边界内注入 secret reference。
3. `fm_extract_parameter=true` 且非参数追问模式时，系统 MUST 解析 API 参数定义、筛选缺失参数、构造 prompt、调用模型并合并提取参数；DSL 已声明参数 MUST 优先。
4. `open_reflection=true` 且模型返回 `NEED_MORE_KEY` 时，系统 MUST 创建 pending input。
5. 系统 MUST 识别并转换声明的时间参数。
6. 系统 MUST 通过统一 Capability 调用边界发起 API 调用。
7. 系统 MUST 按 `CapabilityInvocationResult` 映射安全结果；最终失败 MUST 直接上升显式 `exception`，MUST NOT 执行 RESTFUL 节点级 retry。

**状态 / 产物契约：**
- secret MUST 仅在调用边界内短暂解引用，MUST NOT 进入 output、log 或 snapshot
- 追问反思 MUST 通过 runtime-owned pending-input contract 创建 pending input
- 每次逻辑 API 调用 MUST 只产生一个最终 Capability 结果

**失败与降级：**
- secret 解析失败、API 超时、长任务轮询耗尽和其他最终 Capability 失败 MUST 明确失败并求值显式 `exception`
- API 参数定义解析不可用时，系统 MUST 跳过提参并仅使用 DSL 参数
- 模型输出非法 JSON 时，系统 MUST 跳过合并
- 模板库查询失败时，系统 MUST 使用默认 prompt
- `PromptSplicing` boundary 未装配时，系统 MUST 使用默认 prompt；调用已经发起后的最终失败 MUST 上升，MUST NOT 静默 fallback
- NLP 时间转换失败时，系统 MUST 保留原值

**需求类别**：功能性需求

#### Scenario: Secret Exclusion

- **WHEN** `restful` 节点完成
- **THEN** `WorkflowNodeResult.output` MUST NOT 包含 secret 明文

#### Scenario: 1.0 Alias Compatibility

- **WHEN** 1.0 DSL 使用 `intervals`、`overtime` 或 `singleOvertime`
- **THEN** 实现 MUST 映射到对应 TS 字段名
- **AND** TS 字段名 MUST 优先

#### Scenario: 兼容 retry 配置不重放 Capability

- **WHEN** `retry_times > 0` 且统一执行边界返回最终 `FAILED` 或 `TIMED_OUT`
- **THEN** RESTFUL 节点 MUST NOT 再次调用该 Capability
- **AND** 节点 MUST 立即上升最终安全 `safeError` 并求值显式 `exception`

#### Scenario: Param Extraction Degraded

- **WHEN** `fm_extract_parameter=true` 但 API 参数定义解析不可用
- **THEN** 实现 MUST 跳过提参，仅用 DSL 已声明参数
- **AND** 不得报错中断流程

#### Scenario: Param Extract Reflection

- **WHEN** `open_reflection=true` 且大模型返回 `NEED_MORE_KEY`
- **THEN** 实现 MUST 创建 `QUESTION` pending input 并暂停流程
- **AND** 用户回答后 MUST 恢复执行并将答案加入提参上下文

#### Scenario: Param Extract On All Paths

- **WHEN** `fm_extract_parameter=true` 且节点为长任务轮询或批量模式
- **THEN** 实现 MUST 在 API 调用前执行参数提取和时间转换
- **AND** 三条执行路径 MUST 复用同一提参行为

## ADDED Requirements

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

## Function 变更汇总

### 描述

- 变更类型：修改
- 目标内容：Workflow Capability 节点执行受治理调用，并把最终成功、失败或取消结果无损交给工作流。
- 依据 Requirements：`Capability 节点上升统一最终失败`

### 输出

- 变更类型：修改
- 目标内容：成功和降级产生节点结果；失败保留 Capability `safeError` 并上升；取消直接传播。
- 依据 Requirements：`Capability 节点上升统一最终失败`

### 处理过程

- 变更类型：修改
- 目标内容：节点把声明的 retry 次数作为统一调用边界内部的额外 attempt 上限；未配置时省略该字段并使用统一调用边界的 canonical 缺省行为；节点不对统一调用边界已经返回的最终 Capability 失败执行第二层自动重试。
- 依据 Requirements：`Restful Node`、`Capability 节点上升统一最终失败`

### 结果

- 变更类型：修改
- 目标内容：Workflow engine 可以基于真实业务 code 和安全 message 求值显式 exception。
- 依据 Requirements：`Capability 节点上升统一最终失败`
