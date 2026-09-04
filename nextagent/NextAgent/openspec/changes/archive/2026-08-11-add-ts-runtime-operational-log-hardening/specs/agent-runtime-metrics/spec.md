## MODIFIED Requirements

### Requirement: Metric 领域对象使用唯一 inventory 和唯一 OTel instrument 路径

MetricDescriptor SHALL 定义每个 NextAgent 自有业务 metric 的名称、类型、单位、允许的 labels、取值来源和采集来源。一个不可变的 descriptor inventory MUST 是这些业务 metric label 校验、sample kind/unit 和 OTel instrument 创建的唯一来源；禁止平行的 `metricPolicies`/instrument 定义表。单位策略 SHALL 为：每个 NextAgent 自有的 `*_duration_seconds`、`model_ttft_seconds` 和 `model_chunk_latency_seconds` histogram 使用 `s`；`model_token_usage_total` 使用 `{token}`；其余每个业务 counter 使用 `1`。每个 NextAgent 自有的秒数 histogram SHALL 使用显式边界 `[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300]`。官方 instrumentation 自有的 instrument 按下文规定使用其 OpenTelemetry 包定义，MUST NOT 被重复纳入该 inventory。

MetricSample SHALL 包含名称、类型、有限非负值、允许的 labels、occurredAt 和可选的 dedup key。生产 MetricsRegistry SHALL 保持为 `agent-observability` 实现内部的流式投影抽象：它 MUST 通过 descriptor inventory 校验并将批准的值同步记录到预先创建的 OTel instruments，但 MUST NOT 保留无界或可重放的原始 `MetricSample[]`、暴露生产 sample 历史，或通过重放既有 samples 追加迟到的 sink。仅用于测试的 `InMemoryMetricsRegistry` MAY 在被显式注入测试 composition 时暴露 `snapshot()`；产品 LOCAL/REMOTE composition MUST NOT 选择它。

MetricsProjector 的来源优先级 dedup SHALL 是有界的近期事实保护，而不是持久幂等。它 SHALL 使用一个实现自有的 FIFO 集合，以 `16_384` 个稳定 dedup key 为上限，容量满时先淘汰最旧的 key 再接受新 key。同一事实的首选与 fallback observations MUST 在该窗口内竞争。该集合 MUST NOT 随进程生命周期超过上限增长，且其淘汰行为在测试下 MUST 是确定性的。

Metrics 输出 MUST NOT 使用 RuntimeLogger、绑定 observation 的 operational logger 或 operational writer。`createLocalMetricsLogSink` 和 `surface=metric_diagnostic` MUST NOT 留在产品/包 composition 中。MetricsRegistry SHALL 通过既有 Meter adapter 将其批准的 samples 附加到 OpenTelemetry instruments；LOCAL、REMOTE/PaaS 和测试模式 MUST 复用这些 instruments，仅在 MetricReader/exporter composition 上不同。

MetricProjectionResult SHALL 保持为 `emitted`、`skipped_not_covered`、`skipped_policy_denied`、`degraded` 或 `failed_closed`。

#### Scenario: Metrics 不进入 operational log

- **WHEN** MetricsProjector 在产品、包或测试 composition 中产出 samples
- **THEN** samples MUST 只通过 MetricsRegistry 和 OTel Meter adapter 记录
- **AND** 任何 sample MUST NOT 通过 RuntimeLogger 或 operational writer 序列化
- **AND** operational console/file/archive MUST NOT 包含 `metric_diagnostic` 或 metric payload

#### Scenario: 部署只改变 exporter

- **WHEN** composition 从测试切换到 LOCAL 或 REMOTE/PaaS 部署
- **THEN** MetricsProjector 输入、MetricsRegistry 策略和 OTel instruments MUST 保持不变
- **AND** 只有 periodic MetricReader 背后的 exporter 可以改变

#### Scenario: 生产 registry 不保留原始 samples

- **WHEN** LOCAL 或 REMOTE 产品 composition 记录超过一个导出间隔的 metric observations
- **THEN** 批准的值 MUST 直接记录到 OTel instruments
- **AND** 生产 registry MUST NOT 累积原始 samples 或将其重放到迟到的 sink
- **AND** 趋势历史 MUST 只来自周期性聚合导出

#### Scenario: 测试需要断言原始 samples

- **WHEN** 某个测试需要检查单个投影后的 samples
- **THEN** 测试 composition MUST 显式注入 `InMemoryMetricsRegistry`
- **AND** 该 fixture MUST NOT 成为 LOCAL 或 REMOTE 默认值

#### Scenario: 近期事实 dedup 达到容量上限

- **WHEN** projector 接受超过 16,384 个不同的稳定 dedup key
- **THEN** 在插入最新 key 之前 MUST 先淘汰最旧的 key
- **AND** dedup 内存 MUST 保持有界
- **AND** 该近期事实机制 MUST NOT 被表述为持久 exactly-once 记账

#### Scenario: Descriptor 创建时长 histogram

- **WHEN** OTel adapter 创建任意以秒计的时长 instrument
- **THEN** kind、unit、labels 和采集元数据 MUST 来自单一 descriptor
- **AND** MUST 应用冻结的秒数 bucket 向量，而不是依赖 SDK 版本的默认值

### Requirement: Metrics 部署使用 periodic reader 配本地文件或 PaaS OTLP exporter

产品 composition SHALL 使用一个 OpenTelemetry MeterProvider 和一个 PeriodicExportingMetricReader，带有实现自有的 `exportIntervalMillis=60_000`、`exportTimeoutMillis=10_000`、cumulative temporality、显式 bucket histogram 聚合和每个 instrument 200 的 cardinality 上限。

LOCAL 部署 SHALL 为该 reader 配对 `LocalMetricHistoryExporter`，后者在每次成功采集后向 metrics 自有的文件族 `<paths.logDirectory>/nextagent-metrics.<YYYY-MM-DD>.<sequence>.ndjson` 追加一行有界的 `NextAgentMetricSnapshotV1` JSON。`LocalMetricHistoryExporter` SHALL 直接拥有该文件族的 schema、策略、single-flight 和导出结果映射，并 SHALL 为目标位置、rotation、gzip 对账、retention 和 close 创建一个独立的 `agent-local-file-roll` handle。它 MUST NOT 使用 operational 的 `agent-log` writer 或 handle。该文件族 SHALL 在 30 MiB 或固定的进程本地日界轮转，`YYYY-MM-DD` 使用同一进程本地日期，对已关闭的 segments 做 gzip，从 closedAt 起保留 7 个自然天，并最多保留 10 个已提交的 gzip archives。经过时长 retention 和 archive 数量 SHALL 是相互独立的删除条件。REMOTE/PaaS 部署 SHALL 将同一 reader 策略与由远程部署入口注入的官方 OTLP metric exporter 配对。测试 composition MAY 使用内存 exporter。REMOTE/PaaS MUST NOT 创建或回退到本地 metrics 文件。

#### Scenario: LOCAL 部署无需 Prometheus 即可暴露 metrics

- **WHEN** 某个 LOCAL app 达到第一次成功的周期性 metric 导出
- **THEN** 当日活跃的 metrics NDJSON segment MUST 包含一行完整的 cumulative metrics snapshot
- **AND** 不要求任何 Prometheus server、scrape endpoint 或 collector 进程

#### Scenario: LOCAL 部署保留有界趋势

- **WHEN** 多次成功的 60 秒采集跨越日界或 30 MiB 轮转边界发生，或提交第十一个 gzip archive
- **THEN** 每次采集 MUST 保持为当前或已关闭 metrics 文件族中一行有序的 snapshot
- **AND** 已关闭的 segments MUST 被 gzip 归档并在 7 天后老化删除
- **AND** 一次采集 MUST NOT 新建一个 metrics 文件
- **AND** 成功的维护 MUST 留下不超过 10 个已提交的 metrics gzip archives

#### Scenario: PaaS 部署使用 OTLP

- **WHEN** 部署模式为 REMOTE 且远程入口注入其配置的 OTLP metric exporter
- **THEN** periodic reader MUST 导出到平台 OTLP endpoint
- **AND** 不得创建任何本地 metrics 文件或 operational-log 回退

### Requirement: Metrics 不进入核心 contracts

Metric descriptors、samples、registry、MeterProvider、MetricReader、exporter 和 label 分类 SHALL 保持在 agent-contracts 和业务包 public contracts 之外。runtime/core/model/capability/gateway/channel MUST NOT 直接调用 exporter。一个受信的 `agent-app` 基础设施 composition 选项 MAY 为 REMOTE 部署接受一个 `PushMetricExporter`，但该类型 MUST 保持在 agent-contracts 和业务 owner 之外。`agent-app` 核心 MUST NOT 导入具体的 OTLP exporter 包；具体 exporter 由远程部署入口拥有，并解析标准 OTel endpoint/header/compression 环境变量。原始 exporter 配置 MUST NOT 进入核心 config、startup proof、log 或 metric 字段。

#### Scenario: 业务包保持与 exporter 无关

- **WHEN** metric 部署从 LOCAL 历史文件切换到 PaaS OTLP
- **THEN** 业务包 contracts 和 observation 采集 MUST 保持不变
- **AND** request/model/capability 输入 MUST NOT 选择或配置 exporter

### Requirement: Metrics sink/输出保持 inventory 与 label 策略

MetricsRegistry 和 OTel adapter MUST 在各种输出配置下保持 metric 名称、允许的 labels、非法值处理、dedup key 和 SurfaceProjectionResult 行为。任何输出 adapter 都不得把 request/run/session/tenant/subject/agent/path/host/trace/span 标识符添加为 metric label 或 resource 字段。

#### Scenario: OTel 输出不改变 metric 策略

- **WHEN** samples 通过 OTel Meter adapter 记录
- **THEN** inventory、labels、dedup 和 degraded 结果 MUST 与既有 registry contract 一致
- **AND** exporter 可用性 MUST NOT 改变业务行为

#### Scenario: 产品 metric 内存在导出之间保持有界

- **WHEN** observations 在任意长的进程生命周期内持续发生
- **THEN** registry MUST NOT 保留原始 sample 历史
- **AND** projector dedup MUST 保持以 16,384 个 key 为上限
- **AND** OTel SDK 的 aggregation/cardinality 策略和 exporter 缓冲 MUST 仍是产品 metric 仅有的累积机制

### Requirement: Metric 输出失败不影响业务结果

MeterProvider、MetricReader 或 exporter 不可用，序列化/入队/写入/rotation/压缩/retention 失败，OTLP 超时，force-flush 或 shutdown 失败，都 MUST NOT 改变 request lifecycle、terminal、model、capability、gateway 或 health 结果。Metric 失败 MAY 更新有界的 observability 降级状态，但 MUST NOT 按 sample 回退到 operational log。

对于 LOCAL 导出失败，已提交的完整 NDJSON 行和 archives MUST 保持可读；超尺寸或被丢弃的采集 MUST NOT 被写成不完整的行。对于 REMOTE/PaaS 导出失败，不得创建本地文件回退。两种情况下 metrics readiness MAY 降级，同时业务 readiness 和行为保持不变。组件 runtime logger MAY 只发出有界的 `metrics.export.degraded/recovered` 状态迁移诊断，绝不按 sample、snapshot 或 retry 逐条记录日志。

#### Scenario: 本地 metrics snapshot 无法追加

- **WHEN** snapshot 序列化超过 4 MiB、8 MiB 异步缓冲已满，或入队/写入/rotation 失败
- **THEN** 不得提交任何不完整的 snapshot 行
- **AND** 之前完整的行和 archives MUST 保持可读
- **AND** metric 记录和业务行为 MUST 继续

#### Scenario: PaaS OTLP exporter 不可用

- **WHEN** 配置的 OTLP exporter 失败或超时
- **THEN** metrics readiness MUST 暴露一个有界的降级结果
- **AND** 业务行为 MUST 保持不变
- **AND** samples MUST NOT 作为回退被镜像到本地文件或 operational logs

## ADDED Requirements

### Requirement: HTTP server metrics 使用官方 OpenTelemetry HTTP instrumentation

HTTP server request 测量 SHALL 由注册到与 NextAgent 业务 metrics 相同产品 MeterProvider 和 PeriodicExportingMetricReader 的 `@opentelemetry/instrumentation-http` 拥有。该 instrumentation SHALL 启用 stable HTTP semantic conventions，并以秒为单位发出 `http.server.request.duration`，附带 OpenTelemetry 推荐的显式 bucket advice。其 cumulative histogram 的 point 计数 SHALL 即为请求数；MUST NOT 创建平行的请求 counter。Incoming/server instrumentation SHALL 启用，outgoing/client instrumentation SHALL 禁用，且 incoming span 创建 SHALL 要求存在 parent，使 HTTP 测量不会为无 parent 的 HTTP trace 增加平行 owner。

遗留的 NextAgent 自有 `web_request_total`、`web_request_duration_seconds`、`recordWebRequestMetrics`、HTTP observation 到 sample 的回退和 Fastify `onResponse` metric hook MUST 被移除。官方 instrumentation 自有的 HTTP instruments 是 NextAgent 业务 `MetricDescriptor` inventory 的一个窄例外：其名称、单位、bucket advice 和 attributes SHALL 来自已安装的 OpenTelemetry instrumentation 和 semantic-conventions 包，而不是来自重复的产品 descriptor。它们仍 MUST 使用共享的 MeterProvider、exporter、resource、cumulative temporality 和有界生命周期。

HTTP metric attributes MUST 遵循 stable OpenTelemetry semantic conventions，且 MUST NOT 包含原始 URL、query、headers、credential/token、client request id、tenant/subject/agent/session/request/run/message/trace/span 标识符或其他 NextAgent 高基数关联信息。当 Node HTTP 边界无法获得已校验的框架 route 模板时，`http.route` MAY 缺失；实现 MUST NOT 用原始 path 或 target 代替。

#### Scenario: HTTP request 只被测量一次

- **WHEN** Fastify 完成一个已匹配、未匹配、校验失败或 handler 失败的 HTTP server request
- **THEN** 官方 HTTP instrumentation MUST 恰好向 `http.server.request.duration` 添加一条 observation
- **AND** 该 request MUST NOT 增加 `web_request_total` 或 `web_request_duration_seconds`
- **AND** histogram 计数 MUST 在没有平行 counter 的情况下提供累计请求数

#### Scenario: HTTP metric 在未匹配 route 时保持安全

- **WHEN** 某个 incoming request 包含动态 path 数据、query 值、credential、headers 或伪造的 client request id
- **THEN** 导出的 HTTP metric attributes 中不得出现任何原始 target 或 client 控制的关联值
- **AND** 已校验 `http.route` 的缺失 MUST 保持为缺失，而不是回退到原始请求 path

#### Scenario: HTTP instrumentation 共享产品 SDK 生命周期

- **WHEN** 产品 composition 创建或关闭 metrics 基础设施
- **THEN** HTTP instrumentation MUST 使用该基础设施的 MeterProvider 和 exporter
- **AND** app server MUST 在 provider shutdown 之前停止接受 requests，使后续 requests 无法写入已关闭的 pipeline
- **AND** 注册 HTTP metrics MUST NOT 创建第二个 MeterProvider、reader 或 exporter
