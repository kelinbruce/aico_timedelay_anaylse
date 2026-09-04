## MODIFIED Requirements

### Requirement: Gateway configuration is loaded and stabilized during startup

系统 SHALL 在 startup/bootstrap 阶段读取 gateway 配置组，并在 app-level configuration freeze 完成前完成 gateway adapter selection、校验和冻结。当 source configuration 完全省略 `gateway` section 时，系统 SHALL 应用 LOCAL `working-memory`、LOCAL `long-term-memory`、LOCAL `sqlite` 及其他既有默认 gateway entries，使本地部署获得完整 provider bindings 后才能启动。

#### Scenario: System reaches ready state
- **WHEN** 系统对外报告 ready
- **THEN** gateway configuration 已经完成读取、校验和冻结
- **AND** downstream modules 消费冻结产物而不是原始 source 配置

#### Scenario: Gateway section omitted defaults to local capability providers
- **WHEN** source configuration 完全省略 `gateway` section
- **THEN** 系统 MUST 选择 LOCAL Working Memory、Long-term Memory 和保留 SQLite providers
- **AND** 启动结果 MUST 与显式声明对应默认 entries 一致

### Requirement: Validation follows deterministic rule order

startup validation MUST 按以下顺序执行：

1. gateway 配置组存在且结构可解析；
2. `gatewayId` 非空且唯一；
3. `adapterKind` 属于当前产品允许的稳定选择集合；
4. 同一 `adapterKind` 在 gateway source set 内至多出现一次；
5. 每个 entry 的 `deploymentMode` 已确定；
6. 每个 entry 的 provider selection 和 capability binding 完整性判定完成。

稳定选择集合 MUST 包含 `working-memory`、`long-term-memory`、`sqlite`、`sandbox`、`scheduled-maintenance`、`cron-tasks`、`rag-knowledge`、`skillhub` 和 `workflow-execution`。`sqlite` MUST 只映射到 gateway-store-provider-ownership 规格定义的保留 stores，不得作为 Working Memory 或 Long-term Memory 的别名。provider 缺失、deployment mode 不匹配、未声明支持 selected adapter kind、capability binding 不完整或 binding 冲突时，startup MUST fail before ready。

#### Scenario: Working Memory adapter is missing
- **WHEN** app-required Working Memory capability 没有 selected `working-memory` entry
- **THEN** startup MUST fail before ready

#### Scenario: SQLite is configured as Working Memory fallback
- **WHEN** `working-memory` provider 缺失但保留 `sqlite` provider 可用
- **THEN** startup MUST fail before ready
- **AND** system MUST NOT 将保留 SQLite binding 解释为 Working Memory binding

### Requirement: Gateway registry resolves selected providers per gateway entry

系统 SHALL 在 gateway configuration freeze 后创建 gateway registry，并根据每个 frozen entry 的 `deploymentMode` 和 `adapterKind` resolve 一个声明支持该 capability 的 injected provider。每个 selected entry MUST 恰好由一个 provider 创建 binding；同一 provider MAY 支持多个 selected adapter kinds，但 MUST 只创建分配给它的 bindings。系统 SHALL 按顶层 capability binding 合并不同 provider 的结果，并在 merged bindings 完整覆盖全部 selected adapters 后才能 ready。

#### Scenario: Three local persistence capabilities are selected
- **WHEN** gateway selection 同时包含 LOCAL `working-memory`、LOCAL `long-term-memory` 和 LOCAL `sqlite`
- **THEN** registry MUST 为三个 entries 解析支持对应 adapter kind 的 provider
- **AND** composition MUST 合并互不冲突的 Working Memory、Long-term Memory 和保留 SQLite bindings

#### Scenario: Provider returns an unselected binding
- **WHEN** provider 返回未分配给它的 capability binding
- **THEN** composition MUST fail before ready
- **AND** diagnostics MUST 只包含 safe provider/binding references
