## MODIFIED Requirements

### Requirement: Validation follows deterministic rule order

startup validation MUST 按以下顺序执行：

1. gateway 配置组存在且结构可解析；
2. `gatewayId` 非空且唯一；
3. `adapterKind` 属于当前产品允许的稳定选择集合；
4. 同一 `adapterKind` 在 gateway source set 内至多出现一次；
5. 每个 entry 的 `deploymentMode` 已确定；
6. 每个 entry 的 provider selection 和 capability binding 完整性判定完成。

稳定选择集合 MUST 包含 `working-memory`、`long-term-memory`、`sqlite`、`sandbox`、`scheduled-maintenance`、`cron-tasks`、`rag-knowledge`、`skillhub`、`workflow-execution` 和 `guardrail`。`sqlite` MUST 只映射到 gateway-store-provider-ownership 规格定义的保留 stores，不得作为 Working Memory 或 Long-term Memory 的别名。`guardrail` MUST 只在 `deployment.mode: "REMOTE"` 下被 selected entry 接受；LOCAL 下 selected `guardrail` entry MUST 被 startup 视为禁用且不产生 binding。provider 缺失、deployment mode 不匹配、未声明支持 selected adapter kind、capability binding 不完整或 binding 冲突时，startup MUST fail before ready。

#### Scenario: Guardrail belongs to the stable adapter selection set

- **WHEN** source configuration 声明 `adapterKind: "guardrail"`
- **THEN** 该 entry 属于当前产品允许的稳定选择集合
- **AND** startup validation 不会因 adapterKind 非法而 fail

#### Scenario: Guardrail selected in LOCAL is disabled

- **WHEN** `deployment.mode: "LOCAL"` 且 source configuration 含 selected `guardrail` entry
- **THEN** startup MUST 将该 entry 视为禁用
- **AND** MUST NOT 为其创建 binding
- **AND** startup MUST NOT 仅因该 entry 而 fail before ready

## ADDED Requirements

### Requirement: GatewayBindings exposes an optional guardrail port

`GatewayBindings` SHALL 暴露可选 `guardrail?: GuardrailGatewayPort`。当且仅当 frozen gateway selection 含一个 REMOTE selected `guardrail` entry 且其 provider 创建 binding 成功时，`GatewayBindings.guardrail` MUST 非 undefined。downstream 模块消费护栏能力 MUST 通过 `GatewayBindings.guardrail`，MUST NOT 重新解析 raw gateway source configuration 或自行构造 RobotRouter client。

LOCAL 部署下 `GatewayBindings.guardrail` MUST 为 undefined。`GuardrailGatewayPort` MUST 只暴露稳定 port 操作（guard proxy 转发、nl2py check）与 safe 诊断，MUST NOT 暴露 adapter-private client、SDK 类型、原始 endpoint、credential 或连接池。

#### Scenario: REMOTE guardrail binding is available to downstream

- **WHEN** frozen gateway selection 含 REMOTE selected `guardrail` entry 且 provider 创建 binding 成功
- **THEN** `GatewayBindings.guardrail` MUST 非 undefined
- **AND** downstream 模块通过该 port 消费护栏能力

#### Scenario: LOCAL guardrail binding is absent

- **WHEN** `deployment.mode: "LOCAL"`
- **THEN** `GatewayBindings.guardrail` MUST 为 undefined
- **AND** downstream 模块 MUST NOT 消费护栏能力
