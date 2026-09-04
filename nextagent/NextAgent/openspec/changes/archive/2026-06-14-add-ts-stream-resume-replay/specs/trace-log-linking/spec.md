## MODIFIED Requirements

### Requirement: runtime timeline event 必须保持为 runtime 拥有的唯一观测事实

`agent-runtime` SHALL 只发布 runtime-owned request lifecycle、capability invocation、visible stream 和 terminal facts 对应的 `RunTimelineEvent`。模型调用动作默认不是 canonical timeline fact；当它只服务日志、审计、指标或 trace diagnostic 时，必须通过批准的 `ModelInvocationService` wrapper 生成 observation。runtime 不发布 audit/log/metric/trace 专用事实，不 import logger、audit writer、metrics registry、tracer、observability SDK 或 projector，也不决定某个事实由哪个 observability surface 消费。

runtime 必须按业务目的决定 `RunTimelineEvent` 是否持久化，而不是按 observability surface 需求决定。新增或增强 runtime timeline event 时，必须保持稳定 canonical type 和安全 runtime-owned payload 字段；不能使用 `AUDIT_*`、`LOG_*` 或 `METRIC_*` 这类 surface-specific 名称。runtime diagnostic payload 可包含稳定 status、phase、capability kind、stable invocation refs、safe error code/category、duration/size class 和 stable reason code。模型 provider kind、usage、finish reason 和模型调用 duration 属于 model invocation wrapper observation 的安全候选字段，除非未来 runtime/core owner 证明模型调用动作本身需要 canonical timeline 事实。

`agent-channel-web` 拥有 runtime timeline event 是否以及如何投影到 client stream 的决策权，通过显式 allowlist 和 projection function 实现。runtime event 不携带 `client-visible` 或 `diagnostic-only` 这类 observability-owned event property。未知 timeline event 不改变客户端 stream 呈现。已有投影 event 可以保持当前 DTO shape；新增 inline payload 字段只有被 Web channel schema/projection 显式 allowlist 后才能暴露。

`agent-contracts` SHALL NOT expose an observability subpath for audit/log/metric/redaction/projector internals. `AuditEvent`、`AuditEventWriter`、`StructuredLogEntry`、`MetricsRegistry`、redaction policy types、`ObservabilityProjectorHost` 和 error-normalizer implementation contracts SHALL stay in `agent-observability` or the owning package. Cross-package persistence 仍通过 gateway-owned records / local store contracts 表达，不通过通用 observability contract 表达。

runtime 必须提供明确语义的 runtime-owned `RunTimelineEvent` listener 机制，覆盖 `PERSISTED` 和 `LIVE_ONLY` event。`timelineObservers` 不属于本 change 保留的主设计依赖；实现应清理该产品路径依赖，改为单一 listener 机制。runtime 发布前必须补齐 `RunTimelineEvent.eventId`、`sessionId`、`runId`、`requestId`、`requestContextId`、`sequence`、`createdAt`、`agentId`、`agentVersion` 和 `persistence`。`persistence` 只能由 runtime 设置为 `PERSISTED` 或 `LIVE_ONLY`，producer 不能设置或覆盖。`RunTimelineEventRecord` 只用于持久化边界，必须携带 `agentVersion`，不得用于 live-only event，也不得携带 `persistence`。listener failure 不得影响 append、terminal commit、stream projection、scheduler 或 recovery。runtime 内部 `onTimelineAppend` 只服务 run-state append 后的 channel stream fanout，不得作为 observability extension point。

runtime-owned persistence policy SHALL default to existing persisted behavior and MAY mark selected runtime-owned events as `LIVE_ONLY`. The policy is not an observability surface decision: LOG / AUDIT / METRIC / TRACE / HEALTH projectors, mappers, channel projection and agent/core producers MUST NOT choose persistence. A `LIVE_ONLY` event SHALL be delivered to the same runtime listener with runtime-filled fields and SHALL NOT create a `RunTimelineEventRecord` or channel stream queue item.

#### Scenario: observability contract surface 被收紧
- **WHEN** package exports 被检查
- **THEN** `@nextagent/agent-contracts/observability` 不存在
- **AND** 业务 package 不通过 `agent-contracts` import audit writer、logger、metrics registry、redaction 或 projector 类型

#### Scenario: runtime event 本身不改变客户端呈现
- **WHEN** runtime 为业务诊断增强 `CAPABILITY_COMPLETED`
- **THEN** `agent-channel-web` 不得在未显式 allowlist 时把它渲染成新的 client-visible event
- **AND** LOG / AUDIT / METRIC / TRACE projectors 仍可按 coverage policy 消费对应 observation event

#### Scenario: runtime 不发布 surface-specific facts
- **WHEN** model invocation 因 credential-safe reason code 失败
- **THEN** observability 的 `ModelInvocationService` wrapper 必须生成 `MODEL_CREDENTIAL_FAILED` / `MODEL_SECURITY_FAILED` / `MODEL_QUOTA_FAILED` 等 model invocation observation
- **AND** runtime 不发布 `AUDIT_MODEL_CREDENTIAL_FAILED`，不调用 audit writer，不递增 metric，也不调用 logger

#### Scenario: runtime listener 与 channel stream 分离
- **WHEN** runtime append 或 publish `RunTimelineEvent`
- **THEN** runtime listener 可以把补齐后的 `RunTimelineEvent` 交给 observation mapper
- **AND** channel-web client stream 仍只能通过 `RuntimeSessionPort.streamEvents()` 和 channel projection allowlist 输出
- **AND** listener failure 不得改变客户端 stream、terminal truth 或 event persistence

#### Scenario: live-only event 不创建持久化记录
- **WHEN** runtime-owned persistence policy 将某个 runtime event 判定为 `LIVE_ONLY`
- **THEN** listener 收到补齐后的 `RunTimelineEvent`，其 `persistence` 为 `LIVE_ONLY`
- **AND** runtime 不写 `RunTimelineEventRecord`
- **AND** channel stream 不因该 live-only event 新增 client-visible queue item
