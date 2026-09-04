## Function

- **所属 Function**：`FN-4.3 装配上下文`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Prior conversation preserves valid conversation boundaries

Context Engine MUST 只把协议完整且当前有效的 prior conversation unit 选入普通模型上下文。对于同一 prior request 的 Retry 历史，Context Engine MUST 从具有 `visibility.reason="RETRY_REPLACED"` 且 `runId` 已定义的非 USER message 识别被替换 run，并排除该 request unit 内所有属于这些 run 的非 USER messages；该排除 MUST 包含 Retry 前已经 `visible=false`、没有 replacement reason 的 assistant tool-use。具有 `RETRY_REPLACED` 但缺少 `runId` 的 message MUST 仍按 message 自身排除，但不得据此扩展到其他 messages。Context Engine MUST 保留 root user message，再使用剩余消息验证完整有序的 tool-use / capability-result 序列以及 terminal assistant response；只有验证通过的剩余消息才能成为 history candidate。被 Retry 替换的旧 messages MUST NOT 参与协议配对、终态判定或模型输入。

Context Engine MUST NOT 按消息时间、run 顺序或 `runId` 值猜测 latest attempt，也 MUST NOT 在没有明确 `RETRY_REPLACED` message 时推断被替换 run。具有 `metadata.visibility.reason` 且 reason 不等于 `RETRY_REPLACED` 的 replacement messages MUST NOT 通过上述 Retry 规则恢复为模型可见历史。没有 `metadata.visibility.reason` 且不属于明确被替换 run 的执行期 assistant tool-use 继续遵守既有 Tool protocol 可见性规则。剩余消息存在不完整终态、pending tool-use、孤立 capability result 或其他协议不完整时，Context Engine MUST 排除整个 prior conversation unit，不得只选择其中看似可用的片段。

**需求类别**：功能性需求

#### Scenario: 纯文本 Retry 保留最新有效轮次

- **GIVEN** 一个 prior request 包含可见 root user message、至少一个被标记为 `RETRY_REPLACED` 的旧 terminal assistant response，以及一个最新可见 terminal assistant response
- **WHEN** 后续请求装配模型上下文
- **THEN** history candidate MUST 包含该 root user message 和最新可见 terminal assistant response
- **AND** history candidate MUST NOT 包含任一被 `RETRY_REPLACED` 的旧 assistant response

#### Scenario: Tool Retry 只保留最新完整协议序列

- **GIVEN** 一个 prior request 的旧 run 包含 Retry 前已经 hidden 且没有 replacement reason 的 assistant tool-use，以及被标记为 `RETRY_REPLACED` 的 capability result 和 terminal assistant response
- **AND** 同一 prior request 包含最新可见且有序完整的 assistant tool-use、capability result 和 terminal assistant response
- **WHEN** 后续请求装配模型上下文
- **THEN** history candidate MUST 包含 root user message 和最新可见 attempt 的完整 Tool protocol sequence
- **AND** 该明确被替换 run 的全部非 USER messages MUST NOT 参与协议配对或 history candidate

#### Scenario: 连续 Retry 排除全部旧 attempts

- **GIVEN** 同一 prior request 已完成多次 Retry，且每个旧 run 至少有一个带 `RETRY_REPLACED` 和 `runId` 的非 USER message
- **WHEN** 后续请求装配模型上下文
- **THEN** Context Engine MUST 排除全部被替换 attempts 的 messages
- **AND** 只有 root user message 与最新可见且协议完整的 attempt 能成为该 prior turn 的 history candidate

#### Scenario: 缺少 runId 的 Retry marker 不扩展排除范围

- **GIVEN** 一个 prior request 包含带 `RETRY_REPLACED` 但缺少 `runId` 的 hidden message
- **WHEN** 后续请求装配模型上下文
- **THEN** Context Engine MUST 排除该 message
- **AND** Context Engine MUST NOT 因该 marker 排除其他没有明确关联的 messages
- **AND** 剩余 unit 协议不完整时 MUST 继续整体 fail closed

#### Scenario: 最新 attempt 协议不完整时继续 fail closed

- **GIVEN** 一个 prior request 的旧 attempt messages 已被标记为 `RETRY_REPLACED`
- **AND** 剩余最新可见 attempt 缺少匹配的 capability result 或 terminal assistant response
- **WHEN** 后续请求装配模型上下文
- **THEN** Context Engine MUST 排除整个 prior conversation unit
- **AND** Context Engine MUST NOT 把 root user message、孤立 Tool protocol fragment 或部分最新输出单独作为完整轮次选入

#### Scenario: 其他 replacement reason 不使用 Retry 过滤规则

- **GIVEN** 一个 prior conversation unit 包含 `metadata.visibility.reason` 为非 `RETRY_REPLACED` 值的 hidden message
- **WHEN** Context Engine 验证该 prior conversation unit
- **THEN** 该 hidden message MUST NOT 因本 Requirement 的 Retry 规则恢复为模型可见
- **AND** 该 unit 不满足完整可见轮次条件时 MUST 被整体排除

#### Scenario: Direct Workflow Retry 不引入过程事件

- **GIVEN** 一个 Direct Workflow prior request 在 Retry 后具有 root user message、最新可见 terminal assistant response 和 Workflow process events
- **WHEN** 后续请求装配模型上下文
- **THEN** history candidate MUST 按本 Requirement 使用 root user message 和最新可见 terminal assistant response 验证完整轮次
- **AND** Workflow process events MUST NOT 因 Retry 历史选择进入普通模型上下文

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：系统从活动上下文形成 prior conversation unit 时，先排除被 Retry 替换的旧 attempt messages，再对剩余消息执行完整轮次和 Tool protocol 校验；其他 replacement reason 和不完整协议继续按既有规则排除。
- **依据 Requirements**：`Prior conversation preserves valid conversation boundaries`

### 结果

- **变更类型**：修改
- **目标内容**：Retry 后的完整 prior turn 由原始用户问题和最新有效 attempt 组成，旧 attempt 不进入普通模型上下文；最新 attempt 不完整时该轮次不作为 history candidate。
- **依据 Requirements**：`Prior conversation preserves valid conversation boundaries`

### 规格

- **规格项**：Retry 后历史选择
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：保留原始用户问题和最新完整可见 attempt；排除全部 `RETRY_REPLACED` 旧输出；具有其他 visibility reason 的 replacement message 和不完整 Tool protocol 不恢复为有效轮次。
- **依据 Requirements**：`Prior conversation preserves valid conversation boundaries`
