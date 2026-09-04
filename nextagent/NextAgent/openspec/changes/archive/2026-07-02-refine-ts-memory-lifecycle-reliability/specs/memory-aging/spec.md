## ADDED Requirements

### Requirement: Aging 扫描覆盖已保留 confidence 的完整范围

Memory aging SHALL 评估每个满足生命周期状态、pin 和时间谓词的 scoped 已保留记录，包括 confidence 低于普通检索默认值的记录。Aging 扫描 MUST 显式向 memory core list 边界请求完整的 `[0, 1]` confidence 范围。普通检索默认值 MUST NOT 阻止 decay、archive 或 retention delete。

#### Scenario: 低 confidence 的 ACTIVE 记忆继续衰减
- **GIVEN** 一个未 pin 的 ACTIVE 记录 confidence 为 `0.26` 且早于 `decayStaleDays`
- **WHEN** 下一个 aging cycle 扫描其 owner 和 agent scope
- **THEN** 该记录 MUST 被选中并再次衰减
- **AND** 重复的合格 cycle MUST 能在计算出的 confidence 归零时将其 archive

#### Scenario: 低 confidence 的 ARCHIVED 记忆被物理删除
- **GIVEN** 一个未 pin 的 ARCHIVED 记录 confidence 低于 `0.3`
- **AND** 其 `archivedAt` 早于 `archiveRetentionDays`
- **WHEN** aging 执行 retention delete
- **THEN** 该记录 MUST 被选中并物理删除

### Requirement: Aging 调度与进程启动秒数无关

Aging 调度器 SHALL 按分钟窗口评估配置的六字段 cron 调度。在某一分钟内任意秒启动的进程，在匹配分钟窗口到来时 MUST 仍执行秒字段为 `0` 的调度。同一 scheduler 实例对同一分钟窗口 MUST 最多执行一个调度 cycle。

#### Scenario: 非对齐启动后每日调度仍触发
- **GIVEN** aging 调度为 `0 0 3 * * ?`
- **AND** 进程于本地时间 `02:59:37` 启动
- **WHEN** 本地时间进入 `03:00` 分钟窗口
- **THEN** 恰好一个调度的 aging cycle MUST 启动
