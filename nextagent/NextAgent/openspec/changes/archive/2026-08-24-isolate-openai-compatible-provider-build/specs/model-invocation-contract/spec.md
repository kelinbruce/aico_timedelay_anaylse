# model-invocation-contract Delta

## Function

- **所属 Function**：`FN-4.1 调用模型`
- **Function 变更类型**：修改
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Model provider runtime capability is explicit and build-scoped

系统 SHALL 在启动装配阶段确定当前服务可用的 provider runtime capability，并在模型目录发布前把每个 configured `providerId` 解析到唯一可用 provider runtime。默认服务 capability MAY 同时包含 `openai-compatible` 与 `model-gateway`；`model-gateway-only` 服务 capability MUST 只包含 `model-gateway`。公共模型调用契约、目录契约和 safe error 契约 MUST NOT 暴露 provider SDK object、provider-native DTO 或构建内部 registration 细节。

`model-gateway-only` 服务遇到任一 `modelProfiles[].providerId="openai-compatible"` 配置时，startup MUST fail closed，MUST NOT 发布该 provider 的模型目录，MUST NOT 接受后续模型调用，且 MUST 产生安全诊断 code `MODEL_PROVIDER_BUILD_PROFILE_INCOMPATIBLE`。默认服务包含 `openai-compatible` capability 时，MUST 保持既有配置校验、目录和调用行为；provider 未配置时仍按既有 `DEGRADED_READY` 与 `MODEL_PROVIDER_NOT_CONFIGURED` 语义处理。

**需求类别**：功能性需求

#### Scenario: 默认服务继续支持 OpenAI-compatible
- **WHEN** 默认服务配置合法的 `openai-compatible` model profile
- **THEN** 启动装配注入 OpenAI-compatible provider runtime capability
- **AND** 模型目录和模型调用继续使用既有 provider-neutral contract

#### Scenario: model-gateway-only 服务配置兼容
- **WHEN** `model-gateway-only` 服务的 `modelProfiles` 只包含合法 `model-gateway` provider profile
- **AND** 可信启动装配提供恰好一个 Model Gateway provider
- **THEN** startup 继续装配模型目录和调用服务
- **AND** 运行行为不依赖 OpenAI-compatible provider runtime

#### Scenario: model-gateway-only 服务遇到 OpenAI-compatible 配置
- **WHEN** `model-gateway-only` 服务的任一 `modelProfiles[].providerId` 为 `openai-compatible`
- **THEN** startup 在模型目录发布前 fail closed
- **AND** 安全诊断只标识 provider 不被当前构建支持
- **AND** 系统不发布可用性误导的模型目录，也不接受后续模型调用

#### Scenario: 缺失 provider runtime capability
- **WHEN** configured provider 需要某 provider runtime，而启动装配没有提供对应 registration
- **THEN** startup MUST fail closed
- **AND** 诊断不得暴露 provider access 配置、credential 或 SDK raw error

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：调用模型服务在启动时拥有显式 provider runtime capability；`model-gateway-only` 构建只支持 `model-gateway`，遇到 `openai-compatible` 配置时启动前安全失败。
- **依据 Requirements**：`Model provider runtime capability is explicit and build-scoped`

### 规格

- **规格项**：Provider runtime 构建能力
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：默认能力包含 `openai-compatible | model-gateway`；`model-gateway-only` 能力只包含 `model-gateway`
- **依据 Requirements**：`Model provider runtime capability is explicit and build-scoped`

### 主规格

- **变更类型**：修改
- **目标内容**：`model-invocation-contract`
- **依据 Requirements**：`Model provider runtime capability is explicit and build-scoped`
