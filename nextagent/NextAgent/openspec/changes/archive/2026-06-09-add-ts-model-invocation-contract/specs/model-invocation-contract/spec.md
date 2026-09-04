## ADDED Requirements

### Requirement: 调用语义定义一个稳定的 invocation 能力
本能力 SHALL 使用 `ModelInvocationRequest`、`ModelInvocationService`、`ModelStreamDelta` 和 `ModelFinalResult` 定义一个稳定 model invocation 能力的 lifecycle 语义。

当前的最小流程 contract SHALL 被视为 review baseline，而不是最终的长期 contract 形状。

`agent-model` SHALL 拥有从 provider 原生调用接口与结果到暴露给上游 package 的标准 invocation 结果边界的转换。

Public model contract 只有在这些语义是 provider 中立且稳定的时候，才 MAY 镜像已经过 review 的 AI SDK 语义。Public contract MUST 保持为 NextAgent 自有，并且 MUST NOT 导入、暴露或承诺与 AI SDK DTO、stream part union、providerOptions wire shape、provider error、client 对象或 provider 特定 metadata 的兼容性。

#### Scenario: 调用文档已被 review
- **WHEN** 本 change 被用作设计输入
- **THEN** 它 MUST 被解释为目标 invocation 语义，而不是平行的或 provider 特定的 invocation model

#### Scenario: Provider 结果被转换
- **WHEN** 某 provider 返回内容、tool-call 数据、terminal metadata 或失败信息
- **THEN** `agent-model` MUST 在任何上游 package 消费之前，把该 provider 原生结果转换为标准的 `ModelFinalResult` 或 stream normalization 边界

### Requirement: Model invocation 作为 request-step 执行阶段被触发
Model invocation SHALL 在 context 渲染、profile 选择以及 step 级 budget/cancellation 检查完成之后，于请求执行期间发生。

#### Scenario: 请求到达 model step
- **WHEN** 某个请求进入其 model 执行 step
- **THEN** 调用方 MUST 提供一个完全解析好的 `ModelInvocationRequest`

### Requirement: 目标状态的请求字段是稳定的 invocation 输入
`ModelInvocationRequest` SHALL 携带目标状态的稳定 invocation 输入：`locale`、`providerKind`、`modelName`、`baseUrl`、`credentialRef`、`messages`、`tools`、`commonOptions`、`providerOptions` 和 `timeoutMs`，作为 public invocation contract 的一部分。诸如 `temperature`、`maxOutputTokens`、`topP` 和 `thinking` 这类跨 provider 选项 SHALL 放在 `commonOptions` 内携带，而不是重复为顶层请求字段。

本 change SHALL NOT 向 `agent-contracts` 添加单独的 `language` 字段；语言与地区语义 SHALL 由现有的 `locale` 字段承载。

本 change SHALL review 当前最小流程字段是否适合作为长期 contract 字段。至少，该 review MUST 覆盖：

1. `providerKind` 是否混同了 provider family、adapter 选择、route/profile 选择或部署 endpoint 语义
2. `ModelFinalResult.finishReason?: string` 将如何使用稳定的 provider 中立词汇表被替换为 `ModelFinalResult.finishReason?: ModelFinishReason`
3. `providerOptions: JsonObject` 将如何被精化为 provider 中立的 `ModelCommonOptions` 加上 adapter 自有的 `ModelProviderOptions` schema / allowlist 校验
4. `messages` 和 `tools` 将如何被精化为 provider 中立的 `ModelMessage`、`ModelMessageContentPart` 和 `ModelToolDescriptor` contract，以支撑长期的 tool calling 与消息协议配对

#### Scenario: 组装 invocation 请求
- **WHEN** 调用方准备 `ModelInvocationRequest`
- **THEN** 它 MUST 在进入 `agent-model` 之前解析 provider 身份与访问字段

### Requirement: 在 provider 执行前校验 invocation 前置条件
在 provider 执行开始之前，invocation 边界 MUST 至少校验：

1. 请求身份存在
2. provider/model/access 字段可用
3. messages 可用
4. 请求或 step 未被取消
5. budget 允许执行

#### Scenario: Budget 禁止 model 执行
- **WHEN** 请求 step 在 invocation 开始之前超出其允许的 budget
- **THEN** provider 执行 MUST NOT 开始

### Requirement: 非流式与流式 invocation 共享一个 terminal result contract
非流式 invocation 与流式 invocation SHALL 收敛到相同的 terminal `ModelFinalResult` 语义。

`ModelStreamDelta` 表示流式期间有序的 provider 中立增量事实，`ModelFinalResult` 表示 terminal 结果。

流式事实和 terminal 结果 SHALL 保留双语执行追踪所需的 invocation locale 关联。TS 首个版本 MAY 通过 invocation 请求和 runtime 拥有的 request context / timeline 关联来保留这一关联，而不是把 `locale` 重复到每个 delta 和 terminal result 中。

TS 首版目标状态 SHALL 通过 provider 或 AI SDK 原生非流式调用实现 `complete()`，并 SHALL 把原始响应 normalize 为与流式 invocation 相同的 `ModelFinalResult` 语义。`complete()` MUST NOT 以聚合 `stream()` 作为其实现，并且 MUST NOT 引入平行的 public invocation 协议或分歧的 terminal 语义。

#### Scenario: 流式 invocation 完成
- **WHEN** 某个 stream 成功结束
- **THEN** terminal result MUST 可通过与 `complete()` 所使用的相同 `ModelFinalResult` 语义被消费

#### Scenario: 非流式 provider API 可用
- **WHEN** 某 provider 或 AI SDK 为所请求的 model 提供原生非流式调用
- **THEN** `complete()` MUST 使用该原生非流式调用，并且 MUST NOT 以聚合 `stream()` 作为其实现
- **AND** 原始 provider 响应仍 MUST 被 normalize 为共享的 `ModelFinalResult` terminal 语义

### Requirement: Terminal finish reason 是 provider 中立的
`ModelFinalResult.finishReason` SHALL 暴露 provider 中立的 terminal 语义，而不是原始的 provider finish reason 字符串。

目标 contract 精化 SHALL 引入 `ModelFinishReason`，并在本 contract 被提升为长期 baseline 之前，把 `ModelFinalResult.finishReason?: string` 替换为 `ModelFinalResult.finishReason?: ModelFinishReason`。

稳定词汇表 SHALL 至少包含 `stop`、`length`、`tool-calls`、`content-filter`、`error` 和 `unknown`。

#### Scenario: Provider 返回原始 finish reason
- **WHEN** 某 provider 返回 provider 原生的 finish reason
- **THEN** `agent-model` MUST 在暴露 `ModelFinalResult` 之前把它映射为 `ModelFinishReason`

### Requirement: Messages 和 tools 是 provider 中立的 contract 输入
目标 contract 精化 SHALL 用 provider 中立的 message 和 tool contract 替换当前最小的 `ChatMessage.content: string`、`toolCallId?` 和 `tools: JsonObject[]` baseline。

目标 message contract SHALL 为 model 输入定义 `ModelMessage` 和 `ModelMessageContentPart` 语义，包括 role、文本内容以及显式的 tool-call / tool-result 配对。多部分内容和附件引用 SHALL 作为精化的一部分被 review，并要么纳入目标 contract，要么显式延期。

目标 tool contract SHALL 定义以 capability binding、稳定 tool 名称、可选 description 和 provider 中立 input schema 为中心的 `ModelToolDescriptor` 语义。AI SDK 的 message、tool、tool part 以及 provider 特定的 tool schema 类型 MUST NOT 进入 `agent-contracts`；`agent-model` MUST 在内部把 provider 中立 contract 映射到 AI SDK。

#### Scenario: Model 请求包含 tools
- **WHEN** 调用方为 invocation 准备 model tools
- **THEN** public 请求 MUST 把它们表达为 provider 中立的 `ModelToolDescriptor` 值，而不是原始的 AI SDK tool 定义

#### Scenario: 组装 tool result 消息
- **WHEN** 某 tool result 被包含在 model 输入中
- **THEN** public message contract MUST 保留 tool-call / tool-result 配对，而不要求上游 package 构造 AI SDK message part

### Requirement: Provider option 在 adapter 自有的 schema 之后校验
目标 contract 精化 SHALL 用 provider 中立的公共选项加上 adapter 自有的 provider option schema / allowlist 校验，替换当前无约束的 `providerOptions: JsonObject` baseline。

具有稳定跨 provider 语义的公共 model 选项 SHALL 被表示为 provider 中立的 contract 字段或 `ModelCommonOptions`。Provider 特定选项 SHALL 保持在 adapter 自有的 schema 和受控 namespace 之后。AI SDK 的 `providerOptions` wire shape、provider 原生 option 对象、函数、class 实例和类凭据的 option 值 MUST NOT 进入 public contract。

在 provider 执行开始之前，`agent-model` MUST 依据所选 adapter 的 schema / allowlist 校验 provider 特定选项。无效、未知或不安全的 provider 选项 MUST 在 provider 访问之前失败，并且 MUST NOT 在错误、日志、指标、trace、audit 或用户可见输出中暴露原始 option 值。

#### Scenario: Provider 特定选项被允许
- **WHEN** 请求在所选 adapter 的受控 namespace 下包含一个 provider 特定选项
- **THEN** `agent-model` MUST 在把它映射为 AI SDK provider option 之前，依据该 adapter 的 schema 校验它

#### Scenario: 供给了未知的 provider 选项
- **WHEN** 请求包含未知 namespace、未知 option、错误类型或原始 AI SDK provider option 对象
- **THEN** provider 执行 MUST NOT 开始
- **AND** 该失败 MUST 是安全的，并且 MUST NOT 暴露原始 option 值

### Requirement: Profile timeout 约束 provider 执行
invocation 边界 SHALL 在 provider 执行开始之前，把上层 cancellation 信号与 invocation profile 的 `timeoutMs` 合并。

#### Scenario: provider 执行期间 profile timeout 到期
- **WHEN** provider 执行超出 invocation profile 的 `timeoutMs`
- **THEN** provider 执行 MUST 被取消，AND 该 invocation MUST 以安全的 timeout 失败结束

### Requirement: 失败出口显式且安全
如果 invocation 无法产生成功的 terminal result，它 MUST 通过 `ModelFinalResult.safeError` 呈现一个显式的 terminal 失败。

`agent-model` MUST NOT 在 invocation 边界内部静默切换 profile。

#### Scenario: Provider 调用失败
- **WHEN** provider 执行失败
- **THEN** terminal result MUST 携带安全的失败结果，AND `agent-model` MUST NOT 静默调用另一个 profile
