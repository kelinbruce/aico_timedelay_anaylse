# audit-sink Specification

## Purpose
TBD - created by archiving change add-ts-audit-sink. Update Purpose after archive.
## Requirements
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



### Requirement: Audit output uses a write-only gateway contract

AuditProjector SHALL emit AuditEvent only through the observability-owned AuditEventWriter output port. Product audit output MUST NOT use RuntimeLogger, an observation-bound operational logger, the operational writer, the metrics exporter or an operational-log surface.

`AuditEventRecord`, `AuditEventStoreGateway` and top-level `GatewayBindings.audit` SHALL be owned and exported only by the canonical agent gateway contract module `agent-contracts/gateway`; this change MUST NOT create a parallel `agent-gateway` package or redefine those contracts in observability, app or deployment packages. `AuditEventStoreGateway` SHALL expose only `appendAuditEvent(record): Promise<void>`. `AuditEventRecordQuery`, `listAuditEvents(...)` and `SqliteGatewayStoreBindings.audit` SHALL be removed. A product or test need to inspect emitted audit evidence MUST NOT preserve or recreate a public query method on the write port.

`agent-app` SHALL implement AuditEventWriter by explicitly mapping AuditEvent DO to AuditEventRecord and calling the selected `GatewayBindings.audit`. Structural similarity MUST NOT replace the owned DO-to-Record mapping. The adapter MUST NOT open a file, access SQLite or call a remote audit protocol itself. Gateway implementation packages MUST NOT import the observability AuditEvent DO or AuditProjector.

#### Scenario: Audit gateway contract remains in the canonical gateway module

- **WHEN** package exports and architecture dependencies are inspected
- **THEN** AuditEventRecord, AuditEventStoreGateway and top-level GatewayBindings.audit MUST be exported from `agent-contracts/gateway`
- **AND** AuditEventStoreGateway MUST expose append only
- **AND** observability, app and deployment packages MUST NOT define a parallel audit gateway contract
- **AND** audit MUST NOT remain a member of SqliteGatewayStoreBindings

#### Scenario: Product code attempts to query emitted audit

- **WHEN** app, runtime, observability or a business package requires AuditEventRecordQuery or listAuditEvents
- **THEN** contract and architecture validation MUST reject that dependency
- **AND** tests MUST use an injected capture gateway or directly inspect a test-owned local audit fixture

### Requirement: Local audit is appended to an independent gateway-owned file family

LOCAL deployment SHALL provide a `FileAuditEventStoreGateway` from `agent-platform-gateway-local`. It SHALL append audit evidence only to `<paths.logDirectory>/nextagent-audit.<YYYY-MM-DD>.<sequence>.ndjson`. Every successful append SHALL produce one complete UTF-8 JSON line with a private `schemaVersion=1` file envelope containing one complete AuditEventRecord. A partial line MUST NOT be reported as emitted.

The local audit family SHALL rotate when its active segment reaches fixed 30 MiB or the fixed Node.js process-local daily boundary. The same process-local date SHALL determine `YYYY-MM-DD`, including 23-hour or 25-hour DST calendar days. Closed segments SHALL be gzip archived through `.gz.tmp` plus atomic rename before the source is deleted, and the committed archive SHALL preserve the source's original closed/rotation timestamp as `closedAt`. Startup reconciliation SHALL remove stale temp artifacts conservatively and retry eligible closed sources. The audit gateway SHALL own its schema, audit policy, append-result mapping and one independent `agent-local-file-roll` handle for destination, derived exact selector, maintenance lane and bounded close. It MUST NOT reuse an `agent-log` or `LocalMetricHistoryExporter` writer/handle, and the foundation MUST NOT import AuditEventRecord or audit vocabulary.

The local audit gateway SHALL retain its closed source/archive files for fixed 7 elapsed days from their original `closedAt` and SHALL keep at most 10 committed gzip archives. Elapsed retention and archive count SHALL be independent deletion conditions; count cleanup SHALL delete the oldest exactly owned archive by `mtime` and then file name. It MUST NOT derive elapsed age from local-midnight counts, archive mtime rewrites or file discovery time. Both policies are implementation-owned and MUST NOT be overridden by app config or runtime input.

Operational and metrics retention owners MUST ignore every audit active/source/archive/temp file, and the audit owner MUST ignore operational, metrics, developer-trace, symlink, unknown and out-of-directory files. The audit owner MUST preserve its active destination, young files and ambiguous evidence for which ownership or original `closedAt` cannot be proven. Long-term compliance archival beyond the local 7-day window requires independent deployment governance and is not provided by this change.

The existing SQLite `audit_events` table/index, SqliteAuditStore and associated schema ownership SHALL be removed. LOCAL startup MUST NOT create, read, migrate, dual-write or fall back to SQLite audit storage. The legacy logger-based LoggingAuditEventWriter and unversioned `nextagent-audit.log` mirror SHALL also be removed; the versioned audit NDJSON family is the only LOCAL audit output.

#### Scenario: Local audit is emitted to its own file

- **WHEN** AuditProjector emits an AuditEvent in LOCAL composition
- **THEN** app MUST map it to AuditEventRecord and call the local file audit gateway
- **AND** one complete versioned line MUST be appended to the active `nextagent-audit.*.ndjson` segment
- **AND** operational console/files, metrics files and SQLite databases MUST contain no audit copy

#### Scenario: Local audit rotates and compresses independently

- **WHEN** the active audit segment reaches 30 MiB or crosses the process-local daily boundary
- **THEN** the local audit gateway MUST select a new active sequence without blocking the business path
- **AND** the closed source MUST be atomically gzip archived
- **AND** neither operational nor metrics maintenance may process it
- **AND** the audit gateway MUST preserve the committed archive until its original closedAt reaches 7 elapsed days

#### Scenario: Local audit archive count exceeds ten

- **WHEN** the audit family commits an eleventh gzip archive while all archives are younger than 7 elapsed days
- **THEN** maintenance MUST delete the oldest exactly owned audit archive
- **AND** no more than 10 committed audit gzip archives MUST remain after successful maintenance

#### Scenario: Local audit ages only its expired closed evidence

- **WHEN** an owned closed audit source or archive reaches `closedAt + 7 * 24h`
- **THEN** the local audit gateway MUST delete it during the next hourly run, or during startup reconciliation if the process was stopped at expiry
- **AND** it MUST preserve the active destination, young audit files, stale temp evidence pending conservative reconciliation and every non-audit or unproven file
- **AND** operational and metrics owners MUST NOT delete it on behalf of the audit gateway

#### Scenario: Local audit restarts after interrupted compression

- **WHEN** the process restarts after gzip, rename or source-delete interruption
- **THEN** startup reconciliation MUST preserve at least one complete recoverable audit source or committed archive
- **AND** it MUST NOT treat `.gz.tmp` as committed audit evidence
- **AND** it MUST not modify another output family

### Requirement: Audit append is duplicate-tolerant rather than exactly-once

AuditEventRecord.auditId SHALL remain stable for the same authoritative fact. `appendAuditEvent` SHALL use retryable at-least-once delivery semantics: retrying the same trusted record MAY append another complete line, and the gateway MUST NOT maintain a SQLite or private cross-restart idempotency index solely to suppress duplicates. Audit consumers SHALL use trusted tenant/subject/agent scope plus auditId as the deduplication key. The system MUST NOT claim exactly-once audit delivery.

#### Scenario: The same audit event is retried

- **WHEN** a caller retries an AuditEventRecord with the same trusted scope and auditId after an ambiguous append outcome
- **THEN** the local file MAY contain more than one identical complete audit line
- **AND** no conflicting record may replace or mutate a prior line
- **AND** a consumer MUST be able to identify the duplicates by scoped auditId

### Requirement: Remote audit remains a gateway concern without local fallback

`agent-platform-gateway-remote` SHALL own any adapter that reports AuditEventRecord to a PaaS audit service when that separately specified capability is configured. REMOTE composition MUST NOT create a local audit file, write SQLite audit storage or fall back to operational logging. Business packages, RuntimeLogger and agent-log MUST remain unaware of the audit service protocol.

#### Scenario: PaaS audit gateway is configured

- **WHEN** a PaaS deployment provides an audit service adapter
- **THEN** AuditEventWriter MUST append through the selected GatewayBindings.audit
- **AND** no local audit/log/metrics/SQLite fallback may be created

### Requirement: Audit writer failure remains non-fatal and does not fall back to logging

Audit serialization, append, rotation, gzip, reconciliation, retention, flush, close, remote timeout or gateway-unavailable failure MUST NOT change request lifecycle, terminal commit, model, capability, gateway or stream result. AuditProjector MUST report its existing bounded degraded/failed outcome. It MUST NOT mirror the failed AuditEvent into operational logs or metrics as a fallback. An append reported as successful MUST correspond to a complete line accepted by the deployment gateway; ambiguous failure MAY be retried with the same auditId. A retention failure MUST preserve the affected evidence for a later retry rather than broadening the selector or blocking business work.

During shutdown, app composition SHALL stop audit producers, bounded-drain the projector host and bounded-close the audit gateway before the operational writer closes. Audit finalizer failure MUST NOT skip metrics or operational finalizers.

#### Scenario: Audit gateway is unavailable

- **WHEN** AuditEventWriter cannot append an AuditEvent
- **THEN** authoritative business facts MUST remain unchanged
- **AND** audit projection MUST expose its bounded failure outcome
- **AND** no audit payload may be copied to RuntimeLogger, operational writer, metrics output or SQLite

#### Scenario: Audit close fails during shutdown

- **WHEN** the audit gateway cannot flush or close within its bounded timeout
- **THEN** shutdown MUST continue to the remaining metrics and operational finalizers
- **AND** the still-open operational writer MAY emit only one bounded audit degradation transition without the audit payload

#### Scenario: Audit aging cannot delete an expired owned archive

- **WHEN** local audit retention deletion fails
- **THEN** the archive MUST remain available for a later audit maintenance retry
- **AND** request processing and the other two file lifecycle owners MUST remain unaffected
