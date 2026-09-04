# redaction-policy Specification

## Purpose
定义统一脱敏策略在日志、观测、审计和安全错误边界的应用规则，使敏感 prompt、凭据和运行内容不会进入不可信投影。
## Requirements
### Requirement: Unified redaction applies before observation handoff

系统 SHALL 在 `ObservabilityObservationEvent` 进入 `ObservabilityProjectorHost` 内部异步 handoff 前应用统一 redaction policy。runtime listener、mapper、approved wrapper 可以按 `add-ts-trace-log-linking` 同步生成 `ObservabilityObservationEvent` 并调用 `ObservabilityProjectorHost.acceptObservation(event)`；host MUST 在该同步接收边界执行 `sanitizeObservation(event): ObservabilityObservationEvent`。

sanitizer MUST 只做字段裁剪和字段内容脱敏：不允许的字段直接省略；允许保留但内容敏感的字段 MUST 保留字段名并替换为 masked value、safe summary、reason code、ref-only 或 omitted marker。sanitizer MUST NOT 改变字段名称、改变 `ObservabilityObservationEvent` shape、新增 `RedactedObservabilityObservationEvent`，或生成第二条 redaction event stream。

host 内部 queue / mailbox、异步 projector、exporter 和 sink MUST 只能消费 sanitized `ObservabilityObservationEvent`。它们不得接收 raw prompt、raw model output、thinking、tool args/result、attachment content、raw provider body、path、secret、credential、token 或 stack trace。

#### Scenario: Safe error is redacted before crossing the API boundary
- **WHEN** 某条路径要输出一个用户或 operator 可见的安全错误
- **THEN** redaction 在该错误离开当前输出边界前同步执行
- **AND** 下游不会收到包含 raw secret、raw provider body 或 stack trace 的未脱敏对象

#### Scenario: Observation handoff stores only sanitized events
- **WHEN** mapper 或 approved wrapper 生成 `ObservabilityObservationEvent` 并交给 `ObservabilityProjectorHost.acceptObservation(event)`
- **THEN** host 在同步返回前必须完成字段裁剪和字段内容脱敏
- **AND** 只有 sanitized `ObservabilityObservationEvent` 可以进入 host 内部 queue / mailbox
- **AND** projector 输出同一字段时必须读取同一个 sanitized value

### Requirement: Redaction is enforced by the shared observation boundary

系统 SHALL 在 `ObservabilityProjectorHost.acceptObservation(event)` 的共享接收边界执行 observation redaction。业务模块 MAY 通过 `DiagnosticContext` 或 `ObservabilityObservationEvent` produce candidate safe fields、diagnostic candidates 和 source classifications，但 MUST NOT 实现私有 observation redaction、绕过统一策略或把 raw diagnostic 直接输出给 external consumer。

SafeError、stream diagnostic、health diagnostic 和 release gate evidence 等安全输出边界 SHALL 使用统一字段裁剪和内容脱敏策略。Web API、SSE、WebSocket、timeline、audit、metric、trace 和 `ObservabilityObservationEvent` MUST NOT 消费 local runtime diagnostic special field。

本地 operational runtime log SHALL 作为唯一受控例外，并由 canonical `runtime-logging` capability 定义其策略。其 `toolInput`、`toolOutput`、`modelInput`、`modelOutput` 和 `rawExceptionData` MAY 保留 prompt、路径、命令、stdout、stderr、模型可见输出和普通业务内容，但 SHALL 对 credential 和认证类 token 做窄匹配脱敏，并受固定容量限制。该例外不属于 observation redaction bypass，也不得由 `diagnosticDetail` 配置关闭或扩散到外部边界。

Observation-derived Model terminal entry MAY 投影 `firstContentLatencyMs`，但该字段 MUST 是有限非负数、MUST 只出现在 Model terminal observation、并在同时存在 `durationMs` 时小于或等于 `durationMs`。不满足这些条件的 candidate MUST 被拒绝或省略；该安全 timing 字段不得承载原始 Model 内容，也不改变 special local diagnostic field 的隔离规则。

For this release, `observability.logging.diagnosticDetail=debug` MUST NOT bypass the shared observation boundary. Debug detail MAY only change which already-safe, policy-approved diagnostic fields remain visible after sanitization; it MUST NOT disable redaction, relax forbidden-field classes, or permit a projector / logger sink to consume unsanitized observation data. Security redaction has no user-configurable off switch.

#### Scenario: Local runtime diagnostic 使用独立受控策略

- **WHEN** Tool、Model 或 execution exception 产生 `runtime-logging` 批准的 local special field
- **THEN** configured operational runtime log SHALL 包含该字段的有界可定位值
- **AND** credential 与认证类 token MUST 被窄匹配脱敏
- **AND** 同一值 MUST NOT 进入 `ObservabilityProjectorHost` 或任何 external consumer

#### Scenario: Inline credential 脱敏保留命令语法

- **WHEN** local special field 的命令或文本包含带引号的 credential assignment 或后续参数分隔符
- **THEN** writer MUST 只把 credential value 替换为 credential marker
- **AND** MUST 保留原有引号、`&` 及后续非 credential 参数，使日志仍可用于还原命令形状

#### Scenario: Gateway failure is sanitized at the output boundary

- **WHEN** gateway adapter 返回包含 raw provider 或 platform detail 的失败
- **THEN** shared observation boundary SHALL 在 async projector handoff 前应用 redaction
- **AND** adapter 不得独立决定 raw field 的外部可见性

#### Scenario: Diagnostic candidates are sanitized once

- **WHEN** business module 为 observability 添加 diagnostic candidates
- **THEN** each candidate SHALL 在 queue handoff 前由 shared observation policy filter 或 value-redact
- **AND** unclassified candidate SHALL 默认省略

#### Scenario: High-cardinality candidates are rejected for metrics

- **WHEN** diagnostic candidate 包含 base station id、request id、message id、path、free-text reason 或同类高基数值
- **THEN** sanitized observation MAY 仅在 policy 允许时保留 classified safe representation
- **AND** metric projector 仍 MUST 拒绝高基数字段作为 label，除非 metric inventory 明确允许

#### Scenario: debug mode still hands off sanitized observations only

- **WHEN** frozen app config 启用 `observability.logging.diagnosticDetail=debug`
- **THEN** `ObservabilityProjectorHost` SHALL 仍只 hand off sanitized `ObservabilityObservationEvent`
- **AND** downstream projector、logger transport、audit sink 和 metric registry MUST NOT 因 debug detail 收到 raw prompt、stack、path、provider body、secret 或 credential

#### Scenario: debug detail still hands off sanitized observations only

- **WHEN** frozen app config enables `observability.logging.diagnosticDetail=debug`
- **THEN** `ObservabilityProjectorHost` MUST still hand off only sanitized `ObservabilityObservationEvent`
- **AND** downstream projector、logger transport、audit sink and metric registry MUST NOT receive raw prompt、stack、path、provider body、secret or credential fields because of debug detail

### Requirement: Redaction uses deterministic inputs and preconditions

每次 observation redaction 执行 SHALL 接收 `ObservabilityObservationEvent`，并只使用该 event 中已经存在的字段：

- trusted identity context，其中 owner scope 以 `tenantId`、`subjectId`、`agentId` 和 `agentVersion` 稳定字段表达；`source` 不属于 owner scope；
- correlation refs；
- 已知内容来源类型；
- diagnostic candidates with classification and cardinality hint；
- 当前输出预算或长度上限；
- 已完成的前序安全判定结果。

redaction 不得为了补齐上下文主动发起模型生成、能力调用、跨 owner 探测或新的业务写操作。sanitized observation 不得包含 `traceId`、`spanId` 或 `traceContext`；后续 trace projector 如需 `SpanContext`，只能在 observability implementation-owned carrier 中使用。

#### Scenario: Redaction runs only with the inputs already available at the boundary
- **WHEN** `ObservabilityProjectorHost.acceptObservation(event)` 准备接收 observation
- **THEN** redaction 只使用当前 observation event 已经具备的输入、trusted identity context 和 `tenantId` / `subjectId` / `agentId` / `agentVersion`
- **AND** 不会为了补齐上下文发起新的业务调用

### Requirement: Sensitive-field classification and action order are explicit

redaction policy SHALL 按确定顺序做字段分类和裁剪：

1. 识别字段来源类型；
2. 判断是否命中默认敏感类别；
3. 判断字段允许的安全表示形态；
4. 多规则命中时使用更严格结果；
5. 预算不足时优先降级为 summary、ref-only 或 reason-code-only；
6. 形成 sanitized `ObservabilityObservationEvent` 与 redaction evidence。

默认敏感类别至少覆盖：

- secret / token / credential
- raw prompt
- raw model output
- thinking
- tool args / result
- attachment / content 正文
- provider raw body
- path
- hidden history
- owner-sensitive existence detail

#### Scenario: Provider error body becomes reason code only
- **WHEN** provider 或 gateway 返回包含账户、凭证或 endpoint 痕迹的错误体
- **THEN** redaction 保留允许字段名并将字段值裁为标准 `errorCode`、`category`、`safeSummary`、ref 或等价安全表示
- **AND** 原始错误体不会进入任何受控输出面

### Requirement: Observation field policy is explicit

`sanitizeObservation(event)` SHALL apply a fixed field policy before queue handoff. Fields not listed in this requirement MUST be treated as `OMITTED_BY_POLICY`.

Core observation fields SHALL use the following policy:

| Field | Sanitization rule |
|---|---|
| `ownerScope.tenantId` | MUST be a trusted bounded stable id from channel/auth identity, trusted app composition, persisted session/run/record, or trusted system scope; output as `SAFE_VALUE`; missing or untrusted value fails closed. |
| `ownerScope.subjectId` | Same as `tenantId`; output as `SAFE_VALUE`; missing or untrusted value fails closed. |
| `ownerScope.agentId` | MUST come from trusted app composition, hosted-agent selection, persisted session/run/record, or trusted system scope; output as `SAFE_VALUE`; missing or untrusted value fails closed. |
| `ownerScope.agentVersion` | MUST come from trusted app composition, frozen request run, or trusted system scope; output as `SAFE_VALUE`; missing or untrusted value fails closed. |
| `occurredAt` | MUST be authoritative fact time, wrapper outcome time, or trusted system observation time; MUST NOT use projector emission time, sink flush time, consumer consumption time, client-provided time, or replay time; output as `SAFE_VALUE`; missing or untrusted value fails closed. |
| `boundary` | MUST be a low-cardinality mapper/wrapper vocabulary value; output as `SAFE_VALUE`; unknown value fails closed or drops the observation. |
| `operation` | MUST be a low-cardinality mapper/wrapper vocabulary value; MUST NOT be free text; output as `SAFE_VALUE`. |
| `outcome` | MUST be a fixed outcome such as `success`, `failure`, `timeout`, `canceled`, `denied`, or `degraded`; output as `SAFE_VALUE`. |
| `source` or validation metadata | MAY be retained only as low-cardinality metadata outside `ownerScope`; MUST NOT contain path, URL, IP, header, or user-agent raw value; output as `SAFE_VALUE` or omit. |
| `stableRefs.sessionId`, `stableRefs.requestRunId`, `stableRefs.requestContextId`, `stableRefs.requestId`, `stableRefs.messageId`, `stableRefs.timelineEventId`, `stableRefs.capabilityInvocationId`, `stableRefs.auditEventId` | MAY be retained only when generated by an owning boundary and owner-safe; output as `REF_ONLY`; missing refs MUST be omitted and MUST NOT be fabricated. |
| `durationMs` | MUST be a finite non-negative millisecond number measured by the owning invocation boundary or wrapper; invalid values MUST be omitted; output as `SAFE_VALUE`. |
| `usage.inputTokens`, `usage.outputTokens`, `usage.totalTokens` | MUST be normalized `ModelUsage` values from the model adapter or provider; each present value MUST be a finite non-negative integer; open-ended usage keys MUST be omitted; values MUST NOT be estimated from prompt, delta, content, or client input; output as `SAFE_VALUE`. |
| `safeErrorCode`, `safeReasonCode` | MUST be low-cardinality standard reason codes; MUST NOT contain provider raw body or free-text reason; output as `SAFE_VALUE`. |
| `safeErrorCategory`, `errorCategory` | MUST be low-cardinality standard categories; output as `SAFE_VALUE`. |
| `safeSummary` | MUST be bounded and must not contain prompt, model output, provider raw body, path, credential, stack trace, or owner-private existence detail; output as `SAFE_SUMMARY`. |
| `providerKind`, `capabilityKind`, `gatewayCategory`, `status`, `phase`, `retryability`, `sizeClass` | MUST be low-cardinality vocabulary values from an owning boundary or wrapper; MUST NOT contain endpoint, path, free-text reason, or high-cardinality value; output as `SAFE_VALUE`. |

Diagnostic candidates SHALL use the following policy:

| Candidate field | Sanitization rule |
|---|---|
| `diagnosticSnapshot.candidates[*].key` | MUST be a bounded stable key; dynamic path, prompt fragment, or free text keys MUST cause the candidate to be omitted. |
| `diagnosticSnapshot.candidates[*].classification` | MUST exist and belong to the fixed classification set; missing classification MUST cause the candidate to be omitted. |
| `diagnosticSnapshot.candidates[*].cardinalityHint` | MUST be a fixed hint; missing hint MUST be treated as high-cardinality. |
| low-cardinality enum / safe category / safe reason code candidate value | MAY be retained only with matching safe classification and bounded value; output as `SAFE_VALUE`. |
| stable ref candidate value | MAY be retained only with ref classification and owner-safe bounded value; output as `REF_ONLY`. |
| bounded number / boolean candidate value | MAY be retained only when finite or boolean; output as `SAFE_VALUE`; invalid value MUST be omitted. |
| safe summary candidate value | MAY be retained only as bounded text without raw content or owner-private existence detail; output as `SAFE_SUMMARY`. |
| high-cardinality candidate value | MUST NOT become a metric label by default; MAY be retained only as `REF_ONLY` or `SAFE_SUMMARY` when classified and policy allows it; otherwise omit. |
| unclassified candidate value | MUST be `OMITTED_BY_POLICY`. |

Degradation evidence SHALL only reuse fields allowed by this policy: `boundary`, `operation`, `outcome=degraded`, trusted `ownerScope`, trusted `occurredAt`, optional `durationMs`, stable `safeReasonCode`, owner-safe `stableRefs`, and sanitized `diagnosticSnapshot`. Missing owner or time MUST NOT be fabricated.

The following raw fields or equivalent paths MUST be `OMITTED_BY_POLICY` wherever they appear unless an owning boundary has already converted them into an allowed safe field: raw prompt, prompt messages, raw thinking, raw model output, model delta content, tool args, tool result, capability result body, attachment body, file content, raw provider body, raw gateway error, stack trace, local path, remote path, URL path, SQL, header, authorization header, secret, token, credential, password, api key, cookie, hidden history, free-text reason, owner-private existence detail, open-ended usage key, trace id, span id, and trace context.

#### Scenario: Model usage keeps the normalized shape
- **WHEN** `MODEL_INVOCATION_COMPLETED` or `MODEL_INVOCATION_FAILED` observation contains normalized usage
- **THEN** sanitizer keeps only `usage.inputTokens`, `usage.outputTokens`, and `usage.totalTokens`
- **AND** each retained value is a finite non-negative integer
- **AND** open-ended usage keys or estimated usage values are omitted

#### Scenario: Stable refs are retained as refs
- **WHEN** observation contains owner-safe `stableRefs.requestRunId` and `stableRefs.timelineEventId`
- **THEN** sanitizer keeps the same field names and retains values as `REF_ONLY`
- **AND** missing stable refs are omitted rather than filled with defaults

#### Scenario: Raw paths and headers are dropped everywhere
- **WHEN** observation, metadata, or diagnostic candidate contains a path, URL path, SQL, header, authorization header, token, or credential
- **THEN** sanitizer omits that field unless an owning boundary already converted it to an allowed safe category, reason code, ref, or bounded summary

### Requirement: Redaction keeps field names and uses bounded safe values

允许的字段值形态 SHALL 限定为：

- `SAFE_VALUE`
- `MASKED_VALUE`
- `SAFE_SUMMARY`
- `REF_ONLY`
- `REASON_CODE_ONLY`
- `OMITTED_BY_POLICY`

redaction MUST NOT rename fields, move values to different field names, or change the `ObservabilityObservationEvent` shape. 这些字段值可以附带 redaction evidence，但这些 evidence 只是诊断辅助，不是新的业务事实。

#### Scenario: Attachment content is reduced to a bounded safe representation
- **WHEN** 某个输出面要暴露 attachment 或正文内容
- **THEN** sanitized observation 中对应字段值只能是允许的安全表示之一，或该字段被省略
- **AND** 不会以原始正文形式离开该输出边界

### Requirement: Redaction failure is explicit and fail-closed

当 redaction 遇到超时、分类失败、规则不可用、预算不足或依赖缺失时，系统 MUST fail closed，而不是输出 raw 内容。

#### Scenario: Redaction timeout on host handoff yields generic safe fields
- **WHEN** `ObservabilityProjectorHost.acceptObservation(event)` 执行 redaction 时超时或规则组件不可用
- **THEN** host 只能入队 generic safe fields、reason code、omitted marker 或 bounded degradation evidence
- **AND** 不输出任何 raw prompt、raw provider body 或 secret

### Requirement: Unified redaction keeps projector-visible fields consistent

同一份 sanitized observation 被多个 projector 消费时，同一字段 MUST 具有同一个 sanitized value。不同 projector 可以选择不同字段集合、label allowlist、预算和 sink schema，但不得为同一字段重新执行私有脱敏或生成不同值。

#### Scenario: The same provider failure yields consistent field values
- **WHEN** 同一份 provider failure 同时流向 safe error、log 和 audit
- **THEN** `safeErrorCode`、`errorCategory`、`providerKind` 等公共字段在各 projector 中使用同一 sanitized value
- **AND** 各 projector 可以按自己的 schema 选择是否输出这些字段
- **AND** 各输出都不会暴露被统一 policy 禁止的 raw 敏感内容
