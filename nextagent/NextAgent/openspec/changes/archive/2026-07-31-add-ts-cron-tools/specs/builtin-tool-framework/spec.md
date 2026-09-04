## ADDED Requirements

### Requirement: Cron Tool 受控依赖
内置 Tool framework SHALL 通过 `cronTasks` async dependency 调用 Cron gateway，不得直接访问 SQLite、remote SDK、host timer 或 runtime 私有实现。依赖缺失时 Cron Tool MUST 返回稳定 unavailable safe result。

#### Scenario: Cron dependency 缺失
- **WHEN** capability provider 注册 Cron Tool 但 composition 未注入 `cronTasks`
- **THEN** 调用 MUST fail closed，且不得创建进程内临时任务

#### Scenario: Capability 治理保持生效
- **WHEN** 模型调用任一 Cron Tool
- **THEN** 调用 MUST 经过既有 resolver、schema validation、risk policy、executor 和 safe result boundary
