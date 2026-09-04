## 背景和现状（Context）

当前产品路径混合了三类输出：

- operational log：`RuntimeLogger` direct diagnostic 与 `StructuredLogProjector` trajectory log；
- audit：`AuditProjector` 产生治理证据，但 app 又通过 `LoggingAuditEventWriter` 镜像到日志文件；
- metrics：`MetricsRegistry` 既可写 OTel sink，也可把 sample 镜像成日志。

三者不应通过“都能序列化成 JSON”而共用输出语义。运行日志用于单次问题定位；audit 使用 `AuditEventWriter` 进入 deployment-selected gateway output，LOCAL 追加独立 audit NDJSON、REMOTE/PaaS 上报 audit service；metrics 使用标准 MeterProvider/periodic reader/exporter pipeline，LOCAL 追加有限保留期的聚合历史，REMOTE/PaaS 通过 OTLP 上报。

运行日志也不等于 event sourcing。已有请求生命周期事实恰好有一条可靠的 canonical acquisition 主链：

```text
RunTimelineEvent
    -> TimelineObservationMapper
    -> ObservabilityProjectorHost
    -> StructuredLogProjector
    -> observation-derived log
```

这条链只负责已经存在的 canonical lifecycle/trajectory fact。普通组件日志、边界诊断、maintenance 状态和 caught failure 可以直接使用 `RuntimeLogger`，不要求创建业务 event 或 observation。

## 目标和非目标（Goals / Non-Goals）

### 目标

- 所有 application operational log 使用一个异步 Pino writer 和一个 JSONL file family。
- direct diagnostic 与 observation-derived trajectory 共享物理 writer，但不共享事实 contract。
- 开发态可以启用结构化 console sink。
- active operational segment 默认达到 30 MiB 或跨进程本地每日零点时轮转，任一条件先满足即生效；closed segment gzip，默认 7 天老化且 operational committed gzip archive 默认最多保留 10 个。
- 日志初始化、写入、轮转、压缩、老化和 flush 失败不改变业务结果，也不触发 logger-owned shutdown。
- canonical event-derived coverage 与 component direct diagnostic 各走唯一、清晰的路径。
- audit 与 metrics 完全退出 operational log writer。
- LOCAL audit 退出共享 SQLite，改为 gateway-owned append-only NDJSON family；公共 gateway 只写，不提供产品查询或 exactly-once 去重。
- 生产 metrics registry 流式写 OTel instruments，不在进程内保存 raw sample history；descriptor、dedup 和 SDK aggregation 都有单一且有界的实现。
- LOCAL metrics 每 60 秒追加一个 cumulative 聚合快照到独立 daily NDJSON file family，并按 30 MiB 或跨日轮转、gzip、保留 7 天且最多保留 10 个压缩归档；REMOTE/PaaS metrics 只通过 OTLP exporter 输出。
- local Agent Dev Workbench 通过现有 bounded evidence view 只读取当前 transport-owned active operational segment，并按 entry `surface` 保留两类证据语义；closed/archive 不进入工作台。

### 非目标

- 不要求每条日志拥有业务 event，也不建立全仓日志 event registry。
- 不把默认 info operational log 定义为完整 durable replay；canonical timeline 才是生命周期真相。
- 不实现 PaaS audit service client、audit 查询 API、audit 用户可配置 retention/长期合规归档、Prometheus endpoint、外部 OTLP Collector deployment/operations 或新的 metric inventory；本 change 只实现 LOCAL audit 固定 7 elapsed-day aging和 PaaS OTLP exporter composition。
- 不统一 audit、developer trace artifact、CLI 人类提示或 health probe payload。
- 不建设磁盘 watermark 或字节总量配额；四个受管文件族都允许在 committed gzip archive 超过 10 个时按最旧优先淘汰未满时间 retention 的归档。

## 设计决策（Decisions）

### 决策 1：Structural contract、输出语义 owner 与 rolling-file mechanism 分层

`agent-common` 继续 owning：

- `RuntimeLogger`：四级方法统一采用 Pino-compatible `level(fields, msg?)`，捕获值使用标准 `fields.err`；
- `getLogger({ component, source? })` lazy facade 与单 active `RuntimeLoggerProvider` 绑定 contract；
- `noopRuntimeLogger`；
- `RuntimeLogLevel`；
- `OperationalLogSurface = runtime_diagnostic | observation_derived`。

`agent-common` facade 不创建 sink、不导入 Pino、不执行 I/O，也不暴露可覆盖 redaction/serializer 的原始 child options。它返回延迟解析 provider 的稳定 logger，因此模块或类新增日志无需修改构造函数和 app 装配。未装配时调用安全 no-op；不同 provider 的并行重复绑定必须 fail fast，绑定 handle 只允许解绑自己。

新增 Node-only technical foundation `agent-local-file-roll`。它只导出窄 `createLocalFileRoll(policy)` factory、policy/handle/result types，并完整封装：

- pino-roll/SonicBoom async line destination；
- size+fixed process-local daily rotation和 current active identity；
- 从 safe base/name pattern 派生的 exact selector，不接受 arbitrary matcher、delete callback或 `mode=log|metrics|audit`；
- `.gz.tmp -> atomic .gz -> delete source`、closedAt 保真、startup reconciliation和 elapsed retention；
- 每实例独立 buffer、timer、single maintenance lane、状态、无路径/无领域语义的 bounded maintenance outcome listener和 bounded flush/close；
- path traversal、symlink、outside、unknown和 cross-family 安全保护。

该包不依赖 `agent-common`、`agent-contracts` 或任何 implementation package，不包含 RuntimeLogger、Pino envelope、AuditEventRecord、MetricSnapshot、deployment config、readiness 或业务 failure semantics。它被架构分类为 technical foundation，而不是允许横向依赖的 product implementation package；production consumer allowlist 只有 `agent-log`、`agent-observability` 和 `agent-platform-gateway-local`。

新增 `agent-log` 只允许 `agent-app` 和测试 composition 创建 operational writer，并完整 owning：

- Pino root logger 与 surface-bound component loggers；
- async console destination；
- level routing、redaction 和 reserved-field normalization；
- operational file policy、4 MiB buffer policy、non-throwing enqueue和 ready/degraded mapping；
- 一个独立 `agent-local-file-roll` handle及其 current-active identity projection。

`agent-observability` 的 `LocalMetricHistoryExporter` 独立 owning：OTel collection normalization/export callback、metrics schema/policy、single-flight、8 MiB buffer policy、failure mapping和一个独立 local-file-roll handle。它不调用 `agent-log`，`agent-log` 也不理解 metric schema。

`agent-platform-gateway-local` 的 file audit gateway 独立 owning：`AuditEventRecord` line serialization、append confirmation、audit policy、failure mapping和一个独立 local-file-roll handle。它不调用 `agent-log` 或 `LocalMetricHistoryExporter`，也不提供产品 query/index。

operational、plugin diagnostic、metrics 与 audit owner 共享 factory和机制代码，但必须创建四个运行时 handle；不得共享 destination、active identity、buffer、timer、maintenance lane、状态、close 或 policy object。owner 继续决定 line schema、固定策略值、append/export/log result及 generic maintenance outcome解释、readiness和 degraded/recovered mapping。foundation listener只报告 `archive|retention`、`completed|failed` 和 bounded affected count，不报告文件名、路径、异常或领域 mode；业务 package 只接收 structural `RuntimeLogger` 或领域 port，不得创建 concrete logger、选择 sink 或持有 file lifecycle。

`agent-log` operational writer handle 除统一 RuntimeLogger factory 和 bounded lifecycle 外，只向 trusted app composition 暴露 observation surface logger factory 与 transport-owned current `activeFile` 的只读查询；该路径不得写入日志、config、safe error 或 metric。app 仅把 observation-bound logger 注入 StructuredLogProjector，并把 current-active provider 注入 local workbench evidence adapter；workbench 不扫描目录猜测 active segment。

新增 direct dependency versions 固定如下，不在实施阶段重新选择 floating major/minor：

| Import owner | Direct dependency |
|---|---|
| `agent-local-file-roll` | `pino-roll@4.0.0`、`sonic-boom@4.2.1` |
| `agent-log` | `pino@10.3.1`、`@nextagent/agent-local-file-roll` |
| `agent-observability` | `@nextagent/agent-local-file-roll`、`@opentelemetry/sdk-metrics@2.9.0`、`@opentelemetry/resources@2.9.0` |
| `agent-platform-gateway-local` | `@nextagent/agent-local-file-roll` |
| `agent-remote-deployment` | `@opentelemetry/exporter-metrics-otlp-proto@0.220.0` |

OTel SDK 2.9.0 的 peer range接受现有 `@opentelemetry/api@1.9.1`，OTLP exporter 0.220.0 依赖同一 2.9.0 SDK/resource line；仓库 Node `>=22` 也满足这些 packages 的 engine。任何升级必须作为显式 dependency update 重新运行 descriptor bucket、rotation、lifecycle 和 architecture evidence，不能通过 caret lockfile 漂移改变本 change 行为。

该 technical-foundation 例外必须在归档前同步到长期架构，不允许只修改 dependency-cruiser 配置或 package manifest：

- `openspec/designs/architecture/ts-backend-architecture.md`：新增 technical foundation 分类、依赖方向和仅三个 production consumer 的 allowlist；保留其它 implementation-to-implementation 禁止规则；
- `openspec/designs/architecture/local-runtime-packaging.md`：记录四个受管 file family 共享机制代码但使用四个独立 handle；
- `openspec/designs/architecture/observability-boundaries.md`：保持 log/metrics/audit 输出语义分离；
- 新增 `openspec/designs/modules/agent-local-file-roll.md`，并更新 `agent-log.md`、`agent-observability.md`、`agent-platform-gateway-local.md`；
- 新增 `openspec/designs/adr/local-file-roll-foundation-boundary.md`，记录不采用 `agent-utils`、`agent-file-output` 或三套复制实现的理由；
- 更新 `openspec/designs/spec-to-design-map.md`、architecture package inventory、dependency-cruiser 和 manifest-policy evidence。

归档门禁必须逐项核对这些文档；active implementation 阶段仍只修改本 change 和代码，不提前改长期 baseline。

### 决策 2：普通 operational diagnostic 使用 event，Fastify access log 保留原生语义

两条合法的 operational log producer path 并行存在：

```text
canonical lifecycle/trajectory fact
    -> RunTimelineEvent / approved typed observation
    -> StructuredLogProjector
    -> surface=observation_derived

component diagnostic / owner-private state / boundary failure
    -> getLogger({ component, source? })
    -> surface=runtime_diagnostic
```

第二条路径不创建 `RunTimelineEvent`、`ObservabilityObservationEvent` 或 `StructuredLogEntry`。普通 physical operational diagnostic 必须带稳定 code-owned `event`；它只是可检索的日志事件名，不是业务 durable event。Fastify final access record 是窄例外：它由 Fastify `LogController` 产生固定 `request completed|request errored` message 和原生 access fields，不为了迁就 operational catalog 额外生成 `server.access.*` event。

`OperationalLogWriter.getServerAccessLogger(...)` 是仅供 app composition 绑定 Fastify 的受控入口。它返回从普通 runtime logger 同一个 Pino root 派生、配置安全 `req/res` serializers 与公共 hook 的真实 child，而不是 app 手写的平行 facade。Fastify 默认 `LogController` 原样拥有 `incoming request` 和 `request completed|request errored` 的调用时机、level 与 fixed message；公共配置层只做 allowlist、净化、限额和异步 sink。`req.url` 只能是 validated route template，未匹配请求固定为 `unmatched`；raw URL/query/header 不得进入输出。普通 `getLogger(...)` 对缺少 `event` 的记录仍一律拒绝。

只有本 change 明确承诺的基础诊断里程碑才进入 `event-catalog.md`。catalog 用于冻结这些里程碑的唯一 producer 和验收，不是全仓所有日志的封闭 event enum。

### 决策 3：一个 operational writer、两个 surface，access 使用受控原生 shape

默认 logical base：

```text
logs/nextagent-operational.log.jsonl
```

每条 enabled operational line 至少包含：

- `timestamp`：ISO-8601 writer enqueue time；
- `occurredAt`：observation-derived entry 的可选 ISO-8601事实发生时间；direct diagnostic 没有独立 occurrence time 时省略；
- `level`：`debug|info|warn|error` 文本；Pino 数字只用于内部 threshold/routing，不进入 physical schema；
- `surface`：`runtime_diagnostic` 或 `observation_derived`，由 writer 在创建可信 logger 时绑定；
- `component`：由 code-owned `getLogger` bindings 绑定，调用字段不得覆盖；
- `source`：可选的 code-owned module/class token；不得来自 `constructor.name`、文件路径、stack 或 runtime input；
- `serviceVersion`：由 app composition 绑定；
- `event`：普通 operational entry 的稳定 code-owned token，是其唯一动作/终态语义；Fastify final access record 使用固定原生 `msg` 而不输出 `event`。

不持久化 `operation` 或 `outcome`。可选 `msg` 是独立的人类可读展示字段：只允许 code-owned template 与已经过领域边界验证的低风险变量，变量必须同时出现在结构化字段中；如果只会逐字重复 `event` 则应省略。可选结构化字段还包括 safe reason/category、failureStage、扁平 trusted correlation、duration/size/count bucket、normalized usage和 writer-derived exception evidence。producer 提供的 `timestamp`、`level`、`surface`、`component`、`serviceVersion`、fields 内嵌 `msg/message` 必须被 writer-owned value 覆盖或丢弃。

两类 surface 不建立两套 logger。`agent-log` 内部只有一个创建 Pino-style `RuntimeLogger` facade 的实现和一条 `write(...)` 管道；普通 provider 的 `getLogger(bindings)` 固定绑定 `runtime_diagnostic`，仅 trusted app composition 可调用的 `getObservationLogger(bindings)` 固定绑定 `observation_derived`。两者返回同一个 `RuntimeLogger` API，并共享 child cache、level threshold、reserved-field ownership、字段/message 净化、Error 分类、entry budget、Pino enqueue 和 lifecycle。业务 package 不得选择 surface，caller fields 也不得覆盖 surface。

`StructuredLogProjector` 直接消费 app 注入的 observation-bound `RuntimeLogger`。它只负责把 observation 映射为 `StructuredLogEntry`，再以 entry 的 logical level 调用同一个 logger facade；不得存在 `StructuredLogTransport`、app-local method adapter、生产可注入 transport 旁路或第二套 silent transport。test composition 可注入 test-only capture RuntimeLogger，但产品 composition 只能从唯一 operational writer 获取 observation logger。

`agent-log` 是 operational physical line 的唯一最终净化 owner。优先使用 Pino child bindings、level routing、redaction paths 和 serializer/hook extension points；Pino 无法表达的递归 key policy、语义 allowlist、预算、异常分类/安全 frame 投影和 16 KiB entry fallback 才由 writer 的单一 bounded preprocessor 完成。业务调用方不得建设平行的 logging-only redactor、message sanitizer 或 Error classifier。该集中边界不取消 producer 的数据最小化责任：prompt、模型输出、Skill parser 原文、附件内容等不可信大对象禁止作为普通字段传入 logger，因为通用 writer 无法从任意自然语言中可靠识别所有业务秘密。唯一 Tool payload 例外是 runtime direct diagnostic 的 canonical `toolInput` / `toolOutput`：writer 保留两字段内的 prompt/path/command/content，只窄匹配 credential、credentials、独立 token/tokens、认证 token 变体、显式 credential/token value 和高置信 `Bearer`/`sk-` 值。`credentialRef`、`credentialStatus`、usage token counts、`tokenCount`、`tokenLength`、`tokenization*` 等字段必须保真。writer 同时执行有界递归、字段/数组/字符串截断、不可序列化值归一化和 16 KiB entry fallback。observation acquisition 的 sanitizer 仍保护 trace/metric/audit 等其它 surface，不属于第二套 operational writer。

`StructuredLogProjector` 把 observation 内部的 `boundary+operation+outcome` 规范化为具体稳定 event，例如 `request.completed`、`model.invocation.failed`、`capability.denied`。observation-derived physical entry 只扁平输出允许的 `agentId`、`agentVersion`、`sessionId`、`requestId`、`runId`、`timelineEventId`、`capabilityInvocationId`；不输出嵌套 `ownerScope`/`correlation`、`tenantId`/`subjectId`、`requestContextId` 或 `stepId`。runtime direct diagnostic 在 normal 与 debug diagnostic detail 下都输出 bounded `toolInput` / `toolOutput`，并保留其中 prompt、path、command、内容和非秘密 credential/token 诊断元数据；credential 与认证类 token 仍由 writer 窄匹配脱敏。`diagnosticDetail` 继续只控制 observation-approved 额外安全字段，不控制 canonical Tool payload。该例外不得进入 observation-derived、audit、metric、trace、stream、timeline、SafeError 或 public DTO。除这两个 canonical Tool payload 字段外，任何 surface 都不得包含 prompt、model output、tool args/result、stream delta、attachment content、SQL/row、command/environment、raw error/stack、host path、credential/token。

Tool loop 的唯一接入路径为：

```text
effective tool arguments + effective capability result
    -> agent-core runtime direct diagnostic fields toolInput/toolOutput
    -> agent-log bounded Tool payload normalization
    -> operational writer
```

既有 `tool.call.failed`、`tool.call.result_invalid` 和 repeated-failure diagnostic 始终补充适用的原始 payload；Tool 有效输出在模型可见结果已追加后输出一条 info `tool.payload.captured` diagnostic。Tool loop 不接收 raw-payload logging flag，app composition 也不按 `diagnosticDetail` 分支装配。该 event 只表达 payload 已被本地诊断采集，不表达 Tool lifecycle outcome，不创建或修改 `RunTimelineEvent` / `ObservabilityObservationEvent`，canonical capability completion 仍是 lifecycle truth。

归档时必须用本 change 的 `ts-minimal-agent-kernel` delta 替换 stable “default sanitized/debug raw” 两个场景，并同步 `agent-app` module design 删除 `observability.logging.redaction` / `rawToolInputLogging` 旧装配说明；不得让已删除开关继续成为长期 contract。

### 决策 4：agent-app 单次绑定 provider，业务类自行 getLogger

“公共 logger”指共享 writer、sink policy 和 lifecycle，不是把同一个无 component 的 logger object 传给所有 package。

`agent-app` 创建唯一 operational writer，并把 writer 提供的 `RuntimeLoggerProvider` 绑定到 `agent-common` facade 一次。各业务 module/class 使用 module-scoped `getLogger({ component, source? })`；provider 内部以 Pino root `child` 派生并缓存带稳定 bindings 的 logger。新增需要日志的类不得要求修改 composition root、constructor、options 或 dependency object。component/source 是代码拥有的低基数 token，不从请求、插件输入、文件路径或异常取得。

公开 facade 只暴露本产品允许的 Pino 调用子集（debug/info/warn/error 与 `fields, msg?`），不暴露 raw Pino instance、transport、serializer、redact 或 unrestricted `child(options)`，避免调用方绕过集中安全策略。业务调用使用 `logger.error({ err: caught, event, failureStage, ... }, msg?)`；writer 在单一边界移除 raw `err` 并生成安全异常字段。测试通过显式 provider binding/capture helper 验证日志，不保留 constructor injection 作为第二套产品实现。

现有合法 `RuntimeLogger` 调用无需为了迁移而强制增加 event；只需要移除 concrete logger、direct stdout/file bypass，满足结构化字段和安全政策。已有 canonical lifecycle outcome 的同义 direct log 仍必须删除以避免重复。

### 决策 5：observability.logging 是唯一 operational log 配置入口

冻结配置：

```text
observability.logging.diagnosticDetail
observability.logging.level
observability.logging.console.enabled
observability.logging.file.enabled
observability.logging.file.directory
observability.logging.file.name
observability.logging.file.rotation.maxFileSizeMiB
observability.logging.file.retentionDays
observability.logging.file.maxArchiveFiles
```

默认值：

| 配置 | 默认值 |
|---|---|
| `diagnosticDetail` | `normal` |
| `level` | `info` |
| `file.directory` | frozen `paths.logDirectory` |
| `file.name` | `nextagent-operational.log.jsonl` |
| `file.rotation.maxFileSizeMiB` | `30` |
| fixed rotation frequency | `daily`，implementation-owned，不可配置 |
| `file.retentionDays` | `7` |
| `file.maxArchiveFiles` | `10` |

| Entrypoint/profile | Console | File |
|---|---:|---:|
| development | enabled | disabled |
| local package | disabled | enabled |
| test composition | silent unless explicit | silent unless explicit |

用户可以覆盖 `diagnosticDetail`、sink booleans、level、directory/name、rotation size、retention days 和 operational archive count；不能覆盖安全 redaction、safe error mapping、daily frequency、compression、16 KiB entry budget、4 MiB destination buffer、overflow/drop policy 或 lifecycle failure policy。`diagnosticDetail=debug` 只增加已由统一安全策略批准的低风险诊断字段，不会关闭或放宽脱敏。旧 `observability.runtimeLogging` 与 `observability.logging.redaction` 都必须被 schema 拒绝，不提供兼容别名、迁移 fallback 或第二套 frozen projection。runtime input 不能修改 frozen policy。

该配置只控制 operational logging。LOCAL metrics file family 固定派生自 frozen `paths.logDirectory`，其 `nextagent-metrics` base、`.ndjson`、`dateFormat=yyyy-MM-dd`、60 秒 interval、4 MiB line budget、8 MiB buffer、30 MiB/daily rotation、最多 10 个 gzip archive 和 7-day retention 都是 implementation-owned，不新增并行的用户配置入口。plugin diagnostic 与 audit 同样由各自 owner 固定 30 MiB/daily rotation 和最多 10 个 gzip archive。

operational 与 LOCAL metrics 的 `daily` 和 `yyyy-MM-dd` 都使用 Node.js 进程本地时区。该时区在进程生命周期内固定，不能通过 runtime input、request 或 `observability.logging` 覆盖。DST calendar day 可以是 23 或 25 小时；这只决定轮转边界和文件日期，retention 始终使用 elapsed `24h` 计算。

### 决策 6：业务路径只做有界同步前处理，所有 sink I/O 异步

日志方法保留同步 `void` shape，以便业务调用简单且 non-throwing，但其同步工作严格限于：

1. level threshold check；
2. component/reserved-field normalization；
3. bounded selection/redaction；
4. JSON serialization；
5. enqueue 到 Pino async destination。

禁止在 request/model/capability/gateway/stream 路径执行 `appendFileSync`、同步 flush、gzip、目录扫描、retention 或等待 drain。file 和 console destination 使用 SonicBoom async mode（`sync=false`）；三个 production consumer 为四个文件族分别通过 `agent-local-file-roll` 构造独立 handle和 pino-roll destination，以持有各自 active ownership，不代表文件写入同步。

为了让“异步”同时具备容量上界，两个 implementation-owned 常量固定为：

- normalized serialized entry 最大 `16 KiB`；超限时丢弃 caller fields，只保留 safe envelope、component、level 和 `safeReasonCode=entry_too_large` 的最小替代 entry；
- 每个 async destination 的 SonicBoom `maxLength=4 MiB`；buffer 饱和时丢弃新 entry，记录 saturating dropped-count bucket，不等待 drain、不扩大 buffer。

首次 overload 和恢复只通过 app-owned async stderr emergency reporter 输出 bounded state transition，不回显 dropped payload，也不逐 entry fallback。调用者不等待 emergency reporter；reporter 自身失败时静默终止，不再调用同步 stderr fallback。console/file 各自拥有独立 buffer，一个 sink 的 overload 不影响另一个 sink。

`StructuredLogProjector` 可以同步完成 bounded mapping，但不得等待 log sink。archive/retention 在单独 async maintenance lane 运行。shutdown 只执行有超时上限的 async flush/close；超时后结束，不反向改变已完成业务结果。

### 决策 7：size 与 fixed daily 任一触发 rotation

operational file family 的 pino-roll 同时配置：

- `size=<maxFileSizeMiB>m`；
- `frequency=daily`；
- 不启用 pino-roll 自带的 count deletion 或 symlink；operational owner 把独立的 `maxArchiveFiles` policy 传给 foundation，由精确 selector 下的 gzip archive maintenance 执行数量淘汰。用户仍不能配置 frequency。

`maxFileSizeMiB` 默认是 `30`。大小阈值或 daily 边界任一条件先满足即切换 active segment。这样高流量环境受 size 约束，低流量环境也会在 daily 边界关闭 segment，消除 active file 永不过期漏洞。

`daily` 表示 Node.js 进程本地日历日的午夜边界；operational、metrics 和 audit family 必须使用同一解释。测试通过受控 process timezone/fake clock 覆盖普通跨日和 DST 边界，不增加用户可配置 timezone 或自研第二套 calendar scheduler。

pino-roll 生成 extension-last numbered file：`nextagent-operational.log.<sequence>.jsonl`。managed destination 当前 `destination.file` 是唯一 active ownership；maintenance 不得靠最高编号猜测 active。

### 决策 8：公共机制提供原子 gzip，三个 handle 保持运行时隔离

```text
closed .jsonl
    -> gzip stream
    -> *.jsonl.gz.tmp
    -> atomic rename *.jsonl.gz
    -> delete closed source
```

- 不压缩当前 active segment；
- gzip 使用 `node:zlib`，不执行 shell；
- committed archive 成功后才删除 source；
- gzip/rename/abort failure 保留 source；
- startup 清理 stale temp 并重试 eligible source；
- archive 保留原 closed/rotation timestamp；
- maintenance 串行或合并并发触发；
- `agent-local-file-roll` 只能从 validated base、`sequence | date-sequence` naming和 extension 派生 selector，不接受调用方 arbitrary regex/delete callback；operational、plugin diagnostic、metrics、audit policy分别生成互斥 selector。四个文件族共享 factory/算法但各自拥有 handle和 maintenance lane，不得互相发现、压缩或删除。

### 决策 9：四个受管 file family 都有有界 closed-segment retention 与 archive count

expiration：

```text
now >= closedAt + retentionDays * 24h
```

`agent-log` 为 operational family、`LocalMetricHistoryExporter` 为 metrics family、local file audit gateway 为 audit family 各自拥有并调度：

- transport setup 后异步 startup reconciliation；
- ready 后每分钟 archive scan/compression；
- ready 后每小时 retention aging；
- shutdown bounded flush/close。

fixed daily rotation 保证低流量 operational/plugin diagnostic/metrics/audit entry 最多先在 active segment 中停留一个 daily 周期；segment 关闭后进入各自 retention。plugin diagnostic 固定 3 elapsed days，LOCAL metrics 与 audit 固定 7 elapsed days，operational 默认 7 elapsed days且仅它允许配置更长。四个 owner 都在 startup reconciliation 及每小时 aging 中按原始 `closedAt + retentionDays * 24h` 删除自己 expired closed source/archive，并在 committed gzip archive 超过 10 个时按 `mtime`、文件名最旧优先删除超额归档。每个 owner 的 cleanup 只处理 frozen directory 内自己 family-owned regular files，不跟随 symlink，不删除另一 output family或未知文件。

operational handle 还接收正整数 `maxArchiveFiles`，默认 10。每次 startup reconciliation 和 archive maintenance 完成 eligible source 压缩后，foundation 只统计该 handle 精确 archive selector 命中的 committed `.gz` regular files；若超过上限，则按 `mtime` 升序、同时间按文件名升序确定性删除最旧 archive，直到回到上限。`.gz.tmp`、closed source、active、symlink、unknown 和其它 family 不计入数量，也不得因数量策略删除。时间过期与数量超限是并列删除条件；删除失败保留 evidence 并在后续 maintenance 重试，因此故障期间可以暂时超过上限但不得影响业务路径。metrics、audit 和 plugin diagnostic owner 未传该 policy 时保持原有时间 retention，不继承 operational 配置。

### 决策 10：任何 logging failure 都不影响业务结果或 app readiness

- 两类 surface 共用的 `RuntimeLogger` 永不向调用者抛出 logging failure；
- file/console transport 初始化失败不阻止 app ready；
- write、rotation、gzip、retention、flush、close failure 不改变 request、terminal、stream、model、capability、gateway 或 process shutdown result；
- entry oversize 或 destination buffer overflow 采用 bounded substitute/drop，不等待 drain、不扩大内存、不向调用者抛错；
- 一个 sink 失败不关闭仍可用的其它 sink；
- logging subsystem 不拥有触发 app shutdown 的权限；
- compression failure 保留 source，retention failure 保留 archive；
- writer 未 ready、已 degraded 或 overloaded 时，app-owned async emergency reporter 可以向 stderr enqueue 一次 bounded JSON state transition；调用者不等待它，不得在每次业务日志上 fallback，也不得输出 path/raw error/stack/dropped payload；reporter 自身失败时直接静默；
- config schema 本身非法仍按 configuration boundary 拒绝，因为它不是 logging I/O failure。

### 决策 11：canonical lifecycle fact 仍坚持 timeline-first，但不外推到所有日志

对同一个 request-bound lifecycle semantic fact，producer precedence 固定为：

```text
1. existing canonical RunTimelineEvent
       -> TimelineObservationMapper
       -> StructuredLogProjector

2. no timeline fact but approved trajectory boundary
       -> narrow typed observation adapter
       -> StructuredLogProjector

3. component/owner diagnostic
       -> component-scoped RuntimeLogger
```

规则：

- 1/2 是 trajectory fact；3 是 diagnostic，不因为共享文件转成 observation；
- 已有 canonical model/capability/request outcome 时，不再用 wrapper 或 direct log 记录同义 outcome；
- direct diagnostic 可以解释 queue、dispatch、commit-private failure、recovery、delivery、binding 和 maintenance，但不能宣称 lifecycle truth；
- typed wrappers 只包括 pre-acceptance trusted rejection、`ContextEnginePort.assemble`、existing attachment observation 和 `AppSandboxGatewayPort.execute/executeWithStdoutChunks`；
- 不 blanket-wrap stores、render、readiness query 或 capability-covered remote calls。

### 决策 12：默认 info 是问题定位骨架，不是完整 replay

对隔离的普通 Web submit flow，没有 attachment、compaction、pending input、background、retry、failure 或 degradation，default info request trajectory 必须包含 server access final record、request accepted、request terminal、每次 model start/terminal、每次 capability start/terminal，以及实际出现的 context success、first-visible、policy allow、hook success 和 sandbox success 等安全 child-stage milestone。routine stream、queue/dispatch、task trajectory build 和 maintenance success 可保持 debug。不同 component 的低频 process lifecycle 不属于该 request trajectory。failure/degradation 不受 info budget 截断。

默认 info operational log 是安全问题定位轨迹。debug 可增加低层维护细节，但不能恢复未记录期间的完整轨迹。完整生命周期 replay 以 persisted `RunTimelineEvent` 和业务 durable facts 为准。HTTP transport 使用 Fastify 默认 LogController 的原生 incoming/final access pair，业务侧不得产生 `http.request.*` 或 `server.access.*` event。Fastify 直接使用同一 operational Pino root 的 child；安全 serializers 只投影 route template、statusCode等批准字段，raw URL/header/request/reply/error message不得进入输出。

`loggerInstance` 直接使用 `agent-log` 的受控 Pino child，不建立第二个 logger provider、手写 Fastify logger surface或 custom LogController。Fastify 默认 request child 绑定 server-generated 原生 `reqId`；默认 incoming record 经过安全 `req` serializer输出 method 与 route template，默认 final record只输出 `res.statusCode`、`responseTime`和 fixed native message，不投影 caught/cause chain。未知 HTTP 异常的唯一安全异常证据由 channel 顶层终止 handler 的 stable framework event承担。两条原生记录通过同一 `reqId` 关联；未分类的无 event noise由公共 Pino hook省略。

HTTP server metric 不再由 Fastify `onResponse` 手工映射为私有 `web_request_total` / `web_request_duration_seconds`。`agent-observability` 在已有同一个 MeterProvider 上注册官方 `@opentelemetry/instrumentation-http`，并通过 `OTEL_SEMCONV_STABILITY_OPT_IN=http` 选择稳定语义，使 Node HTTP boundary 原生产出 `http.server.request.duration`（unit `s`、官方 explicit bucket advice）。请求数直接使用该 histogram data point 的 cumulative `count`，不得再建立平行 counter。instrumentation 只启用 incoming/server 方向并设置 `requireParentforIncomingSpans=true`，从而不为无 parent 的请求新增平行 HTTP trace owner，也避免把 exporter 或其它内部 HTTP client traffic 纳入本 change；指标属性沿用 OTel stable semantic conventions，禁止 raw URL、query、header、client request id和 NextAgent 高基数 correlation。官方 instrumentation-owned instrument 不进入 NextAgent 业务 `MetricDescriptor` inventory；这是对“业务投影 metric 统一 descriptor owner”原则的窄例外，避免复制官方 instrument definition或在 SDK 升级时形成双 owner。

### 决策 13：AuditEventWriter 属于 observability，write-only AuditEventStoreGateway 属于 agent gateway contract module

```text
ObservabilityObservationEvent
    -> AuditProjector
    -> AuditEventWriter output port
    -> app DO-to-Record adapter
    -> agent-contracts/gateway:
         AuditEventRecord + AuditEventStoreGateway.appendAuditEvent
         + top-level GatewayBindings.audit
       -> agent-platform-gateway-local:
            logs/nextagent-audit.<YYYY-MM-DD>.<sequence>.ndjson[.gz]
       -> agent-platform-gateway-remote: PaaS audit service adapter
```

- audit 不使用 `RuntimeLogger`、operational writer、surface 或 operational retention 实现；它由 local audit gateway 独立执行固定 7 elapsed-day retention；
- `AuditEventWriter` 仍是 `agent-observability` 的 output port，只有 `AuditProjector` 调用；它不得定义或 re-export `AuditEventStoreGateway`；
- `AuditEventRecord`、write-only `AuditEventStoreGateway` 和顶层 `GatewayBindings.audit` 明确由 `agent-contracts/gateway` owning；仓库不存在也不新增平行 `agent-gateway` package，该 canonical gateway contract subpath就是 agent gateway module；
- public port 只保留 `appendAuditEvent(record): Promise<void>`；删除 `AuditEventRecordQuery`、`listAuditEvents(...)`，并从 `SqliteGatewayStoreBindings` 删除 `audit`，避免把 deployment output 伪装成 SQLite query store；
- app-owned adapter 显式映射 `AuditEvent` DO 到 `AuditEventRecord` 并调用 selected `GatewayBindings.audit`，不得依赖结构同形隐式透传；
- LOCAL implementation 是 `agent-platform-gateway-local` 的 `FileAuditEventStoreGateway`：每个成功 append 写一个完整、可独立解析的 versioned NDJSON line；同一 stable `auditId` 的 retry MAY 产生重复行，consumer 以可信 owner/agent scope + `auditId` 去重，系统不建设跨重启 exactly-once index；
- audit file family 固定 base/date/sequence、`size=30m`、`frequency=daily`、`maxArchiveFiles=10`，按 `.gz.tmp -> atomic .gz -> delete closed source` 压缩并在 startup reconciliation 恢复；同一 gateway 按原始 `closedAt + 7 * 24h` 与 archive count 两个独立条件清理自己的 closed source/archive，策略不可由 runtime input 覆盖；
- `agent-platform-gateway-remote` 在另行配置的能力下调用 audit service；两个 gateway implementation 不得反向 import `AuditEvent` DO；REMOTE 不 fallback 到 local audit file；
- 本 change 删除 SQLite `audit_events` table/index、`SqliteAuditStore`、app `AppAuditEventQuery`、所有产品 `listAuditEvents` use，以及 `LoggingAuditEventWriter`/legacy `nextagent-audit.log` mirror；测试通过 injected capture gateway 或直接解析 owned audit fixture 验证，不为测试保留产品 query port；
- append、serialization、rotation、gzip、retention、flush/close failure 由 AuditProjector 投影为 bounded degraded/failed outcome，不改变业务事实，也不 fallback 到 operational log；PaaS audit service client、长期合规归档和 audit query UI不在本 change 实现。

### 决策 14：metrics 使用同一 OTel periodic reader，只在 deployment exporter 分叉

```text
ObservabilityObservationEvent
    -> MetricsProjector
    -> MetricsRegistry / OTel Meter adapter
    -> MeterProvider
    -> PeriodicExportingMetricReader
       -> LOCAL: LocalMetricHistoryExporter
                    -> exporter-owned policy + independent agent-local-file-roll handle
                    -> logs/nextagent-metrics.<YYYY-MM-DD>.<sequence>.ndjson[.gz]
       -> REMOTE/PaaS: OTLPMetricExporter
                    -> platform collector/service
       -> test: InMemoryMetricExporter
```

统一 reader policy：

- 删除 `createLocalMetricsLogSink` 的 product/default attachment；
- 不再定义 `metric_diagnostic` operational surface；
- 一个 immutable `MetricDescriptor` map 同时 owning name、kind、unit、allowed labels、value source、acquisition source 和 OTel instrument creation；禁止 `metricPolicies` 与 instrument adapter 各维护一套平行 inventory；
- unit 规则冻结为：所有 `*_duration_seconds`、`model_ttft_seconds`、`model_chunk_latency_seconds` histogram 使用 `s`，`model_token_usage_total` 使用 `{token}`，其余 counters 使用 `1`；所有 seconds histogram 共用 explicit boundaries `[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300]`；
- production `MetricsRegistry` 只执行 descriptor validation、projection-result policy 和同步 OTel instrument record，不保存 `MetricSample[]`、不提供历史 replay，也不在后 attach sink；`snapshot()` 只存在于 test-injected `InMemoryMetricsRegistry` fixture；
- `MetricsProjector` 的 source-precedence dedup 是 in-process recent-fact protection，不是 durable idempotency store：使用最多 `16_384` 个 key 的 FIFO set；达到上限先逐出最老 key，禁止无界 `Set`。canonical/fallback competing observations 必须在该窗口内完成，测试覆盖逐出边界；
- `agent-observability` owning `MeterProvider`、`PeriodicExportingMetricReader` 和 lifecycle，固定 `exportIntervalMillis=60_000`、`exportTimeoutMillis=10_000`、cumulative temporality、explicit-bucket histogram 和每 instrument `cardinalityLimit=200`；
- request/model/capability 路径只同步记录 instrument，不等待 collect/export；reader/exporter failure 不回退成 operational log。

LOCAL exporter 输出周期聚合状态，而不是重放原始 `MetricSample`：

```text
collect ResourceMetrics
    -> normalize NextAgentMetricSnapshotV1
    -> serialize as one bounded JSON line
    -> enqueue to exporter-owned metrics destination
    -> rotate on 30 MiB or daily boundary
    -> gzip closed segments and retain 7 days
```

- snapshot 至少包含 `schemaVersion=1`、`exportedAt`、安全 resource identity、metric name/kind/unit/temporality、allowed labels、point time 和 counter/histogram 聚合值；
- 只允许 `service.name`、`service.version`、`deployment.mode` 等低基数 resource fields；不写 tenant/subject/agent/session/request/run/trace/span/path/host/credential/exemplar；
- 每次成功 collection 规范化为一条 `NextAgentMetricSnapshotV1` NDJSON line，UTF-8 serialized bytes（包含换行分隔符）最大 4 MiB；超限视为该次 export degraded，禁止写 partial line；
- metrics destination 使用 implementation-owned 8 MiB async buffer，至少可容纳两个最大 snapshot；buffer 饱和时丢弃本次 snapshot并报告 export failure，不等待 drain、不扩大内存、不影响业务路径；
- 文件 base 固定为 `nextagent-metrics.ndjson`，pino-roll 使用 `dateFormat=yyyy-MM-dd`、`frequency=daily`、`size=30m`，foundation 使用 `maxArchiveFiles=10`，生成 extension-last `nextagent-metrics.<YYYY-MM-DD>.<sequence>.ndjson`；同一日可因 size 产生多个 sequence，但不得每 60 秒创建新文件；
- `LocalMetricHistoryExporter` 的 private metrics lifecycle 直接执行 `.gz.tmp -> atomic .gz -> delete source`、startup reconciliation 和默认 7-day aging；它不调用或复用 `agent-log` 的 operational lifecycle；
- exporter 不使用 Pino log envelope，也不产生 raw sample history；60 秒 cumulative snapshot history 用于本地查看至少 7 天的基础趋势，entry 最大目标窗口仍是一个 daily active 周期、7 天 closed retention 和一个 maintenance interval；进程重启后的 cumulative start time/reset 必须保留在 point time/temporality 中，不伪造成单调跨进程序列；
- serialize/enqueue/write/rotation/gzip/retention/flush failure 只使 metrics exporter/readiness degraded；不得改变业务结果或 fallback 为 per-sample operational log。允许通过 component `RuntimeLogger` 对 `metrics.export.degraded/recovered` 状态转换各输出一次安全诊断，不得每 snapshot、每 sample 或每 retry 输出日志；
- operational maintenance 必须按精确 ownership selector 忽略 metrics active/source/archive/temp，metrics maintenance 也不得触碰 operational/audit/developer-trace files。

REMOTE/PaaS exporter：

- remote deployment entrypoint 注入 official OTLP metric exporter，使用相同 periodic reader 和 instruments；
- endpoint、credential、TLS/header/compression 由 remote deployment package 按 OTel 标准环境变量解析：优先 `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`，其次 `OTEL_EXPORTER_OTLP_ENDPOINT`；可选 headers/compression 遵循同名 OTel signal/general precedence。raw values 不进入 app config、proof、log 或 metric file；
- remote resource 只允许 service name/version/deployment mode，不透传开放式 `OTEL_RESOURCE_ATTRIBUTES` 到 metrics；不能从 request/model/capability input 配置 exporter；
- REMOTE 不创建 local metrics file，OTLP unavailable 时 metrics readiness degraded 且不 fallback 到 file/log；
- 本 change 不部署或管理外部 OTel Collector，但实现 exporter composition、bounded flush/shutdown 和 package evidence。

test composition 使用 in-memory exporter，并与 LOCAL/REMOTE 共用 inventory、reader policy 和 lifecycle contract。

现有依赖 `app.metricsRegistry.snapshot()` 的测试必须显式注入 test `InMemoryMetricsRegistry`；product composition 不得为了测试断言保留 raw sample history。FIFO dedup 的容量上界属于产品策略，test registry 的 snapshot 只活在单个 test fixture 生命周期，不进入 LOCAL/REMOTE composition。

`agent-app` 的 trusted infrastructure composition option 只允许 REMOTE entrypoint 注入一个 `PushMetricExporter`；该类型来自 `agent-observability`/OTel infrastructure，不进入 `agent-contracts`。选择规则固定为：

```text
test composition            -> InMemoryMetricExporter
deployment.mode = LOCAL     -> LocalMetricHistoryExporter(paths.logDirectory)
deployment.mode = REMOTE    -> injected OTLP PushMetricExporter
REMOTE without exporter     -> metrics infrastructure readiness DEGRADED (`METRICS_EXPORTER_UNAVAILABLE`) / no output fallback
```

LOCAL product composition 不接受用户配置替换 exporter；REMOTE injection 只来自 trusted deployment entrypoint。这样 `agent-app` core 可以统一创建 MeterProvider/reader/lifecycle，又不 import concrete OTLP package。

### 决策 15：observability infrastructure 启停顺序固定，operational writer 最后关闭

startup 相对顺序固定为：

```text
trusted config freeze
    -> create/start operational writer destinations
    -> create/start deployment audit gateway
    -> create/start MeterProvider + reader + deployment exporter
    -> create projectors and business producers
    -> app ready
```

logging/metrics transport 初始化失败仍按各自 degraded policy 继续业务启动；只有 config schema 非法可以拒绝 startup。`app.config.accepted` 在 operational writer 可用后输出；writer 建立前的 `app.config.rejected`/init failure 只能走 bounded emergency reporter。

shutdown 不改写各业务 owner 内部既有 stop 顺序，但跨输出域的相对顺序固定为：

```text
stop intake and drain all log/audit/metric producers
    -> close runtime/server/schedulers/workers/gateway/deployment producers
    -> bounded drain projector host and close audit gateway
    -> bounded metrics forceFlush + MeterProvider/reader/exporter shutdown
    -> close LocalMetricHistoryExporter file lifecycle
    -> emit app.shutdown.completed
    -> bounded operational writer flush/close last
```

每个 finalizer 必须位于独立 failure-isolation boundary；producer、audit 或 metrics finalizer 失败不得跳过后续 audit/metrics/operational close，audit/metrics degraded diagnostic 必须发生在 operational writer 关闭前。operational writer 已关闭后只允许其自身 bounded emergency close failure evidence，不能递归写回 logger。

### 决策 16：coverage catalog 只约束承诺的基础诊断

[`event-catalog.md`](./event-catalog.md) 冻结：

- event-derived trajectory 的 producer/event/operation/level/fields；
- cataloged runtime milestone 的 component/event/level/fields；
- duplicate lifecycle path 的 remove/replace 清单；
- 不进入 catalog 的合法 direct component diagnostic 规则和 explicit exclusions。

catalog 不建立所有 `RuntimeLogger` 调用的封闭 enum。architecture tests 禁止 concrete logger、direct console/file I/O、runtime-log-to-observation bridge、direct StructuredLogEntry bypass 和已知 duplicate producer；异常终止规则只使用 representative negative fixture 与本 change 触达路径的 targeted source assertion，不能用全仓正则扫描替代 catch 控制流语义检视。

### 决策 17：Agent Dev Workbench 只读取当前 active operational segment

workbench 不创建第三种日志，也不改变 writer/schema。现有 `runtime-diagnostic-log | structured-safe-log` evidence vocabulary 继续保留，但 source 必须从成功解析后的 entry `surface` 映射：

```text
surface=runtime_diagnostic  -> runtime-diagnostic-log
surface=observation_derived -> structured-safe-log
```

`agent-log` writer handle 向 trusted app composition 暴露只读 current `destination.file` ownership；app 把该 current-active provider 注入 local workbench read adapter。Workbench 不扫描目录、不按文件名包含 `runtime` 或最高 sequence 猜测 active member，也不读取 closed `.jsonl` source、`.jsonl.gz` archive、metrics、audit、legacy、developer trace、symlink或 unknown files。active file 继续遵守既有 byte、line-count、result-count 和 time-window bounds；active ownership缺失、文件切换、访问或解析失败返回 bounded `unavailable`/`truncated`。

### 决策 18：根因定位使用 canonical outcome + termination-owned diagnostic + logger-owned classification

日志的首要运维目标不是证明“发生过错误”，而是让维护人员从症状收敛到具体失败阶段、同类异常集合和部署代码位置。已知 `AgentError`/`SafeError` 继续通过 canonical outcome 的 safe code/category/stage 和 trusted correlation 定位。未知 `Error` 只有到达决策 22 定义的异常终止边界时，才产生一条 direct runtime diagnostic；model、tool、context、gateway、listen 等中间 catch 即使先生成 canonical safe failure fact，只要继续抛出同一异常或包装后抛出，就不得打印该异常。

`agent-log` writer 是唯一字段/message 最终净化、错误分类和异常安全投影 owner，但不决定“这个异常是否应该记录”。后一个判断只由终止边界承担。RuntimeLogger 的四级方法统一接受 Pino-compatible `fields, msg?`；允许记录的边界把捕获值原样放进标准 `err` 字段，不得把它拆成其它 fields，不得为了日志判断 `instanceof Error`、`AgentError.category`、Node error code 或自行选择是否附加 stack evidence；它只提供 code-owned `event`、`failureStage`、可信关联、可选安全 message template，以及仅在独立于 event/failureStage 的稳定领域子原因存在时提供的 `safeReasonCode`。`fallbackReasonCode` 不属于调用或物理日志 vocabulary，writer 也不生成通用 `UNEXPECTED_FAILURE`。writer 的统一规则为：

- non-INTERNAL `AgentError`：普通 failure event 输出其稳定 `code`、`category`、`retryable` 且不输出 stack evidence；终止 owner 应优先依赖 canonical safe outcome，不得再调用专用 unexpected-exception diagnostic；writer 不承担跨行去重；
- INTERNAL `AgentError`：输出稳定 domain fields，并生成安全 exception evidence；
- 普通 `Error`：使用 `category=INTERNAL` 并生成安全 exception evidence；若存在符合稳定 token 约束的 `error.code`，以 `exceptionCode` 集中投影，只有 writer-owned 窄映射或 caller 提供的独立稳定子原因才输出 `safeReasonCode`；
- non-Error throw：使用 `category=INTERNAL` 和 `exceptionType=NonErrorThrow`，不回显原始值，不生成通用原因码；
- 未传 caught：只规范化 fields，不伪造 exception。

### 决策 19：公共 writer 使用窄 semantic allowlist，避免安全过滤破坏运维语义

敏感字段过滤仍由 `agent-log` 最终 owning，但宽泛的 token/path substring 规则不得把已经由 contract 定义的低风险业务语义一并清空。writer 使用 key-aware policy：

- `inputTokens`、`outputTokens`、`totalTokens` 只接受有限非负整数；同名字段之外的 token/credential key 继续脱敏；
- Fastify access 不再向通用 writer 传递 route template；boundary adapter 仅保留原生 safe access shape，任意 `path`、`filePath`、URL/query 或 caller-provided route value继续脱敏；
- micro-compact 使用 `decisionBranch` 而不是通用 `path`；
- caller 不增加 logging-only sanitizer；不可信原文、大对象、prompt/model/tool/Skill diagnostic 仍禁止传入 logger。

该 allowlist 是公共 writer 最终策略的一部分，不是关闭 redaction。black-box 验收必须同时证明 approved semantic field 保真和相邻敏感字段仍被拒绝。

### 决策 20：routine 成功降为 debug，degradation 使用状态转换信号

- policy allow、context success、hook success、sandbox success 和 first-visible 为 info；context budget evaluated、micro-compact evaluated、task trajectory enqueued/built/skipped 为 debug；
- policy denial/degradation、task trajectory dropped、Skill scan partial failure为 warn；
- failure 为 error；
- task trajectory 的 physical event 必须按 `enqueued/completed/skipped/dropped/failed` 收敛，不能用同一个 `task.trajectory.build` 搭配 status 重复表达终态；
- category-question source unavailable 对同一 agent+locale 只在进入 degraded 时 warn，成功恢复时输出一次 `category.question.source_recovered`，避免轮询/请求风暴淹没真正异常。

### 决策 21：serviceVersion 标识实际 deployment candidate

未由 package/deployment entrypoint提供 build identity 时，app 使用产品版本。LOCAL/REMOTE runtime package 必须从可信 manifest 的 `version` 和 `candidateId` 派生 bounded、字符安全的 serviceVersion；超长 candidate 使用稳定短 hash，而不是回退到所有部署相同的 `"1.0.0"` 或 `"unknown"`。同一 serviceVersion 同时用于 operational envelope 和 OTel resource。

对真实 Error，caller 不得自行把 error message 或 enumerable fields 投影到普通字段；runtime-owned execution/tool/request diagnostic 可通过标准 `rawExceptionData.message` / `rawExceptionData.cause.message` 输出统一净化、有界的 exception message，以提高内部 run 定位可用性。writer 仍不得输出原始 stack，只递归生成 allowlisted `exceptionType`、可选稳定 `exceptionCode`、opaque SHA-256 `exceptionFingerprint`、NextAgent-owned `exceptionFrames` 和 `exceptionCause`。异常链最多包含 4 个 Error 节点（最外层计为第 1 个），整条链最多输出 5 个 owned frame refs，读取/解析/计算指纹的字符串总预算最多 64 KiB；exception message 单值最多 2 KiB，并经过 credential/token/path/control-character 净化；frame 只保留安全函数名和 `package#file:line:column`，不得包含目录、drive、URL、node_modules 或第三方/provider frame。writer 使用本次投影局部的对象 identity set 检测 cause cycle；达到深度、总预算、frame 上限或 cycle 时只增加 `exceptionChainTruncated=true`，不得回退原始异常。non-Error cause 使用 `exceptionType=NonErrorThrow` 后终止递归，不回显原值。任意 getter/解析/投影失败都只能省略可选证据，不能 throw 或泄漏原始内容。

每条 operational physical envelope 增加 app-owned `serviceVersion`，caller 不可覆盖。serviceVersion 选择运行时代码构建，agentVersion 选择 Agent assembly/config；缺少版本坐标时 line/frame 无法可靠映射部署代码。

从根因定位角度，cataloged error milestone 必须满足：失败不只存在于 debug；必须包含具体 stable event、safe reason 或 exception fingerprint、failure stage，以及适用的可信 correlation。只有 consume/fallback/degraded/terminal/fatal 边界把 caught 原样交给 logger；继续传播的中间 catch 通过原异常或带 `cause` 的包装保留证据。结果型失败没有 Error 时不得伪造 stack，必须依赖 owner-defined safe code/details；sink drop/degraded 必须可见，使“没有日志”可以和“没有错误”区分。

owner catch 不得自行把 `error.message`、`error.name`、`error.code` 或 `String(error)` 投影到任意字段；这种做法既可能泄露原始内容，也会形成与公共 writer 不一致的分类。caller 也不得用 `fallbackReasonCode` 把 event 改写成大写下划线后重复一遍；只有真正区分同一 event/failureStage 下多个领域原因的稳定码才可作为 `safeReasonCode`。caller 不得因担心 logger 抛错而包一层 logging-only `try/catch`；RuntimeLogger contract 本身必须 non-throwing。若一次 logger 调用失败，业务 owner 不得通过同一个 logger 再写一条“logging failed”形成递归补偿路径；transport degraded/recovered 与 emergency evidence 只由公共 writer owning。archive/retention maintenance 失败只表示 closed-segment maintenance degraded，不得阻断仍可接受的 active audit append 或 metric export。

OTel trace 初始化必须发生在唯一 operational writer 可用之后。credential resolution、SDK initialization、batch export 与 span projection 在捕获失败并返回 disabled/degraded、放弃本次 batch 或继续 projector host 时，属于各自操作的消费/降级终止边界，可通过 `agent-observability` component logger报告 failureStage/safe reason/安全异常证据；若只是包装后继续抛出，则不得记录。不得使用 `NATRACE` console 旁路，不得输出 endpoint、credential、service name 或 raw exporter error。成功 span/成功 export batch 不逐项写 operational log。TraceProjector 的 run-scoped parent context 在 request terminal 后释放，避免诊断基础设施随请求数无界增长。

workbench 只把匹配 stable refs 的完整 JSON line 作为辅助 evidence；未知/缺失 `surface` 不得默认归类，日志文本仍不得生成 graph/action/runtime facts。7-day archive 只由外部运维文件工具查看，不属于 Workbench contract。

### 决策 22：异常处理按执行根设置唯一终止边界

异常日志不采用“首次 catch 打印”，也不要求外层检查异常是否已经打印。是否打印由控制流责任静态决定：

1. catch 后 `throw error`，或创建带 `cause: error` 的新异常继续抛出：该层 MUST NOT 记录该异常；允许 cleanup、补充 canonical safe fact 或增加稳定业务上下文。捕获后用不带 cause 的新异常替换原异常会丢失异常链，MUST NOT 使用。
2. catch 后吃掉异常、返回 fallback/degraded/safe result、完成 safe terminal commit、映射 HTTP response、放弃本次后台操作但继续 loop：该层是该操作的异常终止边界。未知/INTERNAL 异常按 catalog 记录一次；预期 non-INTERNAL `AgentError` 或 boundary-owned schema validation failure 优先只保留 canonical/safe outcome，不增加 stack-like direct diagnostic。
3. cleanup、terminal commit、delivery 或 logging transport 自身又失败时，这是另一个独立操作的异常，可由该操作自己的终止边界使用不同 event/failureStage 记录；不得把它误归类成原执行异常。
4. 实现 MUST NOT 在 Error/AgentError 上增加 `logged`/`handled` 标记，不得使用全局 WeakSet、fingerprint、AsyncLocalStorage 或 mutable request flag 判断外层是否记录同一异常。fingerprint 只用于跨日志聚类，不能作为 exact-once identity。canonical/derived state fact 自身的有界 exact-once key不属于异常打印去重，但不得借其携带第二份 exception evidence。

owner-scoped 终止边界冻结如下：

| 执行根 | 唯一终止 owner | 处理与打印规则 |
|---|---|---|
| accepted request execution | `agent-runtime` request execution boundary | model/tool/context/core 只产生 canonical safe failure fact并传播；runtime 对到达边界的未知异常记录一次 `request.execution.exception_captured` / `REQUEST_EXECUTION`，再进入既有 SafeError/terminal commit。terminal commit failure 使用独立 `request.terminal_commit.failed` 和 terminal-owned stage，不得落入 scheduler `dispatch_failed`。 |
| Web/Task/WS/SSE 同步 request、handshake 或 pre-acceptance callback | 对应 `agent-channel-web` / `agent-channel-task` transport-root error handler | non-INTERNAL `AgentError`、Fastify/TypeBox schema validation等 expected boundary failure 映射既有 safe 4xx/status，不增加 direct exception line；INTERNAL/未知 HTTP/stream-handshake 异常分别记录一次 `server.framework.failed` / `FASTIFY_INTERNAL` 或 `channel.task.request.failed` / `TASK_CHANNEL_REQUEST` 并返回 safe 500/关闭该 transport attempt。已被 runtime 转成 accepted-request terminal 的失败不再回到 channel 记录。Fastify access record只表达 transport outcome，不得再次附带同一个 caught 的异常链。 |
| app composition/start/close | LOCAL/REMOTE deployment startup entrypoint；close 的每个 finalizer boundary | gateway、workflow、capability registration、listen helper只 cleanup并传播；app composition 和 `SERVER_LISTEN` 仍由 `agent-app` composition/startup wrapper负责一次 cause-preserving stage包装且不打印。deployment boundary验证 wrapper metadata，使用 `app.start.failed` 和 allowlisted stage记录一次后拒绝启动；operational writer 尚不可用时只使用 bounded emergency reporter。`SERVER_LISTEN` 前启动贡献失败由 app lifecycle 记录一次 stage-scoped degraded diagnostic 后继续下一阶段，不进入 deployment startup failure boundary。shutdown finalizer吃掉异常并继续后续 finalizer时各自记录一次，`close()` 完成全部 finalizer后不得重抛已经记录的同一异常对象。 |
| scheduler/background callback | 创建并监督该 callback 的 runtime/session/capability owner | callback 边界吃掉失败并保持 scheduler/worker 存活时记录一次；callback 内部 helper 传播时不记录。每次独立 attempt 有自己的 event/attempt ref。 |
| process fatal escape | executable deployment entrypoint | 只注册一次 `uncaughtException` 和 `unhandledRejection` 最后防线；以 re-entry guard 防止递归，记录一次 `process.fatal.uncaught_exception` / `PROCESS_UNCAUGHT_EXCEPTION` 或 `process.fatal.unhandled_rejection` / `PROCESS_UNHANDLED_REJECTION`，执行 bounded operational flush，writer不可用时走 bounded emergency reporter，随后非零终止。不得恢复业务、不得下沉到 `agent-app` reusable package，也不得把已由正常终止边界处理的异常再次上报。 |

异常包装使用 TypeScript/ECMAScript 标准 `cause` 语义。`AgentErrorOptions.cause` 继续由 `agent-common` owning；包装时必须保留原异常对象，除非原异常已经具有所需稳定 code/category/stage 而无需包装。新增的 wrapper message 必须是 code-owned safe template，稳定 phase/code 可放在 owner-controlled safe metadata 中供终止边界选择 event/failureStage；禁止把原始 message 拼进 wrapper。`SafeError` 是跨用户/stream/history 的安全投影，不携带原始 Error 或 cause；原始链只在进程内传播并由 writer 安全投影。本 change 不新增 `agent-contracts` exception DTO、跨 package `GlobalExceptionHandler` 或第二套 error hierarchy。

`app.start.failed` 的 stage 传递采用唯一实现路径：`agent-app` owning `AppStartupFailureStage` allowlist，包含 `APP_COMPOSITION`、`SCHEDULED_MAINTENANCE_START`、`CRON_SCHEDULER_START`、`TRAJECTORY_WORKER_START`、`MEMORY_AGING_SCHEDULER_START`、`MEMORY_EXTRACTION_SCHEDULER_START`、`CAPABILITY_STARTUP_VALIDATION`、`WEB_CHANNEL_READY`、`TASK_CHANNEL_READY`、`CRON_CALLBACK_READY`、`RAG_KNOWLEDGE_BUILD`、`RUNTIME_RECOVERY`、`SERVER_LISTEN` 和 fallback `APP_STARTUP`。app composition factory 在 composition 逃逸时、`composeAppLifecycle.start()` 在 `SERVER_LISTEN` 或其它未被明确降级消费的 startup failure 逃逸时，分别抛出 `AgentError(code=APP_START_FAILED, category=INTERNAL, message=code-owned safe template, cause=original, safeDetails.failureStage=<allowlisted stage>)`，不得记录；listen 等内层 helper 不重复包装。`SERVER_LISTEN` 前的 scheduled maintenance、cron scheduler、trajectory worker、memory schedulers、capability startup validation、channel ready、RAG build 和 `RUNTIME_RECOVERY` 都是启动贡献或 bounded recovery attempt，不是 server listen readiness gate；这些阶段失败时 app lifecycle 记录一次 stage-scoped degraded diagnostic（`RUNTIME_RECOVERY` 使用 `runtime.recovery.degraded`，其它阶段使用 `app.start.degraded`），携带 allowlisted `failureStage` 和 bounded code，然后继续后续阶段，使外挂 gateway/service 后续恢复后仍可通过正常 runtime request/maintenance path 使用。

`agent-app` package root 暴露唯一的 `classifyAppStartupFailure(error: unknown): AppStartupFailureStage` technical API；它只接受 `AgentError`、`code=APP_START_FAILED`、`category=INTERNAL` 且 `safeDetails.failureStage` 命中同一 allowlist 的组合，其它输入统一返回 `APP_STARTUP`。LOCAL/REMOTE deployment entrypoint 必须调用该 classifier，不得复制 allowlist或 import `agent-app` private path，也不得从 message、stack或 frame推断阶段。若 app 对象已经创建，deployment 使用当前绑定的 operational logger输出唯一 `app.start.failed` 后执行拒绝启动/cleanup；若 composition 在 app 对象返回前失败，deployment 使用 classifier 得到 stage并只走 bounded emergency reporter。该 type/classifier 是 app lifecycle 的 package-owned technical API，不进入 `agent-contracts`、SafeError、Web/stream DTO 或持久化 schema。

`runtime.submit.orphan_session` 不是 caught exception diagnostic，而是一个独立的 pre-acceptance degradation fact。它只在 sessionless submit 已成功创建内部 session、但尚未 durable accept 任一 RequestRun 时失败才输出一次；一旦 `saveRun` 返回 accepted record，必须清除 orphan candidate，后续 checkpoint、canonical event或 enqueue failure不得再输出 orphan。该行只携带可信 agent/session/parent refs 与由 AgentError safe code推导的 bounded `failureReason`，不得携带 `err`、exception type/fingerprint/cause。原 submit exception 保持原传播规则，由 channel或其它实际终止 owner决定是否记录。

Todo replace 两层均不是终止边界：`agent-runtime/src/todos/gateway-todo-state.ts` 和 `agent-platform-gateway-local/src/db/sqlite-gateway-core.ts` 的 replace catch 都继续抛出，因此删除 `todo.runtime.replace.failed` 与 `todo.gateway.replace.failed`；start/completed 可保留，失败由上层 capability canonical outcome和最终 request/channel termination负责。

app shutdown finalizer 是独立的 consume boundary：每个 finalizer catch 记录自己的 `app.shutdown.finalizer_failed` 后继续运行剩余 finalizer，因而 `closeApp` 不得再保存并重抛首个已记录异常。deployment shutdown caller不重复打印这些异常；operational writer close 后无法记录的 writer自身 failure仍沿用 bounded emergency policy。

### 决策 23：不可信解析诊断与 CLI 用户提示使用各自的窄安全投影

Skill manifest parser diagnostic message 来源于用户、runtime-generated 或第三方 `SKILL.md`，不是 code-owned log vocabulary。builtin/local discovery 对 manifest invalid 只投影 stable `reasonCode[]`、diagnostic count、provider/source scope 和已通过 safe candidate validation 的 skillId；operational log 与 readiness evidence 都不得携带 parser message、原文字段名/值或 manifest path。这样统一 writer 的字段 redaction 仍是最后一道防线，而不是把不可信原文安全责任推给字段名匹配。

local runtime package 的 ready notice 是面向操作者的 CLI 交互，不是 application operational diagnostic。该输出由 `local-runtime-package` 下的单一 CLI output module owning，`agent-app` 其它产品源码不得调用 `console.*` 或直接写 stdout/stderr。ready notice 只使用 app-owned template 和 validated host/port；self-check 入口调用 package-owned runner，并只向 stderr 输出 allowlisted diagnostic code 与固定 package-relative evidence ref。runner 捕获 validation/layout exception，禁止 Node 默认 uncaught stack、diagnostic message、配置值、host path 或 credential 进入 CLI 输出。

## 长期基线刷新计划

- `openspec/specs/runtime-logging/spec.md`
- `openspec/specs/local-file-roll/spec.md`
- `openspec/specs/ts-minimal-agent-kernel/spec.md`
- `openspec/specs/app-config-schema/spec.md`
- `openspec/specs/structured-logging/spec.md`
- `openspec/specs/local-runtime-package/spec.md`
- `openspec/specs/agent-runtime-metrics/spec.md`
- `openspec/specs/otel-observability-adapter/spec.md`
- `openspec/specs/audit-sink/spec.md`
- `openspec/specs/gateway-store-provider-ownership/spec.md`
- `openspec/specs/dev-agent-workbench/spec.md`
- `openspec/specs/plugin-developer-diagnostic-artifacts/spec.md`
- `openspec/designs/architecture/observability-boundaries.md`
- `openspec/designs/architecture/configuration-boundary.md`
- `openspec/designs/architecture/local-runtime-packaging.md`
- `openspec/designs/architecture/ts-backend-architecture.md`
- `openspec/designs/modules/agent-local-file-roll.md`
- `openspec/designs/modules/agent-log.md`
- `openspec/designs/modules/agent-common.md`
- `openspec/designs/modules/agent-app.md`
- `openspec/designs/modules/agent-runtime.md`
- `openspec/designs/modules/agent-core.md`
- `openspec/designs/modules/agent-channel-web.md`
- `openspec/designs/modules/agent-channel-task.md`
- `openspec/designs/modules/agent-observability.md`
- `openspec/designs/modules/agent-contracts.md`
- `openspec/designs/modules/agent-platform-gateway-local.md`
- `openspec/designs/modules/agent-platform-gateway-remote.md`
- `openspec/designs/adr/local-file-roll-foundation-boundary.md`
- `openspec/designs/spec-to-design-map.md`
- `docs/ts-migration/change-consistency-checks.md`

## 基于当前代码基线的实施落点

| Current path | Required modification |
|---|---|
| `agent-common/src/logging/logger.ts` | 保留 structural type/noop，删除 sync stdout/file factory。 |
| `agent-common/src/index.ts` / `agent-log/src/operational-writer.ts` | 复用现有 `AgentErrorOptions.cause`，统一标准 cause 构造；把 writer 当前单层 cause 投影扩展为本 change 冻结的有界递归链，不新增 public exception DTO。 |
| new `agent-local-file-roll` | Node-only rolling-file technical foundation；owning pino-roll/SonicBoom、safe policy validation、derived selector、size+daily、gzip/reconciliation/retention、active identity和 bounded handle。 |
| new `agent-log` | async Pino operational writer、console/component adapter、envelope/redaction和 operational policy；owning 一个独立 local-file-roll handle。 |
| root `tsconfig.json` / dependency-cruiser / manifests | 注册两个新 package；只允许 app/test 创建 agent-log，只允许三个 production owner依赖 agent-local-file-roll，并更新 lockfile。 |
| `docs/NextAgent 开源组件清单.md` | 记录精确 pinned Pino、pino-roll、OTel SDK/exporter 版本、使用 package 和用途。 |
| `agent-app` logging composition | 创建一个 writer、单次绑定 provider、从 writer 获取 observation-bound RuntimeLogger 并装配 lifecycle；owner 自行通过 `getLogger` 获取 runtime-diagnostic child facade；不保留 StructuredLogTransport 旁路。 |
| `timeline-observation-mapper.ts` | 迁移到 runtime/trajectory acquisition 并扩展实际 canonical families。 |
| `observability-composition.ts` | 删除 runtime bridge、model wrapper、metric log sink、logging audit mirror；分别装配 log projector、AuditEventWriter、MetricsRegistry 与 OTel SDK lifecycle。 |
| `agent-contracts/src/gateway/index.ts` | 把 audit 移到 top-level `GatewayBindings.audit`；`AuditEventStoreGateway` 改为 write-only append，删除 query DTO/list；从 `SqliteGatewayStoreBindings` 删除 audit。 |
| `agent-platform-gateway-local` audit/SQLite | 删除 `SqliteAuditStore` 与 `audit_events` schema；新增 file audit gateway，owning NDJSON/audit policy/failure mapping和独立 local-file-roll handle。 |
| `agent-observability/metrics` | 保留 registry/Meter adapter；新增 MeterProvider/periodic reader；`LocalMetricHistoryExporter` owning `NextAgentMetricSnapshotV1`、metrics policy/export lifecycle、独立 local-file-roll handle和 in-memory exporter tests。 |
| `agent-observability/metrics-registry.ts` | production registry 改为 streaming-only；test registry 单独保留 snapshot；dedup 改为 16,384-key FIFO；descriptor 成为 policy/instrument 单一来源。 |
| local deployment entrypoint | 按 `deployment.mode=LOCAL` 注入 `<paths.logDirectory>/nextagent-metrics.<date>.<sequence>.ndjson` history exporter。 |
| remote deployment entrypoint | 按 `deployment.mode=REMOTE` 注入 official OTLP HTTP/protobuf metric exporter；不把 endpoint/credential 下沉到 core app。 |
| `structured-log-projector.ts` | 增加 debug logical level 和最小 event coverage；不承担 runtime direct log。 |
| `agent-runtime/src/lifecycle/submit.ts` | 建立 accepted-request execution termination boundary；把 execution、dispatch、terminal commit failureStage 分开，未知执行异常 direct diagnostic exact-one；把 `runtime.submit.orphan_session` 收窄为 durable acceptance 前的独立 degradation且不附加 exception evidence。 |
| `agent-runtime/src/todos/gateway-todo-state.ts` / `agent-platform-gateway-local/src/db/sqlite-gateway-core.ts` | 删除 `todo.runtime.replace.failed` / `todo.gateway.replace.failed` log-and-rethrow，保留 start/completed 和上层 canonical failure ownership。 |
| `agent-core/src/model/run-bound-model-invocation.ts` / `agent-core/src/tools/tool-loop.ts` | 保留 canonical model/capability failure fact和原异常传播；tool-loop 在 FAILED/TIMED_OUT 结果写入模型可见失败反馈后输出 `tool.failure_feedback.appended` 安全 direct diagnostic，证明下一轮 context 已获得失败原因但不输出反馈正文；删除 `model.invocation.exception_captured` / `tool.call.exception_captured` 中间层日志；包装时保留 cause。 |
| `agent-observability/src/trajectory/typed-observation-adapters.ts` | context failure observation仍可产生；adapter继续抛出时删除 `context.assembly.exception_captured` direct log。 |
| app composition/lifecycle + deployment entrypoints | gateway/workflow/capability/listen helper 删除 log-and-rethrow；app composition/startup wrapper通过 `APP_START_FAILED` cause + validated `safeDetails.failureStage`传递阶段；`agent-app` root classifier单一 owning allowlist，deployment不得复制或 private import；deployment startup/shutdown 与 process fatal boundary exact-one。 |
| `agent-platform-gateway-remote` call adapters | remote failure 仍归一化为 safe AgentError并保留原异常 cause；adapter继续抛出时删除 direct log，由调用执行根终止 owner记录。 |
| web/task channel top error handler | non-INTERNAL AgentError与schema validation安全映射且无 direct exception；INTERNAL/未知 exception exact-one + safe 500；Fastify access outcome不重复异常链。 |
| context composition | 只包装 `ContextEnginePort.assemble`。 |
| sandbox/gateway composition | 只包装 execute/chunk；sandbox/gateway 自行通过 `getLogger` 获取 component logger；app binding 只做 provider startup ownership。 |
| web/channel composition | HTTP exact-one outcome；stream/component logger；不信任 header/query coords。 |
| `agent-channel-task/task-callback.ts` | 删除 direct `console.warn`，注入 channel-task component logger。 |
| health observation path | 成功 probe 不投影为 log；仅 health owner 保留 metric/health truth，状态 transition 或 subsystem failure可写 direct diagnostic。 |
| `agent-dev-workbench/src/index.ts` | 接收 app 注入的 current active operational provider，按 entry surface 分类；删除目录/文件名 active guess且不读取 closed/archive。 |
| developer hook trace plugin | 保持 explicit developer trace artifact，architecture test 证明不被 operational maintenance 处理。 |

## 迁移顺序（唯一实施路径）

1. 先建立 `agent-local-file-roll` technical foundation和 dependency firewall allowlist，完成机制级 rotation/gzip/reconciliation/retention/security contract tests。
2. 建立 `agent-log` package，增加 frozen config、development/package defaults、component envelope和独立 operational roll handle；app 创建 single writer并迁移所有 concrete/direct stdout/file operational bypass。
3. 先补 timeline mapper characterization/coverage，再删除 bridge、model wrapper 和 duplicate owner outcomes。
4. 接入限定 typed adapters 与 cataloged runtime milestones。
5. 先把 audit contract 移到 top-level `GatewayBindings.audit` 并收敛为 write-only append，删除 query DTO/list 和 `SqliteGatewayStoreBindings.audit`。
6. 删除 SQLite audit table/store与 logging mirror；LOCAL file audit gateway owning audit serialization/policy并创建独立 roll handle，app 完成 DO-to-Record adapter；产品 audit 断言改用 capture gateway/file fixture。
7. 删除 metric log sink，先建立 descriptor/streaming registry/bounded dedup，再接入 OTel SDK；LOCAL history exporter owning metrics schema/policy并创建独立 roll handle，REMOTE/PaaS 注入 OTLP exporter。
8. 迁移 Agent Dev Workbench current-active-only evidence reader，并冻结 observability startup/shutdown relative order。
9. 按执行根迁移异常终止边界：先补 runtime/channel/app/background/process characterization，再删除 model/tool/context/composition/gateway 的 log-and-rethrow；最后扩展 bounded cause-chain writer。
10. 完成 black-box count、安全、failure injection、package 和全量门禁。

## 验证映射（Verification Map）

| 目标 | 验证 |
|---|---|
| single writer + two surfaces | app composition/file integration |
| direct logs use a stable log event without fabricating a business event | component logger stable-event tests + missing-event drop negative test |
| timeline-first lifecycle | mapper/projector exact-count + duplicate negative tests |
| async/non-blocking | injected slow/failing destination、no-await characterization、event-loop latency gate |
| size or daily rotation | threshold + fake-clock daily rollover tests |
| daily timezone | controlled process-timezone tests covering date naming、midnight rollover and DST；retention remains elapsed 24h |
| gzip/reconciliation/aging | agent-local-file-roll mechanism contract tests覆盖 atomicity/restart/fake-clock/retention/count boundary；三个 owner、四个文件族 policy integration和 cross-family negatives证明独立 handle/selector |
| failure never changes business/readiness | init/write/rotation/archive/flush failure injection |
| audit separation | top-level write-only gateway contract + no SQLite table/query + AuditWriter app adapter + local NDJSON/rotation/gzip/duplicates + absence from operational/metrics/Workbench |
| metric separation | registry/OTel tests + LOCAL 60s NDJSON history/size+daily/gzip/7-day aging + REMOTE OTLP + absence from operational file |
| bounded product metrics memory | streaming registry no-history test + 16,384-key FIFO eviction + test-only snapshot injection |
| workbench active evidence | injected current-active ownership + surface classification + active rotation/unavailable + closed/archive exclusion |
| lifecycle order | producer stop -> metrics shutdown -> operational close ordering and independent-finalizer failure tests |
| trusted correlation/security | forged input + forbidden-content negative tests |
| default info trajectory | black-box check for request/model/capability bookends plus key safe child-stage milestones |
| exception termination ownership | source/architecture negatives禁止 log-and-rethrow 与 logged-marker dedup；runtime/channel/app/background/process black-box断言每个执行根 exact-one |
| cause-chain preservation | AgentError/native Error cause tests覆盖 4-node depth、cycle、non-Error cause、整链 5-frame/64-KiB budget、truncation和 raw message/path/provider frame exclusion |
| stage separation | runtime tests分别注入 pre-dispatch、execution、terminal commit failure，断言 event/failureStage不互相误分类 |
| package boundary | dependency-cruiser + manifest policy + package evidence；technical foundation只允许三个 consumer且不得依赖 common/contracts/implementation package |

## 风险与取舍（Risks / Trade-offs）

- async logging 可能在进程崩溃时丢失尚未 flush 的尾部日志；这是“不阻塞业务”的明确取舍，正常 shutdown 通过 bounded flush 降低风险。
- 终止边界 exact-one 是 owner/control-flow contract，不是 durable exactly-once；进程在 enqueue 前崩溃仍可能没有异常行，process fatal handler 只能通过 bounded flush 降低风险，不能承诺恢复或阻塞等待。
- 只在终止边界打印会减少 model/tool 等局部 `*.exception_captured` 行；根因阶段通过 canonical model/capability failure、稳定 wrapper metadata、cause chain/fingerprint和 deployment serviceVersion组合定位，换取不重复打印和清晰 owner。
- daily rotation 使低流量环境产生更多小 archive，但换来可证明的 retention 上限。
- direct diagnostics 不要求对应业务 event或 durable fact，但 physical line 必须使用稳定 code-owned log event；Fastify final access 则依赖固定 native msg 和 access fields。
- LOCAL metrics 以 60 秒粒度保存 cumulative snapshot history，可做基础趋势分析，但不是 Prometheus/TSDB：它不提供查询引擎、跨文件聚合、告警或无限历史；进程重启会形成可识别的 cumulative reset。固定 30 MiB/daily rotation、最多 10 个压缩归档和 closedAt-based 7-day aging 共同约束磁盘增长，数量上限可能使最旧归档早于 7 天被删除。
- REMOTE/PaaS OTLP exporter unavailable 时不 fallback 到 local file 或 operational log；metrics readiness 可 degraded，但业务 readiness/result 保持不变。
- bounded recent-fact dedup 不提供跨进程或任意时长的 exactly-once；metrics 是聚合遥测而非事实账本，使用 16,384-key FIFO 换取可证明的内存上限，canonical/fallback producer 必须在该窗口内竞争。
- Workbench 不读取 closed/archive，因此只能查看当前 active segment 中仍存在的 evidence；历史问题定位由运维直接检查 7-day gzip 文件，这是避免在业务进程建设归档检索器的明确取舍。
- LOCAL audit 采用 duplicate-tolerant append 而不建立跨重启 exactly-once index；同一 stable `auditId` 可能出现多行，这是避免重新造数据库的明确取舍。消费端必须按可信 scope + auditId 去重。
- LOCAL audit archive 固定在 closedAt 后保留 7 elapsed days，再由 audit gateway 自己老化；加上至多一个 daily active period和一个 hourly maintenance interval，磁盘时间窗口有界。超过本地窗口的长期合规归档必须由外部部署治理另行提供，本 change 不承诺本地无限期保存。
- `agent-local-file-roll` 增加一个受限 technical-foundation package和 dependency-firewall例外，但消除四套安全敏感 rolling/gzip/reconciliation/retention 实现。三个 consumer 仍保留四个文件族各自的 schema、policy、append result、readiness和 failure lifecycle；若公共包未来出现 output-domain mode 分支或业务 DTO，即视为边界回归。
