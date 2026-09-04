## ADDED Requirements

### Requirement: Cron gateway adapter selection
系统 SHALL 通过受信 gateway configuration 为 Cron task 选择恰好一个 LOCAL 或 REMOTE adapter。选择项存在但 provider 不支持或 binding 缺失时，应用启动 MUST fail fast；不得静默回退到 in-memory store。

#### Scenario: Local selection
- **WHEN** deployment 选择 LOCAL Cron adapter
- **THEN** composition MUST 注入 SQLite-backed Cron gateway 并把 local scheduler 纳入应用 start/stop lifecycle

#### Scenario: Remote selection
- **WHEN** deployment 选择 REMOTE Cron adapter
- **THEN** composition MUST 注入 external Cron service adapter，且本地不得启动第二个任务到期 scheduler

#### Scenario: 缺少 binding
- **WHEN** 配置选择 Cron adapter 但 provider 未返回对应 binding
- **THEN** 启动 MUST 以稳定配置错误失败
