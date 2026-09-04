## MODIFIED Requirements

### Requirement: OTel metrics adapter 具有单一 reader 策略和按部署区分的 exporters

统一的 MetricsRegistry 和 OpenTelemetry Meter adapter MUST 继续复用 agent-runtime-metrics 冻结的单一 MetricDescriptor inventory、label 白名单、有界的近期事实 dedup 语义和 SurfaceProjectionResult 行为。Descriptor 的 kind/unit/labels/source MUST 创建每个 NextAgent 自有的业务 OTel instrument，且所有此类秒数 histograms MUST 使用冻结的显式边界向量。生产 registry composition MUST 是纯流式的，MUST NOT 保留/重放原始 samples；测试 composition MAY 显式注入仅用于测试的内存 registry/exporter。Metrics MUST NOT 被实现为 operational log 条目，输出选择 MUST NOT 引入 `metric_diagnostic` 或复用 StructuredLogEntry。

官方 `@opentelemetry/instrumentation-http` 的 server instruments SHALL 是 descriptor 自有 instrument 创建的唯一窄例外。它们 MUST 注册到这同一个 MeterProvider，使用 stable HTTP semantic conventions 及其包自有的 `http.server.request.duration` instrument 定义，MUST NOT 被复制到平行的 NextAgent descriptor 或 adapter 中。SDK 管道 MUST NOT 导出已被移除的 `web_request_total` 或 `web_request_duration_seconds` instruments。

`agent-observability` SHALL 拥有 MeterProvider、PeriodicExportingMetricReader 和有界的 force-flush/shutdown 生命周期。reader SHALL 使用 60 秒导出间隔、10 秒导出超时、cumulative temporality、显式 bucket histograms 和每个 instrument 200 的 cardinality 上限。产品部署 profiles SHALL 为：

- test：注入内存 exporter；
- LOCAL：`LocalMetricHistoryExporter` 向一个有界的每日 NDJSON 文件族追加 cumulative snapshots；
- REMOTE/PaaS：注入官方 OTLP metric exporter，写到平台 collector/服务。

`agent-app` SHALL 在受信配置冻结之后创建共享 SDK 管道。LOCAL 产品 composition SHALL 从 `paths.logDirectory` 创建 `LocalMetricHistoryExporter`；REMOTE 产品 composition SHALL 消费受信入口注入的 `PushMetricExporter`；测试 composition SHALL 显式使用内存 exporter。没有注入 exporter 的 REMOTE SHALL 暴露 metrics 降级，且 MUST NOT 选择 LOCAL exporter。

#### Scenario: OTel meter adapter 保持 metric 策略

- **WHEN** MetricsProjector 通过 MetricsRegistry 和 OTel Meter adapter 写入
- **THEN** 非法 labels/值和重复 samples MUST 保持既有结果
- **AND** request/run/session/tenant/subject/agent/path/host/trace/span ids MUST NOT 成为 metric labels 或导出的 resource 身份

#### Scenario: Exporter 选择不改变采集

- **WHEN** composition 选择 test、LOCAL 文件或 REMOTE/PaaS OTLP 输出
- **THEN** MetricsProjector 输入、inventory、labels、dedup 和 OTel instruments MUST 保持不变
- **AND** 业务包 MUST 对 exporter 类型保持无感知

#### Scenario: SDK composition 使用 descriptor 自有的 instruments

- **WHEN** app composition 创建 counters 和 histograms
- **THEN** 名称、kind、unit 和允许的 labels MUST 来自同一个 MetricDescriptor inventory
- **AND** 时长 histograms MUST 使用冻结的显式 buckets
- **AND** 依赖升级后 SDK 默认值 MUST NOT 静默改变聚合边界

#### Scenario: SDK composition 注册标准 HTTP server metrics

- **WHEN** agent-observability 创建产品 MeterProvider
- **THEN** 它 MUST 以 stable semantic conventions 和禁用的 outgoing instrumentation 将官方 HTTP instrumentation 绑定到该 provider
- **AND** 得到的 `http.server.request.duration` MUST 流经同一 reader、resource 和按部署选择的 exporter
- **AND** 不得创建第二个 provider 或遗留的自定义 HTTP instrument

### Requirement: 本地 metric exporter 向老化中的每日历史追加有界的 cumulative snapshots

LOCAL 部署 SHALL 导出到 metrics 自有的文件族 `<paths.logDirectory>/nextagent-metrics.<YYYY-MM-DD>.<sequence>.ndjson`。每次成功的 60 秒采集 SHALL 恰好追加一行 `NextAgentMetricSnapshotV1` JSON，代表完整的 cumulative ResourceMetrics 采集。该历史 MUST 包含周期性聚合 snapshots，而不是原始 MetricSample 事件。

snapshot SHALL 包含：

- `schemaVersion: 1` 和 ISO 的 `exportedAt`；
- 低基数的 `resource` 字段，仅限于 service name、service version 和 deployment mode；
- NextAgent descriptor 自有的 metrics 加上官方 `http.server.request.duration`，各自带有稳定的名称、kind、unit、cumulative temporality 和聚合数据点；
- 每个数据点允许的 labels、start/end 时间和 counter 值或有界的显式 bucket histogram 值。

它 MUST 省略 exemplars 以及 tenant/subject/agent/session/request/run/message/capability/task/trace/span/path/host/credential/token/content 字段。Metric 和数据点排序对本地检查和测试 SHOULD 是确定性的。

exporter SHALL 在入队之前在内存中序列化完整的行。其 UTF-8 序列化字节数（含换行分隔符）MUST NOT 超过 4 MiB。metrics 目标位置 SHALL 使用实现自有的 8 MiB 异步缓冲；入队 MUST NOT 等待排空或增大缓冲。超尺寸、饱和或写入失败 MUST 使该次导出失败，不提交不完整的行，也不改变业务行为。

`LocalMetricHistoryExporter` SHALL 直接拥有其规范化/schema、metrics 策略、writer 缓冲策略、single-flight 和导出失败映射。它 SHALL 为目标位置、派生的精确 selector、轮转、gzip 对账、retention 和 close 创建一个独立的 `agent-local-file-roll` handle。该文件族 SHALL 使用基础名 `nextagent-metrics.ndjson`、`dateFormat=yyyy-MM-dd`、固定的 `frequency=daily`、固定的 `size=30m`、通过 `.gz.tmp` 加原子重命名对已关闭 segments 做 gzip、startup 对账、基于 closedAt 的 7 天 retention 和至多 10 个已提交 gzip archives。每日轮转和 `YYYY-MM-DD` SHALL 使用为进程生命周期固定的 Node.js 进程本地时区；retention SHALL 使用从 `closedAt` 起经过的 `7 * 24h`，包括跨 DST 切换。Archive 数量清理 SHALL 独立地先按 `mtime` 再按文件名删除最旧的完全自有 archive。物理的扩展名置尾模式 SHALL 为 `nextagent-metrics.<YYYY-MM-DD>.<sequence>.ndjson[.gz]`。一天内的多次采集 MUST 复用活跃 segment，除非发生尺寸轮转；禁止每次采集一个文件。

Operational、metrics 和 LOCAL audit 文件 owner SHALL 只共享 `agent-local-file-roll` factory/机制代码，并 MUST 创建各自独立的 handles。它们 MUST NOT 共享目标位置、活跃身份、缓冲、timer、维护 lane、可变状态、close 状态或 policy 对象。派生 selectors MUST 相互互斥：operational 维护 MUST 忽略每一个 metrics/audit 的活跃/源/archive/临时文件，`LocalMetricHistoryExporter` 维护 MUST 忽略 operational、audit、developer-trace、symlink、未知和目录外文件，LOCAL audit gateway 同样 MUST 忽略 operational 和 metrics 文件。并发的导出尝试 MUST 是 single-flight 或被合并。到 degraded 或 recovered 的状态迁移 MAY 产生一条安全的组件诊断；成功的周期性导出和单个 samples MUST NOT 产生 operational logs。

#### Scenario: 第一次本地导出追加一个 snapshot

- **WHEN** LOCAL 模式下第一次周期性采集成功
- **THEN** 活跃的 metrics `.ndjson` segment MUST 包含一行有效的 `NextAgentMetricSnapshotV1`
- **AND** 它 MUST 包含聚合的 OTel 数据点，而不是原始的按操作 samples

#### Scenario: 本地追加安全失败

- **WHEN** 序列化、入队、写入或轮转失败
- **THEN** exporter MUST 报告导出失败而不向业务路径抛出异常
- **AND** 之前完整的行和 archives MUST 保持可读
- **AND** 不得提交任何不完整的 snapshot 行

#### Scenario: 本地历史轮转和老化

- **WHEN** 活跃 metrics segment 达到 30 MiB、跨过日界或提交第十一个 gzip archive
- **THEN** exporter 拥有的目标位置 MUST 在不阻塞业务路径的情况下选择新的活跃 sequence
- **AND** 已关闭的 segment MUST 被 gzip 归档并保留 7 天
- **AND** startup 对账 MUST 在停机后完成符合条件的 archive/老化工作
- **AND** 成功的维护 MUST 留下不超过 10 个已提交的 metrics gzip archives

#### Scenario: 本地 metric 文件跨过时区边界

- **WHEN** 受控的进程本地日历跨过午夜，包括夏令时切换
- **THEN** 活跃的 metrics segment MUST 轮转并使用新的本地 `YYYY-MM-DD`
- **AND** archive 过期 MUST 仍基于从 `closedAt` 起的经过时长

#### Scenario: Operational 维护遇到 metrics 文件

- **WHEN** operational 的 archive/retention 维护扫描 `paths.logDirectory`
- **THEN** 它 MUST 忽略所有 `nextagent-metrics.<date>.<sequence>.ndjson[.gz][.tmp]` 文件族成员
- **AND** metrics exporter MUST 绝不修改 operational、audit 或 developer-trace 文件

### Requirement: PaaS metrics 使用官方 OTLP exporter 且无本地回退

REMOTE/PaaS 部署入口 SHALL 创建并注入 `@opentelemetry/exporter-metrics-otlp-proto`。远程包 SHALL 按标准信号特定/通用优先级 `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` 再 `OTEL_EXPORTER_OTLP_ENDPOINT` 解析 endpoint；可选的 headers、compression 和 timeout SHALL 遵循相应的 OTel 环境变量优先级。缺少显式 PaaS endpoint SHALL 使 metrics readiness 降级，而不是静默使用 localhost 默认值。原始 endpoint/header 值 MUST NOT 进入 startup proof、logs、metrics 或 safe errors。

远程包 SHALL 构造一个白名单 Resource，只包含 service name、service version 和 deployment mode；它 MUST NOT 将任意 `OTEL_RESOURCE_ATTRIBUTES` 透传到导出的 metrics。`agent-app` 核心 MUST NOT 导入具体的 OTLP 包或读取 exporter endpoint/credential 值。

REMOTE/PaaS composition MUST NOT 创建 `nextagent-metrics.*` 文件族、暴露 Prometheus endpoint，或在 OTLP 不可用时回退到 RuntimeLogger/文件输出。本 change 拥有 exporter 组合和生命周期证据，但不部署、配置或运维外部 OpenTelemetry Collector/服务。

#### Scenario: 远程部署通过 OTLP 导出

- **WHEN** 远程入口提供一个有效的 OTLP metric exporter
- **THEN** 共享的 periodic reader MUST 将同样的 metric instruments 发送给该 exporter
- **AND** 包证据 MUST 标识 OTLP 被选中，而不暴露 endpoint 或 credential 值

#### Scenario: 远程 endpoint 缺失

- **WHEN** REMOTE/PaaS startup 时既不存在信号特定也不存在通用的 OTLP endpoint
- **THEN** metrics readiness MUST 以一条有界的安全原因降级
- **AND** 该 exporter MUST NOT 静默指向 SDK 的 localhost 默认值
- **AND** app 的业务 readiness 和行为 MUST 保持不变

#### Scenario: OTLP 导出失败

- **WHEN** OTLP endpoint 不可用或导出超时
- **THEN** metrics readiness MUST 变为有界降级
- **AND** 不得创建任何本地 metrics 文件或按 sample 的 operational log 回退
- **AND** 之前的业务结果 MUST 保持不变

### Requirement: OTel adapter 生命周期有界且独立

MetricReader/exporter 的 collect、enqueue、轮转、gzip、retention、force-flush 和 shutdown 操作 MUST 由 observability/基础设施 composition 拥有，并 MUST 具有有界的超时行为。它们 MUST NOT 被 request/model/capability 业务路径等待。在受信配置冻结之后，operational writer 和部署 audit 基础设施 SHALL 在 MeterProvider/reader/exporter 之前启动，metrics 管道 SHALL 在 projectors/业务生产者之前启动。在 app shutdown 期间，所有生产者和 projector host SHALL 停止/排空，audit gateway SHALL 在 metrics 终结之前被有界关闭；metrics force-flush/provider-reader-exporter shutdown 和 `LocalMetricHistoryExporter` 文件生命周期 close SHALL 在最终 app shutdown 诊断和 operational writer 关闭之前完成或超时。Operational writer SHALL 是最后一个被关闭的常规输出域。本地文件生命周期失败 MUST 保留可恢复的源文件/archive 证据，且 MAY 只降低其拥有的输出 readiness。

每个 producer、audit、metrics 和 operational finalizer SHALL 从独立的故障隔离边界运行。较早的 audit/生产者关闭失败 MUST NOT 跳过 metrics shutdown 或 operational flush/close，audit/metrics 的降级迁移 MAY 在 operational 关闭之前使用仍然打开的组件 RuntimeLogger，但不包含 payload。

#### Scenario: Metric flush 超时

- **WHEN** 本地历史或 PaaS OTLP exporter 在 shutdown 期间无法 flush
- **THEN** shutdown 处理 MUST 保持有界
- **AND** 该失败 MUST NOT 触发同步的文件/log 回退或改变之前的业务结果

#### Scenario: Metrics 终结先于 operational 关闭

- **WHEN** app shutdown 到达 observability 终结阶段
- **THEN** metrics force-flush/shutdown 和 `LocalMetricHistoryExporter` 文件生命周期 close MUST 先在有界超时内被尝试
- **AND** operational writer MUST 保持可用以供一次有界的 metrics 降级迁移
- **AND** 即使 metrics 终结失败，operational flush/close MUST 最后运行
