## ADDED Requirements

### Requirement: Memory scheduler cron 配置在 readiness 之前被校验

Memory scheduler 配置 SHALL 只接受支持的六字段 cron 子集：恰好六个以空白分隔的字段，每个字段是 `*`、`?` 或字段范围内的一个十进制整数；day-of-week 字段还接受 `7` 表示周日。秒字段 MUST 为 `0`，因为 memory scheduler 按分钟窗口运行。不支持的表达式、列表、范围、步进、名称、无效字段数和越界取值 MUST 使 memory configuration 在应用 readiness 之前变为 `INVALID`。

#### Scenario: 受支持的 memory cron 被接受
- **WHEN** memory aging 调度为 `0 0 3 * * ?`
- **AND** memory extraction 调度为 `0 0 2 * * ?`
- **THEN** memory configuration 校验 MUST 同时接受这两个调度

#### Scenario: 不支持的 memory cron 快速失败
- **WHEN** 某个 memory 调度为 `*/5 * * * * ?`、`0 0 3 * * MON-FRI`，或任一字段超出其数值范围
- **THEN** memory configuration 状态 MUST 为 `INVALID`
- **AND** 任何 memory 后台 scheduler 不得启动
