## 背景与问题（Why）

`MODEL_GATEWAY` 已是获批的 runtime model provider kind，但产品入口仍默认使用 OpenRouter 支撑的 model service，除非调用方注入裸 `ModelInvocationService`。这使远程推理 gateway 集成缺少稳定的 provider SPI，也让基于 gateway 的 model service 创建与仅测试用的 model 覆盖无从区分。

我们需要一个小型 provider contract，让可信 app composition 为 `MODEL_GATEWAY` 创建 `ModelInvocationService`，同时保持普通 local/OpenAI 启动仍走既有 OpenRouter 路径。由于 model fallback 可以在基础请求构建之后切换 `ModelInvocationRequest.providerKind`，默认产品 model service 必须是 provider-kind 分发器，而不是单一 provider 实现。

## 变更范围（What Changes）

- 向 `@nextagent/agent-contracts/model` 新增公共 `ModelGatewayProvider`：
  - `providerId`
  - `supportedProviderKinds`
  - `createModelService(): ModelInvocationService`
- 为产品 app composition 新增 `modelGatewayProviders` 支持。
- 在产品 app composition 中构建默认的按 provider-kind 分发的 `ModelInvocationService`：
  - `OPENAI` 请求分发到 OpenRouter 支撑的 service。
  - `MODEL_GATEWAY` 请求分发到可信的 `ModelGatewayProvider` service。
- 当所选产品 model provider kind 是 `MODEL_GATEWAY`，或任何启用的 model profile 使用 `MODEL_GATEWAY` 时，要求该 provider SPI。
- 仅当存在 remote gateway 选择时才允许 `MODEL_GATEWAY`。
- 当 model gateway provider 缺失、重复、歧义、不支持 `MODEL_GATEWAY` 或在没有 remote gateway 选择的情况下使用时，快速失败。
- 保持显式 `model` 注入作为既有的可信覆盖路径，供测试/composed 调用方使用。

## 影响范围（Impact）

- 公共 contract：`@nextagent/agent-contracts/model`。
- App composition：产品入口的 model service 选择。
- 测试：远程 `MODEL_GATEWAY` provider 创建和 local-gateway 拒绝的主路径 characterization。

## 非目标（Non-Goals）

- 不向公共 contract 新增 provider 原生的请求/响应 DTO。
- 不新增通用 gateway store、Record、持久化表或 gateway binding 字段。
- 不向 provider SPI 新增 fallback/路由策略；fallback 只能改变 `ModelInvocationRequest.providerKind`，分发器路由的是这个已经解析完成的请求。
