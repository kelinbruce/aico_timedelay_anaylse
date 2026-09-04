## Function

- **所属 Function**：`FN-5.2 调用能力`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Executors Return Results Without Owning Runtime Side Effects

Capability executor MUST 返回 `CapabilityInvocationResult`，MUST NOT 直接写入 runtime timeline event、session message、checkpoint、audit sink、terminal commit 或 Agent/Core loop state。Runtime/Core 管理的副作用 MUST 保持在既有受治理生命周期边界之后。

系统 MUST 显式消费 Capability result 的 `status`、`structuredPayload`、`generatedMessages`、`contextPatch`、`resultRef`、`artifactRefs`、`safeError`、`fallbackTriggered` 和安全 metadata。`SUCCEEDED` result MUST 把安全 `structuredPayload` 和安全 refs 暴露为 tool-call result。`DEGRADED` result MUST 发出降级通知，并仍暴露安全 `structuredPayload` 和安全 refs。`FAILED` 和 `TIMED_OUT` result MUST 发出安全失败或超时，MUST NOT 被视为成功 tool result。只有既有模型恢复 policy 允许后续模型步骤时，模型可恢复的安全失败 MAY 产生有界 `CAPABILITY_RESULT` fact；policy 不允许时 MUST 直接按该安全失败结算。不可恢复的 `AUTHORIZATION | POLICY_DENIED | INTERNAL | CANCELED` 失败 MUST 在产生有界 evidence 后 fail closed，MUST NOT 继续 tool loop。

由 result 驱动的 generated messages 和 allowed-tool patch MUST 保持在当前 request 内。系统 MUST NOT 把 `generatedMessages` 持久化为用户 session message，Capability executor MUST NOT 修改 Agent assembly、catalog state、provider configuration、session configuration 或其他 runtime-owned fact。

`CapabilityInvocationResult.contextPatch` MUST 为后续模型步骤使用 canonical optional `modelId` 和 optional `modelOptions`。`modelId` MUST 使用模型调用契约定义的同名 scalar 约束。`modelOptions` MUST 复用 canonical `ModelInferenceOptions` contract，并 MUST 是封闭对象，其 optional fields MUST 恰好为 `temperature`、`maxOutputTokens`、`topP`、`topK`、`presencePenalty`、`frequencyPenalty`、`thinking` 和 `providerOptions`；前七个字段 MUST 使用 `ModelInvocationRequest` 的同名约束，`providerOptions` MUST 为非 null `JsonObject`。`providerOptions` MUST 仅在当前 result 由受治理 Skill Tool 从已通过 source admission、manifest validation 和 Skill resolution governance 的 `SkillMetadata.modelOptions.providerOptions` 原样映射时构成授权来源；任意其他 Capability result、Capability 参数、模型输出或 metadata 提供该字段时 MUST 被拒绝。`modelId` 缺失 MUST 表示该 patch 不覆盖后续模型选择；`modelOptions` 缺失 MUST 表示该 patch 不覆盖任何模型参数。`modelOptions` 中缺失的单个字段 MUST 表示不覆盖该字段，后续 effective value 继续按模型调用契约的 profile/prompt/Skill/request/fixed-default/provider-default 矩阵解析；Capability patch 自身 MUST NOT 为这些字段建立默认值或空 `providerOptions`。显式 `null`、closed schema 未列出的字段以及 provider access、transport、timeout 或 retry control MUST 被拒绝。

已接受的模型 patch MUST 先基于当前 accepted Agent assembly 和 request/run 通过模型选择与治理校验，才能影响后续模型步骤。该 patch MUST 保持在当前 request 内，MUST NOT 修改 Agent assembly、session configuration、provider configuration、catalog state、global model profile 或持久化 session state。非法、未授权或未治理的 patch MUST 安全失败，MUST NOT 被静默应用或忽略。已接受的 patch 与后续模型选择 MUST 使用同一个 canonical `modelId`。

**需求类别**：功能性需求

#### Scenario: Generated messages 保持受控

- **WHEN** 一次 Capability 调用返回 `generatedMessages`
- **THEN** 每条 generated message MUST 使用 `USER` role
- **AND** 系统 MUST 只把 generated messages 追加到当前 request/run 的后续模型输入
- **AND** 系统 MUST NOT 把 generated messages 持久化为用户 session messages

#### Scenario: Context patch 不能扩张 Capability 权限

- **WHEN** Capability result 包含 `contextPatch.allowedTools`
- **THEN** 系统 MUST 确保它是当前 request scope 已授权且可见 Capability ids 的子集
- **AND** 该 patch MUST NOT 永久修改 Agent assembly、provider configuration、session configuration 或 catalog state

#### Scenario: 受治理模型 patch 只在当前 request 内生效

- **WHEN** Capability result 返回通过 schema 校验的 `contextPatch.modelId` 或 `contextPatch.modelOptions`
- **AND** 模型选择与治理校验批准该 patch 用于当前 accepted Agent 和 request/run
- **THEN** 系统 MUST 只把它应用到同一 request/run 的后续模型步骤
- **AND** durable Agent、session、provider、catalog 或 model profile configuration MUST NOT 发生变化

#### Scenario: 模型 patch 遵守封闭 schema

- **WHEN** Capability result 的 `contextPatch` 或 `modelOptions` 包含 contract 未列出的字段
- **THEN** result validation MUST 拒绝该 patch
- **AND** 后续模型选择与调用 MUST NOT 消费该字段

#### Scenario: 模型 patch 省略可选字段

- **WHEN** Capability result 的 `contextPatch` 省略 `modelId`、`modelOptions` 或 `modelOptions` 中的某个字段
- **THEN** 省略字段 MUST NOT 覆盖后续模型选择或对应模型参数
- **AND** 系统 MUST NOT 为省略字段合成 Capability-specific 默认值

#### Scenario: Skill model patch 携带受治理 provider options

- **WHEN** 受治理 Skill Tool 从当前 resolved Skill 的 accepted metadata 原样映射结构合法的 `providerOptions`
- **THEN** result validation MUST 接受该字段进入同一 request/run 的后续模型参数治理
- **AND** 最终 selected provider MUST 在 provider execution 前校验该对象

#### Scenario: 拒绝未授权 provider options 或 provider access patch

- **WHEN** 非 Skill Tool Capability result、Capability 参数、模型输出或 metadata 提供 `providerOptions`，或任一 context patch 包含 provider identity、endpoint、credential、header、transport、timeout 或 retry 字段
- **THEN** result validation MUST 拒绝该 patch
- **AND** 后续模型步骤 MUST NOT 消费提供的值

#### Scenario: Result refs 保持 opaque

- **WHEN** Capability result 包含 `resultRef` 或 `artifactRefs`
- **THEN** 系统 MUST 只把安全 ref identifier 或安全 summary 写入 Capability result metadata
- **AND** 系统在消费 result 时 MUST NOT 读取引用内容、展开本地路径或内联 artifact content

## Function 变更汇总

### 输入

- **变更类型**：修改
- **目标内容**：`CapabilityInvocationResult.contextPatch` 的模型选择输入使用 optional canonical `modelId` 和八字段 closed `modelOptions`；其中 `providerOptions` 只接受受治理 Skill Tool 从 accepted Skill metadata 的映射。
- **依据 Requirements**：`Executors Return Results Without Owning Runtime Side Effects`

### 处理过程

- **变更类型**：修改
- **目标内容**：模型 patch 在当前 accepted Agent 和 request/run scope 内通过统一模型选择治理后才能影响后续模型步骤；合法 patch 只保留在 request-local state，非法或越权 patch 安全失败。
- **依据 Requirements**：`Executors Return Results Without Owning Runtime Side Effects`

### 结果

- **变更类型**：修改
- **目标内容**：合法 patch 只影响同一 request/run 的后续模型步骤；不得修改 Agent、session、provider、catalog 或全局模型配置。未授权 `providerOptions`、provider access、timeout、retry 和 closed schema 外字段被拒绝。
- **依据 Requirements**：`Executors Return Results Without Owning Runtime Side Effects`

### 主规格

- **变更类型**：修改
- **目标内容**：`capability-catalog`
- **依据 Requirements**：`Executors Return Results Without Owning Runtime Side Effects`
