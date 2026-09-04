## ADDED Requirements

### Requirement: Workbench 只消费当前活跃的 operational segment

本地 Agent Dev Workbench 的 log 证据视图 SHALL 只读取当前由 transport 拥有的活跃 operational segment。`agent-log` SHALL 暴露由 `destination.file` 支撑的当前只读活跃目标位置身份；受信的 `agent-app` composition SHALL 向 workbench 传递一个 current-active provider。workbench MUST NOT 通过扫描日志目录、测试文件名或猜测最高 sequence 来发现 operational 证据。

对于每个成功解析的完整条目，workbench SHALL 从 writer 拥有的 `surface` 字段推导其既有证据来源：

- `runtime_diagnostic` 映射到 `runtime-diagnostic-log`；
- `observation_derived` 映射到 `structured-safe-log`。

缺失、未知或非法的 `surface` MUST NOT 默认归入任一证据来源。Log 证据仍是辅助的只读证据，按经授权的稳定 refs 过滤，且 MUST NOT 创建 graph 节点、action 详情、runtime 状态、audit 事实、metric samples 或其他业务事实。

活跃文件 reader SHALL 保持异步并强制执行既有的结果数、字节、时间窗和查询 deadline 限制。达到限制 MUST 返回有界的 `truncated` 证据/状态。访问失败、轮转竞争或解析失败 MUST 返回有界的 `unavailable`/诊断状态，且 MUST NOT 回退到目录扫描或改变 request 执行。

已关闭的 operational `.jsonl` 源文件、已提交的 `.jsonl.gz` archives、metrics 文件、audit 存储、开发者 traces、遗留日志、symlink 和未知文件 MUST NOT 被 workbench 打开。保留的 operational 历史 SHALL 只通过 Agent Dev Workbench 之外的外部 operational 文件工具检查。

#### Scenario: 活跃统一条目保留其 surface

- **WHEN** 经授权的开发者查询一个 run，其当前活跃 operational segment 包含来自两个 surface 的匹配完整条目
- **THEN** workbench MUST 将 runtime diagnostics 作为 `runtime-diagnostic-log` 返回
- **AND** 它 MUST 将 observation 派生的条目作为 `structured-safe-log` 返回
- **AND** 分类 MUST 使用解析出的 surface 而不是物理文件名

#### Scenario: 查询期间活跃目标位置发生轮转

- **WHEN** 在 workbench 查询读取之前提供的活跃 segment 时，`agent-log` 改变了 `destination.file`
- **THEN** 有界查询 MAY 返回已读取的完整条目和 `truncated` 或 `unavailable` 状态
- **AND** 它 MUST NOT 扫描、猜测或重新打开已关闭 segment 或新的活跃 segment
- **AND** 之后的查询 MUST 从 provider 获取当时的当前活跃身份

#### Scenario: 匹配证据只存在于保留历史中

- **WHEN** 匹配的 run 证据只存在于已关闭的 `.jsonl` 源文件或已提交的 `.jsonl.gz` archive 中
- **THEN** workbench MUST 不从该文件返回任何 log 证据
- **AND** 它 MUST NOT 解压或以其他方式打开保留历史

#### Scenario: Workbench 遇到其他输出域

- **WHEN** 日志目录中还包含 metrics、audit、developer trace、遗留、symlink 或未知文件
- **THEN** workbench MUST 将这些文件作为 operational 证据忽略
- **AND** 它 MUST NOT 通过文件名启发式对它们分类

#### Scenario: 条目 surface 缺失或非法

- **WHEN** 当前活跃 segment 包含一行不可解析的数据，或一个不含允许的 operational surface 的完整 JSON 对象
- **THEN** 该行 MUST NOT 被错误标记为 runtime 或 observation 派生证据
- **AND** 查询 MAY 只报告一条有界的 unavailable/解析诊断，不改变任何事实
