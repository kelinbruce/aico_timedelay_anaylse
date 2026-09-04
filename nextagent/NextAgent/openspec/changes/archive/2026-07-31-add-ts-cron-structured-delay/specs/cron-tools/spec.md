## ADDED Requirements

### Requirement: Cron Tool 结构化相对延迟创建
系统 SHALL 允许 `Cron(action=create)` 使用结构化 `delay` 表达一次性 elapsed duration。`delay` SHALL 只包含可选的非负整数 `days`、`hours`、`minutes`，每个字段允许自然大值；系统 MUST 将各字段统一换算，总延迟 MUST 为 1 至 525600 分钟。1 day MUST 固定等于 24 hours。`delay` 与 `cron` MUST 恰好选择一个；delay task 的 `recurring` MUST 省略或为 `false`。

#### Scenario: 一小时十分钟后执行
- **WHEN** 调用 `Cron(action=create, delay={hours:1, minutes:10}, prompt=<非空任务>)`
- **THEN** 系统 MUST 创建 one-shot durable task
- **AND** MUST NOT 要求调用方换算为 70 分钟或提供当前时间
- **AND** create 结果 MUST 返回稳定 task id、原始结构化 delay、可读摘要和 `recurring=false`

#### Scenario: 自然大字段由系统归一化
- **WHEN** 调用方提供 `delay={minutes:90}` 或 `delay={hours:48}`
- **THEN** 系统 MUST 分别按 90 分钟和 48 小时计算，不得要求调用方改写单位

#### Scenario: 调度输入冲突
- **WHEN** create 同时提供 `cron` 与 `delay`，或两者均未提供，或 delay 配合 `recurring=true`
- **THEN** runtime schema validation MUST 拒绝调用且不得写入 task

#### Scenario: 非法或越界延迟
- **WHEN** delay 含未知字段、负数、小数，所有字段均为零，或总延迟超过 525600 分钟
- **THEN** 系统 MUST 返回稳定 validation failure 且不得写入 task

### Requirement: Cron 相对延迟使用可信分钟调度
系统 SHALL 使用受信系统时钟在创建操作中冻结相对任务的 `nextRunAt`。目标时间 MUST 等于创建基准加总延迟后向上取整到分钟，量化误差 MUST 小于 1 分钟且任务 MUST NOT 早于请求偏移量执行。该计算 MUST NOT 调用 Bash、Python 或读取 system prompt 时间。

#### Scenario: 跨日并向上取整
- **WHEN** 受信创建时刻为 23:55:30 且 delay 为 10 分钟
- **THEN** 冻结到期时间 MUST 为次日 00:06:00

#### Scenario: 重启不重新计算延迟
- **WHEN** delay task durable commit 后进程在到期前重启
- **THEN** 系统 MUST 继续使用原冻结 `nextRunAt`
- **AND** MUST NOT 以重启时间重新应用 delay

#### Scenario: Sandbox 不可用
- **WHEN** Cron gateway 可用但 sandbox capability 不可用
- **THEN** 合法 delay create MUST 仍能创建任务

#### Scenario: 到期只执行一次
- **WHEN** delay task 到期并成功 claim 首个 trigger
- **THEN** 系统 MUST 沿用现有 one-shot completion 和标准 request lifecycle
- **AND** MUST NOT 再从兼容 cron 字段推导后续执行
