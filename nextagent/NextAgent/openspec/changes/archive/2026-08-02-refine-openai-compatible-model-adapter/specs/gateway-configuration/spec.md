## Function

- **所属 Function**：`FN-10.5 集成外部系统`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Gateway configuration is loaded and stabilized during startup

系统 SHALL 在 startup/bootstrap 阶段读取 gateway 配置组，并在 app-level configuration freeze 完成前完成 gateway adapter selection、校验和冻结。当 source configuration 完全省略 `gateway` section 时，系统 SHALL 应用 LOCAL `working-memory`、LOCAL `long-term-memory`、LOCAL `sqlite` 及其他既有默认 gateway entries，使本地部署获得完整 provider bindings 后才能启动。

为模型目录装配安全 model-information capability MUST NOT 改变上述 gateway selection、freeze、LOCAL defaults 或既有 adapter readiness/fallback 语义。gateway configuration bootstrap MUST 只装配该 capability，MUST NOT 因装配行为在 ready 前发起模型信息查询。

`agent-contracts/gateway` MUST 定义环境中立且 Fetch-compatible 的 `FetchGateway` port，其单一异步操作 shape MUST 等价于 `fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>`。`GatewayBindings.fetch` MUST 是可选 binding，不新增 `GatewayAdapterKind`、selection entry、LOCAL default、readiness requirement 或仓库内 REMOTE 实现。该 port MUST 表达可供 app composition 下 outbound HTTP consumer 复用的运行环境 transport 能力，MUST NOT 以模型、REST resource 或具体 provider 命名。多个 selected Gateway providers 同时返回非空 `fetch` binding 时，app composition MUST 在 ready 前以安全 binding conflict 失败；恰好一个 provider 返回该 binding 时，merge MUST 保留同一 port 实例。本 change MUST NOT 迁移其他 REST client、建立全局 HTTP client abstraction、定义 header policy 或增加额外 header 语义。

**需求类别**：功能性需求

#### Scenario: 系统进入 ready 状态

- **WHEN** 系统对外报告 ready
- **THEN** gateway configuration 已经完成读取、校验和冻结
- **AND** downstream modules 消费冻结产物而不是原始 source 配置

#### Scenario: 省略 Gateway section 时使用本地 capability providers

- **WHEN** source configuration 完全省略 `gateway` section
- **THEN** 系统 MUST 选择 LOCAL Working Memory、Long-term Memory 和保留 SQLite providers
- **AND** 启动结果 MUST 与显式声明对应默认 entries 一致

#### Scenario: 装配 model-information capability

- **WHEN** trusted app composition 为模型目录装配 Gateway model-information capability
- **THEN** gateway configuration 的 selection、freeze、LOCAL defaults 和既有 adapter readiness/fallback 语义 MUST 保持不变
- **AND** 系统 MUST NOT 因该 capability 的装配在 ready 前发起模型信息查询

#### Scenario: Remote provider 提供可选通用 fetch

- **WHEN** trusted Gateway provider 或预装配 `GatewayBindings` 提供 `fetch`
- **THEN** Gateway bindings merge MUST 向 app composition 保留同一 optional `fetch` port
- **AND** 该 port MUST NOT 建立独立 adapter kind、selection entry 或 readiness requirement

#### Scenario: Local bindings 未提供通用 fetch

- **WHEN** LOCAL deployment 的 Gateway bindings 未提供 `fetch`
- **THEN** app startup MUST 正常完成
- **AND** merged `GatewayBindings.fetch` MUST 保持缺失

#### Scenario: 多个 provider 重复提供通用 fetch

- **WHEN** 多个 selected Gateway providers 同时返回非空 `fetch` binding
- **THEN** app composition MUST 在 ready 前以安全 binding conflict 失败
- **AND** 系统 MUST NOT 任意选择或覆盖其中一个 binding

#### Scenario: 当前 change 不扩展其他 HTTP consumer

- **WHEN** 通用 `FetchGateway` 已由 app composition 装配
- **THEN** 本 change MUST 只要求 OpenAI-compatible adapter 消费该 binding
- **AND** 既有 REST client 和其他 outbound HTTP consumer MUST 保持现有实现，直到其 owning change 明确定义迁移

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：为模型目录装配安全 model-information capability 时，Gateway configuration selection、freeze、LOCAL defaults、adapter readiness 和 fallback 规则保持不变；装配行为不在 ready 前发起模型信息查询。环境中立的可选 `FetchGateway` 通过 `GatewayBindings.fetch` 向 app composition 提供可复用的运行环境 transport；LOCAL 缺省不装配且无需仓库内 REMOTE 实现，重复非空 binding 安全失败，其他 HTTP consumer 不在本 change 迁移。
- **依据 Requirements**：`Gateway configuration is loaded and stabilized during startup`

### 主规格

- **变更类型**：修改
- **目标内容**：`gateway-configuration`
- **依据 Requirements**：`Gateway configuration is loaded and stabilized during startup`

### 遗留规格

- **变更类型**：修改
- **目标内容**：`fullstack-packaging-boundary` 继续承载未触及的全栈托管边界。
- **依据 Requirements**：`Gateway configuration is loaded and stabilized during startup`
