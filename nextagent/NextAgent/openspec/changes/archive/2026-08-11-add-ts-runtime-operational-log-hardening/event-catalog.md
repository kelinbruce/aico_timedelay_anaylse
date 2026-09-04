## 基础问题定位目录

本文只冻结本 change 承诺必须出现的基础问题定位里程碑。它不是业务 event registry；普通 operational diagnostic 必须选择稳定 code-owned log event，Fastify 原生 final access record 使用固定 native message。实现不得为已有 canonical lifecycle fact 增加平行 producer。

### 共同规则

- 每条 operational log 由公共 writer 强制增加 ISO `timestamp`、文本 `level`、固定 `surface`、app-bound `component` 和 app-owned `serviceVersion`。
- 每条普通 diagnostic entry 必须有稳定 code-owned `event`，并且不得持久化重复的 `operation` 或 `outcome`；Fastify final access record 是仅有例外。
- observation-derived correlation 扁平白名单为 `agentId`、`agentVersion`、`sessionId`、`requestId`、`runId`、`timelineEventId`、`capabilityInvocationId`；不得输出 nested ownerScope/correlation、tenantId/subjectId、requestContextId或stepId。direct diagnostic 可按 owner event 使用其它明确的安全引用，但同样不得输出 requestContextId/stepId。
- 普通字段禁止 prompt、message/context/model output、thinking、tool result、pending question/answer、stream delta、SQL/row/persisted payload、environment、stdout/stderr、raw stack、credential/token。runtime direct diagnostic 的 canonical `toolInput` / `toolOutput` 是唯一 Tool payload 例外：normal 与 debug diagnostic detail 下都保留 prompt/path/command/content 和非秘密 credential/token 诊断元数据，仅对 credential 与认证类 token 做窄匹配脱敏，并执行集中 writer 的递归、字段、数组、字符串和 16 KiB entry 容量边界；两字段不得进入 observation、audit、metric、trace、stream、timeline、SafeError 或 public DTO。caller 不得把 `Error.message` 复制到任意普通字段；runtime-owned execution/tool/request exception diagnostic 可通过标准 `rawExceptionData.message` / `rawExceptionData.cause.message` 输出经统一 writer 净化且最多 2 KiB 的 exception message，用于内部 run 定位。唯一允许的结构化异常字段是 writer 生成的 `exceptionType`、可选稳定 `exceptionCode`、opaque `exceptionFingerprint`、有界 NextAgent-owned `exceptionFrames`、递归 `exceptionCause` 和 `exceptionChainTruncated`；最多 4 个 Error 节点、整链最多 5 个 owned frames/64 KiB 检查预算，frame 不得包含目录或第三方位置。
- 异常只在执行根的 consume/fallback/degraded/terminal/fatal 边界打印；继续抛出同一异常或带 cause wrapper 的中间 catch 不得打印。不得使用 Error 标记、全局集合、fingerprint 或 ALS/request flag 判断外层是否需要打印。
- canonical timeline 以 persisted fact identity 去重；first-visible 以 `runId + stepId` 去重；typed wrapper 每次真实 invocation 只产生一条 start 和一条 terminal；runtime milestone 每次状态转换/失败尝试记录一次。
- request/model/capability bookend 和关键内部 run 进展 milestone 可为 `info`；低层维护成功细节可为 `debug`；拒绝/降级为 `warn`；主路径或运维动作失败为 `error`。failure 不得只留下 debug。
- normalized entry 最大 16 KiB、每 destination async buffer 最大 4 MiB；entry 超限使用最小安全替代，buffer 饱和丢弃新 entry且不等待 drain。overload/recovery 只记录一次状态转换和 dropped-count bucket，不回显 dropped payload。
- audit、metric sample、span、successful health probe 和 developer hook trace artifact 不进入 operational writer。

### 默认 info 问题定位骨架

对隔离的普通 Web submit flow，不触发 attachment、context compaction、pending input、background、recovery、retry、failure 或 degradation，default info request trajectory 至少包含 server access final record、REQUEST_ACCEPTED、one request terminal、model started/terminal、capability started/terminal，以及实际出现的 context success、first-visible、policy allow、hook success、sandbox success 等安全 child-stage milestone。

该约束只覆盖 cataloged request-related milestone，不把同时发生的低频 process lifecycle 或其它独立 component diagnostic 算入同一 request。routine stream、queue/dispatch、task trajectory build 和 maintenance success 可继续保持 debug。

### Observation-derived trajectory

下表写 `surface=observation_derived`。除明确 typed owner 外，唯一 producer 为 `RunTimelineEvent -> TimelineObservationMapper -> StructuredLogProjector`。

| Source fact | physical `event` | Level | 安全字段 | 唯一性/说明 |
|---|---|---|---|---|
| `REQUEST_ACCEPTED` | `request.accepted` | info | request lifecycle status | canonical timeline only |
| request completed/canceled/failed terminal | `request.completed` / `request.canceled` / `request.failed` | info/error | terminal status、safe code/category、duration | canonical timeline only；无 content |
| `MODEL_INVOCATION_STARTED` | `model.invocation.started` | info | profile/provider/model refs、count bucket、timelineEventId | canonical timeline only |
| first visible `LLM_CONTENT_DELTA` | `model.stream.first_visible_content` | info | profile/provider/model refs、duration、timelineEventId | mapper内部仍可用run+step去重；physical line无stepId/delta |
| `MODEL_INVOCATION_COMPLETED` | `model.invocation.completed` | info | finish reason、normalized usage、count bucket、duration | canonical timeline only |
| `MODEL_INVOCATION_FAILED` | `model.invocation.failed` / credential/quota/security-specific event | error | safe code/category、duration | 保留现有分类 |
| `CAPABILITY_STARTED` | `capability.started` | info | capability/tool-call refs、batch bucket | canonical timeline only |
| `CAPABILITY_COMPLETED` | `capability.completed` / `capability.denied` / security/policy-specific event | info/warn/error | status、safe code/category、duration | canonical timeline only |
| `POLICY_APPLIED` | `policy.allowed` / `policy.denied` / `policy.degraded` / `policy.failed` | info/warn/error | policy kind、decision、safe reason | canonical timeline only |
| `HOOK_INVOKED` | `hook.completed` / `hook.timed_out` / `hook.canceled` / `hook.failed` | info/warn/error | hook kind、status、duration | canonical timeline only |
| `CONTEXT_COMPACTED` | `context.compacted` | info | before/after bucket、duration | canonical timeline only |
| `DEGRADATION_NOTICE` | `degradation.notice` | warn | reason code、stage | canonical timeline only |
| pending input lifecycle | owner-mapped `pending.input.*` event | info/warn/error | pending ref、kind、status、timeout bucket | 无 questions/answers |
| background task lifecycle | owner-mapped `background.task.*` event | info/error | task ref、controlled name、status、exit class、duration | 无 stdout/stderr/command |
| attachment accepted/rejected | owner-mapped `attachment.*` event | info/warn | approved attachment ref、media category、safe reason | existing typed owner |
| `ContextEnginePort.assemble` terminal | `context.assembly.completed` / `context.assembly.failed` | info/error | purpose、count bucket、compression flag、duration | narrow typed wrapper |
| trusted pre-acceptance rejection | owner-mapped `request.*.failed` event | warn/error | command kind、safe code/category | runtime typed observer；无 fabricated run |
| sandbox execute/chunk | owner-mapped `sandbox.*` event | info/warn/error | execution/executable refs、status flags、duration、safe code | narrow typed wrapper |

`StructuredLogProjector` 覆盖已有 hook/policy、attachment trajectory，并只为没有 canonical timeline 等价物的 context assembly 使用窄 typed adapter；pending-input、background-task继续由 canonical timeline映射。`PLANNING_STARTED` 没有产品 producer，本 change 不映射。

### Cataloged runtime milestones

下表写 `surface=runtime_diagnostic`。这些 event 是必须可黑盒验收的基础 milestone；catalog 外的 direct component log 仍必须选择自己的稳定 code-owned event。

| Component | Frozen event/level | 安全字段/去重 |
|---|---|---|
| bootstrap/app config | `app.config.accepted` info；`app.config.rejected` error；`logging.transport.init_failed` error | writer 前 failure 走 emergency stderr；每次启动/状态转换一次 |
| app lifecycle/server | recovery/startup/listen/shutdown ready/completed/failed/degraded，按 debug/info/warn/error | component、state/count bucket/safe reason；无 host/port/path |
| server access | Fastify native `incoming request` info + `request completed` info / `request errored` error | Fastify 默认 LogController；同一 Pino root 的受控 child与安全 serializers输出共享原生 `reqId` 的 access pair；incoming含安全 `req.method/req.url`（validated route template 或 `unmatched`），final含`res.statusCode`、`responseTime`；不生成 operational event |
| Fastify framework lifecycle | `server.framework.degraded` warn；`server.framework.failed` error | channel 顶层消费未知同步异常或 Fastify internal operation 自身终止时 exact-one；`failureStage=FASTIFY_INTERNAL`与 writer-derived exception evidence；不输出 raw req/res/header/URL/message/router dump；原生 access pair只表达 transport outcome，不再次附带同一 caught |
| stream | opened/replay/closed debug；gap/backpressure warn；delivery failed error | transport、server request id、lookup 后可信 coords |
| scheduler/submit degradation | queue/dispatched/execution-finished debug；dispatch failed error；`runtime.submit.orphan_session` warn | dispatch failed只覆盖pre-execution dispatch，不吸收execution/terminal commit failure；orphan只覆盖内部session已创建但RequestRun尚未durable accept的pre-acceptance failure，含trusted agent/session/parent refs与derived safe reason，不含`err`/exception chain |
| terminal/private async | `request.execution.exception_captured` error；commit started debug；commit/resume/timeout/callback/title failure error | request execution termination exact-one且`failureStage=REQUEST_EXECUTION`；terminal/async 独立 operation 使用 trusted coords、attempt/status、safe code |
| Tool raw payload diagnostic | `tool.payload.captured` info；既有 `tool.call.failed` / `tool.call.result_invalid` / `tool.loop.repeated_failure` 保持原级别 | normal/debug diagnostic detail 均携带 bounded `toolInput` / `toolOutput`；capture event 不表达 lifecycle outcome，只属于 runtime direct diagnostic，不替代 canonical capability outcome |
| tool failure feedback | `tool.failure_feedback.appended` info | FAILED/TIMED_OUT tool result写入 `CAPABILITY_RESULT` 模型可见反馈后输出；仅含 run/tool/capability refs、status、safe code/category、安全错误摘要、retryable和feedback kind；不含原始反馈正文、tool result、prompt或模型输出 |
| recovery/background private | recovery record failed error；background emit failed warn；completion failed error | trusted refs、kind、safe code |
| gateway composition | `gateway.bindings.ready` info；`gateway.bindings.failed` error | category/count bucket、safe reason；startup summary only |
| sandbox private | background start failed error；kill failed warn；killed debug | execution/task ref、safe code |
| safe exception termination | `request.execution.exception_captured` / `REQUEST_EXECUTION`；`server.framework.failed` / `FASTIFY_INTERNAL`；`channel.task.request.failed` / `TASK_CHANNEL_REQUEST`；`app.start.failed` / validated `AppStartupFailureStage`；`process.fatal.uncaught_exception` / `PROCESS_UNCAUGHT_EXCEPTION`；`process.fatal.unhandled_rejection` / `PROCESS_UNHANDLED_REJECTION`，error | 只由对应执行根终止 owner输出；startup stage通过`APP_START_FAILED.safeDetails.failureStage`传递并验证，非法/未知固定为`APP_STARTUP`；serviceVersion、trusted correlation（适用时）、writer-derived bounded cause chain；non-INTERNAL AgentError和boundary schema validation依赖 canonical/safe outcome，不创建专用 capture line |
| task callback | `task.callback.delivery_abandoned` warn | task ref、sequence bucket、safe reason；取代 direct console |
| logging maintenance | transport ready info；transport degraded/overloaded error；transport recovered info；archive completed debug/failed warn；retention completed debug/failed warn；flush/close failed warn | saturating count/size/duration bucket、safe reason；每状态转换一次；无 path/dropped payload |
| metrics exporter lifecycle | `metrics.export.degraded` warn；`metrics.export.recovered` info | exporter mode、safe reason、dropped-count bucket；每状态转换一次，不逐 sample/snapshot/retry；无 metric payload/path/endpoint |
| trace infrastructure | `otel.trace.init.skipped/completed/failed` info/error；`otel.trace.export.failed` error；`trace.projection.exception_captured` error | failureStage、safe reason、trusted request-run ref、safe exception evidence；无 endpoint/credential/service name/raw error；不逐 span 或成功 batch 记录 |
| health/log boundary | health state transition warn/info；probe subsystem failure error | transition、component、safe reason；成功 probe 不逐次记录 |
| capability discovery | `skill.scan.completed` info；`skill.scan.degraded` warn；`skill.scan.report_failed` warn | 每 source 一次；失败仅含 count/stable reason codes |
| category question source | `category.question.source_unavailable` warn；`category.question.source_recovered` info；`category.question.registered` info | 同一 agent+locale degraded/recovered 状态转换限频 |

routine direct diagnostic 级别补充：`context.budget.evaluated`、`context.microCompact.evaluated` 为 debug；micro-compact 使用 `decisionBranch` 而不是 `path`。Task trajectory observation-derived event 按 `task.trajectory.build.enqueued/completed/skipped/dropped/failed` 输出，级别依次为 debug/debug/debug/warn/error。

当 operational writer 本身不可用时，`logging.transport.init_failed/degraded` 由 app-owned emergency reporter 写一次 bounded stderr JSON，而不是递归写回失败 sink。

### Direct component diagnostic policy

catalog 外的合法 direct diagnostic：

- MUST 使用 app-injected component-scoped `RuntimeLogger`；
- MUST 有 stable code-owned `event`，不得用 msg、operation或outcome补充动作语义；只有当存在已验证低风险的动态上下文时，才可通过 RuntimeLogger 独立 `msg` 参数提供人类可读描述，且动态变量必须同步存在于 fields；
- routine success 默认使用 debug，除非是低频 process readiness；
- MUST NOT 重复上表或 trajectory 表中的 semantic outcome；
- MUST NOT 创建 observation、metric、audit 或 persistence fact；
- owner catch 只有在消费、降级、转换 terminal/public response 或结束执行根时才可输出 error/warn并把 caught 放入标准 `err` 字段；继续传播时 MUST NOT 调用 logger；记录时必须携带 code-owned `failureStage`和可信坐标，只有独立于 event/failureStage 的稳定领域子原因才可携带 `safeReasonCode`，不得使用 `fallbackReasonCode`，不得自行判断 Error/AgentError 类型、解析或输出 stack；
- owner catch MUST NOT 把 `error.message`、`error.name` 或 `String(error)` 放入其它字段；logger 调用失败 MUST NOT 通过同一个 logger 重试或生成平行的 `*.logging_failed` 事件，transport owner 的 degraded/emergency signal 是唯一 fallback；
- wrapper MUST 使用标准 `cause` 保留原异常，不得把原始 message 拼入安全 wrapper；不得新增 `alreadyLogged`/`handled` 标记或跨 owner 全局异常 handler；
- 传播异常时 MAY 记录一个语义独立、条件已经成立的 canonical/derived degradation fact，但该行不得携带 caught 或安全异常链；`runtime.submit.orphan_session` 是本 change 的窄实例，不得泛化为中间 catch failure log；
- MUST NOT 直接使用 console/stdout/stderr/file API；唯一例外是 app emergency reporter、显式 developer trace artifact 和 CLI human output。

### 现有代码迁移清单

| Current owner/path | Keep/normalize | Remove/replace |
|---|---|---|
| runtime `submit.ts` | request execution termination、queue/pre-dispatch、commit-private/recovery/async failures各自独立 stage | model/terminal canonical duplicate、internal observation、把 terminal commit failure 误记为 dispatch failure |
| core `tool-loop.ts` | canonical capability failure/degradation fact、失败反馈写入模型上下文的 `tool.failure_feedback.appended` direct diagnostic、debug `toolInput` / `toolOutput` direct diagnostic，以及 cause-preserving propagation | `tool.call.exception_captured` 中间层 log-and-rethrow、tool lifecycle/risk duplicate |
| model invocation wrapper | canonical model failed timeline和 cause-preserving propagation | `model.invocation.exception_captured` 中间层 log-and-rethrow、重复 model outcome |
| context typed adapter | context failure observation和 cause-preserving propagation | `context.assembly.exception_captured` 中间层 log-and-rethrow |
| restricted sandbox | injected component logger only for private background state | `logFile`、default concrete logger、typed-wrapper duplicate |
| app lifecycle/server | deployment startup termination milestone；shutdown finalizer consume boundaries | composition/gateway/workflow/capability/listen helper log-and-rethrow、`close()`重抛已记录finalizer exception、message-only、host/port/path output |
| remote gateway call adapter | safe normalization、cause-preserving propagation | adapter direct log-and-rethrow；同一失败由调用执行根终止 owner记录 |
| runtime/SQLite Todo replace | start/completed与上层capability canonical failure | `todo.runtime.replace.failed`、`todo.gateway.replace.failed` 中间层 log-and-rethrow |
| web/stream | channel top handler + trusted coords；non-INTERNAL AgentError/schema validation保留expected safe mapping；INTERNAL/unknown safe 500 exact-one | header/query coords、accepted-runtime failure重记、access record重复 exception chain |
| deployment process boundary | startup termination + bounded fatal diagnostic/flush/non-zero exit | reusable package global handler、fatal recovery、同一 fatal episode重复上报 |
| channel-task callback | cataloged abandonment diagnostic | `console.warn` |
| health projector | health/metric truth retained | successful probe log projection |
| audit composition | `AuditProjector -> AuditEventWriter -> gateway` | `LoggingAuditEventWriter` / audit log mirror |
| metrics composition | registry/OTel adapter | `createLocalMetricsLogSink` / `metric_diagnostic` |
| trace SDK/projector | injected component logger only for init/export/projection degradation | `NATRACE` console bypass、endpoint/service name/raw exporter error、successful span/batch noise |
| existing component RuntimeLogger calls | keep safe structured diagnostics；stable event required | concrete logger/direct file/stdout and canonical duplicates |

### Explicit exclusions

- developer hook trace plugin 的显式 NDJSON 是 developer trace artifact，不是 operational log；maintenance 不得扫描它。
- local runtime package 的一次性 human-readable login URL 是用户提示，不是 operational diagnostic；不得复制到 file log。
- CLI scaffold/self-check output 是 CLI contract，不进入 operational writer。
- gateway-owned LOCAL audit `nextagent-audit.<date>.<sequence>.ndjson[.gz]` / PaaS audit service、LOCAL `nextagent-metrics.<date>.<sequence>.ndjson[.gz]`、PaaS OTLP metric export、trace、health state 和业务 persistence 不属于 operational log family；仅 audit/metrics output degraded/recovered 的 bounded payload-free component diagnostic 属于 operational log。
