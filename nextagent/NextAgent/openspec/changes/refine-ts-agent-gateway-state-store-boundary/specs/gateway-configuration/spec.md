# gateway-configuration Specification Delta

## Function

- **所属 Function**：`FN-10.5 集成外部系统`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Gateway configuration is loaded and stabilized during startup

系统 SHALL 在 startup/bootstrap 阶段读取 gateway 配置组，并在 app-level configuration freeze 完成前完成 gateway adapter selection、校验和冻结。当 source configuration 完全省略 `gateway` section 时，系统 SHALL 应用 LOCAL `state-store`、LOCAL `long-term-memory`、LOCAL `user-interaction-stores`、LOCAL `blob-store`、LOCAL `task-trajectory` 及其他既有默认 gateway entries，使本地部署获得完整 provider bindings 后才能启动。LOCAL 默认 `state-store` entry 的 gatewayId 为 `local-state-store`，其产生 `GatewayBindings.stateStore` binding；默认 `user-interaction-stores` entry 的 gatewayId 为 `local-user-interaction-stores`，其产生 `GatewayBindings.userInteractionStores` binding；默认 `blob-store` entry 的 gatewayId 为 `local-blob-store`，其产生 `GatewayBindings.blobStore` binding；默认 `task-trajectory` entry 的 gatewayId 为 `local-task-trajectory`，其产生 `GatewayBindings.taskTrajectory` binding。

为模型目录装配安全 model-information capability MUST NOT 改变上述 gateway selection、freeze、LOCAL defaults 或既有 adapter readiness/fallback 语义。gateway configuration bootstrap MUST 只装配该 capability，MUST NOT 因装配行为在 ready 前发起模型信息查询。

`agent-contracts/gateway` MUST 定义环境中立且 Fetch-compatible 的 `FetchGateway` port，其单一异步操作 shape MUST 等价于 `fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>`。`GatewayBindings.fetch` MUST 是可选 binding，不新增 `GatewayAdapterKind`、selection entry、LOCAL default、readiness requirement 或仓库内 REMOTE 实现。该 port MUST 表达可供 app composition 下 outbound HTTP consumer 复用的运行环境 transport 能力，MUST NOT 以模型、REST resource 或具体 provider 命名。多个 selected Gateway providers 同时返回非空 `fetch` binding 时，app composition MUST 在 ready 前以安全 binding conflict 失败；恰好一个 provider 返回该 binding 时，merge MUST 保留同一 port 实例。本 change MUST NOT 迁移其他 REST client、建立全局 HTTP client abstraction、定义 header policy 或增加额外 header 语义。

**需求类别**：功能性需求

#### Scenario: 系统进入 ready 状态

- **WHEN** 系统对外报告 ready
- **THEN** gateway configuration 已经完成读取、校验和冻结
- **AND** downstream modules 消费冻结产物而不是原始 source 配置

#### Scenario: 省略 Gateway section 时使用本地 capability providers

- **WHEN** source configuration 完全省略 `gateway` section
- **THEN** 系统 MUST 选择 LOCAL StateStore、Long-term Memory、user-interaction-stores、blob-store 和 task-trajectory providers
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

### Requirement: Validation follows deterministic rule order

startup validation MUST 按以下顺序执行：

1. gateway 配置组存在且结构可解析；
2. `gatewayId` 非空且唯一；
3. `adapterKind` 属于当前产品允许的稳定选择集合；
4. 同一 `adapterKind` 在 gateway source set 内至多出现一次；
5. 每个 entry 的 `deploymentMode` 已确定；
6. 每个 entry 的 provider selection 和 capability binding 完整性判定完成。

稳定选择集合 MUST 包含 `state-store`、`long-term-memory`、`user-interaction-stores`、`blob-store`、`task-trajectory`、`sandbox`、`scheduled-maintenance`、`cron-tasks`、`rag-knowledge`、`skillhub`、`workflow-execution`、`guardrail` 和 `watermark`。`state-store` MUST 映射到 `GatewayBindings.stateStore` 运行状态 store 组；`long-term-memory` MUST 映射到 `GatewayBindings.longTermMemory`；`user-interaction-stores` MUST 映射到 `GatewayBindings.userInteractionStores` 的 `attachmentStore` 与 `userQuestionActivityStore`；`blob-store` MUST 映射到 `GatewayBindings.blobStore`；`task-trajectory` MUST 映射到 `GatewayBindings.taskTrajectory`。`guardrail` MUST 只在 `deployment.mode: "REMOTE"` 下被 selected entry 接受；LOCAL 下 selected `guardrail` entry MUST 被 startup 视为禁用且不产生 binding。`watermark` MUST 只在 `deployment.mode: "REMOTE"` 下被 selected entry 接受；LOCAL 下 selected `watermark` entry MUST 被 startup 视为禁用且不产生 binding。provider 缺失、deployment mode 不匹配、未声明支持 selected adapter kind、capability binding 不完整或 binding 冲突时，startup MUST fail before ready。

**需求类别**：功能性需求

#### Scenario: StateStore 属于稳定选择集合

- **WHEN** source configuration 声明 `adapterKind: "state-store"`
- **THEN** 该 entry 属于当前产品允许的稳定选择集合
- **AND** startup validation 不会因 adapterKind 非法而 fail

#### Scenario: blob-store 与 task-trajectory 属于稳定选择集合

- **WHEN** source configuration 声明 `adapterKind: "blob-store"` 或 `adapterKind: "task-trajectory"`
- **THEN** 该 entry 属于当前产品允许的稳定选择集合
- **AND** startup validation 不会因 adapterKind 非法而 fail

#### Scenario: user-interaction-stores 属于稳定选择集合

- **WHEN** source configuration 声明 `adapterKind: "user-interaction-stores"`
- **THEN** 该 entry 属于当前产品允许的稳定选择集合
- **AND** startup validation 不会因 adapterKind 非法而 fail

#### Scenario: LOCAL 下 guardrail 被禁用

- **WHEN** `deployment.mode: "LOCAL"` 且 source configuration 含 selected `guardrail` entry
- **THEN** startup MUST 将该 entry 视为禁用
- **AND** MUST NOT 为其创建 binding
- **AND** startup MUST NOT 仅因该 entry 而 fail before ready

#### Scenario: LOCAL 下 watermark 被禁用

- **WHEN** `deployment.mode: "LOCAL"` 且 source configuration 含 selected `watermark` entry
- **THEN** startup MUST 将该 entry 视为禁用
- **AND** MUST NOT 为其创建 binding
- **AND** startup MUST NOT 仅因该 entry 而 fail before ready

#### Scenario: Guardrail belongs to the stable adapter selection set

- **WHEN** source configuration 声明 `adapterKind: "guardrail"`
- **THEN** 该 entry 属于当前产品允许的稳定选择集合
- **AND** startup validation 不会因 adapterKind 非法而 fail

#### Scenario: Guardrail selected in LOCAL is disabled

- **WHEN** `deployment.mode: "LOCAL"` 且 source configuration 含 selected `guardrail` entry
- **THEN** startup MUST 将该 entry 视为禁用
- **AND** MUST NOT 为其创建 binding
- **AND** startup MUST NOT 仅因该 entry 而 fail before ready

#### Scenario: Watermark belongs to the stable adapter selection set

- **WHEN** source configuration 声明 `adapterKind: "watermark"`
- **THEN** 该 entry 属于当前产品允许的稳定选择集合
- **AND** startup validation 不会因 adapterKind 非法而 fail

#### Scenario: Watermark selected in LOCAL is disabled

- **WHEN** `deployment.mode: "LOCAL"` 且 source configuration 含 selected `watermark` entry
- **THEN** startup MUST 将该 entry 视为禁用
- **AND** MUST NOT 为其创建 binding
- **AND** startup MUST NOT 仅因该 entry 而 fail before ready

### Requirement: Gateway registry resolves selected providers per gateway entry

系统 SHALL 在 gateway configuration freeze 后创建 gateway registry，并根据每个 frozen entry 的 `deploymentMode` 和 `adapterKind` resolve 一个声明支持该 capability 的 injected provider。每个 selected entry MUST 恰好由一个 provider 创建 binding；同一 provider MAY 支持多个 selected adapter kinds，但 MUST 只创建分配给它的 bindings。系统 SHALL 按顶层 capability binding 合并不同 provider 的结果，并在 merged bindings 完整覆盖全部 selected adapters 后才能 ready。

**需求类别**：功能性需求

#### Scenario: 五个本地持久化能力被选择

- **WHEN** gateway selection 同时包含 LOCAL `state-store`、LOCAL `long-term-memory`、LOCAL `user-interaction-stores`、LOCAL `blob-store` 和 LOCAL `task-trajectory`
- **THEN** registry MUST 为五个 entries 解析支持对应 adapter kind 的 provider
- **AND** composition MUST 合并互不冲突的 StateStore、Long-term Memory、user-interaction-stores、blobStore 和 taskTrajectory bindings

#### Scenario: provider 返回未选择的 binding

- **WHEN** provider 返回未分配给它的 capability binding
- **THEN** composition MUST fail before ready
- **AND** diagnostics MUST 只包含 safe provider/binding references

#### Scenario: Three local persistence capabilities are selected

- **WHEN** gateway selection 同时包含 LOCAL `working-memory`、LOCAL `long-term-memory` 和 LOCAL `sqlite`
- **THEN** registry MUST 为三个 entries 解析支持对应 adapter kind 的 provider
- **AND** composition MUST 合并互不冲突的 Working Memory、Long-term Memory 和保留 SQLite bindings

#### Scenario: Provider returns an unselected binding

- **WHEN** provider 返回未分配给它的 capability binding
- **THEN** composition MUST fail before ready
- **AND** diagnostics MUST 只包含 safe provider/binding references

## ADDED Requirements

### Requirement: REMOTE 空实现未注入真实实现时安全失败

当 REMOTE adapter 为空实现且未注入真实实现时，系统 MUST 在 startup/ready 前以安全诊断失败，MUST NOT 回退到 LOCAL 或内存实现。已 selected 但无法产出真实 binding 的 REMOTE entry MUST 使 startup fail before ready，诊断 MUST 只包含 safe provider/binding 引用。若空实现 binding 因外部注入被创建，其任意 store 或 capability 方法调用 MUST 返回确定性安全错误（code 为 `NOT_IMPLEMENTED`），MUST NOT 抛出 provider 内部异常，MUST NOT 泄漏 provider 端点、credential、连接池或 provider-native 错误体。

**需求类别**：系统质量属性

**质量属性**：安全

**适用范围**：该 Function

#### Scenario: 未注入真实实现的 REMOTE provider 启动失败

- **WHEN** frozen gateway selection 含 selected REMOTE entry 但未注入真实实现
- **THEN** startup MUST fail before ready
- **AND** 诊断 MUST 只包含 safe reason 和 field reference
- **AND** 系统 MUST NOT 静默回退到 LOCAL 或内存实现

#### Scenario: 空实现方法调用返回确定性安全错误

- **WHEN** 空实现 binding 的 store 或 capability 方法被调用
- **THEN** 调用 MUST 返回 code 为 `NOT_IMPLEMENTED` 的确定性安全错误
- **AND** 该错误 MUST NOT 暴露 provider 端点、credential、连接池或 provider-native 错误体

### Requirement: 外部团队复用实现无关 conformance 契约交付 REMOTE provider

系统 MUST 提供实现无关的 Gateway conformance 契约，使外部团队能够基于 `agent-contracts` 在独立项目中实现 REMOTE provider 并通过同一组断言验证契约一致性。本仓 MUST NOT 依赖外部 REMOTE 实现来完成 LOCAL 验证或 conformance 验证；LOCAL provider 与外部 REMOTE provider 的 conformance 判定 MUST 使用同一组断言和同一判定标准。

**需求类别**：系统质量属性

**质量属性**：可测试性

**适用范围**：该 Function

#### Scenario: 外部 REMOTE 实现复用 conformance 契约

- **WHEN** 外部团队基于 `agent-contracts` 实现 REMOTE provider 并运行本仓提供的 conformance 契约
- **THEN** 同一组断言 MUST 可执行且可复用
- **AND** 判定标准 MUST 与 LOCAL provider 一致

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：gateway 配置按能力组语义组织选择键（`state-store`、`long-term-memory`、`user-interaction-stores`、`blob-store`、`task-trajectory`），REMOTE 空实现未注入时 fail closed，外部团队复用实现无关 conformance 契约交付 REMOTE。
- **依据 Requirements**：`Gateway configuration is loaded and stabilized during startup`、`Validation follows deterministic rule order`、`Gateway registry resolves selected providers per gateway entry`、`REMOTE 空实现未注入真实实现时安全失败`、`外部团队复用实现无关 conformance 契约交付 REMOTE provider`

### 输入

- **变更类型**：修改
- **目标内容**：gateway 配置可接受 `adapterKind: "state-store"`、`"user-interaction-stores"`、`"blob-store"` 与 `"task-trajectory"` 作为持久化能力组选择；`working-memory` 与 `sqlite` 不再作为选择键。
- **依据 Requirements**：`Gateway configuration is loaded and stabilized during startup`、`Validation follows deterministic rule order`

### 处理过程

- **变更类型**：修改
- **目标内容**：startup 按冻结 selection 解析 provider 并合并 binding；REMOTE 空实现未注入真实实现时启动失败，不静默回退；外部 REMOTE 实现与 LOCAL 共用同一 conformance 判定。
- **依据 Requirements**：`Gateway registry resolves selected providers per gateway entry`、`REMOTE 空实现未注入真实实现时安全失败`、`外部团队复用实现无关 conformance 契约交付 REMOTE provider`

### 规格

- **规格项**：运行状态持久化选择键
- **变更类型**：修改
- **原规格值**：`working-memory`
- **目标规格值**：`state-store`
- **依据 Requirements**：`Gateway configuration is loaded and stabilized during startup`、`Validation follows deterministic rule order`

- **规格项**：用户交互存储选择键
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：`user-interaction-stores` 映射到 `GatewayBindings.userInteractionStores`（attachmentStore 与 userQuestionActivityStore）
- **依据 Requirements**：`Validation follows deterministic rule order`

- **规格项**：对象存储选择键
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：`blob-store` 映射到 `GatewayBindings.blobStore`
- **依据 Requirements**：`Validation follows deterministic rule order`

- **规格项**：任务轨迹选择键
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：`task-trajectory` 映射到 `GatewayBindings.taskTrajectory`（taskTrajectoryStore 与 taskTrajectoryQuery）
- **依据 Requirements**：`Validation follows deterministic rule order`

- **规格项**：REMOTE 空实现失败语义
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：未注入真实实现时 startup/ready 前安全失败，不回退 LOCAL；方法调用返回 code 为 `NOT_IMPLEMENTED` 的确定性安全错误
- **依据 Requirements**：`REMOTE 空实现未注入真实实现时安全失败`

- **规格项**：外部 REMOTE conformance
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：实现无关 conformance 契约可被外部团队基于 `agent-contracts` 复用，LOCAL 与 REMOTE 同一判定标准
- **依据 Requirements**：`外部团队复用实现无关 conformance 契约交付 REMOTE provider`

### 主规格

- **变更类型**：修改
- **目标内容**：`gateway-configuration` 继续作为 `FN-10.5 集成外部系统` 的 canonical spec。
- **依据 Requirements**：`Gateway configuration is loaded and stabilized during startup`、`Validation follows deterministic rule order`、`Gateway registry resolves selected providers per gateway entry`、`REMOTE 空实现未注入真实实现时安全失败`、`外部团队复用实现无关 conformance 契约交付 REMOTE provider`
