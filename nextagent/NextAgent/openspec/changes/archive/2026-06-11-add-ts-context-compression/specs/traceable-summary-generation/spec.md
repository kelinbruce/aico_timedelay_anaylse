# traceable-summary-generation Specification (delta from add-ts-context-compression)

## ADDED Requirements

### Requirement: TraceableSummaryGenerationRequest DTO MUST 携带可信 scope 和冻结覆盖范围

定义在 `agent-contracts/context` 中的 `TraceableSummaryGenerationRequest` DTO MUST 携带可信 owner scope、agent scope、请求身份、locale、purpose，以及生成 summary draft 所需的冻结模型可见覆盖消息范围。该 DTO 是 `TraceableSummaryGenerationPort.generate(request, signal)` 接受的唯一请求类型。

#### Scenario: Request DTO 携带可信 scope 与身份字段

- **WHEN** Context Engine 构造一个 `TraceableSummaryGenerationRequest`
- **THEN** 该 DTO MUST 携带 `tenantId`、`subjectId`、`agentId`、`agentVersion`、`sessionId`、`requestId`、`runId`、`stepId`、`locale` 和 `purpose`
- **AND** 这些字段 MUST 来自可信 channel/auth 边界、runtime 拥有的 agent assembly resolver 和已受理的 assembly 事实
- **AND** 该 DTO MUST NOT 携带 `rootMessageId`、raw prompt、raw provider 请求体、credential、本地路径或高基数标识符
- **AND** `requestId` MUST 表示当前根用户请求身份

#### Scenario: Request DTO 携带压缩覆盖范围

- **WHEN** Context Engine 为一次 `PREFIX_COMPACT_RECENT_TAIL` 提交构造 `TraceableSummaryGenerationRequest`
- **THEN** 该 DTO MUST 携带 `sourceActiveContextVersion`、`targetBudgetUnits`、`coveredMessageRefs`、`retainedTailMessageRefs`，以及以冻结模型可见形式序列化的 `coveredMessages` 列表
- **AND** 序列化的 `coveredMessages` MUST 消费既有的大内容替换，MUST NOT 重新内联 raw 外部大 payload
- **AND** 该 DTO MUST NOT 携带 secret、credential、不安全的本地路径或高基数标识符

#### Scenario: Port 签名可取消且异步

- **WHEN** Context Engine 调用 `TraceableSummaryGenerationPort.generate(request, signal)`
- **THEN** 该调用 MUST 接受 `AbortSignal` 或等价的 cancellation context
- **AND** 该调用 MUST 返回单个 `TraceableSummaryDraft` 或安全失败
- **AND** 该调用 MUST NOT 拥有 active context、session 持久化、checkpoint、timeline、runtime 生命周期或压缩提交

### Requirement: TraceableSummaryGenerationRequest 和 TraceableSummaryDraft MUST 是 JSON 兼容的

Request 和 draft 两个 DTO 都 MUST 是由 `agent-contracts/context` 拥有的 JSON 兼容类型。Schema 或 type guard 校验 MUST 在 trust 或进程边界应用。

#### Scenario: DTO 穿越 trust 或进程边界

- **WHEN** Context Engine 为 generator 序列化一个 request，或 generator 返回一个 draft
- **THEN** 该 DTO MUST 能无损通过 JSON 往返
- **AND** schema 或 type guard 校验 MUST 拒绝未知字段或错误类型
- **AND** 校验失败 MUST 被视为安全的 generator 失败
