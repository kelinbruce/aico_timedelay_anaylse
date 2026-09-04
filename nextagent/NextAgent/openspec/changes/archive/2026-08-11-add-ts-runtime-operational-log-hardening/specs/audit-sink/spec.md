## ADDED Requirements

### Requirement: Audit 输出使用只写 gateway contract

AuditProjector SHALL 只通过 observability 拥有的 AuditEventWriter 输出 port 发出 AuditEvent。产品 audit 输出 MUST NOT 使用 RuntimeLogger、绑定 observation 的 operational logger、operational writer、metrics exporter 或 operational-log surface。

`AuditEventRecord`、`AuditEventStoreGateway` 和顶层 `GatewayBindings.audit` SHALL 只由权威 agent gateway contract 模块 `agent-contracts/gateway` 拥有并导出；本 change MUST NOT 创建平行的 `agent-gateway` 包，也不得在 observability、app 或部署包中重定义这些 contracts。`AuditEventStoreGateway` SHALL 只暴露 `appendAuditEvent(record): Promise<void>`。`AuditEventRecordQuery`、`listAuditEvents(...)` 和 `SqliteGatewayStoreBindings.audit` SHALL 被移除。产品或测试检查已发出 audit 证据的需要 MUST NOT 在写 port 上保留或重建公开的查询方法。

`agent-app` SHALL 通过显式将 AuditEvent DO 映射到 AuditEventRecord 并调用选定的 `GatewayBindings.audit` 来实现 AuditEventWriter。结构相似性 MUST NOT 取代自有的 DO 到 Record 映射。该 adapter MUST NOT 自己打开文件、访问 SQLite 或调用远程 audit 协议。Gateway 实现包 MUST NOT 导入 observability 的 AuditEvent DO 或 AuditProjector。

#### Scenario: Audit gateway contract 保持在权威 gateway 模块中

- **WHEN** 检查包导出和架构依赖
- **THEN** AuditEventRecord、AuditEventStoreGateway 和顶层 GatewayBindings.audit MUST 从 `agent-contracts/gateway` 导出
- **AND** AuditEventStoreGateway MUST 只暴露 append
- **AND** observability、app 和部署包 MUST NOT 定义平行的 audit gateway contract
- **AND** audit MUST NOT 继续作为 SqliteGatewayStoreBindings 的成员

#### Scenario: 产品代码尝试查询已发出的 audit

- **WHEN** app、runtime、observability 或某个业务包需要 AuditEventRecordQuery 或 listAuditEvents
- **THEN** contract 和架构校验 MUST 拒绝该依赖
- **AND** 测试 MUST 使用注入的 capture gateway 或直接检查测试自有的本地 audit fixture

### Requirement: 本地 audit 追加到独立的 gateway 自有文件族

LOCAL 部署 SHALL 从 `agent-platform-gateway-local` 提供一个 `FileAuditEventStoreGateway`。它 SHALL 只将 audit 证据追加到 `<paths.logDirectory>/nextagent-audit.<YYYY-MM-DD>.<sequence>.ndjson`。每次成功追加 SHALL 产生一行完整的 UTF-8 JSON，带有私有 `schemaVersion=1` 文件信封，其中包含一个完整的 AuditEventRecord。不完整的行 MUST NOT 被报告为已发出。

本地 audit 文件族 SHALL 在其活跃 segment 达到固定的 30 MiB 或固定的 Node.js 进程本地日界时轮转。同一个进程本地日期 SHALL 决定 `YYYY-MM-DD`，包括 23 小时或 25 小时的 DST 日历日。已关闭的 segments SHALL 通过 `.gz.tmp` 加原子重命名做 gzip 归档，之后才删除源文件，已提交的 archive SHALL 保留源文件原始的关闭/轮转时间戳作为 `closedAt`。Startup 对账 SHALL 保守地移除陈旧的临时产物，并重试符合条件的已关闭源文件。audit gateway SHALL 拥有其 schema、audit 策略、追加结果映射，以及一个独立的 `agent-local-file-roll` handle，用于目标位置、派生的精确 selector、维护 lane 和有界 close。它 MUST NOT 复用 `agent-log` 或 `LocalMetricHistoryExporter` 的 writer/handle，foundation MUST NOT 导入 AuditEventRecord 或 audit 词汇。

本地 audit gateway SHALL 从已关闭源文件/archive 文件原始的 `closedAt` 起保留固定的 7 个自然天，并 SHALL 最多保留 10 个已提交的 gzip archives。经过时长 retention 和 archive 数量 SHALL 是相互独立的删除条件；数量清理 SHALL 先按 `mtime` 再按文件名删除最旧的完全自有 archive。它 MUST NOT 从本地午夜计数、archive mtime 重写或文件发现时间推导经过时长。两个策略均为实现自有，MUST NOT 被 app config 或 runtime 输入覆盖。

Operational 和 metrics 的 retention owner MUST 忽略每一个 audit 的活跃/源/archive/临时文件，audit owner MUST 忽略 operational、metrics、developer-trace、symlink、未知和目录外的文件。audit owner MUST 保留其活跃目标位置、年轻文件，以及无法证明所有权或原始 `closedAt` 的有歧义证据。超出本地 7 天窗口的长期合规归档需要独立的部署治理，本 change 不提供。

既有的 SQLite `audit_events` 表/索引、SqliteAuditStore 及相关 schema 所有权 SHALL 被移除。LOCAL startup MUST NOT 创建、读取、迁移、双写或回退到 SQLite audit 存储。遗留的基于 logger 的 LoggingAuditEventWriter 和无版本的 `nextagent-audit.log` 镜像也 SHALL 被移除；带版本的 audit NDJSON 文件族是唯一的 LOCAL audit 输出。

#### Scenario: 本地 audit 发出到自己的文件

- **WHEN** AuditProjector 在 LOCAL composition 中发出一个 AuditEvent
- **THEN** app MUST 将其映射为 AuditEventRecord 并调用本地文件 audit gateway
- **AND** 一行完整的带版本数据 MUST 被追加到活跃的 `nextagent-audit.*.ndjson` segment
- **AND** operational console/文件、metrics 文件和 SQLite 数据库 MUST 不包含 audit 副本

#### Scenario: 本地 audit 独立轮转和压缩

- **WHEN** 活跃 audit segment 达到 30 MiB 或跨过进程本地日界
- **THEN** 本地 audit gateway MUST 在不阻塞业务路径的情况下选择新的活跃 sequence
- **AND** 已关闭的源文件 MUST 被原子地 gzip 归档
- **AND** operational 和 metrics 的维护都不得处理它
- **AND** audit gateway MUST 保留已提交的 archive 直到其原始 closedAt 达到 7 个自然天

#### Scenario: 本地 audit archive 数量超过十个

- **WHEN** audit 文件族在所有 archives 都未满 7 个自然天时提交第十一个 gzip archive
- **THEN** 维护 MUST 删除最旧的完全自有的 audit archive
- **AND** 成功维护后 MUST 留下不超过 10 个已提交的 audit gzip archives

#### Scenario: 本地 audit 只老化其已过期的关闭证据

- **WHEN** 某个自有的已关闭 audit 源文件或 archive 达到 `closedAt + 7 * 24h`
- **THEN** 本地 audit gateway MUST 在下一次每小时运行中删除它，若进程在过期时停止则在 startup 对账中删除
- **AND** 它 MUST 保留活跃目标位置、年轻的 audit 文件、等待保守对账的陈旧临时证据，以及每一个非 audit 或无法证明归属的文件
- **AND** operational 和 metrics owner MUST NOT 代表 audit gateway 删除它

#### Scenario: 本地 audit 在压缩中断后重启

- **WHEN** 进程在 gzip、重命名或源文件删除中断后重启
- **THEN** startup 对账 MUST 保留至少一个完整可恢复的 audit 源文件或已提交 archive
- **AND** 它 MUST NOT 把 `.gz.tmp` 当作已提交的 audit 证据
- **AND** 它 MUST 不修改其他输出文件族

### Requirement: Audit 追加容忍重复而非 exactly-once

AuditEventRecord.auditId 对同一权威事实 SHALL 保持稳定。`appendAuditEvent` SHALL 使用可重试的 at-least-once 投递语义：重试同一受信 record MAY 追加另一行完整数据，gateway MUST NOT 仅为抑制重复而维护 SQLite 或私有的跨重启幂等索引。Audit 消费方 SHALL 使用受信的 tenant/subject/agent scope 加 auditId 作为去重 key。系统 MUST NOT 声称 exactly-once 的 audit 投递。

#### Scenario: 同一 audit event 被重试

- **WHEN** 调用方在一次有歧义的追加结果之后，以相同受信 scope 和 auditId 重试一个 AuditEventRecord
- **THEN** 本地文件 MAY 包含多于一行的相同完整 audit 数据
- **AND** 任何冲突 record 都不得替换或修改既有行
- **AND** 消费方 MUST 能够通过带 scope 的 auditId 识别重复项

### Requirement: 远程 audit 仍属 gateway 关注点且无本地回退

当另行规格化的能力被配置时，`agent-platform-gateway-remote` SHALL 拥有向 PaaS audit 服务上报 AuditEventRecord 的任何 adapter。REMOTE composition MUST NOT 创建本地 audit 文件、写入 SQLite audit 存储或回退到 operational logging。业务包、RuntimeLogger 和 agent-log MUST 对 audit 服务协议保持无感知。

#### Scenario: 配置了 PaaS audit gateway

- **WHEN** 某个 PaaS 部署提供 audit 服务 adapter
- **THEN** AuditEventWriter MUST 通过选定的 GatewayBindings.audit 追加
- **AND** 不得创建任何本地 audit/log/metrics/SQLite 回退

### Requirement: Audit writer 失败保持非致命且不回退到 logging

Audit 序列化、追加、轮转、gzip、对账、retention、flush、close、远程超时或 gateway 不可用失败 MUST NOT 改变 request lifecycle、terminal commit、model、capability、gateway 或 stream 结果。AuditProjector MUST 报告其既有的有界 degraded/failed 结果。它 MUST NOT 将失败的 AuditEvent 作为回退镜像到 operational logs 或 metrics。被报告为成功的追加 MUST 对应部署 gateway 接受的一行完整数据；有歧义的失败 MAY 以同一 auditId 重试。retention 失败 MUST 保留受影响的证据以供稍后重试，而不是扩大 selector 或阻塞业务工作。

在 shutdown 期间，app composition SHALL 先停止 audit 生产者，对 projector host 做有界排空，并在 operational writer 关闭之前有界关闭 audit gateway。Audit finalizer 失败 MUST NOT 跳过 metrics 或 operational finalizers。

#### Scenario: Audit gateway 不可用

- **WHEN** AuditEventWriter 无法追加一个 AuditEvent
- **THEN** 权威业务事实 MUST 保持不变
- **AND** audit 投影 MUST 暴露其有界的失败结果
- **AND** 任何 audit payload 都不得被复制到 RuntimeLogger、operational writer、metrics 输出或 SQLite

#### Scenario: shutdown 时 audit close 失败

- **WHEN** audit gateway 无法在其有界超时内 flush 或 close
- **THEN** shutdown MUST 继续执行其余的 metrics 和 operational finalizers
- **AND** 仍然打开的 operational writer MAY 只发出一条有界的 audit 降级状态迁移，不包含 audit payload

#### Scenario: Audit 老化无法删除已过期的自有 archive

- **WHEN** 本地 audit retention 删除失败
- **THEN** 该 archive MUST 保持可用以供稍后的 audit 维护重试
- **AND** 请求处理和另外两个文件生命周期 owner MUST 不受影响
