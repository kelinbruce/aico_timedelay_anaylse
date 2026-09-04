## 背景和现状（Context）

本 change 关注 `ObservabilityObservationEvent` 进入异步 projector fanout 前如何统一完成字段裁剪和字段内容脱敏，而不是让 mapper、wrapper、日志、trace、audit、metrics、stream diagnostic 和 health reason 各自维护一套敏感字段规则。它消费 `add-ts-trace-log-linking` 定义的 `DiagnosticContext` snapshot、`ObservabilityObservationEvent` 和 `ObservabilityProjectorHost.acceptObservation(event)` 处理流程，不重新定义采集入口或观测事件流。

## 第一性原理（First Principle）

统一 redaction policy 的唯一职责，是决定 observation 字段能否进入异步观测流，以及字段值需要以什么安全形式保留。

它负责：

- 什么敏感
- 怎么裁剪
- 字段内容保留的最小安全表示

它不负责：

- 决定业务事实是否成立
- 替代日志、trace、audit、metric、stream 或 health 的输出契约
- 新增状态机、summary、artifact 或 checkpoint
- 改名字段、重塑 `ObservabilityObservationEvent` 或生成第二套 redacted event carrier

## 黑盒目标（Blackbox Goal）

同一份原始事实在进入 observation stream 前，由同一套规则决定：

- 哪些字段必须删掉；
- 哪些字段只能保留 masked 值；
- 哪些字段只能保留 safe summary、reason code 或 ref；
- 字段名称和 `ObservabilityObservationEvent` shape 如何保持不变。

sanitized observation 进入 `ObservabilityProjectorHost` 内部队列后，LOG、AUDIT、METRIC、TRACE 和 HEALTH projector 只能从这份安全输入中选择字段。不同 projector 输出同一字段时，看到的是同一个 sanitized value；surface 差异由各 projector 的字段选择、label allowlist、预算和 sink schema 表达，不由 redaction 为同一字段生成多套值。

## 边界（Boundary）

- 负责：敏感字段分类、字段裁剪、字段内容脱敏、字段名保持不变、host 接收边界统一准入、跨 projector 字段值一致性
- 不负责：定义 request lifecycle、structured logging 触发点、trace contract、audit truth、metric inventory、stream canonical event、health / release 判定本身

## 当前冻结的核心实现策略（Current Strategy To Freeze）

首版只冻结以下策略：

1. 固定高风险敏感分类
2. 固定字段裁剪和字段内容脱敏动作
3. 固定首版字段级策略表
4. 在 `ObservabilityProjectorHost.acceptObservation(event)` 同步执行
5. 不改变字段名称，不改变 `ObservabilityObservationEvent` shape
6. 失败时 fail closed

所有来自业务模块的 diagnostic candidate 都只是候选信息，不是任何输出面的可见字段。mapper 或 wrapper 可以把 candidate snapshot 到 `ObservabilityObservationEvent`，但 `ObservabilityProjectorHost.acceptObservation(event)` 必须在事件进入内部 queue / mailbox 前同步执行统一 redaction：不允许的字段直接省略；允许保留但内容敏感的字段保留字段名并替换为 masked value、safe summary、reason code、ref-only 或 omitted marker。host 内部异步 handoff 和后续 projector 只能看到 sanitized `ObservabilityObservationEvent`。

`add-ts-trace-log-linking` 已经固定业务路径：runtime listener 或 approved wrapper 同步 map 成 `ObservabilityObservationEvent`，调用 `ObservabilityProjectorHost.acceptObservation(event): void`，host 内部异步 fanout 给固定 projector set。本 change 在该路径上只定义 host 接收边界如何把 input event 同步 sanitize 成同 shape event；它不要求 mapper / wrapper 各自实现 redaction，也不允许 projector、exporter 或 sink 读取 redaction 前的 candidate。

`ObservabilityProjectorHost` 内部 handoff queue / mailbox 只能持有 sanitized `ObservabilityObservationEvent`、stable refs、safe runtime payload 和已裁剪 / 已脱敏的 diagnostic candidates，不得持有 raw prompt、raw model output、thinking、tool args/result、attachment content、raw provider body、path、secret、credential、token 或 stack trace。进入 queue 的 observation 仍不是 surface output；projector 负责把 sanitized fields 组装成 LOG / TRACE / AUDIT / METRIC / STREAM_DIAGNOSTIC / HEALTH_DIAGNOSTIC 的输出。

本 change 依赖 `add-ts-trace-log-linking` 提供 diagnostic candidate capture、`DiagnosticContext` snapshot、runtime `RunTimelineEvent` mapper 和 wrapper-generated `ObservabilityObservationEvent` 的最小输入来源；其他 observability projector change 只消费本 change 生成的 sanitized observation。首版不得实现动态策略语言、用户自定义规则、远端 policy fetch、插件化 classifier 或多版本 policy registry。

实施标识：本 change MUST consume and return the same `ObservabilityObservationEvent` shape defined by `add-ts-trace-log-linking`。它不得定义第二套 candidate carrier、redaction event bus、surface-private observation event、`RedactedObservabilityObservationEvent` 或 per-surface private policy input。OpenSpec active change 正文优先于 roadmap one-pager 的能力组背景；若 one-pager 的大清单与本 change fixed classifications / actions 不同，以本 change 的 design/spec/tasks 为准。

本 change 只定义敏感分类、字段裁剪、字段内容脱敏和同步 sanitize 执行入口。它不定义采集入口、不定义 `ObservabilityObservationEvent` shape、不定义 `ObservabilityProjectorHost`、不定义 projector registry，也不决定哪个业务事实应该被 log、audit、metric、trace 或 health 输出。所有 candidate 必须来自 `add-ts-trace-log-linking` 定义的 `DiagnosticContext` snapshot、authoritative `RunTimelineEvent` mapper output 或 approved wrapper 生成的 `ObservabilityObservationEvent`；redaction 只能裁剪 / 脱敏已有字段，不能补齐缺失事实、改名字段或生成新的 observation。

## 字段级策略表（Observation Field Policy）

首版 `sanitizeObservation(event)` MUST 使用以下字段级策略。表中未列出的字段默认 `OMITTED_BY_POLICY`；不得为了“保留更多诊断信息”把未知字段原样放入 sanitized observation。

| 字段 / 路径 | 允许来源 | 校验 | 动作 |
|---|---|---|---|
| `ownerScope.tenantId` | trusted channel/auth identity、trusted app composition、已持久化 session/run/record、trusted system scope | 必须存在且为有界稳定 ID；不得来自 request body、model output、capability args、candidate 或 consumer ALS | `SAFE_VALUE`；缺失或不可信时 observation fail closed |
| `ownerScope.subjectId` | 同 `tenantId` | 必须存在且为有界稳定 ID | `SAFE_VALUE`；缺失或不可信时 observation fail closed |
| `ownerScope.agentId` | trusted app composition、hosted-agent selection、已持久化 session/run/record、trusted system scope | 必须存在且为有界稳定 ID | `SAFE_VALUE`；缺失或不可信时 observation fail closed |
| `ownerScope.agentVersion` | trusted app composition、已固化 request run、trusted system scope | 必须存在且为有界稳定版本字符串 | `SAFE_VALUE`；缺失或不可信时 observation fail closed |
| `occurredAt` | authoritative fact time、wrapper outcome time、trusted system observation time | 必须是可信时间；不得使用 projector emission、sink flush、consumer consumption、client-provided 或 replay time | `SAFE_VALUE`；缺失或不可信时 observation fail closed |
| `boundary` | mapper / wrapper 的固定 vocabulary | 低基数枚举；未知值 fail closed 或省略整个 observation | `SAFE_VALUE` |
| `operation` | mapper / wrapper 的固定 vocabulary | 低基数枚举；不得是自由文本 | `SAFE_VALUE` |
| `outcome` | owning boundary outcome | `success` / `failure` / `timeout` / `canceled` / `denied` / `degraded` 等固定集合 | `SAFE_VALUE` |
| `source` / validation metadata | host / mapper 内部元数据 | 低基数枚举；不得混入 `ownerScope`；不得包含 path、URL、IP、header 或 user agent raw value | `SAFE_VALUE` 或省略 |
| `stableRefs.sessionId`、`requestRunId`、`requestContextId`、`requestId`、`messageId`、`timelineEventId`、`capabilityInvocationId`、`auditEventId` | owning boundary 已生成的 owner-safe refs | 有界稳定 ID；缺失则省略，不得伪造占位值 | `REF_ONLY`；projector 可选择输出，metric label 仍受 metric inventory 限制 |
| `durationMs` | owning invocation boundary 或 wrapper | 有限、非负毫秒数；非法值省略 | `SAFE_VALUE` |
| `usage.inputTokens`、`usage.outputTokens`、`usage.totalTokens` | model adapter / provider normalized `ModelUsage` | 每个 present value 必须是有限、非负整数；开放式 usage key 必须省略；不得从 prompt、delta、content 或客户端输入估算 | `SAFE_VALUE` |
| `safeErrorCode` / `safeReasonCode` | safe error mapping、owning boundary、wrapper | 低基数标准 reason code；不得是 provider raw body 或 free-text reason | `SAFE_VALUE` |
| `safeErrorCategory` / `errorCategory` | safe error mapping、owning boundary、wrapper | 低基数标准 category | `SAFE_VALUE` |
| `safeSummary` | safe error mapping、redaction prior decision | 有界长度；不得包含 prompt、model output、provider raw body、path、credential、stack trace 或 owner-private existence detail | `SAFE_SUMMARY` |
| `providerKind`、`capabilityKind`、`gatewayCategory`、`status`、`phase`、`retryability`、`sizeClass` | owning boundary 或 wrapper 的固定 vocabulary | 低基数枚举；不得是 provider name raw endpoint、path、free-text reason 或 high-cardinality value | `SAFE_VALUE` |
| `diagnosticSnapshot.candidates[*].key` | business module candidate | 有界稳定 key；不得是动态 path、prompt fragment 或 free text | `SAFE_VALUE`；非法 candidate 省略 |
| `diagnosticSnapshot.candidates[*].classification` | business module candidate | 必须存在且属于固定分类；缺失则 candidate 省略 | `SAFE_VALUE` |
| `diagnosticSnapshot.candidates[*].cardinalityHint` | business module candidate | 必须是固定 hint；缺失按 high-cardinality 处理 | `SAFE_VALUE` |
| `diagnosticSnapshot.candidates[*].value` with low-cardinality enum / safe category / safe reason code | business module candidate | classification 必须声明安全；值必须有界且非自由文本 | `SAFE_VALUE` |
| `diagnosticSnapshot.candidates[*].value` with stable ref | business module candidate 或 owning boundary | classification 必须声明 ref；值必须是有界 owner-safe ref | `REF_ONLY` |
| `diagnosticSnapshot.candidates[*].value` with bounded number / boolean | business module candidate | 有限数值或 boolean；非法值省略 | `SAFE_VALUE` |
| `diagnosticSnapshot.candidates[*].value` with safe summary | business module candidate | 有界长度；不得包含 raw 内容或 owner-private existence detail | `SAFE_SUMMARY` |
| `diagnosticSnapshot.candidates[*].value` with high-cardinality value | business module candidate | 默认不得进入 metric label；只有已分类且 policy 允许安全表示时保留 | `REF_ONLY` / `SAFE_SUMMARY` / `OMITTED_BY_POLICY` |
| `diagnosticSnapshot.candidates[*].value` without classification | 任意 | 不可信 | `OMITTED_BY_POLICY` |
| degradation evidence: `boundary`、`operation`、`outcome=degraded`、`ownerScope`、`occurredAt`、`durationMs`、`safeReasonCode`、`stableRefs`、`diagnosticSnapshot` | host / projector / sink failure handling | 只能使用本表中已允许字段；缺失 owner/time 不得伪造 | 按对应字段规则 sanitize 后保留 |

以下字段或任意等价路径，无论出现在哪一层，首版都必须 `OMITTED_BY_POLICY`，除非 owning boundary 已先转换成本表允许的安全字段：raw prompt、prompt messages、raw thinking、raw model output、model delta content、tool args、tool result、capability result body、attachment body、file content、raw provider body、raw gateway error、stack trace、local path、remote path、URL path、SQL、header、authorization header、secret、token、credential、password、api key、cookie、hidden history、free-text reason、owner-private existence detail、开放式 usage key、trace id、span id、trace context。

字段级策略只决定 sanitized observation 能保存什么值。LOG / AUDIT / METRIC / TRACE / HEALTH projector 仍按各自 change 定义字段选择、metric label allowlist、sink schema 和覆盖范围；但它们不得读取 redaction 前的字段，也不得对同一字段生成不同脱敏值。

## 与 structured logging 的职责边界

- structured logging 负责定义哪些业务边界必须打正式结构化日志；
- redaction policy 负责定义哪些 observation 字段敏感、如何裁剪、字段内容如何脱敏；
- 结构化日志只能消费 sanitized observation，不能另起一套敏感字段规则。

## 输入输出（Inputs / Outputs）

输入：

- `ObservabilityObservationEvent`
- trusted owner scope：`tenantId`、`subjectId`、`agentId`、`agentVersion`
- stable refs、boundary、operation、outcome、occurredAt
- safe runtime payload
- diagnostic candidate 及其 classification / cardinality hint
- 字段预算和长度上限
- 已完成的前序安全判定结果

输出：

- 同 shape 的 sanitized `ObservabilityObservationEvent`
- 字段裁剪 / 字段内容脱敏 evidence
- 有界 degradation evidence

## 关键约束（Key Constraints）

- 不得让 raw 内容进入 `ObservabilityProjectorHost` 内部 queue / mailbox
- 不得让任何输出面在 redaction 失败时 fallback 到 raw 内容
- 不得触发模型调用、能力调用、会话写入或跨 owner 探测
- 不得新增业务事实或持久化产物
- 不得改变字段名称、字段归属或 `ObservabilityObservationEvent` shape
- 不得新增 `RedactionOutput`、`RedactedObservabilityObservationEvent` 或第二条 redaction event stream
- 未声明 classification 的 diagnostic candidate 默认不得进入 sanitized observation
- 高基数字段如基站 ID、request id、message id、capability invocation id、path 或自由文本 reason 默认不得进入 metric label；是否可作为 LOG / AUDIT / TRACE 字段由对应 projector 的字段选择和 allowlist 定义，但 projector 只能看到 sanitized value
- 同一字段在不同 projector 中输出时必须使用同一个 sanitized value
- sanitized observation 不包含 `traceId`、`spanId` 或 `traceContext`；后续 trace projector 如需 `SpanContext`，只能作为 observability implementation-owned carrier 使用
- redaction evidence 是诊断辅助，不是 authoritative event、audit fact、metric sample、trace span、health truth 或 release pass/fail 事实

## 关键业务流程（Key Flow）

最小流程：

1. `add-ts-trace-log-linking` 的 mapper 或 wrapper 同步生成 `ObservabilityObservationEvent` 并调用 `ObservabilityProjectorHost.acceptObservation(event)`
2. host 在同步接收边界执行 `sanitizeObservation(event): ObservabilityObservationEvent`
3. sanitizer 按固定敏感分类裁剪字段或保留字段名并脱敏字段内容
4. sanitized observation 进入 host 内部 bounded queue / mailbox
5. host 异步 fanout 给 fixed projector set
6. projector 只从 sanitized observation 中选择字段并写对应输出；失败时按各自 coverage / sink policy fail closed

## 待确认问题（Open Questions）

无。redaction policy 已收敛为“host 接收边界同步 sanitize + 固定敏感分类 + 字段裁剪 / 字段内容脱敏 + 不改字段名和 event shape”。
