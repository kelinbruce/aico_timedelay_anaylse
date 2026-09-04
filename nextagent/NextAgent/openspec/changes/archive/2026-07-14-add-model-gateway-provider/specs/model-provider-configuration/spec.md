## MODIFIED Requirements

### Requirement: 支持的 provider kind 是封闭集合
产品配置 MUST 只允许已启用的产品 model profile 使用受支持的运行时 provider kind `OPENAI` 和 `MODEL_GATEWAY`。

`OPENAI_COMPATIBLE`、`CUSTOM`、`MINIMAX`、`DEEPSEEK` 或 `QWEN` 等额外 provider kind 必须先经过显式的产品配置变更，才 MAY 进入产品配置。

Fake、test 或 mock provider MUST NOT 出现在产品配置中。

`MODEL_GATEWAY` SHALL 只通过带有 remote gateway 选择和匹配 `ModelGatewayProvider` 的可信 app composition 启用。仅 local gateway 的启动 MUST NOT 静默创建 `MODEL_GATEWAY` service，缺失或存在多个匹配 model gateway provider 时 MUST 在 ready 之前失败。本要求既适用于直接选择 `modelProviderKind=MODEL_GATEWAY` 的情形，也适用于任何已启用的 model profile 可作为 `MODEL_GATEWAY` fallback 路由被触达的情形。

支持 `MODEL_GATEWAY` 的 remote deployment 参考代码 SHALL 通过 `modelGatewayProviders` 显式注册 model gateway provider；仅声明 remote gateway 选择 MUST NOT 暗示存在 model gateway inference adapter。该参考代码只用于外部实现指引和仓内验证；它 MUST NOT 引入环境变量自动装配或默认的产品 HTTP inference gateway 模式。

#### Scenario: 配置了不支持的 provider kind
- **WHEN** 某个 profile 使用支持集合之外的 provider kind
- **THEN** startup MUST 拒绝该 profile 配置

#### Scenario: 未带 remote gateway 却选择了 MODEL_GATEWAY
- **WHEN** 产品 app composition 选择 `modelProviderKind=MODEL_GATEWAY`
- **AND** 不存在已启用的 remote gateway 选择
- **THEN** startup MUST 在 ready 之前失败

#### Scenario: MODEL_GATEWAY provider 缺失或存在歧义
- **WHEN** 产品 app composition 选择 `modelProviderKind=MODEL_GATEWAY`
- **AND** 支持 `MODEL_GATEWAY` 的可信 `ModelGatewayProvider` 条目为零或多个
- **THEN** startup MUST 在 ready 之前失败

#### Scenario: OPENAI 主配置带有 MODEL_GATEWAY fallback profile
- **WHEN** 产品 app composition 选择 `modelProviderKind=OPENAI`
- **AND** 一个已启用的 model profile 使用 `providerKind=MODEL_GATEWAY`
- **THEN** startup MUST 要求恰好一个支持 `MODEL_GATEWAY` 的可信 `ModelGatewayProvider`
- **AND** 由此产生的产品 model service MUST 能够同时分发 `OPENAI` 和 `MODEL_GATEWAY` invocation request

#### Scenario: Remote deployment 装配 MODEL_GATEWAY 参考 provider
- **WHEN** 一个 remote deployment 参考 entrypoint 被给定一个显式的 vendor model gateway client
- **THEN** 它 MUST 通过 app composition 注册一个可信 `ModelGatewayProvider`
- **AND** `MODEL_GATEWAY` request MUST 经由该 provider 创建的 model service 路由
- **AND** startup MUST NOT 仅凭环境变量或 remote gateway 选择推断出该 provider
