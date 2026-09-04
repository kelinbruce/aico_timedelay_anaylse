## Function

- **所属 Function**：`FN-1.2 断线后从上次位置继续`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: 结构化过程正文使用单一 Message 恢复

对于已经具有 canonical `CAPABILITY_RESULT` Message carrier 的 ordinary Capability 语义结果，系统 MUST 只持久化一份 Message 语义正文。对应 `CAPABILITY_COMPLETED` 与其他 ordinary lifecycle Event MUST NOT 持久化第二份 Message 或 Event body。

经过受治理 producer 的 canonical shape validation、安全过滤和 structured-delta 识别，并由 `tool-structured-delta` persistence rules 选为 durable history 的 `TOOL_STRUCTURED_DELTA`，在 canonical Message 尚不能分别承载语义结果与最终 structured presentation snapshot 的兼容阶段，MUST 作为独立、封闭的 Channel/UI 过渡 presentation Event 持久化。该 Event MUST NOT 取代 Message 的语义结果所有权，MUST NOT 进入模型上下文，也 MUST NOT 反向改变 Capability outcome、request terminal status、degradation、新的 request-level terminal fact 或 annotation。

Conversation history 在同一 run 的同一 `toolCallId` 存在通过既有 process-history eligibility 过滤的可信 persisted structured presentation Event 时 MUST 使用该 Event 集合恢复 process presentation，MUST NOT 同时从 `CAPABILITY_RESULT` Message 再产生第二份 structured presentation。只有该 `toolCallId` 不存在可信 eligible persisted structured presentation Event 时，history MAY 从 stored Message 识别 canonical structured event shape并恢复 legacy compatibility envelope；该 fallback MUST NOT 创建新的 durable body。ordinary non-Workflow `ANSWER` Event MUST 继续由 canonical answer filter 排除，history MUST 保留对应的 Message-derived answer projection。

当 stored `CAPABILITY_RESULT` Message 不匹配 canonical structured event shape 时，history MUST 继续产生 ordinary `CAPABILITY_RESULT_DELTA` projection，MUST NOT 构造 structured presentation。structured presentation 例外 MUST NOT 被 ordinary Tool、Skill、Bash、LLM、ApiCall、CLIP 或 arbitrary self-reported output 绕过。qualified Workflow inner product 的 Event-owned 例外继续只由 `workflow-event-history` 定义。最终 Assistant answer 继续从 Assistant Message 恢复。

**需求类别**：功能性需求

#### Scenario: 持久化结构化呈现优先于Message兼容投影

- **GIVEN** 同一 run 与 `toolCallId` 同时存在 `CAPABILITY_RESULT` Message 和可信 persisted `TOOL_STRUCTURED_DELTA` Event
- **WHEN** history 合并该 Tool 调用的 presentation
- **THEN** history MUST 使用 persisted Event 集合
- **AND** MUST NOT 同时从 Message 生成第二份 structured presentation
- **AND** Message MUST 继续供模型上下文使用

#### Scenario: legacy历史从stored Message恢复结构化呈现

- **GIVEN** 一个 legacy Tool 调用没有可信 persisted structured presentation Event
- **AND** stored `CAPABILITY_RESULT` Message 包含匹配 canonical structured event shape 的 payload
- **WHEN** history 恢复该 Tool 调用
- **THEN** history MAY 产生安全 `TOOL_STRUCTURED_DELTA` compatibility envelope
- **AND** envelope MUST 保留 canonical `toolEventType`、`toolMessageType` 与 content
- **AND** history MUST NOT 创建第二份 durable body

#### Scenario: 非结构化payload保持ordinary result projection

- **WHEN** stored `CAPABILITY_RESULT` Message payload 不匹配 canonical structured event shape
- **THEN** history MUST 产生既有 `CAPABILITY_RESULT_DELTA` projection
- **AND** MUST NOT 构造 structured presentation

#### Scenario: ordinary ANSWER继续使用Message-derived projection

- **GIVEN** 同一 run 与 `toolCallId` 同时存在 ordinary non-Workflow `ANSWER` Event 和可识别的 `CAPABILITY_RESULT` Message
- **WHEN** history 合并该 Tool 调用的 answer presentation
- **THEN** persisted `ANSWER` Event MUST 由 canonical answer filter 排除
- **AND** history MUST 保留 Message-derived structured answer projection

#### Scenario: 不同Tool调用不得互相抑制兼容投影

- **GIVEN** 同一 run 的 Tool A 有 persisted structured presentation Event
- **AND** Tool B 只有可识别的 legacy `CAPABILITY_RESULT` Message
- **WHEN** history 合并两个 Tool 调用
- **THEN** Tool A MUST 使用 Event presentation
- **AND** Tool B MUST 保留 Message-derived compatibility presentation

#### Scenario: Workflow product使用独立Event-owned例外

- **WHEN** qualified Workflow inner product 没有 canonical Message carrier
- **THEN** completed product body MUST 使用 `workflow-event-history` 定义的 durable Event owner
- **AND** 该例外 MUST NOT 改变 ordinary Capability 语义结果或 terminal answer 的 Message owner

#### Scenario: string payload的structured history恢复（DEFERRED）

- **WHEN** public Capability result contract 接受 CLIP string payload，且 stored `CAPABILITY_RESULT` Message 包含该 payload
- **THEN** history MUST 产生 `toolEventType: "ANSWER"`、`toolMessageType: "TEXT"` 的 `TOOL_STRUCTURED_DELTA` envelope
- **AND** 在 public Capability result contract 不接受 string payload 时，本 Scenario MUST NOT 改变当前输入值域或形成当前实施任务

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：history 按 `(runId, toolCallId)` 为 structured presentation 选择唯一来源；新数据使用 persisted Event，缺失 Event 的 legacy 数据使用 Message-derived compatibility projection。
- **依据 Requirements**：`结构化过程正文使用单一 Message 恢复`

### 结果

- **变更类型**：修改
- **目标内容**：刷新后的 structured presentation 不重复且 legacy history 仍可恢复；Message 语义结果与 Event presentation 不互相成为 authority。
- **依据 Requirements**：`结构化过程正文使用单一 Message 恢复`
