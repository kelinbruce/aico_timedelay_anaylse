## ADDED Requirements

### Requirement: 本地 runtime 包通过单一尺寸或日界文件族保留 operational logs

Backend-only 和 with-frontend profiles SHALL 使用逻辑基础名 `logs/nextagent-operational.log.jsonl`。pino-roll SHALL 创建相应的带编号 `.jsonl` 文件族，并在达到 30 MiB 或固定的进程本地午夜日界之一时轮转。Runtime diagnostic 和 observation 派生条目 MUST 共享该文件族，并保持可通过 `surface` 区分。

AuditEvent MUST 流经 `agent-contracts/gateway` 拥有的只写 AuditEventStoreGateway，到达独立的 `logs/nextagent-audit.<YYYY-MM-DD>.<sequence>.ndjson[.gz]` 文件族，且 MUST NOT 出现在 operational logs 或 SQLite 中。MetricSample MUST 保持在 metrics 管道中，MUST NOT 出现在 operational console、活跃文件或 archives 中；OTel periodic exporter SHALL 将 cumulative 聚合追加到独立的 `logs/nextagent-metrics.<YYYY-MM-DD>.<sequence>.ndjson[.gz]` 文件族。该包 MUST NOT 创建遗留的 `nextagent-runtime.log`、`nextagent-observability.log`、无版本的 logger 镜像 `nextagent-audit.log` 或 `audit_events` SQLite 表。

#### Scenario: 包写入一个 operational 文件族

- **WHEN** 本地包以内置默认值启动
- **THEN** 非 audit 的 operational logs MUST 使用带编号的 `nextagent-operational.log.<sequence>.jsonl` 文件族
- **AND** 恰好一个 segment MUST 由 transport 拥有并处于活跃状态
- **AND** audit/metrics MUST 使用其独立的输出 contracts
- **AND** audit/metrics MUST 使用各自的活跃目标位置和精确所有权 selectors
- **AND** operational-log 维护 MUST NOT 发现、压缩或老化 audit 文件

### Requirement: 本地 runtime 包将 audit 写入独立文件 gateway

Backend-only 和 with-frontend 的 LOCAL profiles SHALL 从 `agent-platform-gateway-local` 选择顶层 `GatewayBindings.audit`。该 gateway SHALL 向活跃的 `logs/nextagent-audit.<YYYY-MM-DD>.<sequence>.ndjson` segment 追加一行带版本的完整 AuditEventRecord。它 SHALL 在固定的 30 MiB 或进程本地日界轮转，原子地 gzip 已关闭 segments，从原始 `closedAt` 起经过固定 7 个自然天后老化其自有的已关闭源文件/archive，并最多保留 10 个已提交 gzip archives。它 MUST NOT 创建/查询 SQLite audit 存储、通过 RuntimeLogger 镜像 audit，或复用 operational/metrics writer 或 handle；它 SHALL 使用自己的 audit 策略和独立的 `agent-local-file-roll` handle。

Audit retention SHALL 为实现自有且不可配置。Startup 对账和每小时的 audit 维护 SHALL 只删除已过期且被精确选中的 audit 已关闭源文件/archive 文件；它们 MUST 保留活跃、年轻、symlink、未知、外部和其他文件族的文件。目标 audit 窗口上限 SHALL 为一个每日活跃周期加 7 个自然天的已关闭 retention 加一个每小时维护间隔。Audit 重试 MAY 产生带有相同受信带 scope auditId 的重复完整行；该包 MUST NOT 构建隐藏的 SQLite/索引 sidecar 来声称 exactly-once。

#### Scenario: 本地包追加 audit 证据

- **WHEN** 一个有代表性的 audit observation 被投影
- **THEN** 活跃的 audit NDJSON segment MUST 包含一条完整的带版本 AuditEventRecord 条目
- **AND** operational/metrics 输出或任何 SQLite 表中都不得出现 audit 副本
- **AND** 追加降级时包的业务结果 MUST 保持不变

#### Scenario: 本地包轮转一个 audit segment

- **WHEN** audit segment 达到 30 MiB、跨过本地午夜或提交第十一个 gzip archive
- **THEN** 本地 audit gateway MUST 在新的 sequence 上继续
- **AND** 已关闭的源文件 MUST 被原子地 gzip 归档
- **AND** audit 维护 MUST 保留已提交的 archive 直到其原始 closedAt 达到 7 个自然天，然后在下一次每小时运行中删除它
- **AND** 成功的维护 MUST 保持不超过 10 个已提交的 audit gzip archives

### Requirement: 本地 runtime 包保留七天的周期性 metrics 历史

Backend-only 和 with-frontend 的 LOCAL profiles SHALL 将共享的 OTel MeterProvider 和 PeriodicExportingMetricReader 与 `LocalMetricHistoryExporter` 组合。每次成功的 60 秒采集 SHALL 向活跃的 `logs/nextagent-metrics.<YYYY-MM-DD>.<sequence>.ndjson` segment 追加一行完整的 `NextAgentMetricSnapshotV1` cumulative JSON。测试/包验证 MAY 触发 `forceFlush` 而不是等待真实间隔。

metrics 文件族 SHALL 使用固定的 30 MiB 或进程本地日界轮转，`YYYY-MM-DD` 使用同一进程本地日期，对已关闭 segments 做 gzip，应用基于 closedAt 的 7 个自然天 retention，并最多保留 10 个已提交 gzip archives。经过时长 retention 和数量清理 SHALL 是相互独立的删除条件。它 SHALL 与 operational 文件族保持物理和逻辑分离：`agent-log` SHALL 拥有 operational schema/策略及其 roll handle，而 `LocalMetricHistoryExporter` SHALL 独立拥有 metrics schema/策略和另一个 roll handle。它们 MAY 只共享 `agent-local-file-roll` 机制代码，MUST NOT 共享 runtime 状态或 handles。该包 MUST NOT 启动或要求 Prometheus、追加原始 samples、每分钟创建一个文件，或将 metrics 文件策略暴露为 runtime 用户配置。

#### Scenario: 本地包通过文件暴露 metrics

- **WHEN** 包验证记录有代表性的 counter 和 histogram 数据并强制一次成功导出
- **THEN** 活跃的 metrics NDJSON segment MUST 包含一行带有 cumulative 聚合点的有效数据
- **AND** 它 MUST NOT 包含 operational log 信封字段、原始 MetricSample 历史或被禁止的关联/内容
- **AND** 不得要求任何 Prometheus endpoint

#### Scenario: 本地 metrics 历史保持有界且可按文件查询

- **WHEN** 采集跨越多个间隔、一个日界、30 MiB 阈值或第十一个已提交 gzip archive
- **THEN** 完整的 snapshots MUST 在活跃/已关闭的 metrics 文件族中按顺序保留至少 7 天
- **AND** 已关闭的 segments MUST 是 gzip archives，且单个日期 MAY 有多个带编号的 segments
- **AND** 一次成功的间隔 MUST 追加一行而不是新建一个文件
- **AND** 成功的维护 MUST 保持不超过 10 个已提交的 metrics gzip archives

#### Scenario: Metrics 历史导出失败

- **WHEN** 序列化、入队、写入、轮转、gzip 或 retention 失败
- **THEN** 已提交的完整 metrics 行和 archives 在存在时 MUST 保持可读
- **AND** 包的业务 readiness 和请求结果 MUST 保持不变

### Requirement: 本地 runtime 包压缩自有的已关闭 segments 并在七天后老化

包默认值 SHALL 禁用 operational console、启用异步 operational 文件 logging，并将 operational 尺寸阈值设为 30 MiB、固定的进程本地午夜日界轮转、retention 7 个自然天和 `maxArchiveFiles=10`。Operational、plugin diagnostic、metrics 和 audit 文件族 SHALL 各自使用 30 MiB 尺寸阈值、为进程生命周期固定的 Node.js 进程本地时区用于日界/文件日期，以及最多 10 个已提交 gzip archives。过期仍基于每个 segment 原始的 `closedAt + retentionDays * 24h`；plugin diagnostic 使用固定 `retentionDays=3`，metrics 和 audit 使用固定 `retentionDays=7`，operational 使用其冻结默认值或有效的已配置值。每个维护 owner MUST 忽略其他文件族，并 MUST NOT 处理活跃、年轻的已关闭源文件、symlink、data/run/config/workspace 或未知文件。

Startup MUST 对账陈旧临时文件、符合条件的已关闭源文件和已过期 archive。运行中的维护 MUST 至少每分钟扫描一次 archive 工作，并至少每小时老化已过期的已关闭源文件/archive。低流量 MUST NOT 让一个 segment 活跃超过其每日轮转周期。

#### Scenario: 包按尺寸轮转

- **WHEN** 活跃 operational 文件在日界之前达到 30 MiB
- **THEN** 它 MUST 轮转并在新 segment 中继续写入
- **AND** 已关闭的源文件 MUST 进入 gzip 维护

#### Scenario: 包对低流量日志按日轮转

- **WHEN** 活跃文件在进程本地午夜日界之前一直低于 30 MiB
- **THEN** 它 MUST 仍然轮转
- **AND** 前一个 segment MUST 变为可 gzip 和 retention

#### Scenario: 包跨过夏令时日界

- **WHEN** 受控的 Node.js 进程本地时区在 23 小时或 25 小时的日历日跨过午夜
- **THEN** operational、metrics 和 audit 文件族 MUST 按该本地日历边界轮转
- **AND** 每个文件日期 MUST 使用同一本地日历
- **AND** 已关闭源文件/archive 的过期 MUST 仍要求经过 7 个完整的 24 小时周期

#### Scenario: 包老化已过期的 archives

- **WHEN** 一个已关闭源文件或 archive 达到 7 天
- **THEN** 运行中的维护 MUST 在下一次每小时运行中删除它
- **AND** 停止期间过期的条目 MUST 由 startup 对账删除

### Requirement: 本地包 logging 失败是非致命的

Operational transport 初始化或 runtime 维护失败 MUST NOT 阻止包业务 readiness 或改变请求结果。该包 MAY 在每次 logging 降级状态迁移时发出一条有界的紧急 stderr 诊断，但 MUST NOT 回退到按条目同步的 stderr/文件输出。

#### Scenario: 包文件 sink 无法初始化

- **WHEN** 配置的 operational 文件 transport 在 startup 期间失败
- **THEN** 包业务 readiness MUST 保持不变
- **AND** 不得发起任何 logger 拥有的 shutdown
- **AND** 一条有界的紧急诊断 MAY 指明 logging 子系统失败，不包含 path 或原始错误

### Requirement: 发布证据暴露全部三个生效的本地文件策略

发布验证 SHALL 暴露 operational 逻辑基础名、带编号 segment 模式、console/file 默认值、异步目标位置、30 MiB 阈值、固定的进程本地日界轮转、gzip 策略、经过时长 retentionDays 和 maxArchiveFiles；顶层只写的 `agent-contracts/gateway` audit 绑定、audit 文件模式/版本/30 MiB/进程本地日界/gzip/至多 10 个/固定 7 天 retention/无 SQLite/重复策略；本地 metrics 文件族模式/schema/60 秒间隔/30 MiB/进程本地日界/gzip/至多 10 个/7 天策略；plugin diagnostic 的 30 MiB/进程本地日界/gzip/至多 10 个/3 天策略；共享的 `agent-local-file-roll` 机制与四个独立 handles/selectors 以及 metric-log 缺席。

#### Scenario: 发布候选证明 logging 分离

- **WHEN** 发布包验证检查一个候选
- **THEN** 它 MUST 验证 operational writer 策略和尺寸/每日 retention 行为
- **AND** 它 MUST 验证 audit 使用独立的 gateway 自有 NDJSON 文件族、固定 7 天老化，且不存在 SQLite audit 表/查询
- **AND** 它 MUST 验证 LOCAL metrics 通过 OTel 文件 exporter 使用滚动的 `nextagent-metrics.*.ndjson[.gz]` 文件族，且未被复制到 operational logs

### Requirement: Runtime 包日志标识已部署的候选

LOCAL 和 REMOTE runtime 包入口 SHALL 从受信候选清单的 version 和 candidateId 推导 operational 和 metric 的 `serviceVersion`。结果 MUST 有界且对 operational 信封和 OTel resource 安全；过长的 candidateId MUST 使用稳定的短 hash。包 startup MUST NOT 让每个候选都报告同一个硬编码的产品版本。

#### Scenario: 两个包候选共享同一产品版本

- **WHEN** 两个候选具有相同的清单 version 但不同的 candidateId 值
- **THEN** 它们推导出的 serviceVersion 值 MUST 不同
- **AND** 每个值在同一候选的重启之间 MUST 保持稳定
- **AND** 不得包含任何宿主 path、build workspace 或 credential

### Requirement: 本地包 CLI 输出显式且有内容边界

Start ready 通知和生成的 self-check 命令 SHALL 是显式的本地 runtime CLI 交互，而不是 operational 诊断。`agent-app` 产品源码 MUST NOT 使用分散的 `console.*`；一个本地 runtime CLI 输出模块 SHALL 拥有直接的 stdout/stderr 写入。ready 通知 MAY 只包含 app 自有的模板加上已校验的展示 host 和 port。失败的 self-check MUST 只发出白名单内的诊断码和固定的包相对证据引用，MUST 捕获校验/布局异常，且 MUST NOT 发出诊断消息、配置值、宿主路径、stack traces 或 credentials。

#### Scenario: Self-check 拒绝包含敏感文本的配置

- **WHEN** 生成的 self-check 命令评估一个非法的包配置，其校验失败包含 credential、path 或任意消息金丝雀
- **THEN** stderr MUST 只包含稳定的诊断码和包相对的 evidence refs
- **AND** 该命令 MUST 以非零退出，不出现原始异常 stack
- **AND** 生成的入口源码和 agent-app 产品 runtime 源码 MUST NOT 使用 `console.*`
