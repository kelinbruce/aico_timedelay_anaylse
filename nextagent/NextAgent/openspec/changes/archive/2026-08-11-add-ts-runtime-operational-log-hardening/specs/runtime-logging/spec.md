## ADDED Requirements

### Requirement: Runtime logging 策略控制异步级别与 sink

Runtime logging SHALL 支持 `error`、`warn`、`info` 和 `debug` 阈值，以及可独立配置的 console 和 file sink。每个启用的 destination MUST 使用异步模式。业务路径上的日志调用 MUST NOT 等待文件/控制台 I/O、drain、rotation、压缩、retention 或 flush；它 MAY 只同步执行有界的级别过滤、字段规范化/脱敏、JSON 序列化和入队。

规范化后的序列化 entry MUST 限制为 16 KiB。超大的调用方字段 MUST 被替换为最小的安全 entry，而不是无界复制。每个 destination MUST 使用一个独立的、实现自有的 4 MiB 异步 buffer。buffer 饱和时 MUST 丢弃新 entry，只更新有界/饱和式的 dropped-count bucket，并且 MUST NOT 等待 drain、无界增长内存或向调用方抛出异常。

#### Scenario: 开发环境 console 异步输出

- **WHEN** 开发环境启用 console、禁用 file 并选择 `debug`
- **THEN** 符合条件的 entry MUST 被入队到结构化 console destination
- **AND** MUST NOT 创建任何 operational 文件
- **AND** 业务调用 MUST NOT 等待 console 完成

#### Scenario: Package file sink 不阻塞请求

- **WHEN** 本地 package 文件日志已启用且 destination 较慢
- **THEN** request/model/capability 结果 MUST 保持与 destination 延迟无关
- **AND** 业务路径上不得执行任何同步 append、gzip、scan 或 retention 操作

#### Scenario: 慢速 sink 使其 buffer 饱和

- **WHEN** 某个异步 destination 达到其 4 MiB buffer 上限
- **THEN** 新 entry MUST 被丢弃而不阻塞业务调用方
- **AND** 被丢弃的 payload MUST NOT 被复制到 stderr 或另一个 fallback 队列
- **AND** 另一个健康的 destination MUST 保持可用
- **AND** 过载/恢复证据 MUST 限定为状态迁移和一个安全的 count bucket

### Requirement: 产品 runtime logger 由实现自有并按 component 划分作用域

`agent-log` SHALL 拥有完整的 operational logging 语义：Pino envelope、console sink、operational 文件策略、Pino child provider、不抛出异常的结果映射以及一个独立拥有的 `agent-local-file-roll` handle。仅限 Node 的 foundation SHALL 拥有共享的 pino-roll/SonicBoom rotation、gzip 协调、retention 和有界 handle 机制，且不理解 operational 字段。`agent-app` SHALL 恰好创建一个 operational writer，并将其 provider 绑定到 `agent-common` facade 一次。业务模块/类 SHALL 通过 `getLogger({ component, source? })` 获取按 component 划分作用域的 logger，而不需要构造函数/组合注入。provider MUST 派生一个带有可信低基数、代码自有绑定的 Pino child。业务 package MUST NOT 创建具体 logger 或选择 sink。

#### Scenario: 共享 writer 不抹除 component 归属

- **WHEN** runtime 和 channel 的 owner 通过 `getLogger` 获取 logger
- **THEN** 两个 entry MUST 使用同一个已配置的 writer/文件族
- **AND** 每个 entry MUST 包含其 app 绑定的 component
- **AND** 调用方字段 MUST NOT 覆盖 component

### Requirement: Operational entry 使用一个稳定的日志 event

每个普通 operational diagnostic SHALL 是一个独立的结构化 JSON object，包含 writer 自有的 ISO `timestamp`、文本形式的 `level=debug|info|warn|error`、固定的 `surface`、app 绑定的 `component`、app 自有的 `serviceVersion` 以及一个稳定的代码自有 `event`。受控例外 SHALL 是 Fastify 原生 access 对：`incoming request` MUST 保留安全的原生 `req` 形状，`request completed|request errored` MUST 保留原生 `res` 和 `responseTime` 形状，不新增 operational event。这两条记录 MUST 共享 Fastify 原生由服务端生成的 `reqId`。安全的 `req` 序列化器 MUST 只包含 method 和 `url` 中一个经过校验的路由模板，未匹配的请求用固定值 `unmatched` 表示。Pino 数字级别属于内部路由细节，MUST NOT 进入物理 schema。

普通物理 entry MAY 为人类可读性持久化一个可选的经过净化的 `msg`，但 MUST NOT 持久化 `operation` 或 `outcome`。`event` 仍是其唯一的机器 action/outcome 语义，用于搜索、告警和聚合。Fastify access 例外使用其固定原生消息加上 `res.statusCode` 和 `responseTime` 作为常规 access-log schema。Observation 采集 MAY 在内部为 trace、metric 和 audit 投影保留 boundary/operation/outcome，但 StructuredLogProjector MUST 将它们规范化为一个具体 event。

#### Scenario: 直接 component diagnostic 使用一个 event

- **WHEN** 某 owner 写入一条安全的结构化 runtime diagnostic
- **THEN** operational writer MUST 附带 timestamp、文本级别、`surface=runtime_diagnostic`、绑定的 component 和稳定的 event 输出它
- **AND** 物理 envelope MUST 包含由 app composition 选定的可信 serviceVersion
- **AND** 当它提供安全的动态上下文时 MAY 附加一个经过净化的 msg，但当它只是重复 event 时 SHOULD 省略 msg
- **AND** 它 MUST NOT 添加 operation 或 outcome
- **AND** 不得创建任何 observation、timeline、audit 或 metric 事实

#### Scenario: Event 派生的 trajectory 保留 event 身份

- **WHEN** StructuredLogProjector 输出一条已批准的 trajectory entry
- **THEN** writer MUST 保留其稳定的 projector event 和 `surface=observation_derived`
- **AND** 共享 writer MUST NOT 把无关的 runtime diagnostic 转换成 event 派生的 entry

#### Scenario: 已批准的语义字段在集中脱敏后保留

- **WHEN** 一个已批准的 model usage object 包含非负整数 `inputTokens`、`outputTokens` 和 `totalTokens`
- **THEN** 公共 writer MUST 为 operational 诊断保留这些值
- **AND** 相邻的 credential/token/path/query 字段 MUST 保持脱敏
- **AND** 调用方 MUST NOT 实现第二个仅用于日志的字段净化器

### Requirement: Operational 日志按大小或固定每日边界轮转并以 gzip 归档

当文件日志启用时，`agent-log` SHALL 使用其冻结的 operational 策略创建并拥有一个 `agent-local-file-roll` handle，包括对该 handle 由 transport 拥有的 active 身份的观察。foundation SHALL 用冻结的 size 字符串（其默认值为 `30m`）和实现自有的 `frequency=daily` 配置 pino-roll。当达到大小阈值或进程本地午夜时 SHALL 发生 rotation。用户配置 MUST NOT 禁用或覆盖每日安全 rotation。

每日边界以及自有文件名中嵌入的任何日历日期 SHALL 使用 Node.js 进程本地时区，并在进程生命周期内固定。Request/runtime 输入和 `observability.logging` MUST NOT 覆盖它。存在夏令时的日历日 MAY 短于或长于 24 小时；closed segment 的过期 MUST 保持为从 `closedAt` 起流逝的 `retentionDays * 24h`。

在 ready 状态之后，maintenance MUST 每分钟至少扫描一次 logger 拥有的文件族，排除当前 `destination.file`，并通过 `.gz.tmp` 加原子重命名对 closed segment 进行 gzip。源文件删除 MUST 仅在归档提交成功之后发生。

#### Scenario: 高流量文件按大小轮转

- **WHEN** active 文件达到 `maxFileSizeMiB`
- **THEN** pino-roll MUST 切换到一个新的 active segment
- **AND** 后续写入 MUST 继续而不等待 gzip

#### Scenario: 低流量文件每日轮转

- **WHEN** active 文件跨过每日 rotation 边界后仍低于大小阈值
- **THEN** pino-roll MUST 关闭它并选择一个新的 active segment
- **AND** 该 closed segment MUST 变为可进行归档维护

#### Scenario: 每日 rotation 使用进程日历而 retention 使用流逝时间

- **WHEN** 一个受控的进程时区跨越本地午夜，包括夏令时切换
- **THEN** active segment MUST 按该进程本地日历边界轮转
- **AND** 其文件日期 MUST 使用同一个进程本地日历
- **AND** 后续过期 MUST 使用从 `closedAt` 起流逝的小时数，而不是本地午夜计数

#### Scenario: 压缩失败保留证据

- **WHEN** gzip、重命名或 cancellation 失败
- **THEN** closed 源文件 MUST 保留以供重试
- **AND** `.gz.tmp` MUST NOT 计为已提交的证据

### Requirement: Operational 归档在 retention 窗口后自动老化

默认 retention SHALL 为 7 天，配置的 retention MUST 是大于或等于 7 的整数。默认 `maxArchiveFiles` SHALL 为 10，配置值 MUST 是正整数。过期 MUST 使用原始的 closed/rotation 时间。Startup reconciliation 和每小时 maintenance MUST 删除已过期的 logger 拥有的归档或 closed 源文件。当已提交的 logger 拥有的 gzip 归档数量超过 `maxArchiveFiles` 时，startup reconciliation 和每个归档维护周期 MUST 还删除其中最旧的归档，使用 `mtime` 再用文件名做确定性排序。时间过期和归档数量溢出 SHALL 是相互独立的删除条件。Maintenance MUST 保留 active、尚新的 closed 源文件、audit、metrics、developer diagnostic、unknown、symlink 和目录外文件；只有完全自有且已提交的 operational gzip 归档才 MAY 因数量限制在其时间窗口之前被删除。

固定的每日 rotation MUST 确保低流量数据不会无限期留在某个 active segment 中。一个 entry 的最大目标窗口是一个每日 active 周期加上配置的 closed segment retention 和一个维护间隔，但当已提交的 operational 归档超过 `maxArchiveFiles` 时会提前按最旧优先逐出。

#### Scenario: 默认归档数量超过十个

- **WHEN** 压缩提交了第十一个 operational gzip 归档，而先前十个仍未满 7 天
- **THEN** 最旧的完全自有的 operational 归档 MUST 在该维护周期内被删除
- **AND** 维护成功后留下的已提交 operational gzip 归档不得超过十个
- **AND** 数量限制 MUST NOT 影响 metrics、audit、developer diagnostic 或 unknown 文件

#### Scenario: 默认归档保留七天

- **WHEN** 一个已提交的归档未满 7 天
- **THEN** maintenance MUST 保留它

#### Scenario: 过期文件被老化删除

- **WHEN** 一个 logger 拥有的归档或 closed 源文件达到 7 天
- **THEN** 它 MUST 在下一个每小时 maintenance 或 startup reconciliation 中被删除

#### Scenario: Maintenance 不拥有其他文件

- **WHEN** 日志目录中包含 audit 存储、developer trace、symlink 或 unknown 文件
- **THEN** 归档/retention 维护 MUST 不改动它们

### Requirement: 日志失败绝不影响业务行为或就绪状态

Transport 初始化、序列化、entry 超大、入队溢出、写入、rotation、压缩、retention、flush 和关闭失败 MUST NOT 改变 app ready 结果、request lifecycle、terminal commit、stream 交付、model/capability/gateway 结果，也不得触发 app 关闭。一个失败或过载的 sink MUST NOT 禁用另一个健康的 sink。Runtime logger 方法 MUST 保持不抛出异常。

在 writer 可用之前或它进入 degraded/过载状态之后，一个 app 自有的异步 emergency reporter MAY 在每次启动或状态迁移时入队一条有界的结构化 stderr entry。发起调用的调用方 MUST NOT 等待它。它 MUST NOT 成为逐 entry 的 fallback 或常规 console sink，并且 MUST NOT 包含路径、raw error、stack、配置值、被丢弃的 payload 或 secret。如果 emergency reporter 自身失败，它 MUST 静默停止并且 MUST NOT 调用同步 fallback。

无效的 runtime logging 配置仍然属于配置校验失败；它不是 transport 失败，并 MAY 在配置边界内拒绝启动。

#### Scenario: 文件 transport 初始化失败

- **WHEN** 文件日志已启用但其 transport 无法初始化
- **THEN** app 业务就绪和请求行为 MUST 保持不变
- **AND** 可用的 console sink MAY 继续工作
- **AND** emergency reporter MAY 输出一条安全的 `logging.transport.init_failed` 状态迁移

#### Scenario: 异步 destination 在 ready 后失败

- **WHEN** 写入或 rotation 在 ready 之后失败
- **THEN** 发起的业务调用 MUST 保留其结果
- **AND** 日志 MUST NOT 发起 app 关闭
- **AND** 降级证据 MAY 只使用一条独立的有界 emergency 路径

### Requirement: Operational writer 生命周期包围每个产品生产者

在可信配置冻结之后，app composition SHALL 先创建/启动 operational destination，然后是 deployment audit gateway 和 metrics pipeline，再创建 observation projector 或业务生产者。Transport 初始化失败 MAY 使其拥有的输出域降级，但 MUST NOT 创建一个部分拥有的第二个 writer，也不得拒绝原本有效的业务启动。

在关闭期间，app composition SHALL 首先停止接受工作，并按照各自拥有的生命周期 drain 每个 runtime/channel/scheduler/worker/gateway/deployment 生产者和 projector host。然后它 SHALL 有界关闭 audit gateway，有界强制 flush 并关闭 metrics，同时关闭 `LocalMetricHistoryExporter` 文件生命周期，输出最终的 app 关闭诊断，最后有界 flush/关闭 operational writer。每个 finalizer MUST 从独立的失败隔离边界执行，使一个失败不会跳过后续的 audit、metrics 或 operational 清理。

#### Scenario: Metrics 关闭仍能报告降级

- **WHEN** 某 metrics exporter 在 app 关闭期间超时或失败
- **THEN** 其有界的 degraded 迁移 MAY 在 operational writer 关闭之前写入
- **AND** operational flush/关闭 MUST 仍然执行
- **AND** metrics 失败 MUST NOT 改变 app 之前的业务结果

#### Scenario: 较早的生产者关闭失败

- **WHEN** 某 runtime、gateway 或 deployment 生产者在关闭时抛出异常
- **THEN** metrics 收尾和 operational writer 关闭 MUST 仍在各自超时内被尝试
- **AND** operational writer MUST 仍然是最后一个关闭的常规输出域

### Requirement: 公共 operational 诊断提供基线问题定位覆盖

产品组合 SHALL 组合 canonical timeline 投影、范围收窄的已批准类型化 observation adapter 以及按 component 划分作用域的 runtime 诊断。既有 canonical lifecycle 事实 MUST 恰好一次使用 timeline 优先采集。没有业务 event 的事实 MAY 直接记录日志，MUST NOT 仅仅为了获得结构化文件而被强制经过 observation。

本 change 中的类型化 trajectory adapter 限于可信的 acceptance 前拒绝、`ContextEnginePort.assemble`、既有 attachment observation 和 `AppSandboxGatewayPort.execute/executeWithStdoutChunks`。Runtime 诊断覆盖 owner 私有的 scheduler、commit、恢复、delivery、gateway 绑定、maintenance 和其他安全的 component 状态。产品组合 MUST NOT 对 persistence store、render/readiness 查询或已被 capability 覆盖的远程调用做全量包装。

#### Scenario: Canonical lifecycle 结果恰好投影一次

- **WHEN** canonical model、capability 或 request terminal event 被发布
- **THEN** timeline mapper MUST 提供 observation 派生的 milestone
- **AND** 任何 model 包装器、runtime-log 桥、通用内部 observer 或同一结果的直接日志都不得重复它

#### Scenario: Component diagnostic 保持直接

- **WHEN** 某 component 报告 timeline 未表示的本地初始化或 owner 私有失败
- **THEN** 它 MAY 通过其按 component 划分作用域的 RuntimeLogger 写入
- **AND** 它 MUST NOT 仅为日志而创建 observation

#### Scenario: 公共组合不能静默绕过公共 writer

- **WHEN** 某个 operational sink 已启用
- **THEN** 产品 owner MUST 接收由 app 组合的 adapter
- **AND** owner 本地具体 logger、直接 stdout/stderr/文件输出或 noop 替代 MUST 被拒绝，已文档化的 emergency/CLI/developer-trace 排除项除外

#### Scenario: Trace 基础设施失败保留安全根因证据

- **WHEN** OTel trace credential 解析、SDK 初始化、批量导出或 span 投影失败
- **THEN** 第一个基础设施 owner catch MUST 输出一条带代码自有 failureStage 和安全 reason 的按 component 划分作用域的诊断
- **AND** 意外 Error MUST 使用 writer 自有的安全异常投影
- **AND** endpoint、credential、服务名、raw error message 和 raw stack MUST NOT 通过 console 或任何并行诊断路径写入
- **AND** 成功的 span 和成功的导出批次 MUST NOT 产生逐条目的 operational 噪声

### Requirement: 基线 operational 目录与信号预算由实现冻结

实现 SHALL 在其中明确编目的 milestone 上遵循 `event-catalog.md`。该目录 MUST NOT 被解释为所有直接诊断的封闭 enum。

对于一个隔离的普通 Web 提交流程，default-info 编目的 request trajectory MUST 包含 request/model/capability/terminal 的首尾 bookend，加上内部 run 诊断所需的关键安全子阶段 milestone。其他进程级 component 日志在该 per-request trajectory 之外。Metrics MUST NOT 增加它；失败/降级 MUST 保持可见。

#### Scenario: 普通请求在 info 级别仍可诊断

- **WHEN** 一个隔离的普通请求以一次 model 调用完成且没有 capability 调用
- **THEN** 其 info trajectory MUST 包含 request accepted/completed、model start/completion、context assembly 和 first-visible milestone
- **WHEN** 它以两次 model 调用和一次 capability 调用完成
- **THEN** 其 info trajectory MUST 额外包含 capability start/completion 以及定位执行推进或停止位置所需的 model/子阶段 milestone

#### Scenario: 直接诊断不必进入目录

- **WHEN** 一条安全的 component 诊断不属于已编目的必需 milestone
- **THEN** 它 MAY 仍通过共享 writer 输出
- **AND** 它 MUST 遵守 component、级别、安全性和重复结果策略

#### Scenario: 服务器访问只有一个 owner

- **WHEN** Fastify 完成或失败一个 HTTP 请求
- **THEN** 服务器边界 MUST 通过公共 writer 输出 Fastify 默认原生的 `incoming request`，随后恰好一条 `request completed` 或 `request errored` 记录
- **AND** Fastify MUST 接收一个从同一 `agent-log` root writer 派生的受控原生 Pino child 作为其 `loggerInstance`，而不需要 app 自有的平行 logger facade 或自定义 `LogController`
- **AND** 默认的 Fastify `LogController` MUST 保持唯一的 access-log 生产者
- **AND** 任何产品 owner 都不得输出 `http.request.*` 或 `server.access.*`
- **AND** incoming 记录和 final 记录 MUST 共享 Fastify 原生由服务端生成的 `reqId`；incoming 记录 MUST 保留安全的 `req.method` 和经过校验的路由模板 `req.url`，而 final 记录 MUST 保留 `res.statusCode`、`responseTime` 和固定的原生消息
- **AND** access 对 MUST NOT 投影被捕获的 Error 或 cause 链；意外 HTTP 异常证据只属于 channel 终止诊断
- **AND** raw URL/query/header/request/reply 和客户端提供的 request id MUST NOT 进入记录
- **AND** HTTP 服务器 metrics MUST 由官方 OpenTelemetry HTTP instrumentation 在共享 MeterProvider 上独立输出，MUST NOT 使用 app 自有的 `onResponse` metric observer，并且 MUST NOT 生成或修改 access 记录
- **AND** incoming request 日志 MUST 保持启用，作为 Fastify 原生 access 对的第一个成员
- **AND** Fastify stream、serializer、write-head、error-handler 和 service-unavailable 失败 MUST 保留稳定的框架 event，并通过公共 writer 传递被捕获的 Error
- **AND** 该 adapter MUST 只序列化已批准的原生 access 字段；raw Fastify req/reply/header/URL/自由格式消息、router dump 和客户端控制的 request id MUST NOT 绕过公共 writer 或进入 operational 输出

#### Scenario: 例行诊断不掩盖降级

- **WHEN** 发生 policy allow 或 context assembly 成功
- **THEN** 对应 event MUST 是 info
- **WHEN** 发生 context budget/micro-compact 成功或 task trajectory 入队/构建/跳过
- **THEN** 对应 event MAY 保持 debug
- **WHEN** Skill 扫描部分完成、task trajectory 被丢弃，或某个 category-question source 进入 unavailable 状态
- **THEN** 对应 event MUST 是 warn
- **AND** category-question 的 unavailable/recovered 信号 MUST 只在按 agent 和 locale 的状态迁移时输出

### Requirement: Audit 与 metrics 保持在 operational 日志之外

Operational writer SHALL 只接受 `runtime_diagnostic` 和 `observation_derived` 两种 surface。Audit MUST 流经 `AuditEventWriter` 到一个只写 deployment gateway；LOCAL audit 输出只属于 gateway 拥有的 `nextagent-audit.*.ndjson[.gz]` 文件族，并且 MUST NOT 使用 operational 日志或 SQLite。Metric 样本 MUST 流经 `MetricsRegistry`/OTel metric adapter，并且 MUST NOT 被序列化进 operational console、active 文件或归档。一个 LOCAL OTel metrics NDJSON history 文件族是独立的输出 artifact，其完整文件生命周期由 `LocalMetricHistoryExporter` 拥有；它 MUST NOT 被当作 operational 日志 surface 或文件族成员。一条有界的 audit/metrics degraded/recovered component 诊断 MAY 进入 operational 日志，但它 MUST NOT 包含 audit/metric payload，并且 MUST NOT 逐 event、逐 sample、逐 snapshot 或逐 retry 发生。

#### Scenario: Audit 使用 gateway writer

- **WHEN** AuditProjector 产生一个 AuditEvent
- **THEN** 它 MUST 调用由已配置 gateway sink 支撑的 AuditEventWriter
- **AND** 它 MUST NOT 调用 RuntimeLogger 或 operational writer

#### Scenario: Metrics 不变成日志

- **WHEN** MetricsProjector 输出样本
- **THEN** 样本 MUST 保持在 metrics pipeline 中
- **AND** 不得产生任何 `metric_diagnostic` operational entry
- **AND** 任何 LOCAL metrics 文件输出 MUST 只由 metrics exporter 产生

### Requirement: 异常诊断只在 owner 作用域的终止边界输出

每个执行根 SHALL 有一个显式的异常终止 owner。重抛同一异常或抛出以原始异常为 `cause` 的包装的 catch MUST NOT 为该异常输出 operational 诊断。通过返回 fallback/degraded/安全结果、提交 request terminal、映射公共响应、放弃一次受监督的后台尝试或终止进程来消费异常的 catch MAY 为该操作输出已编目的诊断，并且当目录要求根因证据时，对意外的 INTERNAL 异常 MUST 这样做。

是否记录日志的决策 MUST 从静态的 owner/控制流职责推导。实现 MUST NOT 给 Error/AgentError 添加 already-logged 标志、维护全局 Error 集合、把异常 fingerprint 用作去重键，或使用 AsyncLocalStorage/request 局部可变状态来决定外层 handler 是否应记录日志。由清理、terminal commit、delivery 或诊断基础设施抛出的新失败是一个独立操作，MAY 由该操作自身的终止边界用一个独立的 event 和 failureStage 记录一次。

`AgentError` SHALL 在包装增加稳定的 owner 上下文时保留标准 Error `cause`。catch MUST NOT 用一个省略 cause 的新异常替换被捕获的异常。包装器 MUST 使用代码自有的安全消息，并且 MUST NOT 插值原始消息。SafeError/公共错误投影 MUST NOT 携带 Error/cause 对象。Operational writer SHALL 最多投影四个 Error 节点（包括最外层 error），跨完整链最多五个 NextAgent 自有的 frame ref，并跨完整链最多检查 64 KiB 的字符串材料。Cause 环、过深的深度、耗尽的检查/frame 预算、不可访问属性和投影失败 MUST 只以省略加 `exceptionChainTruncated=true` 表示；它们 MUST NOT 抛出异常或暴露 raw 值。非 Error cause MAY 只以 `exceptionType=NonErrorThrow` 出现并终止投影链。

#### Scenario: 传播中的 model 和 capability catch 不打印

- **WHEN** model、capability 或 context 代码输出其 canonical 安全失败事实，然后重抛同一异常或保留 cause 的包装
- **THEN** 该中间 catch MUST NOT 用该异常调用 RuntimeLogger
- **AND** 原始 cause 链 MUST 对 request 执行终止边界保持可用

#### Scenario: 已接受请求的异常在 runtime 中恰好终止一次

- **WHEN** 一个意外异常在请求被接受之后逃逸出 request core 执行
- **THEN** `agent-runtime` MUST 输出恰好一条带可信 request/run 坐标和 `failureStage=REQUEST_EXECUTION` 的 `request.execution.exception_captured` 直接诊断
- **AND** runtime MUST 规范化公共结果并继续既有的安全 terminal commit 路径
- **AND** canonical request 失败 MAY 保持独立的 trajectory 结果，但 MUST NOT 包含该 Error 或重复其异常链
- **AND** terminal commit 失败 MUST 使用它自己的 terminal-commit event/failureStage，并且 MUST NOT 被报告为 scheduler dispatch 失败

#### Scenario: Channel 顶层 handler 消费意外的同步异常

- **WHEN** 一个 Web 或 Task channel 异常在 runtime 把已接受请求转换为 terminal 事实之前发生
- **THEN** channel 顶层 error handler MUST 把已知的非 INTERNAL AgentError 或边界自有的 Fastify/TypeBox schema 校验失败映射到其既有的安全状态，而不需要专门的异常诊断
- **AND** 它 MUST 把 INTERNAL AgentError 或未知异常映射到安全的 500 响应，并根据 transport 根因恰好输出一条 `server.framework.failed` / `FASTIFY_INTERNAL` 或 `channel.task.request.failed` / `TASK_CHANNEL_REQUEST` 安全异常诊断
- **AND** Fastify access 记录 MAY 表达 transport 结果，但 MUST NOT 再次附加同一被捕获的异常链

#### Scenario: 嵌套启动失败只在 deployment 终止处打印

- **WHEN** gateway 组合或 server listen 捕获异常、执行清理并以原始异常作为 cause 重抛
- **THEN** 中间 app helper MUST NOT 记录该异常
- **AND** app composition/startup 包装器 MUST 抛出 `AgentError(code=APP_START_FAILED, category=INTERNAL)`，带上原始 cause 和一个已列入 allowlist 的 `safeDetails.failureStage`，用于组合失败、server listen 失败和其他非降级启动失败
- **AND** `agent-app` MUST 暴露一个 package 根部 classifier，对照唯一 app 自有的 allowlist 校验包装器的 code、category 和 stage，并对每个未知或无效输入返回 `APP_STARTUP`
- **AND** deployment 边界 MUST 使用该 classifier，并且 MUST NOT 复制 allowlist、导入 `agent-app` 私有路径或从消息、stack 或 frame 文本推断 stage
- **AND** LOCAL 或 REMOTE deployment 启动边界 MUST 在拒绝启动之前恰好输出一条启动失败诊断
- **AND** 它 MUST 只在 app 对象创建之后才使用当前 operational logger；app 创建之前的失败 MUST 只使用有界的 emergency reporter

#### Scenario: listen 之前的启动贡献失败被降级而不与 listen 就绪耦合

- **WHEN** app lifecycle 启动到达 `SERVER_LISTEN` 之前的任一阶段，且该阶段因 scheduler、worker、validation、channel ready、RAG build、恢复期 gateway 或外部服务不可用或无效而拒绝或抛出异常
- **THEN** `composeAppLifecycle.start()` MUST 为该阶段输出一条带已列入 allowlist 的 `failureStage` 的安全降级诊断
- **AND** 非恢复阶段 MUST 使用 `app.start.degraded`，而 `RUNTIME_RECOVERY` MAY 保留其专用的 `runtime.recovery.degraded` event
- **AND** 启动 MUST 继续到下一阶段并最终到达 `SERVER_LISTEN`，而不是把该阶段异常包装为 `APP_START_FAILED`
- **AND** server listen 失败 MUST 保持其既有的 fail-closed 启动行为
- **AND** 之后的 runtime 请求和 maintenance MUST 继续使用其正常路径，使外部服务在启动之后能够变为可用

#### Scenario: Acceptance 之前的孤儿 session 是独立的降级事实

- **WHEN** 一个无 session 的提交创建了其内部 session，并在任何 RequestRun 为该提交被持久接受之前失败
- **THEN** runtime MUST 在传播提交异常之前恰好输出一条 `runtime.submit.orphan_session` 警告
- **AND** 该警告 MUST 只包含可信的 session/parent ref 和一个有界的安全派生失败原因
- **AND** 它 MUST NOT 包含 `err`、异常类型、fingerprint、frame 或 cause
- **AND** 一旦某个 RequestRun 被持久接受，后续的 checkpoint、canonical-event 或入队失败 MUST NOT 把该 session 归类为孤儿

#### Scenario: Todo replace adapter 传播而不记录失败日志

- **WHEN** runtime Todo adapter 或 SQLite Todo store 捕获一个 replace 失败并重抛它
- **THEN** 两层都 MUST NOT 输出 `todo.runtime.replace.failed` 或 `todo.gateway.replace.failed`
- **AND** capability canonical 失败和适用的执行终止 owner MUST 保持对失败证据负责

#### Scenario: 关闭 finalizer 失败在其自身边界被消费

- **WHEN** 某个 app 关闭 finalizer 失败而生命周期继续执行其余 finalizer
- **THEN** 该 finalizer 边界 MUST 输出一条 `app.shutdown.finalizer_failed` 诊断
- **AND** `close()` MUST NOT 之后再重抛同一个已记录的异常对象
- **AND** deployment 关闭调用方 MUST NOT 为该 finalizer 失败再输出另一条诊断

#### Scenario: 受监督的后台失败被消费

- **WHEN** 某 scheduler 或 worker callback 捕获一次失败的尝试并保持 supervisor 存活
- **THEN** 该 callback owner MAY 为该尝试输出一条诊断
- **AND** 只传播同一失败的 helper MUST NOT 输出另一条诊断

#### Scenario: 进程 fatal handler 是最后手段

- **WHEN** 一个未捕获异常或未处理的 rejection 逃逸出所有常规执行根边界
- **THEN** 可执行的 deployment 入口 MUST 至多输出一条有界的 fatal 诊断，尝试一次有界的 operational flush 并以非零码终止
- **AND** writer 不可用 MAY 只使用有界的 emergency reporter
- **AND** fatal handler MUST NOT 恢复业务执行，也不得实现为可复用的 agent-app 全局 handler

## MODIFIED Requirements

### Requirement: Runtime 日志与 observation 派生日志分离

Runtime 诊断和 observation 派生的 trajectory entry SHALL 共享同一个结构化 operational writer 和文件族，同时保持逻辑上可区分。Runtime 诊断是直接的 component 证据，MUST 使用 `surface=runtime_diagnostic`。Observation 派生 entry 是投影事实，MUST 使用 `surface=observation_derived`。

Runtime 诊断 MUST NOT 被当作 audit 真相、metric 真相、health 真相、canonical lifecycle 真相或 terminal 真相。Observation 派生 entry MUST 继续只消费已批准的 observation。该文件 MUST NOT 成为输入事实来源。

#### Scenario: Runtime logger 不创建 observability 事实

- **WHEN** 某个业务 package 写入一条 runtime 诊断
- **THEN** 它 MUST 使用来自 `agent-common` 的 `getLogger`
- **AND** 它 MUST NOT 调用 ProjectorHost 或构造 StructuredLogEntry

#### Scenario: 共享文件保持真相归属

- **WHEN** 两个 surface 写入同一个文件
- **THEN** `surface` MUST 区分它们
- **AND** 任何一方都不得解析该文件来为另一方创建事实

### Requirement: 业务 package 使用 agent-common runtime logger contract

业务 package SHALL 只为结构化的 RuntimeLogger contract 和无 I/O 的 `getLogger` facade 依赖 `agent-common`。它们 MUST NOT 导入 `agent-log`、`agent-local-file-roll`、Pino、pino-roll、logging transport、zlib 或文件系统 API 来输出产品 operational 诊断。为一个类添加日志 MUST NOT 要求新的构造函数参数、依赖选项或 composition-root 修改。

#### Scenario: 业务依赖打印直接诊断

- **WHEN** 某个业务 owner 需要一条安全的 operational 诊断
- **THEN** 它 MAY 调用其从 `getLogger` 获得的按 module/class 划分作用域的 logger
- **AND** 它 MUST NOT 感知 sink 或归档生命周期

### Requirement: 输出域只共享滚动文件机制

`agent-app` SHALL 创建一个 operational writer。该 writer SHALL 通过同一个 RuntimeLogger 实现创建 runtime-diagnostic 和 observation-derived 两种 logger，只通过一个可信的 writer 绑定 surface 区分。普通业务 `getLogger` MUST 始终绑定 `runtime_diagnostic`；只有可信的 app composition MAY 为 StructuredLogProjector 获取 observation 绑定的 logger。AuditEventWriter、MetricsRegistry/OTel、trace 和 health 输出 MUST NOT 实现为 operational writer adapter。`agent-log` SHALL 独占拥有 operational schema/policy/输出解释。`LocalMetricHistoryExporter` SHALL 单独拥有 LOCAL metrics schema/policy/输出解释。LOCAL AuditEventStoreGateway SHALL 单独拥有 audit schema/policy/输出解释。

产品组合 MUST NOT 暴露或注入独立的 StructuredLogTransport、重复的按级别 adapter、调用方可选的 surface 或第二条净化/路由路径。StructuredLogProjector SHALL 在注入的 observation 绑定 RuntimeLogger 上按其逻辑级别路由每个 StructuredLogEntry。仅用于测试的 capture logger MAY 只通过测试组合注入。

三个生产消费者 SHALL 复用 `agent-local-file-roll` 的工厂和机制代码，但 MUST 创建四个独立 handle：`agent-log` 中分开的 operational 和 plugin 诊断 handle、一个 metrics handle 和一个 audit handle。它们 MUST NOT 共享 destination、active 身份、buffer、timer、维护 lane、可变状态、关闭状态或 policy 对象。每个 handle SHALL 使用其 owner 的可信 policy 派生一个互斥 selector。foundation MUST NOT 包含输出域模式或 DTO，并且每个 owner MUST 保持为解释其 append/log/export 结果的唯一 component。

#### Scenario: App 组合独立输出域

- **WHEN** observability 基础设施被组合
- **THEN** runtime 和 trajectory 日志 MUST 共享 operational writer
- **AND** audit MUST 使用其 gateway writer
- **AND** metrics MUST 使用其 reader/exporter pipeline
- **AND** 三个 owner MUST 创建独立的 local-file-roll handle，同时只共享 foundation 机制代码

### Requirement: Runtime 日志 helper 安全、异步且非致命

Runtime 日志 helper SHALL 不抛出异常，并且 SHALL 不执行同步 sink I/O。它们 MAY 包含有界的稳定标识符、安全 reason code、状态和 bucket。RuntimeLogger SHALL 对所有级别接受一个可选的 `msg` 作为独立参数。该消息 MUST 基于代码自有的模板加上已校验的低风险变量，MUST 是单行并在 UTF-8 规范化后有界于 1 KiB，并且 MUST 通过与结构化字符串值相同的集中式 secret/path 掩码。调用方提供的 `msg` 或 `message` 字段 MUST 被忽略。无效或无法处理的消息输入 MUST 被省略，同时仍然输出稳定的结构化 event。

它们 MUST NOT 把 raw prompt、model output、stream delta、attachment content、provider body 或 credential 序列化为普通字段。Runtime 自有的 tool 诊断 MUST 包含 canonical `toolInput`，并在已有有效结果后包含 canonical `toolOutput`，用于 normal 和 debug 诊断细节下的内部本地 run 诊断。该行为 MUST NOT 依赖 raw-payload 日志开关，也不得被 `diagnosticDetail` 关闭。嵌套在这两个字段下的内容 MUST 保留 prompt、路径、命令、结果内容和非 secret 的 credential/token 诊断元数据。`agent-log` MUST 窄范围脱敏 credential 值和认证 token，同时不脱敏 credential 引用/状态、usage token 计数、token 计数/长度或 tokenization 诊断。它 MUST 还在入队前应用有界递归、字段/数组/字符串限制、不支持值规范化和 16 KiB entry fallback。Runtime 自有的 tool 失败诊断 MUST 包含一个只从 `SafeError.message` 或代码自有 fallback 消息派生的有界 `safeErrorSummary`。`agent-log` MUST 集中拥有保留字段过滤、普通字段敏感键过滤、递归值规范化、内联 secret 掩码、消息规范化、异常投影和入队前 entry 大小 fallback。业务调用方 MUST NOT 添加平行的仅日志 redactor、消息净化器、Error 分类器或仅日志的 try/catch 包装。生产者 MUST 仍对 canonical `toolInput` / `toolOutput` 之外的每个字段应用数据最小化。

RuntimeLogger 的 debug/info/warn/error 方法 SHALL 遵循 Pino 兼容的 `fields, msg?` 调用形状。只有异常终止或显式的消费/降级边界 SHALL 在标准 `err` 字段中原样传递被捕获值；继续传播的中间 catch MUST NOT 记录它。日志边界 MUST 提供 event、failureStage 和适用的可信坐标，但 MUST NOT 执行日志特有的 Error/AgentError/Node 错误码分类，也不得把被捕获属性复制到替代字段。只有当 `safeReasonCode` 是一个稳定的领域子原因且增加了 event 和 failureStage 尚未编码的信息时，它 MAY 提供该字段。`fallbackReasonCode` MUST 被丢弃，MUST NOT 出现在调用方约定或物理输出中；writer MUST NOT 合成通用的 `UNEXPECTED_FAILURE`。Operational writer SHALL 集中分类并移除 raw `err`，但 SHALL NOT 推断该异常是否本应被记录，也不得对多次调用去重。普通失败 event 上的非 INTERNAL AgentError SHALL 产生稳定的 code/category/retryable 而不带 stack 证据；owner MUST NOT 为该预期错误创建专门的意外异常诊断。INTERNAL AgentError 或普通 Error SHALL 额外产生本 change 定义的有界安全 cause 链投影；非 Error 抛出 SHALL 产生 `exceptionType=NonErrorThrow` 而不暴露原始值。对于没有独立安全子原因的普通 Error/非 Error 抛出，event、failureStage、category 和异常证据 SHALL 足够，`safeReasonCode` SHALL 被省略。投影或消息净化失败 MUST 省略受影响的可选证据，而不抛出异常、丢弃稳定的 event 或暴露原始值。

Observation 派生的物理 entry SHALL 只在存在时扁平化 `agentId`、`agentVersion`、`sessionId`、`requestId`、`runId`、`timelineEventId` 和 `capabilityInvocationId`。它们 MUST NOT 持久化嵌套的 `ownerScope` 或 `correlation`、tenantId、subjectId、requestContextId 或 stepId。writer 的 timestamp 记录入队时间；observation 发生时间在需要时 SHALL 使用独立的 `occurredAt` 字段。

意外异常 SHALL 只在本 change 定义的 owner 作用域终止边界产生直接 error 诊断。继续传播的 model、capability、context、组合、gateway、listen、delivery 或其他中间 catch MUST 保留异常/cause，并且 MUST NOT 记录它。该诊断 MUST 保持与 canonical lifecycle terminal 事实相区分，并且 MUST NOT 创建另一个 observation 或持久化的 timeline event。

owner catch MUST NOT 把 `Error.message`、`Error.name`、`Error.stack` 或 `String(error)` 复制到替代字段。如果一次 logger 调用抛出异常，业务 owner MUST 隔离该失败，MUST NOT 重试或通过同一 logger 输出 logging-failure event；只有 operational writer MAY 拥有 transport 降级和 emergency fallback。归档或 retention 维护失败 MUST NOT 拒绝原本已被接受的 active audit append 或 metric export。

#### Scenario: Tool 失败排除不安全输入

- **WHEN** 输出一条与 tool 相关的直接诊断
- **THEN** 它 MAY 包含稳定的 invocation/capability ref 和安全 reason
- **AND** 它 MAY 只对 runtime 自有的异常诊断、在集中脱敏和有界化之后包含标准 `rawExceptionData.message` / `rawExceptionData.cause.message`
- **AND** 它 MUST NOT 包含 raw args/result/path/stack/secret 或调用方复制到替代字段中的异常文本

#### Scenario: 意外 capability 异常无需中间打印仍可定位根因

- **WHEN** 一次 capability 调用在返回安全结果之前抛出一个非领域 Error
- **THEN** canonical capability terminal MUST 保留其安全的通用结果
- **AND** capability catch MUST 保留并重抛该 Error 而不输出直接诊断
- **AND** runtime request 终止边界 MUST 输出一条相关的直接诊断，包含 `failureStage=REQUEST_EXECUTION` 加上 writer 派生的异常类型/fingerprint/cause 链/自有 frame
- **AND** runtime request 终止边界 MAY 为内部 run 诊断包含经过净化且有界的 `rawExceptionData.message` 和 cause 消息
- **AND** 两条 entry 都不得包含 raw stack、宿主路径、provider frame、credential 或调用方复制到替代字段中的异常文本

#### Scenario: 异常投影无法识别自有 frame

- **WHEN** 某 Error 只包含第三方 frame 或不可解析的 stack
- **THEN** 该诊断 MUST 在可用时保留 failureStage、exceptionType 和 fingerprint
- **AND** 它 MUST 省略 exceptionFrames 而不是输出 raw stack

#### Scenario: 诊断 sink 失败只有一个 fallback owner

- **WHEN** 某个业务 component 尝试通过 `getLogger` 输出一条 runtime 诊断而 provider 失败
- **THEN** 业务结果 MUST 保持不变
- **AND** 该 component MUST NOT 用 logging-failure event 再次调用同一 logger
- **AND** transport 降级证据在可用时 MUST 由 operational writer 拥有

### Requirement: Runtime 诊断与 trajectory 日志保持职责分离

Runtime 诊断 SHALL 承载本地编排和 component 状态，例如队列、dispatch、commit 私有失败、恢复、delivery 和 maintenance。它们 MUST NOT 重复 canonical request/model/capability 结果，也不得成为 replay 真相来源。

Observation 派生日志 SHALL 提供默认的安全 request/model/capability/terminal 问题定位骨架，加上成功时的 context、policy、hook、sandbox、first-visible 和 warn/error 子阶段证据。完整的持久 replay SHALL 使用 canonical timeline 和业务持久事实，而不只是 operational 日志。

#### Scenario: 默认日志支持诊断而不声称完整 replay

- **WHEN** 运维人员在 info 级别过滤 `surface=observation_derived`
- **THEN** 安全的 request/model/capability/terminal 骨架 MUST 可用
- **AND** 缺失的 debug 期子阶段成功 MUST NOT 被表示为完整 replay 保证

#### Scenario: 失败的 tool 反馈可追踪而不暴露反馈内容

- **WHEN** 一个 tool 结果返回 `FAILED` 或 `TIMED_OUT`，且 runtime 把安全失败 payload 作为 model 可见的 `CAPABILITY_RESULT` 附加
- **THEN** runtime MUST 输出一条按 run、tool call 和 capability 标识关联的 `tool.failure_feedback.appended` info 诊断
- **AND** 该诊断 MUST 包含状态、安全 error code/category、安全 error 摘要、可重试性和反馈消息 kind
- **AND** 该诊断 MUST NOT 包含反馈消息内容、raw tool result、prompt、model output 或 stream delta
- **AND** 既有的 canonical capability 完成和降级事实 MUST 保持为 lifecycle 真相

#### Scenario: Debug Tool 诊断保留 raw 输入与输出

- **WHEN** 可信 app 配置使用 normal 或 debug 诊断细节，且一次 Tool 调用返回有效结果
- **THEN** runtime 直接诊断 MUST 支持 canonical `toolInput` 和 `toolOutput` 字段，包含实际 Tool 参数和有效 Tool 结果
- **AND** 嵌套在这些字段下的 prompt、路径、命令、结果内容、credential 引用/状态、usage token 计数、token 计数/长度和 tokenization 诊断 MUST 保持不变，除非容量上限截断或替换该 entry
- **AND** credential 值、独立 token 值、认证 token 变体、显式 credential/token 值字段以及高置信度的内联 `Bearer` 或 `sk-` 值 MUST 被脱敏
- **AND** 脱敏规则 MUST NOT 仅因字段名包含子串 `credential` 或 `token` 就把该字段归类为 secret
- **AND** 成功或降级的有效结果 MUST 输出一条 info 级 `tool.payload.captured` runtime 诊断，使 payload 在常规 operational 级别保持可用
- **AND** Tool loop 和 app 组合 MUST NOT 要求或暴露 raw Tool payload 日志开关
- **AND** 该诊断 MUST 保持为本地 operational 证据，MUST NOT 创建或丰富 observation、audit、metric、trace、stream、timeline、SafeError 或公共 DTO payload
- **AND** canonical capability 完成 MUST 保持为 lifecycle 真相

### Requirement: 不可信 parser 诊断使用稳定的纯代码 operational 证据

从用户、runtime 生成或第三方 Skill manifest 派生的诊断 SHALL 被当作不可信内容。Builtin 和本地 Skill 发现 MUST 只记录稳定的 parser reason-code 列表、其数量、owner 定义的安全结果代码和可信且有界的来源坐标。Parser 诊断消息、原始字段名/值、manifest 路径和文档内容 MUST NOT 进入 operational 日志。同一失败的 readiness 证据 MUST 使用 owner 定义的静态安全消息，而不是复制 parser 诊断。

#### Scenario: 无效 Skill manifest 包含 secret 与路径金丝雀

- **WHEN** Skill 发现拒绝一个 manifest，其 parser 诊断包含文档控制的字段文本、credential 金丝雀或宿主路径
- **THEN** runtime 诊断 MUST 只包含稳定的诊断 reason code 及其数量
- **AND** operational 输出和 readiness 证据 MUST NOT 包含 parser 消息、金丝雀或路径
