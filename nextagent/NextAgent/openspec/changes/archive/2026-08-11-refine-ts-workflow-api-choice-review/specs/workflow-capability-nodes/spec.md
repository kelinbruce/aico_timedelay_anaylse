# workflow-capability-nodes Specification Delta

## MODIFIED Requirements

### Requirement: RESTFUL Node Param Extraction (Retroactive Coverage)

`restful` 节点 MUST 支持通过大模型提取缺失参数（`fm_extract_parameter`），提取结果合并到 API 调用参数中。

**触发机制：**
- 节点 ready 时触发
- 同步启动，异步等待 capability 边界完成

**输入与前置条件：**
- 标准输入 `api_name`
- 可选 `fm_extract_parameter` — 大模型参数提取开关（默认 false）
- 可选 `model` / `modelGroup` — 节点级模型路由覆盖（modelGroup 为 deferred，当前不生效）
- 可选 `param_extract_prompt_template` — 自定义提参 prompt（优先级最高）
- 可选 `param_extract_prompt_template_name` — 提参模板名称（通过 prepareLlmPrompt 查询模板库）
- 可选 `open_reflection` — 参数追问反思开关（默认 false）
- secret reference 解析能力可用
- runtimeCapabilityResolver 可用（fm_extract_parameter=true 时获取 API 参数定义）
- modelInvocation 可用（fm_extract_parameter=true 时调用大模型）

**输出与副作用：**
- safe API 调用结果
- API 调用 diagnostic
- 提参结果合并到 API 调用参数中，不作为独立输出

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
4. 时间参数处理：从 inputSchema 识别 isTimeParam=true 的参数，做 NLP 或 AI 结构化时间转换
5. 通过 gateway 发起 API 调用
6. 对结果做 safe 映射

**状态 / 产物契约：**
- secret 仅在调用边界内短暂解引用，不进入 output / log / snapshot
- API 级重试不产生独立产物，最终结果与单次调用输出同形
- 追问反思创建 pending input，owner 为 agent-runtime

**失败与降级：**
- secret 解析失败、API 超时、长任务轮询耗尽、重试耗尽 → 明确失败或走 `onError`
- runtimeCapabilityResolver 不可用 → 跳过提参（降级，不报错）
- 模型输出非法 JSON → 跳过合并（降级，不报错）
- 模板库查询失败 → 使用默认 prompt（降级）
- 动态 API prompt 构造失败 → 使用默认 prompt（降级）
- NLP 时间转换失败 → 保留原始值

#### Scenario: Secret Exclusion
- **WHEN** `restful` 节点完成
- **THEN** `WorkflowNodeResult.output` MUST NOT 包含 secret 明文

#### Scenario: Param Extraction Degraded
- **WHEN** `fm_extract_parameter=true` 但 runtimeCapabilityResolver 不可用
- **THEN** 实现 MUST 跳过提参，仅用 DSL 已声明参数
- **AND** 不得报错中断流程

#### Scenario: Param Extract Reflection
- **WHEN** `open_reflection=true` 且大模型返回 `NEED_MORE_KEY`
- **THEN** 实现 MUST 创建 pending input（kind 为 QUESTION），暂停流程
- **AND** 节点状态为 NODE_WAITING
- **AND** 用户回答后恢复执行，将答案加入提参上下文重新提取参数

#### Scenario: Param Extraction on All Paths
- **WHEN** `fm_extract_parameter=true` 且节点为长任务轮询或批量模式
- **THEN** 实现 MUST 在 API 调用前执行参数提取和时间转换
- **AND** 提参为公共逻辑，三条执行路径统一接入

### Requirement: RESTFUL Node API-Level Retry (Retroactive Coverage)

`restful` 节点 MUST 支持节点级 API 重试（`retry_times` / `retry_wait_time`）。

**输入与前置条件：**
- 可选 `retry_times` — 重试次数（默认 0，非负整数）
- 可选 `retry_wait_time` — 重试间隔秒数（默认 0）

**核心判断逻辑：**
1. 首次 API 调用后，若结果为 FAILED/TIMED_OUT 且 `retry_times > 0`
2. 等待 `retry_wait_time` 秒
3. 重新调用 API
4. 重复直到成功或重试耗尽
5. SUCCEEDED/DEGRADED 不重试

**输出与副作用：**
- 最终结果与单次调用同形，不产生独立重试产物

**失败与降级：**
- 重试耗尽 → 返回最后一次失败结果

#### Scenario: API-Level Retry
- **WHEN** `retry_times > 0` 且首次 API 调用 FAILED
- **THEN** 实现 MUST 重试最多 `retry_times` 次
- **AND** 重试耗尽后返回最后一次失败结果

### Requirement: RESTFUL Node Time Parameter Conversion (Retroactive Coverage)

`restful` 节点 MUST 支持从 API inputSchema 识别时间参数（`isTimeParam=true`）并做 NLP 或结构化时间转换。

**输入与前置条件：**
- API inputSchema 中属性标记 `isTimeParam: true`
- 可选 `timeType`（`timestamp` | `time_str`，默认 `timestamp`）
- 可选 `timeFormat`（默认 `yyyy-MM-dd HH:mm:ss`）
- 可选 `paramDataType`（默认 `integer`）

**核心判断逻辑：**
1. 从 inputSchema 递归提取所有 isTimeParam=true 的参数定义
2. 对每个时间参数的当前值做 NLP 解析（相对时间表达式、ISO 日期、Unix 时间戳）
3. 若 timeType=timestamp，转换为 epoch 毫秒
4. 若 timeType=time_str，按 timeFormat 格式化为字符串

**失败与降级：**
- NLP 解析失败 → 保留原始值

#### Scenario: Time Param NLP Conversion
- **WHEN** 时间参数值为 "yesterday" 且 timeType=timestamp
- **THEN** 实现 MUST 转换为昨天 0 点的 epoch 毫秒值

### Requirement: RESTFUL Node 1.0 Alias Compatibility (Retroactive Coverage)

`restful` 节点 MUST 兼容 1.0 DSL 的轮询参数别名。

**输入与前置条件：**
- 1.0 DSL 使用 `intervals`、`overtime`、`singleOvertime` 字段名

**核心判断逻辑：**
1. `intervals` → 映射到 `poll_interval`
2. `overtime` → 映射到 `poll_timeout`
3. `singleOvertime` → 映射到 `poll_single_timeout`
4. TS 字段名优先于 1.0 别名（两者同时存在时取 TS 字段名）

#### Scenario: 1.0 Alias Compatibility
- **WHEN** 1.0 DSL 使用 `intervals`/`overtime`/`singleOvertime` 字段名
- **THEN** 实现 MUST 将其映射到对应的 TS 字段名
- **AND** TS 字段名优先于 1.0 别名