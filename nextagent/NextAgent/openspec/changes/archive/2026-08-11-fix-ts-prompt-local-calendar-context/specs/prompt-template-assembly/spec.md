## Function

- **所属 Function**：`FN-10.4 自定义工具和提示词`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Prompt 日历变量使用同一进程本地语义

当 Prompt Template 渲染受治理变量 `timezone` 或 `currentDate` 时，系统 MUST 从同一次渲染的进程本地日历事实解析两个变量。`timezone` MUST 表示该进程的 IANA 时区，`currentDate` MUST 表示该时区中渲染时刻对应的 `YYYY-MM-DD` 日历日期。系统 MUST NOT 使用 UTC 日期与非 UTC 的 `timezone` 组成同一次渲染结果。

**需求类别**：功能性需求

#### Scenario: 正时区跨 UTC 日期边界

- **WHEN** 进程时区为 `Asia/Shanghai`，渲染时刻为 `2026-08-09T18:00:00.000Z`
- **THEN** `timezone` MUST 为 `Asia/Shanghai`
- **AND** `currentDate` MUST 为 `2026-08-10`

#### Scenario: 负时区跨 UTC 日期边界

- **WHEN** 进程时区为 `America/New_York`，渲染时刻为 `2026-08-10T01:00:00.000Z`
- **THEN** `timezone` MUST 为 `America/New_York`
- **AND** `currentDate` MUST 为 `2026-08-09`

#### Scenario: UTC 日期与本地日期相同

- **WHEN** 进程时区为 `UTC`，渲染时刻为 `2026-08-10T01:00:00.000Z`
- **THEN** `timezone` MUST 为 `UTC`
- **AND** `currentDate` MUST 为 `2026-08-10`

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：系统按同一次渲染的进程本地时区和时刻解析受治理的时区与日期变量。
- **依据 Requirements**：`Prompt 日历变量使用同一进程本地语义`

### 结果

- **变更类型**：修改
- **目标内容**：渲染结果中的 `timezone` 与 `currentDate` 表达同一个进程本地日历事实。
- **依据 Requirements**：`Prompt 日历变量使用同一进程本地语义`
