## MODIFIED Requirements

### Requirement: agent-model 拥有内部 provider adapter 能力
`agent-model` SHALL 拥有内部 provider adapter 能力，把稳定的 `ModelInvocationRequest` 转换为 provider 特定的访问行为，并把 provider 原生 outcome 转换为标准 invocation 边界。

该能力是 `agent-model` 内部能力，SHALL NOT 引入新的跨模块 public invocation contract。

产品 app composition MAY 使用可信的 `ModelGatewayProvider` SPI 来创建供 `MODEL_GATEWAY` provider kind 使用的 `ModelInvocationService`。`ModelGatewayProvider` 只是 service factory 边界：它 MUST 暴露稳定的 `providerId`、`supportedProviderKinds` 和 `createModelService()`，且 MUST NOT 通过 public model contract 暴露 provider 原生 request DTO、raw gateway 响应、credential、fallback policy 或路由决策。

Remote gateway adapter package MAY 仅出于支持外部实现示例和仓内验证的目的提供参考性 `ModelGatewayProvider` factory。此类 factory 仍 MUST 只向产品 composition 暴露 `ModelGatewayProvider` 和 `ModelInvocationService`，MUST NOT 定义默认的产品 HTTP inference gateway 协议，MUST NOT 仅凭环境变量或 remote gateway 选择就自动启用 `MODEL_GATEWAY`，并且 MUST 在 remote 失败或畸形响应 outcome 离开 adapter 边界之前把它们规范化为安全的 model 结果。

默认产品 model service SHALL 在启用的 model profile 可以触达多于一个运行时 provider kind 时作为 provider-kind 分发器。该分发器作为 provider adapter 选择粘合层，属于 `agent-model` invocation 边界。它 SHALL 消费已解析的 `ModelInvocationRequest.providerKind` 并转发到匹配的 provider 特定 `ModelInvocationService`。它 SHALL NOT 重新执行 model profile 选择、fallback policy、业务路由、prompt 组装或 gateway 选择。

#### Scenario: Invocation 进入 agent-model
- **WHEN** 一个完全解析的 `ModelInvocationRequest` 进入 `agent-model`
- **THEN** TS 首发基线 MUST 使用当前 `providerKind` 字段选择其内部 provider adapter
- **AND** 若 provider identity 的 contract refinement 结果取代 `providerKind`，长期 adapter 选择语义 MUST 跟随该结果

#### Scenario: MODEL_GATEWAY service 由可信 app composition 创建
- **WHEN** 产品 app composition 选择 `modelProviderKind=MODEL_GATEWAY`
- **THEN** 它 MUST 恰好通过一个支持 `MODEL_GATEWAY` 的可信 `ModelGatewayProvider` 创建 model invocation service
- **AND** 创建出的 service MUST 仍然实现稳定的 `ModelInvocationService` contract
- **AND** 上游调用方 MUST 继续只调用 `ModelInvocationService`

#### Scenario: Remote gateway package 提供 MODEL_GATEWAY 参考 adapter
- **WHEN** 外部实现者或仓内测试需要一个 `MODEL_GATEWAY` remote inference 示例
- **THEN** remote gateway package MAY 把一个显式注入的 vendor client 包装为可信 `ModelGatewayProvider`
- **AND** 产品 app composition MUST 只收到 provider SPI 和稳定的 model invocation service
- **AND** 畸形或失败的 vendor 响应 MUST 被转换为安全的 model unavailable 结果，不得泄露 raw provider 细节
- **AND** 参考 adapter MUST NOT 创建内建的产品 HTTP model gateway 模式

#### Scenario: Provider-kind 分发器路由已解析的 invocation request
- **WHEN** 一个 `ModelInvocationRequest` 到达产品 model service
- **AND** `providerKind=OPENAI`
- **THEN** 分发器 MUST 调用 OpenRouter 支撑的 model service
- **WHEN** 一个 `ModelInvocationRequest` 到达产品 model service
- **AND** `providerKind=MODEL_GATEWAY`
- **THEN** 分发器 MUST 调用由 `ModelGatewayProvider` 创建的 model service
- **AND** 不支持的运行时 provider kind MUST 返回安全的 model provider unavailable 结果，而不是泄露 raw provider exception
