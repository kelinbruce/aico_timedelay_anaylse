## 背景和现状

AUDIT surface 需要在 `add-ts-trace-log-linking` 的统一 observation stream 上完成治理留痕。当前代码基线已经有 audit projector、timeline observation mapper、local audit writer adapter 和 app composition 中的直接投影调用；这些产品路径需要收敛到唯一 handoff 路径，避免业务模块或 app hook 绕过 `ObservabilityProjectorHost` 直接写 audit。`AuditEvent` / `AuditEventWriter` 属于 `agent-observability` 的 AUDIT surface 对象，不进入 `agent-contracts`。

## 第一性原理

审计的唯一职责，是把已经成立的治理事实记录为安全、可追溯、machine-readable 的审计留痕。它不决定业务事实，不补建 runtime 状态，不替代 timeline、terminal commit、session history、checkpoint、capability result、日志、指标或 trace。

## 黑盒目标

系统在 request acceptance、terminal commit、模型治理失败、capability 拒绝或安全失败、gateway owner/credential failure、hook/policy 决策、attachment intake 和 safe error output 等关键治理边界，能够从同一 `ObservabilityObservationEvent` stream 生成 `AuditEvent`。operator、release gate 和后续治理流程可以用 owner scope、stable refs、event name、outcome、safe reason code 和 safe summary 追溯事实，而不读取 raw payload。

## 非范围与安全排除

本 change 不定义 observation acquisition、runtime listener、wrapper taxonomy、DiagnosticContext、`ObservabilityObservationEvent` shape、projector host、trace context、metric inventory、structured log schema 或 health judgment。

本 change 不新增 `TimelineEventType`，不实现远端审计平台、审计查询 API、audit queue、retry worker、后台 replay、报表产品面或从其它 surface 输出回放生成 audit 的路径。

AUDIT output 只允许安全、低基数、可脱敏字段。raw prompt、raw thinking、raw model output、tool args/result、attachment body、raw provider response、path、credential、secret、token、stack trace、free-text reason、动态 payload、trace id/span id、高基数字段和未授权对象存在性细节不得进入 `AuditEvent`。

## 核心对象

### AuditEvent

`AuditEvent` 是 AUDIT surface 的正式输出领域对象。它至少包含：

- `auditId`：稳定审计记录 id，由 projector 基于 observation id / stable refs / event name 生成或携带。
- `eventName`：稳定审计事件名，例如 `request.accepted`、`terminal.committed`、`capability.denied`。
- `ownerScope`：`tenantId`、`subjectId`、`agentId`、`agentVersion`。
- `occurredAt`：权威事实时间或 wrapper observation outcome time。
- `outcome`：`success`、`failure`、`denied`、`canceled`、`degraded` 等低基数结果。
- `stableRefs`：`sessionId`、`requestRunId`、`requestContextId`、`messageId`、`timelineEventId`、`capabilityInvocationId`、`hookId`、`policyId`、`attachmentId` 等已成立安全 refs。
- `safeReasonCode` / `safeErrorCategory`：可选 machine-readable 安全原因。
- `safeSummary`：有界安全摘要。
- `attributes`：经 AUDIT policy 批准的低基数字段和有界数值字段。

`AuditEvent` 是审计留痕，不是 canonical timeline event、gateway business record、session read model 或 Web DTO。

### AuditEventWriter

`AuditEventWriter` 是 `AuditProjector` 的 sink port。产品路径中只有 `agent-observability` 的 `AuditProjector` 可以调用它；`agent-runtime`、`agent-core`、`agent-model`、`agent-capability`、`agent-channel-web`、gateway adapter 和业务 package 只能发布权威 event / fact 或 diagnostic candidate。

### AuditProjectionPolicy

`AuditProjectionPolicy` 判断 observation 是否命中 AUDIT coverage，并给出 event name、required refs、allowed attributes 和 redaction surface。coverage 不写入 `ObservabilityObservationEvent`，也不由 runtime、channel 或 wrapper 决定。

### AuditProjectionResult

每个 observation 的 AUDIT projection 结果固定为：

- `emitted`：成功写入正式 `AuditEvent`。
- `skipped_not_covered`：该 observation 不属于 AUDIT coverage。
- `skipped_policy_denied`：命中候选但被 AUDIT policy 拒绝。
- `degraded`：形成安全降级证据，但没有正式 audit success。
- `failed_closed`：缺失可信 owner/time、redaction 失败或字段非法，拒绝写出。

## 唯一产品路径

本 change 的唯一产品路径如下：

1. `add-ts-trace-log-linking` 负责 runtime listener / wrapper / system producer 同步生成 `ObservabilityObservationEvent`，并调用 `ObservabilityProjectorHost.acceptObservation(event): void`。
2. `ObservabilityProjectorHost` 异步调用 fixed projector set，其中包含 `AuditProjector`。
3. `AuditProjector` 调用 `AuditProjectionPolicy.covers(event)` 判断 coverage。
4. 命中 coverage 后，`AuditProjector` 从 observation 映射 `AuditEvent` 候选，执行 AUDIT redaction、最小字段校验和 idempotency anchor 组装。
5. 合法候选通过 `AuditEventWriter.write(event)` 写入真实 sink。
6. 写入失败或字段不安全时，`AuditProjector` 返回 `degraded` / `failed_closed`，并产生 bounded audit degradation evidence。

这条路径替代当前代码中的直接 projector 调用、`NoopAuditEventWriter` 产品装配、timeline-only audit observer 和任何业务模块直接调用 audit writer 的路径。

## AUDIT Coverage 清单

| Audit event | 业务事实 | 输入来源 | event 状态 / wrapper | timeline payload 增强 | 生成规则 |
|---|---|---|---|---|---|
| `request.accepted` | 请求被 runtime 接受 | `REQUEST_ACCEPTED` | 已有 persisted timeline event | 无 | 从 observation ownerScope / refs / occurredAt 生成 |
| `request.rejected` | run 创建前请求被拒绝 | `RuntimeCommandPort` wrapper | 当前已由 `agent-app` composition 接入 | 无 | 只携带 ownerScope、entrypoint refs、safe reason |
| `terminal.committed` | 请求终态已提交 | `REQUEST_COMPLETED` / `REQUEST_FAILED` / `REQUEST_CANCELED` / `REQUEST_SUPERSEDED` | 已有 persisted timeline event | 无 | terminal truth 成立后生成；status 映射 outcome |
| `model.security_failed` | 模型调用发生安全 / credential / quota / policy failure | `ModelInvocationService` wrapper observation | wrapper observation | 依赖 trace-log-linking wrapper 提供 `durationMs` / optional `usage`；audit 不为此新增字段 | 仅当 safeErrorCategory / safeReasonCode 命中治理失败分类时生成 |
| `capability.denied` | capability 被拒绝或策略阻断 | `CAPABILITY_COMPLETED` 或 `CapabilityInvocationPort` wrapper | 已有 event 可用时优先；无 event 时 wrapper | 依赖 trace-log-linking 补 `durationMs` | status / safeErrorCategory 映射 denied |
| `capability.security_failed` | capability 安全失败或受控动作失败 | `CAPABILITY_COMPLETED` 或 wrapper | 同上 | 同上 | 只记录 capability kind/id、toolCallId、safe reason |
| `gateway.owner_boundary_failed` | gateway owner / credential / policy boundary failure | `GatewayPort` wrapper | 后续 gateway owner wrapper | 无 | 只记录 gateway category、operation、safe reason、duration |
| `hook.invoked` / `hook.completed` / `hook.failed` | lifecycle hook 执行治理事实 | `HookPolicy` wrapper | 后续 hook owner wrapper | 无 | 只记录 hook id/stage/outcome/safe reason |
| `policy.allowed` / `policy.denied` / `policy.failed` | policy 决策事实 | `HookPolicy` wrapper | 后续 policy owner wrapper | 无 | 只记录 policy id、decision、safe reason |
| `attachment.accepted` / `attachment.rejected` | attachment intake 结果 | `ATTACHMENT_ACCEPTED` / `ATTACHMENT_REJECTED` 或 `AttachmentIntakeRead` wrapper | event / wrapper 由 attachment owner 后续实现 | 不在本 change 增强 | 不记录 filename path/body；只记录 attachment ref、media class、safe reason |
| `safe_error.emitted` | safe error 跨边界输出 | `SafeErrorOutput` wrapper | 后续 safe error owner wrapper | 无 | 只记录 safe error code/category/retryability |

本 change 不新增 event。`ATTACHMENT_*`、hook/policy、gateway 等如后续需要 runtime/capability/attachment owner 发布正式 timeline event，必须由对应业务 owner change 定义 safe payload、persistence purpose、channel projection impact 和 observation mapper impact。
本 change 的代码实现落地 AUDIT projector、audit writer adapter、当前已存在 acquisition source 的消费，以及 pre-run rejection 所需的 `RuntimeCommandPort` wrapper 消费。后续 wrapper 行表示 AUDIT surface 支持的目标覆盖和允许接入方式，不表示当前已经实现对应采集器。

## 从 Observation 到 AuditEvent 的映射

1. 读取 `ownerScope`、`occurredAt`、`boundary`、`operation`、`outcome`、`stableRefs`、`safeReasonCode`、`durationMs`、`usage` 和 `diagnosticSnapshot`。
2. 调用 `AuditProjectionPolicy.covers(event)`，未覆盖返回 `skipped_not_covered`。
3. 根据 coverage 生成稳定 `eventName` 和 `auditId`。`auditId` 使用 ownerScope + eventName + stable fact key；不得使用随机值掩盖重复事实。
4. 选择 AUDIT allowed attributes：status、phase、providerKind、capabilityKind、gatewayCategory、hookStage、policyDecision、safeErrorCategory、retryable、durationMs、usage 中被 AUDIT policy 允许的有界字段。
5. 执行 AUDIT redaction。redaction 失败或字段 classification 缺失时 fail closed。
6. 校验必需字段：`auditId`、`eventName`、`ownerScope`、`occurredAt`、`outcome`、`safeSummary`。
7. 调用 `AuditEventWriter`。sink failure 只影响 AUDIT projection result，不改变业务 outcome。

`usage` shape 与 `ModelUsage` 保持一致，只在 AUDIT policy 允许时作为有界数值 attributes 写入；不得引入 `modelInputTokens` 等二次字段名。

## 失败与降级

AUDIT projector 的失败策略固定为 fail closed：

- 缺失可信 `ownerScope` 或 `occurredAt`：`failed_closed`。
- redaction 失败、serialization failure、必需字段缺失：`failed_closed` 并生成 audit degradation evidence。
- sink unavailable、timeout、write failure：`degraded`，不得伪装成功。
- optional refs 缺失：省略，不伪造。

Audit degradation 复用 `add-ts-trace-log-linking` 的 bounded degradation evidence，不定义 audit-only event bus、queue、degradation carrier 或 replay path。

## 代码修改方案

1. `packages/agent-observability/src/audit/audit-projector.ts`：改为 `ObservabilityProjectorHost` fixed projector，输入只接受 `ObservabilityObservationEvent`，实现 `covers()` / `project()`。
2. `packages/agent-observability/src/audit/timeline-observation-mapper.ts`：只负责从 runtime `RunTimelineEvent` 生成 observation；AUDIT coverage 不在 mapper 内硬编码为 surface 输出。
3. `packages/agent-app/src/composition/create-app.ts`：移除直接 `auditProjector.project(...)` 产品路径，改为注册 host fixed projector 和必要 wrappers。
4. `packages/agent-observability/src/audit/noop-audit-writer.ts`：产品 composition 不得使用 no-op writer；测试可保留 fake writer。
5. source / architecture test：断言业务 package 不 import / call `AuditEventWriter`，无 audit-only observation event，wrapper 不直接写 audit sink。

## 验收样例

- `REQUEST_ACCEPTED` observation 生成 `request.accepted` audit event。
- `REQUEST_COMPLETED` observation 在 terminal truth 成立后生成 `terminal.committed` audit event。
- model invocation observation 只有在安全 / credential / quota / policy failure 分类命中时生成 audit event；普通 provider failure 只由 LOG / METRIC / TRACE 处理。
- 后续 gateway credential failure wrapper 生成 observation 后，AUDIT projector 写 `gateway.credential_failed`，且不包含 path、SQL、credential 或 raw error。
- audit writer unavailable 时业务结果不变，AUDIT projector 返回 degraded 并留下安全降级证据。
