## ADDED Requirements

### Requirement: AUDIT surface 必须消费统一 observation stream

AUDIT surface SHALL 消费 `add-ts-trace-log-linking` 产生的 `ObservabilityObservationEvent`。runtime listener、composition-time wrapper、system observation producer、source precedence、dedup 和 `ObservabilityProjectorHost.acceptObservation(event): void` 仍由 `add-ts-trace-log-linking` 拥有。

`AuditProjector` SHALL 作为 `ObservabilityProjectorHost` 异步调用的 fixed projector。业务 package 不得 import `AuditEventWriter`、构造 `AuditEvent`、定义 audit-only observation event 或直接写 audit sink。

#### Scenario: Audit 使用 host handoff 路径
- **WHEN** observation 被 `ObservabilityProjectorHost` 接收
- **THEN** AUDIT 处理只能通过已配置的 `AuditProjector` 执行
- **AND** runtime、core、capability、model、gateway 和 channel 产品代码不得调用 `AuditEventWriter`

### Requirement: AUDIT domain objects 必须有稳定语义

`AuditEvent` SHALL 是 AUDIT surface 的输出对象，必须包含稳定 `auditId`、`eventName`、可信 `ownerScope`、可信 `occurredAt`、低基数 `outcome`、owner-safe `stableRefs`、可选 `safeReasonCode`、可选 `safeErrorCategory`、有界 `safeSummary` 和 policy-approved machine-readable `attributes`。

`AuditEventWriter` SHALL 是只由 `AuditProjector` 调用的 sink port。`AuditProjectionPolicy` SHALL 拥有 AUDIT coverage 和 allowed attributes。`AuditProjectionResult` SHALL 固定为 `emitted`、`skipped_not_covered`、`skipped_policy_denied`、`degraded` 或 `failed_closed`。

#### Scenario: Audit event 可追溯且不含 raw payload
- **WHEN** 命中 AUDIT coverage 的 observation 被投影
- **THEN** 生成的 `AuditEvent` 携带 owner scope、event name、outcome、safe reason 和 stable refs
- **AND** 不需要 prompt、model output、tool args/result、attachment content、path 或 raw provider response

### Requirement: AUDIT coverage 清单必须声明输入来源

AUDIT surface SHALL 维护 coverage inventory。每个 audit event SHALL 声明业务事实、首选 timeline event、event 是否已存在、已有 event 是否需要增强、是否需要由 owner change 新增业务 event，或由哪个 wrapper 生成 `ObservabilityObservationEvent`。

首版 AUDIT inventory SHALL 包含：

| Audit event | Preferred input | Status |
|---|---|---|
| `request.accepted` | `REQUEST_ACCEPTED` | 已有 persisted timeline event；无需 audit-specific enhancement |
| `request.rejected` | `RuntimeCommandPort` wrapper | 当前由 `agent-app` composition 接入；run / timeline 尚未产生时使用 wrapper observation |
| `terminal.committed` | `REQUEST_COMPLETED` / `REQUEST_FAILED` / `REQUEST_CANCELED` / `REQUEST_SUPERSEDED` | 已有 persisted timeline events；无需 audit-specific enhancement |
| `model.security_failed` / `model.credential_failed` / `model.quota_failed` | `ModelInvocationService` wrapper observation | wrapper observation；`durationMs` / `usage` 增强归 `add-ts-trace-log-linking`；只有 safe category 命中治理失败时写 AUDIT |
| `capability.denied` / `capability.security_failed` / `capability.policy_blocked` | `CAPABILITY_COMPLETED` 或 `CapabilityInvocationPort` wrapper | 已有 event 优先；无 event 覆盖权威事实时使用 wrapper；`durationMs` 增强归 `add-ts-trace-log-linking` |
| `gateway.owner_boundary_failed` / `gateway.credential_failed` | `GatewayPort` wrapper | 后续 gateway owner wrapper；本 change 不新增 runtime timeline event |
| `hook.invoked` / `hook.completed` / `hook.failed` | hook wrapper | 后续 hook owner wrapper；本 change 不新增 runtime timeline event |
| `policy.allowed` / `policy.denied` / `policy.failed` | policy wrapper | 后续 policy owner wrapper；本 change 不新增 runtime timeline event |
| `attachment.accepted` / `attachment.rejected` | `ATTACHMENT_ACCEPTED` / `ATTACHMENT_REJECTED` 或 `AttachmentIntakeRead` wrapper | event vocabulary / wrapper 由 attachment owner 后续实现 |
| `safe_error.emitted` | `SafeErrorOutput` wrapper | 后续 safe error owner wrapper |

本 change SHALL NOT 新增 `TimelineEventType`。attachment、hook、policy 或 gateway 事实如果后续需要 timeline event，必须由对应业务 owner change 定义 safe payload、persistence purpose、channel projection impact 和 observation mapper impact。
本 change 的代码实现落地 AUDIT projector、audit writer adapter、已有 acquisition source 的消费，以及 pre-run rejection 所需的 `RuntimeCommandPort` wrapper 消费；上表中的其它后续 wrapper 行不得被解读为当前已经实现对应采集器。

#### Scenario: 已有 timeline event 优先
- **WHEN** `REQUEST_ACCEPTED` 或 terminal timeline event 可用
- **THEN** AUDIT projection 使用由该 runtime event 派生的 observation
- **AND** wrapper 不得为同一事实发出重复 audit observation

#### Scenario: Wrapper 覆盖 pre-run rejection
- **WHEN** 请求在 run 和 timeline 事实产生前被拒绝
- **THEN** `RuntimeCommandPort` wrapper 可以生成携带可信 owner scope 和 safe reason 的 observation
- **AND** audit event 省略尚不存在的 run/session refs

### Requirement: AuditEvent generation 必须从 observation 受控映射

`AuditProjector` SHALL 只从 `ObservabilityObservationEvent` 生成 `AuditEvent`。它必须把 `ownerScope`、`occurredAt`、`boundary`、`operation`、`outcome`、`stableRefs`、`safeReasonCode`、`durationMs`、`usage` 和 `diagnosticSnapshot` 经过 AUDIT policy 与 redaction 后再写出。

`auditId` SHALL 对同一权威事实保持稳定，基于 owner scope、event name 和 stable fact key 生成。projector 必须省略不可用 optional refs；当可信 owner scope、可信 occurredAt、event name、outcome 或 safe summary 无法成立时 fail closed。

#### Scenario: Model usage 保持 normalized shape
- **WHEN** 命中 audit coverage 的 model failure observation 携带 normalized `usage`
- **THEN** AUDIT attributes 只在 AUDIT policy 允许时使用 `inputTokens`、`outputTokens` 和 `totalTokens`
- **AND** projector 不引入 `modelInputTokens` 或开放式 usage key

#### Scenario: 缺失可信 owner 时 fail closed
- **WHEN** audit candidate 缺少可信 `ownerScope` 或 `occurredAt`
- **THEN** `AuditProjector` 返回 `failed_closed`
- **AND** 不从 diagnostic candidates、当前 ALS 或 sink time 补 tenant、subject、agent 或 timestamp

### Requirement: AUDIT failures 必须显式、有界且不影响业务结果

Audit sink failure、timeout、serialization failure、redaction failure、invalid field shape 或 missing required trusted input SHALL NOT 改变 request lifecycle、terminal commit、stream projection、model invocation、capability invocation、gateway call 或 health response。projector SHALL 通过 shared degradation model 记录 bounded audit degradation evidence，且不得伪造 audit write success。

#### Scenario: Audit writer unavailable
- **WHEN** terminal audit projection 时 `AuditEventWriter` 不可用
- **THEN** terminal truth 仍保持 committed
- **AND** AUDIT projection 返回 `degraded` 或 `failed_closed`，并留下 safe degradation evidence

### Requirement: Audit output 不得成为业务权威

`AuditEvent` SHALL 被视为 derived governance evidence。它不得创建、更新、替换或覆盖 `RequestRun`、`RunTimelineEvent`、`SessionMessage`、checkpoint、pending input、artifact、memory、capability result、metric sample、structured log 或 trace output。

#### Scenario: Audit 与 runtime truth 冲突
- **WHEN** audit record 看起来与 runtime durable facts 不一致
- **THEN** runtime durable facts 仍是权威事实
- **AND** audit record 只能作为可能 degraded 的派生证据
