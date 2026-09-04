## Function

- **所属 Function**：`FN-9.4 执行能力节点`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

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

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：`restful` 节点 reflection pending input 超时 resume（`resumeState.answers` 为 `undefined`）时抛 `WORKFLOW_NODE_TIMEOUT`（category: TIMEOUT），不重新调用模型创建新 reflection pending input，由 engine exception 分支处理或终态化 `FAILED`。
- **依据 Requirements**：`Restful Node`

### 结果

- **变更类型**：修改
- **目标内容**：reflection 超时后走 exception 分支（terminal 可能为 `COMPLETED`）或 `FAILED`（`WORKFLOW_NODE_TIMEOUT`）。
- **依据 Requirements**：`Restful Node`

### 规格

#### 规格项：reflection 超时行为

- **变更类型**：修改
- **原规格值**：超时 resume 后 fall through 重复调用模型创建新 reflection pending input
- **目标规格值**：超时 resume 时抛 `WORKFLOW_NODE_TIMEOUT`（category: TIMEOUT），不创建新 reflection pending input
- **依据 Requirements**：`Restful Node`
