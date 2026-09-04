# model-invocation-contract Specification

## Purpose
定义统一模型目录与调用契约，使调用方通过 canonical `modelId`、provider-neutral 输入和可信调用 scope 获得规范化的流式或非流式结果、安全失败、受控扩展参数以及一致的超时和重试语义。

## Function

- **所属 Function**：`FN-4.1 调用模型`
- **spec 角色**：主规格
## Requirements
### Requirement: Invocation semantics define one stable invocation capability

本 capability SHALL 通过 NextAgent-owned `ModelInvocationRequest`、`ModelInvocationService`、`ModelStreamDelta` 和 `ModelFinalResult` 定义统一模型调用语义。模型边界 SHALL 把 provider-native 调用和结果转换为该公共边界；public contract MUST NOT 暴露或承诺兼容 provider-native DTO、stream event、option wire shape、error、client object 或 metadata。

**需求类别**：系统质量属性
**质量属性**：可维护性
**适用范围**：该 Function

#### Scenario: Provider 返回 native result
- **WHEN** provider 返回 content、tool call、terminal metadata 或 failure
- **THEN** 模型边界先归一化为 NextAgent-owned contract
- **AND** 上游消费者不消费 provider-native object

#### Scenario: Model Gateway 接收 canonical invocation scope
- **WHEN** selected model 绑定 `providerId=model-gateway` 的 invocation capability
- **THEN** 模型调用 MUST 把已校验的单一 `ModelInvocationScope` 随 canonical request 完整交付给该模型能力
- **AND** optional run coordinates MUST 只作为 correlation facts
- **AND** scope MUST 限制在 trusted invocation envelope，且 MUST NOT 进入下游模型可见消息、tool result 或 provider-native model body

### Requirement: Model invocation is triggered as a request-step execution stage

模型调用 SHALL 在模型选择及适用的 budget/cancellation 校验完成后，于受治理的 request-run 或 background lifecycle 中发生。调用方 MUST 提供已选 `modelId`、真实 invocation scope 以及渲染后的 messages 和 tools；调用方 MAY 提供规格允许的可选顶层推理参数、`providerOptions`、`timeoutMs` 和 `maxRetries`，但 MUST NOT 解析或复制 provider access configuration。受信任 run-bound orchestration MUST 把 owning `stepId` 的同一值作为 `operationId` 与 accepted run coordinates 原子写入单一 scope；owning background lifecycle MUST 把其已冻结 cycle/post-terminal identity 作为 `operationId`，并仅在存在真实相关 run 时携带完整 causal correlation。run-bound/background lifecycle 由可信调用路径决定，MUST NOT 从 scope shape 推断。locale 只用于上游模型选择、prompt template matching 和 rendering，MUST NOT 进入模型调用 request。provider 确有 locale-specific option 时，MUST 只由通过 selected-provider reserved-field validation 的 `providerOptions` 表达；模型调用契约不定义 locale header 或 generic locale 字段。

**需求类别**：功能性需求

#### Scenario: 请求进入模型执行步骤
- **WHEN** 请求进入模型执行 step
- **THEN** 调用方为已选择 `modelId` 提供完整渲染的 `ModelInvocationRequest`
- **AND** 模型边界从自身目录解析 provider access

### Requirement: Target-state request fields are stable invocation inputs

`providerOptions` SHALL be a non-null `JsonObject`. When merging `providerOptions` across precedence layers (profile, prompt template, capability patch, trusted request, hook), the merge MUST be a top-level shallow merge: keys in later layers replace same-named keys in earlier layers, but keys only present in earlier layers MUST be preserved. Nested objects within `providerOptions` are replaced wholesale (not deep-merged).

`modelParams` SHALL be an optional `JsonObject` carrying opaque recipe-level model parameters. It MUST NOT be interpreted by the workflow or contract layer; the provider expands its fields into the HTTP request body top-level. When merging, `modelParams` from the override replaces `modelParams` from the base (not merged).

When `thinking.depth` is `"OFF"`, the openai-compatible provider MUST inject `enable_thinking: false` into the HTTP request body via the `transformRequestBody` channel, and MUST also inject `chat_template_kwargs: { enable_thinking: false }` for vLLM gateway compatibility. The provider MUST NOT send `reasoning_effort` when `thinking.depth` is `"OFF"`. When `thinking.depth` is `undefined`, the provider MUST NOT inject any reasoning or enable_thinking configuration.

#### Scenario: OFF depth injects enable_thinking false and chat_template_kwargs

- **GIVEN** a model invocation request has `thinking: { depth: "OFF" }`
- **WHEN** the openai-compatible provider prepares the invocation
- **THEN** the HTTP request body MUST include `enable_thinking: false`
- **AND** the HTTP request body MUST include `chat_template_kwargs: { enable_thinking: false }`
- **AND** the HTTP request body MUST NOT include `reasoning_effort`

#### Scenario: Undefined depth does not inject reasoning

- **GIVEN** a model invocation request does not have `thinking`
- **WHEN** the openai-compatible provider prepares the invocation
- **THEN** the HTTP request body MUST NOT include `reasoning_effort`
- **AND** the HTTP request body MUST NOT include `enable_thinking`
- **AND** the HTTP request body MUST NOT include `chat_template_kwargs`

#### Scenario: providerOptions shallow-merge preserves base keys

- **GIVEN** base `providerOptions` is `{ key_a: "base" }`
- **AND** override `providerOptions` is `{ key_b: "override" }`
- **WHEN** the options are merged
- **THEN** the result MUST be `{ key_a: "base", key_b: "override" }`

#### Scenario: modelParams override replaces base

- **GIVEN** base `ModelInferenceOptions` has `modelParams: { temperature: 0.5 }`
- **AND** override `ModelInferenceOptions` has `modelParams: { top_p: 0.9 }`
- **WHEN** the options are merged
- **THEN** the result `modelParams` MUST be `{ top_p: 0.9 }`

#### Scenario: modelParams expanded into request body

- **GIVEN** a model invocation request has `modelParams: { temperature: 0.7, seed: 42 }`
- **WHEN** the openai-compatible provider prepares the invocation
- **THEN** the HTTP request body MUST include `temperature: 0.7` and `seed: 42` at top level

### Requirement: Invocation preconditions are validated before provider execution

provider execution 开始前，模型调用边界 MUST 校验真实 invocation scope、selected `modelId`、Agent activation、模型可用性、messages、tools、全部可选调用参数、cancellation 和 execution budget。run-bound 调用 MUST 在发布 started fact 前把 scope 的完整 session/request/run/operation coordinates 与 accepted run/context 原子校验；scope shape MUST NOT 决定 lifecycle。模型边界 MUST 在不发生 provider access 的情况下拒绝 unknown、`UNAVAILABLE` 或 non-activated model。当且仅当 `providerId=model-gateway` 时，`modelId` 资格检查（`assembly.modelIds.includes(request.modelId)`）MUST 被跳过；`assemblyRef` 校验 MUST 仍然强制执行。此例外允许 Gateway 透传 recipe 中指定但未在 Agent assembly 中激活的 `modelId`。非 `model-gateway` provider 不受此例外影响。

**需求类别**：功能性需求

#### Scenario: 已选模型可调用
- **WHEN** `modelId` 在目录中为 `AVAILABLE`，且属于 invocation scope 标识的 accepted Agent assembly
- **THEN** 调用 MUST 通过该 model profile 对应的唯一受信 provider access 继续

#### Scenario: 已选模型不可调用
- **WHEN** `modelId` unknown、`UNAVAILABLE` 或未被 accepted Agent 激活
- **THEN** provider execution 不启动
- **AND** 模型调用返回安全失败

#### Scenario: model-gateway 透传未激活 modelId
- **WHEN** `providerId=model-gateway` 且 `modelId` 不在 `assembly.modelIds` 中，但 `assemblyRef` 匹配
- **THEN** `modelId` 资格检查 MUST 被跳过
- **AND** provider execution MUST 继续

#### Scenario: model-gateway 仍校验 assemblyRef
- **WHEN** `providerId=model-gateway` 且 `assemblyRef` 不匹配
- **THEN** provider execution 不启动
- **AND** 模型调用返回 `MODEL_NOT_ACTIVATED` 安全失败

#### Scenario: Budget 禁止执行
- **WHEN** request step 在调用开始前超出允许 budget
- **THEN** provider execution 不启动

### Requirement: Non-streaming and streaming invocation share one terminal result contract

非流式与流式调用 SHALL 收敛到相同 `ModelFinalResult` 语义。`ModelStreamDelta` 表示有序的 provider-neutral 增量事实，`ModelFinalResult` 表示唯一终态。`ModelFinalResult` MUST 为封闭对象：required field MUST 恰好为 `content`；optional fields MUST 恰好为 `reasoning`、`finishReason`、`incompleteOutputReason`、`usage`、`toolCalls`、`providerResponseId` 和 `safeError`。`incompleteOutputReason` 的类型 MUST 为 `ModelIncompleteOutputReason`，允许值 MUST 恰好为 `output-limit | truncated-tool-call`；字段缺失 MUST 表示系统没有可恢复的不完整输出证据，显式 `null` 和未知值 MUST 被拒绝。`incompleteOutputReason` 与 `finishReason` MUST 是独立事实：系统 MUST 保留 provider-neutral `finishReason`，不得为触发恢复而把 `tool-calls`、`stop` 或 `unknown` 改写为 `length`。

模型身份由对应 `ModelInvocationRequest.modelId` 拥有。provider 返回的 model identity 只作为边界内 normalization input；`providerResponseId` 只用于安全 response correlation。`complete()` MUST 使用 provider 支持的 native non-stream 调用，MUST NOT 聚合 `stream()`。`stream(request, signal, onDelta)` MUST 按顺序 `await` `onDelta` 交付零个或多个 `ModelStreamDelta`，并以 `Promise<ModelFinalResult>` 恰好返回一个终态；终态位置由该 Promise 的完成唯一确定，MUST NOT 把终态混入 delta event union，也 MUST NOT 要求 Core、Workflow 或其他调用方根据重叠字段自行判别最后一个 event。因终态与 delta 已由调用位置分离，流式终态使用与 `complete()` 相同的 `ModelFinalResult` shape，content-only 终态合法，不新增 public terminal discriminator 或 terminal marker schema。统一 model runtime MUST 在 hook 和调用方消费前校验 provider service 返回的终态与 delta；非法结果必须安全失败。

成功终态 MUST 保留归一化 content、存在时的 reasoning、完整 tool calls、provider-neutral finish reason、存在时的 provider-neutral incomplete output reason、存在时的安全 `providerResponseId`，以及 provider 可用时的 best-effort usage。系统 MUST 接受 `finishReason="stop"` 同时携带一个或多个完整 `toolCalls`，并依据非空 `toolCalls` 进入 Tool 分支；系统 MUST NOT 要求该字段只与 `finishReason="tool-calls"` 组合。cancellation、timeout、provider failure 或 normalization failure MUST 产生安全失败终态。

**需求类别**：功能性需求

#### Scenario: Stream 调用方不判别终态事件
- **WHEN** provider-neutral stream 依次产生 delta 并完成模型调用
- **THEN** `ModelInvocationService.stream()` MUST 通过 `onDelta` 交付全部增量
- **AND** MUST 通过返回的 Promise 单独交付唯一 `ModelFinalResult`
- **AND** 调用方 MUST NOT 缓存最后一个 delta 或编译 terminal schema 来识别终态

#### Scenario: 非流式调用完成
- **WHEN** native non-stream provider call 成功
- **THEN** 结果归一化为公共 `ModelFinalResult`
- **AND** 结果 MUST 通过包含 `incompleteOutputReason` 字段间约束的 closed terminal-result schema

#### Scenario: 流式调用完成
- **WHEN** stream 成功结束
- **THEN** `ModelInvocationService.stream()` 返回的 Promise 恰好交付一个成功 `ModelFinalResult`
- **AND** 其 `finishReason` 与 `incompleteOutputReason` 语义 MUST 与非流式成功结果一致

#### Scenario: Provider stream 没有结束事实
- **WHEN** provider stream 在交付零个或多个 delta 后结束，且没有产生 defined `finishReason` 或 provider failure
- **THEN** 模型调用边界 MUST 返回显式安全失败的 `ModelFinalResult`
- **AND** 系统 MUST NOT 把最后一个 delta 解释为成功终态

#### Scenario: Stop 终态同时返回 Tool call
- **WHEN** schema-valid 成功终态包含 `finishReason="stop"` 和一个或多个完整 `toolCalls`，且没有 `incompleteOutputReason`
- **THEN** 系统 MUST 保留这些 Tool calls
- **AND** Agent Core MUST 进入既有 Tool 执行与下一轮路径
- **AND** 系统 MUST NOT 仅因 finish reason 不是 `tool-calls` 而拒绝该结果

#### Scenario: Stream 被取消或失败
- **WHEN** cancellation、timeout、provider failure 或 normalization failure 终止 stream
- **THEN** `ModelInvocationService.stream()` 返回的 Promise 恰好交付一个安全失败 `ModelFinalResult`
- **AND** 该安全失败 MUST NOT 携带 `incompleteOutputReason`

### Requirement: Terminal finish reasons are provider-neutral
`ModelFinalResult.finishReason` SHALL expose provider-neutral terminal semantics rather than raw provider finish reason strings.

The target contract refinement SHALL introduce `ModelFinishReason` and replace `ModelFinalResult.finishReason?: string` with `ModelFinalResult.finishReason?: ModelFinishReason` before this contract is promoted as a long-term baseline.

The stable vocabulary SHALL include at minimum `stop`, `length`, `tool-calls`, `content-filter`, `error`, and `unknown`.

#### Scenario: Provider returns a raw finish reason
- **WHEN** a provider returns a provider-native finish reason
- **THEN** 系统 MUST 在暴露 `ModelFinalResult` 前将其映射为 `ModelFinishReason`

### Requirement: Messages and tools are provider-neutral contract inputs
`ModelMessage` 和 `ModelMessageContentPart` SHALL 定义模型输入的 provider-neutral 语义，包括 role、text content 以及显式 tool-call/tool-result pairing。公共模型调用契约 MUST NOT 暴露 provider SDK message、tool、content part 或 provider-specific tool schema 类型。

`ModelToolDescriptor` SHALL 使用稳定 tool name、optional description 和 provider-neutral input schema 表达模型可见工具。模型调用 MUST 将这些公共契约转换为 selected provider 可接受的输入，并且转换结果 MUST 保持公共契约中的 tool identity 和 pairing 语义。

`ModelToolCall` SHALL carry `toolCallId`, `toolName`, and structured JSON `arguments`. `toolName` SHALL represent the provider-neutral model tool name used in model messages and provider invocation; it SHALL NOT be named `capabilityId` in the public model invocation contract.

`ModelToolResultContentPart` SHALL carry `toolCallId`, `toolName`, and structured JSON `output`. A tool result message SHALL preserve the original tool name needed to pair with the assistant tool call without requiring provider-specific inference from previous messages.

系统 SHALL 在调用 capability 前把 `ModelToolCall.toolName` 解析为当前 Agent 可见的 capability descriptor。Capability invocation、runtime context、timeline、recovery、audit 和 Web projection contracts SHALL 继续使用 `capabilityId` 表示已解析的 NextAgent capability identity。

#### Scenario: Model request includes tools
- **WHEN** the caller prepares model tools for invocation
- **THEN** the public request MUST express them as provider-neutral `ModelToolDescriptor` values rather than provider SDK tool definitions

#### Scenario: Tool result message is assembled
- **WHEN** a tool result is included in model input
- **THEN** the public message contract MUST preserve tool-call / tool-result pairing using `toolCallId` and `toolName` without requiring callers to construct provider SDK message parts

#### Scenario: Provider receives tool messages
- **WHEN** provider-neutral model messages are converted for the selected provider
- **THEN** the converted request MUST use `ModelToolCall.toolName` and `ModelToolResultContentPart.toolName` directly for provider tool names
- **AND** the system MUST NOT infer a tool result name from a previous assistant message when the tool result part already carries `toolName`

#### Scenario: Core resolves model tool calls
- **WHEN** a model result contains `ModelToolCall.toolName`
- **THEN** the system MUST resolve that tool name to a visible capability descriptor for the accepted Agent before capability invocation
- **AND** downstream capability execution MUST use the resolved descriptor's `capabilityId`

### Requirement: Profile timeout constrains provider execution

`ModelProfile.timeoutMs` 和 `ModelInvocationRequest.timeoutMs` SHALL 为可选正整数默认值与调用级覆盖值。请求值存在时 MUST 覆盖 profile 默认值；请求值缺失时 MUST 使用 profile 值；两者都缺失时 MUST 使用 NextAgent 配置 schema 的固定默认值 `30,000 ms`。effective timeout MUST 再受当前 execution budget 剩余时长约束，并 MUST 覆盖一次 logical invocation 的 initial provider request、全部 retry 和全部 backoff 的总墙钟耗时；每次 retry 只能获得该总时限的剩余时长，MUST NOT 重置 timeout。cancellation MUST 独立生效；模型边界 SHALL 以该 effective timeout 作为 provider request、retry 和 backoff 的唯一时限机制。

**需求类别**：系统质量属性
**质量属性**：可靠性/恢复
**适用范围**：该 Function

#### Scenario: 请求未提供 timeout
- **WHEN** `ModelInvocationRequest.timeoutMs` 缺失
- **THEN** provider execution 使用已选 profile 的 timeout 默认值
- **AND** profile 也未配置时使用 NextAgent 固定默认值 `30,000 ms`

#### Scenario: 请求覆盖 profile timeout
- **WHEN** request 和 profile 都声明合法 timeout
- **THEN** provider execution 使用 request timeout

#### Scenario: Execution budget 更短
- **WHEN** 当前剩余 execution budget 小于请求或 profile 解析出的 timeout
- **THEN** effective timeout 使用剩余 execution budget

#### Scenario: Effective timeout 到期
- **WHEN** provider execution 超过 effective timeout
- **THEN** 调用按照 safe timeout failure semantics 结束

#### Scenario: Retry 不重置 timeout
- **WHEN** initial provider request 失败后进入 retry
- **THEN** retry 只能使用 logical invocation effective timeout 的剩余时长
- **AND** initial request、backoff 和 retry 的总墙钟耗时 MUST NOT 超过 effective timeout

### Requirement: Failure exits are explicit and safe

模型调用不能产生成功终态时，MUST 通过 `ModelFinalResult.safeError` 返回显式安全失败。模型边界 MUST 在 `AFTER_MODEL_RESULT` hook 和调用方消费前把 `finishReason="content-filter"` 映射为 `category="POLICY_DENIED"`、`retryable=false` 的安全失败，并移除该终态携带的 content、reasoning、Tool calls 和 `incompleteOutputReason`；它 MUST 把没有 `safeError` 的 `finishReason="error"` 映射为没有 recoverability 证据的 non-retryable 安全失败。没有 Tool call 的 `finishReason="unknown"`，以及没有完整 Tool call 且未携带精确 `incompleteOutputReason="truncated-tool-call"` 证据的 `finishReason="tool-calls"`，MUST 同样安全失败。只有 `finishReason="tool-calls"`、没有完整 Tool call 且 provider 适配层已按 usage 证据标记 `incompleteOutputReason="truncated-tool-call"` 的结果，模型边界 MUST 原样保留其 incomplete 终态且不得增加 `safeError`，交由 Agent core 按 `输出超限不得静默截断` 处理。已有 `safeError` 的 error 终态 MUST 保留其可信 recoverability classification，并 MUST NOT 同时携带 `incompleteOutputReason`。模型边界 MUST NOT 暴露 raw provider result、error、endpoint、credential、header、custom fetch 或内部 lifecycle coordinates，也 MUST NOT 在内部切换模型。usage 缺失、不支持或单个 usage 字段非法不属于模型调用失败；但系统 MUST NOT 因 usage 缺失、部分非法或未达到有效输出预算而推断 `truncated-tool-call`。本 Requirement 不修改 `finishReason="length"` 的恢复顺序。

**需求类别**：系统质量属性
**质量属性**：安全
**适用范围**：该 Function

#### Scenario: Provider 调用失败
- **WHEN** provider execution 失败
- **THEN** 终态结果携带安全失败
- **AND** 模型边界不调用其他模型
- **AND** 终态 MUST NOT 携带 `incompleteOutputReason`

#### Scenario: 具有精确截断证据的空 Tool-call 终态进入恢复
- **WHEN** provider 适配层返回 `finishReason="tool-calls"`、无完整 Tool call 且 `incompleteOutputReason="truncated-tool-call"`
- **THEN** 模型边界 MUST 原样保留该 incomplete 终态且 MUST NOT 增加 `safeError`
- **AND** Agent core MUST 按 `输出超限不得静默截断` 处理该结果

#### Scenario: 缺少或使用错误截断证据的空 Tool-call 终态安全失败
- **WHEN** provider 返回 `finishReason="tool-calls"` 且没有完整 Tool call
- **AND** `incompleteOutputReason` 缺失或不等于 `truncated-tool-call`
- **THEN** 模型边界 MUST 返回 non-retryable `MODEL_TOOL_CALLS_MISSING`
- **AND** `AFTER_MODEL_RESULT` hook、Tool 执行和 terminal success MUST NOT 启动

#### Scenario: Provider content filter 阻断终态
- **WHEN** provider 返回 `finishReason="content-filter"`，无论该结果是否同时携带 content、reasoning、Tool calls 或输出预算证据
- **THEN** 模型边界 MUST 在 `AFTER_MODEL_RESULT` hook 和调用方消费前返回 non-retryable `POLICY_DENIED` 安全失败
- **AND** 失败终态 MUST NOT 交付 content、reasoning、Tool calls 或 `incompleteOutputReason`

#### Scenario: Error 终态没有 recoverability 证据
- **WHEN** provider 返回 `finishReason="error"` 且没有 `safeError`
- **THEN** 模型边界 MUST 返回 non-retryable 安全失败
- **AND** Agent Core MUST NOT 仅按 error category 或输出 Token 数推断可恢复输出

#### Scenario: 结束原因与结果不完整但没有截断证据
- **WHEN** provider 返回没有完整 Tool call 的 `finishReason="tool-calls"`、`stop` 或 `unknown`，且 usage 缺失、部分非法或 `outputTokens` 小于本次有效 `maxOutputTokens`
- **THEN** 模型边界 MUST 返回 non-retryable 安全失败
- **AND** `AFTER_MODEL_RESULT` hook、输出恢复、Tool 执行和 terminal success MUST NOT 启动

#### Scenario: 只有 usage 不完整
- **WHEN** provider output 可安全归一化，但 usage 缺失或部分非法
- **THEN** 模型调用保持成功
- **AND** 终态只省略不可用 usage 字段

### Requirement: 输出超限不得静默截断

当模型终态携带 `incompleteOutputReason` 时，系统 MUST 把该结果视为可恢复的不完整输出，不得直接提交 terminal success，也不得执行该结果携带或尚未完整形成的 Tool call。模型边界 MUST 对没有结构残缺 Tool call 的 `finishReason="length"` 输出设置 `incompleteOutputReason="output-limit"`。当 Tool call 结构残缺时，模型边界仅在以下任一条件成立时 MUST 设置 `incompleteOutputReason="truncated-tool-call"`：provider-neutral `finishReason="length"`；或者 `finishReason` 为 `tool-calls | stop | unknown`，且合法 `usage.outputTokens` 不小于本次有效 `maxOutputTokens`。后一个比较 MUST 使用整数 Token 值且不设置容差；不满足任何条件时 MUST 按 `Failure exits are explicit and safe` 返回安全失败。`content-filter`、`error` 和已有 `safeError` MUST 优先于上述推断且不得携带 `incompleteOutputReason`。

Agent core MUST 依据 `incompleteOutputReason` 而不是 `finishReason` 进入唯一输出恢复流程。没有可见 content、没有 Tool call、存在非空 reasoning、携带 `incompleteOutputReason="output-limit"` 且没有 `safeError` 的终态 MUST 被识别为 reasoning-only 输出耗尽。当前 model round 首次出现 reasoning-only 输出耗尽时，Agent core MUST 在保持本次有效 `maxOutputTokens` 不变的情况下，注入一次 request-local reasoning-only 收敛指令并重试；MUST NOT 在该收敛重试前提升输出预算。该指令 MUST 要求模型立即返回简洁的用户可见回答或一次必要 Tool call，MUST NOT 要求或重复内部推理。该收敛重试在当前 model round 内 MUST 至多发生一次，且收敛指令 MUST NOT 作为独立 session message 持久化。

收敛重试没有 `incompleteOutputReason`、没有 `safeError` 且满足既有 terminal output guard 时，系统 MUST 正常提交完整回答或执行完整 Tool call。收敛重试转为带非空可见 content、没有 Tool call 的 `incompleteOutputReason="output-limit"` 时，系统 MUST 按普通 `output-limit` 从一次同请求预算提升开始恢复。收敛重试再次形成 reasoning-only 输出耗尽时，当前 route MUST 以既有 retryable `MODEL_EMPTY_OUTPUT` 安全失败进入 cross-model fallback；该 route MUST NOT 再提升输出预算、发起 continuation 或提交空终态。没有可用 fallback 或 fallback 耗尽时，请求 MUST 以安全失败结束。

除 reasoning-only 输出耗尽外，Agent core MUST 先对 `incompleteOutputReason` 尝试一次同请求预算提升。`incompleteOutputReason="output-limit"` 的预算提升结果仍为带非空可见 content、没有 Tool call 的 `output-limit` 时，系统 MUST 在同一 request run 内最多发起 3 次 request-local 续写。`incompleteOutputReason="truncated-tool-call"` 只允许同请求预算提升重新生成一次；预算提升后仍有任一 `incompleteOutputReason` 时 MUST 安全失败，不得把残缺 Tool call 转成文本续写。只有恢复调用没有 `incompleteOutputReason`、没有 `safeError` 且满足既有 terminal output guard 时，系统才可提交最终回答或执行完整 Tool call。

同请求预算提升 MUST 复用同一模型路由、消息、工具集合、provider-neutral options、timeout 和 cancellation signal，只覆盖 `maxOutputTokens`。提升值 MUST 为原有效值的 8 倍且不超过 `32000 tokens`；同时 MUST 不超过基于当前模型 `contextWindowTokens` 与本次调用可得输入估算计算出的剩余输出窗口。原请求未显式设置 `maxOutputTokens` 时，候选提升值 MUST 为 `32000 tokens`。只有计算结果严格大于原有效值时才发起该次提升重试。

每次续写 MUST 把上一段 assistant 文本和一条隐藏的直接续写指令追加到本次恢复调用的 request-local 消息中，MUST 要求模型直接从截断处继续且不得道歉或复述；中间 assistant 文本和恢复指令 MUST NOT 作为独立 session message 持久化。续写段 MUST 按生成顺序拼接，恢复计数 MUST 以当前 model round 为边界且不得占用 Tool round 预算。

当第 3 次续写仍返回 `output-limit`、任一 `output-limit` 结果携带完整或残缺 Tool call，或恢复阶段产生无法安全接续的 Tool call 时，系统 MUST 发布不含原始输出的 `DEGRADATION_NOTICE` 并以 safe `REQUEST_FAILED` 结束。direct model 可见文本硬上限 MUST 为 `150000` 个 UTF-16 code unit，并继续作为独立于输出 Token 恢复的容量保护。

当一次 direct model route 的累计 provider-neutral 可见文本首次超过 `150000` 个 UTF-16 code unit 时，系统 MUST 立即停止继续消费该模型输出，MUST 发布恰好一次 `DEGRADATION_NOTICE(code=MODEL_TEXT_LIMIT_EXCEEDED)`，且 MUST NOT 启动该 route 的 Token 恢复、cross-model fallback 或执行模型返回的 Tool call。系统 MUST 从已接收的累计文本中保留顺序前缀且 MUST NOT 拆分 UTF-16 surrogate pair；当保留前缀以未闭合的 Markdown code fence 或 table row 结束时，系统 MUST 闭合该结构；随后 MUST 追加固定标记 `[Model output truncated at the 150000-character safety limit.]`，并把总长不超过 `150000` 个 UTF-16 code unit 的结果作为唯一 terminal assistant message 提交；请求 MUST 以 `REQUEST_COMPLETED` 结束。超过容量的后缀和未完整形成的 Tool call MUST NOT 进入 stream 或 history，降级事件、SafeError、audit 和日志 MUST NOT 包含任何模型文本。

当 model delta、capability result 或 terminal assistant message 超过对应 persistence 或 stream 硬安全大小限制时，系统 MUST NOT 静默截断用户可见内容。除 read capability 明确返回 `truncated=true` 与 `nextOffset` 的逐行有界切片、上述 provider 输出恢复流程，以及 direct model `150000` 个 UTF-16 code unit 上限的带固定标记有界交付外，Runtime、Agent core 或对应 boundary MUST 发布 `DEGRADATION_NOTICE` 并以 safe `REQUEST_FAILED` 结束。任何超限与恢复处理 MUST NOT 把 raw prompt、provider-native raw output、Tool result、附件内容、credential、未脱敏路径或超过已声明容量的模型文本后缀写入 SafeError、stream、history、audit 或日志。

**需求类别**：系统质量属性
**质量属性**：可靠性/恢复、安全、性能/容量
**适用范围**：该 Function

#### Scenario: 首次 reasoning-only 输出耗尽在原预算下收敛

- **GIVEN** 当前调用的有效 `maxOutputTokens` 为 `16384`
- **WHEN** 模型首次返回无 content、无 Tool call、reasoning 非空、`incompleteOutputReason="output-limit"` 且无 `safeError` 的终态
- **THEN** Agent core MUST 注入一次 reasoning-only 收敛指令并以 `maxOutputTokens=16384` 重试
- **AND** MUST NOT 在该重试前发起 `maxOutputTokens=32000` 的预算提升

#### Scenario: 收敛重试产出有效结果

- **WHEN** reasoning-only 收敛重试返回没有 `incompleteOutputReason` 和 `safeError` 的非空可见回答或完整 Tool call
- **THEN** 系统 MUST 只消费该完整结果
- **AND** MUST NOT 为当前 model round 再发起预算提升或 reasoning-only 收敛重试

#### Scenario: 收敛后转为普通可见文本超限

- **WHEN** reasoning-only 收敛重试返回非空可见 content、无 Tool call且 `incompleteOutputReason="output-limit"`
- **THEN** Agent core MUST 使用既有同请求规则尝试一次预算提升
- **AND** 预算提升后仍为可续写纯文本 `output-limit` 时 MUST 继续遵循最多 3 次 request-local 续写边界

#### Scenario: 收敛后再次 reasoning-only 耗尽

- **WHEN** reasoning-only 收敛重试再次返回无 content、无 Tool call、reasoning 非空、`incompleteOutputReason="output-limit"` 且无 `safeError`
- **THEN** 当前 route MUST 以 retryable `MODEL_EMPTY_OUTPUT` 安全失败进入既有 cross-model fallback
- **AND** 当前 route MUST NOT 提升输出预算、发起 continuation 或提交空终态
- **AND** 当前 model round MUST NOT 注入第二次 reasoning-only 收敛指令

#### Scenario: 普通文本超限保持先提升预算

- **GIVEN** 当前模型请求的有效 `maxOutputTokens` 为 `2048`
- **WHEN** 模型返回非空可见 content、无 Tool call且 `incompleteOutputReason="output-limit"`
- **THEN** Agent core MUST NOT 注入 reasoning-only 收敛指令
- **AND** MUST 使用相同请求输入把 `maxOutputTokens` 提升为 `16384` 后重试一次

#### Scenario: 残缺 Tool call 保持一次重生成

- **WHEN** 模型返回 `incompleteOutputReason="truncated-tool-call"`
- **THEN** Agent core MUST 只允许一次同请求预算提升重新生成
- **AND** 提升后仍有任一 `incompleteOutputReason` 时 MUST 安全失败且 MUST NOT 执行或续写残缺 Tool call

#### Scenario: 取消中止恢复链

- **WHEN** 当前 request 的 `AbortSignal` 在预算提升、reasoning-only 收敛重试、fallback 或续写期间被取消
- **THEN** 当前模型调用 MUST 被取消
- **AND** 系统 MUST NOT 发起后续恢复调用或提交 late output

#### Scenario: 硬字符上限保留有界内容

- **WHEN** 单次或拼接后的 direct model 可见文本超过 `150000` 个 UTF-16 code unit
- **THEN** 系统 MUST 发布恰好一次 code 为 `MODEL_TEXT_LIMIT_EXCEEDED` 的 `DEGRADATION_NOTICE`
- **AND** MUST 停止继续消费该模型输出，不得通过恢复或 fallback 绕过硬上限
- **AND** MUST 提交按 Requirement 规则形成、以固定截断标记结尾且总长不超过 `150000` 个 UTF-16 code unit 的唯一 assistant message

### Requirement: 全局模型目录提供安全模型配置

系统 MUST 在启动配置完成本地校验后建立进程生命周期内不可变的全局模型目录已配置模型集合。每个通过本地校验并保留在配置中的 `ModelProfile` MUST 进入该集合，并 MUST 以系统内唯一 `modelId` 同时作为 Agent 激活、模型选择、模型调用身份和传给 provider 的模型标识；其父级 `ModelProviderProfile.providerId` MUST 解析到唯一受信 provider access。已配置模型的成员关系、配置顺序和可由本地配置确定的模型事实 MUST 在 ready 前冻结；系统 MUST NOT 因目录发布或 Agent assembly publication 在 ready 前调用 Gateway model-information service。可选 `displayName` 只用于人类可读展示，MUST NOT 参与模型选择、provider 路由或授权。目录消费者 MUST 只观察本 Requirement 定义的安全目录项，MUST NOT 观察或推导 provider 接入配置。

`ModelProfile.modelId` MUST 是去除首尾空白后不为空、长度为 `1..256` 个 Unicode code point 且不包含控制字符的字符串。产品配置允许的 `ModelProviderProfile.providerId` 清单 MUST 恰好为区分大小写的 `openai-compatible | model-gateway`：`openai-compatible` 允许 optional `baseUrl` 和 optional `credentialRef`；`model-gateway` 只在可信启动配置提供恰好一个 `ModelGatewayProvider` 时可用，禁止 `baseUrl` 并允许 optional `credentialRef`。任一 optional credential 缺失都表示不发送 credential。`openai-compatible` 父项在 `baseUrl` 缺失时视为未配置：该父项的子 profile MUST 保留在已配置模型集合中，并在模型目录中以 `UNAVAILABLE`、`unavailableReason=MODEL_PROVIDER_NOT_CONFIGURED` 呈现；这些子 profile MAY 被 Agent assembly 引用，但 MUST NOT 提供可用于选择或调用的 resolved model configuration，模型调用 MUST 返回安全 model-unavailable failure。该父项 MUST NOT 阻止其他 viable provider profile 进入目录。其他 `providerId` 或不符合对应 access shape 的配置 MUST 在目录发布前安全失败；后续增加 provider 类型必须通过独立 extension/config contract change 扩展该清单，不能仅靠配置字符串启用。可选 `displayName` MUST 使用与 `modelId` 相同的非空字符串约束。`fallbackEligible` MUST 为 required boolean。profile 中的 optional `temperature`、`maxOutputTokens`、`topP`、`topK`、`presencePenalty`、`frequencyPenalty`、`thinking`、`toolChoice`、`providerOptions`、`timeoutMs` 和 `maxRetries` MUST 使用 `Target-state request fields are stable invocation inputs` 定义的同名字段约束。每个通过 closed schema、安全校验和 provider access validation 的配置项 MUST 成为目录项；父项已配置接入参数时目录项按本 Requirement 解析 `AVAILABLE`，父项未配置接入参数时目录项 MUST 为 `UNAVAILABLE` 且 `unavailableReason=MODEL_PROVIDER_NOT_CONFIGURED`；部署停用模型时 SHALL 从配置中移除该子项。显式 `null` 和 closed schema 未列出的字段 MUST 在目录发布前被拒绝。

公共目录契约 MUST 使用封闭判别联合 `ModelCatalogEntry`。`availability="AVAILABLE"` 分支的 required fields MUST 恰好为 `availability`、`fallbackEligible` 和 `configuration: ResolvedModelConfiguration`，optional field MUST 恰好为 `displayName`，且 MUST NOT 包含顶层 `modelId` 或 `unavailableReason`。`availability="UNAVAILABLE"` 分支的 required fields MUST 恰好为 `modelId`、`availability`、`fallbackEligible` 和 `unavailableReason`，optional field MUST 恰好为 `displayName`，且 MUST NOT 包含 `configuration`。`unavailableReason` 的允许值 MUST 恰好为 `MODEL_PROVIDER_NOT_CONFIGURED | MODEL_INFORMATION_UNAVAILABLE | MODEL_NOT_FOUND | MODEL_INFORMATION_AMBIGUOUS | CONTEXT_WINDOW_INVALID`。

`ResolvedModelConfiguration` MUST 是封闭不可变对象：required fields MUST 恰好为 `modelId`、正安全整数 `contextWindowTokens`、`temperature`、`maxOutputTokens`、`topP`、required `toolChoice`、单位为 ms 的正安全整数 `defaultTimeoutMs` 和非负安全整数 `defaultMaxRetries`；optional fields MUST 恰好为 `topK`、`presencePenalty`、`frequencyPenalty` 和 `thinking`，并使用 `Target-state request fields are stable invocation inputs` 定义的同名字段约束。available catalog entry 和 `ModelSelectionResult.status="SELECTED"` MUST 复用同一 resolved configuration shape；selection MUST 原样返回命中 available entry 的 frozen `configuration`，MUST NOT 复制、重命名或再次嵌套模型身份。`ModelProfile` 未配置 `temperature`、`maxOutputTokens`、`topP`、`toolChoice`、`timeoutMs` 或 `maxRetries` 时，对应 resolved 值 MUST 分别为 `0.55`、`32,000`、`1`、`AUTO`、`30,000` 和 `2`。

canonical identity、Agent 激活、exact template matching、模型调用请求和 provider invocation MUST 使用同一个 `modelId`；模型边界 MUST 把该值传给命中的 provider。`ModelFinalResult` 的字段集合由 `Non-streaming and streaming invocation share one terminal result contract` 定义。公共模型目录、模型选择、prompt input、模型调用请求和模型调用时间线 MUST NOT 暴露或依赖 `providerId` 或 provider access implementation class。`providerOptions` 和 locale 不属于安全 resolved configuration。所有目录对象 MUST 拒绝 `null`、未知字段、混合判别分支和非法数值。

`ModelProfile` optional fields MUST 使用以下缺省语义：

- `displayName` 缺失时保持缺失，系统 MUST NOT 从 `modelId` 合成 display name；
- `temperature` 缺失时 effective profile default MUST 为 `0.55`；
- `maxOutputTokens` 缺失时 effective profile default MUST 为 `32,000`；
- `topP` 缺失时 effective profile default MUST 为 `1`；
- `toolChoice` 缺失时 effective profile default MUST 为 `AUTO`；
- `timeoutMs` 缺失时 effective profile default MUST 为 `30,000` ms；
- `maxRetries` 缺失时 effective profile default MUST 为 `2`；
- `topK`、`presencePenalty`、`frequencyPenalty`、`thinking` 和 `providerOptions` 缺失时保持缺失。

模型目录与 provider access 解析 MUST 区分三类配置问题：access shape 违反（例如 `openai-compatible` 提供非法 `baseUrl` 值）、provider 未配置（`openai-compatible` 缺失 `baseUrl`）和 provider identity 解析失败（`providerId` 未命中或命中多个受信 provider access）。access shape 违反 MUST 在目录发布前安全失败；provider 未配置 MUST 使该父项子 profile 的目录项为 `UNAVAILABLE` 且 `unavailableReason=MODEL_PROVIDER_NOT_CONFIGURED`，并产生不影响 readiness 的安全 validation evidence；provider identity 解析失败 MUST 在目录发布前安全失败。

**需求类别**：功能性需求

#### Scenario: 内置默认配置未配置模型 provider
- **WHEN** 系统加载内置 `default-system.yaml`，其 `openai-compatible` 父项未提供 `baseUrl` 和 `credentialRef`
- **AND** 未通过配置 overlay 注入真实接入参数
- **THEN** 应用 MUST 启动成功并进入 `DEGRADED_READY`
- **AND** 该父项的子 profile 在模型目录中 MUST 为 `UNAVAILABLE` 且 `unavailableReason=MODEL_PROVIDER_NOT_CONFIGURED`
- **AND** 模型调用 MUST 返回安全 model-unavailable failure
- **AND** 安全诊断 MUST 只含相关 `providerId` 和安全 code，MUST NOT 包含 raw secret、endpoint 或本地路径

#### Scenario: 未配置 provider 不影响其他 viable profile
- **WHEN** 配置同时包含一个未配置 `baseUrl` 的 `openai-compatible` 父项和一个 viable `model-gateway` 父项
- **THEN** 未配置 `openai-compatible` 父项的子 profile MUST 在模型目录中为 `UNAVAILABLE` 且 `unavailableReason=MODEL_PROVIDER_NOT_CONFIGURED`
- **AND** viable `model-gateway` profile MUST 正常进入目录并可调用
- **AND** 系统 MUST NOT 因未配置 `openai-compatible` 父项而 fail closed

#### Scenario: 已知 Gateway 模型被 Agent 激活
- **WHEN** Agent assembly 激活已配置模型集合中的 Gateway profile
- **THEN** assembly publication MUST NOT 依赖该 profile 的模型信息或可用性
- **AND** 后续模型选择 MUST 通过安全目录查询取得其 frozen `AVAILABLE | UNAVAILABLE` 结果

#### Scenario: 已发布 Agent 的全部模型解析为不可用
- **WHEN** 已发布 Agent assembly 的非空激活模型集合全部经安全目录查询解析为 `UNAVAILABLE`
- **THEN** 应用 MUST 保持 ready
- **AND** Agent assembly MUST 保持已发布
- **AND** 目录不为这些 profile 提供 resolved model configuration

#### Scenario: Agent 激活未知 profile
- **WHEN** Agent assembly 引用目录外的 `modelId`
- **THEN** assembly publication 安全失败

### Requirement: Invocation scope represents real lifecycle coordinates

`ModelInvocationScope` MUST 是一个封闭扁平对象，required 字段 MUST 恰好为可信 `tenantId`、`subjectId`、`agentId`、`agentVersion`、`agentAssemblyRef` 和 `operationId`；optional 字段 MUST 恰好为 `sessionId`、`requestId` 和 `runId`，且这三个字段 MUST all-or-none 出现。owner 与 Agent fields 的来源和语义必须与 trusted `IdentityContext`、accepted Agent 和 run facts 一致。optional run coordinates 只表示真实、可信的调用关联事实；run-bound 或 background lifecycle 由可信调用上下文决定。`operationId` MUST 是去除首尾空白后非空、长度为 `1..256` 个 Unicode code point 且不含控制字符的字符串。未知字段、部分 run coordinates 或 synthetic coordinates MUST 在 provider access 前失败。

受信任 run-bound orchestration MUST 以 owning `stepId` 的同一值构造 `operationId`，并与 accepted run 的真实 `sessionId/requestId/runId` 原子写入 scope。owning background invocation boundary MUST 使用由自身可信 owner 建立的真实 operation identity：scheduler/cycle path 使用已冻结 cycle identity，按需 background service 在实际模型调用前建立 fresh identity。没有真实相关 run 时 MUST 省略全部 run coordinates，有真实相关 accepted/completed run 时 MAY 把完整三元组作为 causal correlation，但这不改变 background lifecycle。模型边界 MUST 使用 tenant/subject 与 Agent coordinates 校验 trusted Owner/Agent scope；当调用属于已接受的 request-run lifecycle 时，系统 MUST 额外把完整 run coordinates 与该 accepted run/context 一起校验。lifecycle authority MUST 来自可信调用上下文，MUST NOT 从 scope shape 推断。

`operationId` MUST 只用于内部 correlation、observability 和 audit，MUST NOT 参与模型选择、provider routing、授权、幂等、logical-invocation identity、retry 决策或模型可见推理。模型调用边界 MUST 为 outbound model HTTP request 从已校验 scope 集中生成 framework-owned correlation headers；名称集合 MUST 恰好为 `X-NextAgent-Agent-Id`、`X-NextAgent-Session-Id`、`X-NextAgent-Request-Id` 和 `X-NextAgent-Run-Id`。每个该类 request MUST 发送 Agent header；完整 run coordinates 存在时 MUST 同时发送其余三个 headers，三者缺失时 MUST 全部省略。tenant/subject、agent version/assembly、operation 和其他 raw lifecycle coordinate MUST 限制在可信 invocation envelope，MUST NOT 进入 provider-native model body、模型可见输入或 framework-owned correlation header。`providerId=model-gateway` 的 trusted canonical invocation envelope MAY 按本规格的 Gateway scenario 携带完整 scope，但该 scope MUST NOT 转为下游模型可见输入或 provider-native body。`ModelInvocationRequest`、`providerOptions`、hook mutation 和 caller MUST NOT 接受、提供或覆盖 header/transport metadata。模型调用契约不定义额外 outbound header policy；`agentId` 按固定 `X-NextAgent-Agent-Id` header 原值发送，不因其为 raw value 而拒绝。

**需求类别**：系统质量属性
**质量属性**：安全
**适用范围**：该 Function

#### Scenario: Run-bound 调用模型
- **WHEN** 模型调用属于 accepted request run
- **THEN** session、request 和 run coordinates 完整存在并等于同一 accepted orchestration step 的可信 facts
- **AND** `operationId` 等于该 owning orchestration `stepId` 的同一值

#### Scenario: 没有相关 run 的 background cycle 调用模型
- **WHEN** 受治理 background cycle 在没有 request run 的情况下调用模型
- **THEN** scope 的 `operationId` MUST 等于 owning background lifecycle 已冻结的真实 cycle identity
- **AND** scope MUST 省略全部 session/request/run coordinates

#### Scenario: Background 调用保留 completed-run 因果关联
- **WHEN** 受治理 post-terminal background consumer 与一个真实 completed run 存在直接因果关系
- **THEN** scope MAY 携带该 completed run 的完整 session/request/run coordinates
- **AND** scope 的 `operationId` MUST 等于 owning background service 为本次实际模型调用建立的可信 operation identity
- **AND** 该三元组 MUST NOT 使调用进入 run-bound timeline 或改变其 background lifecycle；调用仍 MUST 通过统一 `ModelInvocationService` 执行当前 Agent 已激活的 model hook

#### Scenario: `operationId` 不改变模型行为
- **WHEN** 两次其他有效输入相同的调用仅使用不同的 schema-valid `operationId`
- **THEN** `operationId` MUST NOT 改变模型选择、provider routing、authorization、retry、idempotency 或模型可见输入
- **AND** 系统 MUST 把可观察差异限制为内部 correlation、observability 或 audit 关联

#### Scenario: Scope 不满足封闭 schema
- **WHEN** scope 包含部分 run coordinates、synthetic coordinates 或 closed schema 未列出的字段
- **THEN** provider execution 不启动
- **AND** 调用安全失败

#### Scenario: 完整 run 关联坐标生成既有 correlation headers
- **WHEN** schema-valid scope 携带完整 session/request/run coordinates，且系统发起 outbound model HTTP request
- **THEN** outbound request 的 framework-owned correlation headers MUST 恰好为 scope `agentId` 与 session/request/run 分别对应的四个固定 `X-NextAgent-*` headers

#### Scenario: 无 run 关联坐标只生成 Agent header
- **WHEN** schema-valid scope 省略全部 session/request/run coordinates，且系统发起 outbound model HTTP request
- **THEN** outbound request 的 framework-owned correlation headers MUST 恰好为 `X-NextAgent-Agent-Id`

### Requirement: 模型调用时间线使用 canonical identity

run-bound 模型调用产生 `MODEL_INVOCATION_STARTED | MODEL_INVOCATION_COMPLETED | MODEL_INVOCATION_FAILED` 事实时，三个事件的安全时间线 identity MUST 恰好使用 required `stepId` 和 `modelId`。`stepId` MUST 是同一 `ModelInvocationRequest.invocationScope.operationId` 在可信 run-bound lifecycle boundary 的原值投影，`modelId` MUST 使用 `ModelProfile.modelId` 的 scalar constraint 并来自本次调用的 canonical selected model。系统 MUST 只为已接受的 request-run 调用产生该投影，并 MUST 把 scope 中的 Owner/Agent/session/request/run/operation coordinates 与该 accepted run/context 作为同一组 facts 校验；可信调用路径决定是否进入 run-bound timeline。时间线 `stepId` MUST 只作为 request run 内的 orchestration grouping key，MUST NOT 被当作 logical invocation id；同一步骤内的多个顺序 logical invocations MUST 复用该值，并由 timeline event identity 和 sequence 区分各 started/terminal event pair。三个事件 MUST 对同一次 logical invocation 使用相同 `stepId` 和 `modelId`。

同一个 orchestration step 内的 initial model invocation、模型边界内部同模型 retry 和 Core 发起的 cross-model fallback MUST 在 scope `operationId` 复用 owning `stepId` 的同一值。同模型 retry MUST 保持在同一个 `MODEL_INVOCATION_STARTED` 与 terminal event 对内；cross-model fallback MUST 产生新的 started/terminal event 对，并以新的 `modelId` 与前一次调用区分。Agent loop、workflow node 或其他绑定 accepted request run 的消费者 MUST 把其 owning orchestration step 已建立的 `stepId` 映射到 scope `operationId` 并携带完整 accepted run coordinates；消费者没有 accepted run step 时 MUST 使用 background invocation path，MUST NOT 为产生 run-bound lifecycle facts 而合成 run coordinates 或 `stepId`。

所有可观察或持久化的 `MODEL_INVOCATION_*` 事实 MUST 使用上述 exact identity shape。background model invocation MUST 执行统一模型边界中的 model hook，但 MUST NOT 进入 run-bound timeline boundary 或产生 request-run `HOOK_INVOKED`/`MODEL_INVOCATION_*` 事实；即使它携带 completed-run causal correlation，其 `operationId` 也 MUST NOT 被投影成 request-run `stepId`。

该安全投影的 identity fields MUST 恰好为 `stepId` 和 `modelId`；endpoint、credential reference、resolved credential、header、custom fetch、provider metadata、raw lifecycle coordinates 和 provider option value MUST 留在 owning boundary。无法从 accepted run step 与可信 selected model 生成 schema-valid identity 时，run-bound invocation MUST 在 provider execution 前安全失败；MUST NOT 使用 default、空字符串或调用方输入伪造 identity。

**需求类别**：系统质量属性
**质量属性**：审计/可追溯性
**适用范围**：该 Function

#### Scenario: 收窄请求后生成模型调用开始事实
- **WHEN** schema-valid run-bound invocation 携带 canonical `modelId`、动态调用输入和完整 accepted run coordinates
- **AND** 该 scope 的 `operationId` 等于 owning orchestration `stepId`
- **THEN** `MODEL_INVOCATION_STARTED.modelId` MUST 等于该 canonical `modelId`
- **AND** 三个 lifecycle events 的 `stepId` MUST 等于该 `operationId`，且 `modelId` MUST 分别相同

#### Scenario: 同一步骤发生跨模型 fallback
- **WHEN** Core 在一个 accepted orchestration step 中对第一次 logical invocation 的安全失败执行 cross-model fallback
- **THEN** fallback invocation MUST 在 scope `operationId` 复用该 owning `stepId` 的同一值
- **AND** fallback invocation MUST 以重新选择结果的 `modelId` 产生新的 started/terminal event 对

#### Scenario: 同一步骤顺序执行多次模型调用
- **WHEN** owning orchestrator 在同一个 accepted orchestration step 中顺序执行多个 logical model invocations
- **THEN** 每次调用 MUST 在 scope `operationId` 复用该 owning `stepId` 的同一值
- **AND** 每个 started/terminal event pair MUST 由各自 event identity 和 sequence 区分

#### Scenario: 非 Agent loop 的 run-bound 消费者调用模型
- **WHEN** workflow node 或其他消费者在 accepted request run 的 owning orchestration step 中调用模型
- **THEN** 它 MUST 把该 owning `stepId` 的同一值作为 `operationId` 与同一 run coordinates 写入 scope
- **AND** 它 MUST 通过同一个 schema-valid scope 交付这些关联事实

#### Scenario: 没有 request-run step 的消费者调用模型
- **WHEN** background consumer 没有 accepted request-run orchestration step
- **THEN** 它 MUST 使用可信 background invocation path
- **AND** scope MUST 以 owning background lifecycle identity 填充 `operationId` 并省略不存在的 run coordinates
- **AND** 它 MUST 执行统一 `ModelInvocationService` 中的 model hook，但 MUST NOT 进入 run-bound timeline boundary 或产生 request-run hook/model 时间线事实

#### Scenario: 调用方尝试伪造可观测 identity
- **WHEN** 不可信 metadata 或未获 lifecycle authority 的 caller 尝试提供或覆盖 scope identity
- **THEN** provider execution MUST 在使用该 identity 前安全失败
- **AND** 时间线 identity 和 provider routing MUST 保持由可信 lifecycle 与 selected model 决定

### Requirement: 模型接入配置只在模型边界内解析

模型调用边界 MUST 根据已选 `modelId` 解析唯一 `ModelProfile` 及其父级 `providerId`，再取得唯一受信 provider access，并且 MUST 以同一个 `modelId` 调用对应 provider。系统 MUST NOT 根据 `providerId` 字符串格式、前缀或其他调用输入推断 provider 类型或接入方式。调用方、Agent、Capability、客户端和模型输出 MUST NOT 提供或覆盖 `providerId`、endpoint、credential、header、transport 或其他接入事实。模型调用边界 MUST NOT 选择初始模型或 fallback 模型。

**需求类别**：系统质量属性
**质量属性**：安全
**适用范围**：该 Function

#### Scenario: 调用可用的 compatible 模型
- **WHEN** 调用请求选择已激活且 `AVAILABLE`、其父级 `providerId=openai-compatible` 的 `modelId`
- **THEN** 模型边界使用该模型唯一受信的 compatible provider access，并把同一 `modelId` 传给 provider

#### Scenario: 调用可用的 Gateway 模型
- **WHEN** 调用请求选择已激活且 `AVAILABLE`、其父级 `providerId=model-gateway` 的 `modelId`
- **THEN** 模型边界使用该模型唯一受信的 Gateway invocation capability，并传入同一 `modelId`

#### Scenario: 调用方尝试提供接入配置
- **WHEN** 调用输入包含 `providerId`、provider kind、endpoint、credential、header、custom fetch 或 transport
- **THEN** 这些字段不被接受为调用权威
- **AND** provider execution 不启动

#### Scenario: 已选 provider access 不可用
- **WHEN** 已选模型无法解析到唯一受信 provider access
- **THEN** 模型调用返回安全 provider-unavailable failure
- **AND** 不尝试其他模型

### Requirement: OpenAI-compatible 调用遵循统一 Chat Completions 语义

`providerId=openai-compatible` 的模型调用 MUST 以 Chat Completions 作为非流式与流式调用的唯一 endpoint capability，并 MUST 支持 provider-neutral messages、tools、规格允许的可选顶层推理参数、受控 `providerOptions`、cancellation、effective timeout 和同模型 recoverable retry。provider-specific thinking MUST 只从 validated 顶层 `ThinkingOptions` 映射，MUST NOT 从 `providerOptions` 建立第二套 reasoning authority。effective `thinking.depth="OFF"` 只有在 selected provider 能够显式关闭 reasoning，或能够保证省略 provider reasoning option 时该模型不会执行 reasoning，才构成安全映射。无法保证请求语义的可选参数 MUST 在 provider access 前安全失败。

**需求类别**：功能性需求

#### Scenario: Compatible 非流式调用
- **WHEN** 调用方执行 `complete(...)`
- **THEN** provider 使用非流式 Chat Completions 能力
- **AND** 结果归一化为公共 `ModelFinalResult`

#### Scenario: Compatible 流式调用
- **WHEN** 调用方执行 `stream(...)`
- **THEN** provider 使用流式 Chat Completions 能力
- **AND** stream 与终态结果使用公共 provider-neutral contract

#### Scenario: Provider 显式支持请求的 thinking depth
- **WHEN** effective optional model parameters 包含 provider capability 已定义 provider-native 映射的 thinking depth
- **THEN** 模型调用边界按该映射生成 provider option
- **AND** provider-native option 只在模型边界内形成

#### Scenario: Provider 缺省行为保证关闭 thinking
- **WHEN** effective optional model parameters 包含 `thinking.depth="OFF"`
- **AND** provider capability 保证省略 provider reasoning option 时 selected model 不执行 reasoning
- **AND** 其他 invocation preconditions 均有效
- **THEN** 模型调用边界 MUST 省略 provider reasoning option 并启动调用
- **AND** 该调用的 thinking 语义为 `OFF`

#### Scenario: Provider 不能表达请求的 thinking 语义
- **WHEN** effective optional model parameters 包含 selected provider 无法安全表达的 thinking 值，或包含 `thinking.depth="OFF"` 但 provider 不能保证显式关闭或省略后关闭
- **THEN** provider execution 不启动
- **AND** 调用返回安全失败

### Requirement: 模型 transport 通过可选 Gateway fetch 装配

当 trusted gateway configuration 提供 optional `GatewayBindings.fetch` 时，OpenAI-compatible outbound request MUST 使用同一 binding；该 binding 缺失时 MUST 使用平台默认 fetch。调用方和模型输入 MUST NOT 感知或选择具体 fetch implementation。

custom fetch MAY 隔离 HTTPS/mTLS certificate、connection、proxy 或其他运行环境相关 transport 差异，并 MUST 通过 `RequestInit.signal` 接收本次调用 cancellation signal。调用请求、hook、provider options 和其他系统功能 MUST NOT 提供、替换或取得该 binding。模型边界仍只负责集中生成四个固定 correlation headers；模型调用契约 MUST NOT 增加 `ModelOutboundHeaderPolicy` 或额外 custom-header 语义。transport failure MUST 映射为安全模型失败，certificate、private key、credential、endpoint、header value 和 raw transport error MUST NOT 进入公共输出或 observability payload。

**需求类别**：系统质量属性
**质量属性**：安全
**适用范围**：该 Function

#### Scenario: 使用可信 custom fetch
- **WHEN** trusted gateway configuration 提供包含 `fetch` 的 `GatewayBindings`
- **THEN** compatible model invocation 使用该 Gateway port 执行 Chat Completions request
- **AND** 其他模块和调用请求 MUST NOT 读取或替换该 fetch

#### Scenario: 未装配 custom fetch
- **WHEN** `GatewayBindings.fetch` 缺失
- **THEN** compatible model invocation 使用平台默认 fetch
- **AND** LOCAL startup 不要求该可选 binding

#### Scenario: Custom transport 失败
- **WHEN** custom fetch 因 HTTPS identity、certificate、connection 或其他 transport 原因失败
- **THEN** 模型调用返回安全失败
- **AND** failure 不暴露 certificate、private key、credential、endpoint 或 raw transport error

### Requirement: 可恢复错误按受控次数重试

模型调用边界 MUST 是同模型 retry 的唯一 owner，并 MUST 只对 selected `modelId` 的 provider 或 SDK 明确标记为 recoverable 的错误执行 retry。effective `maxRetries` MUST 按“调用请求的非负整数值、否则 profile 的非负整数默认值、否则固定值 `2`”解析，并表示初始 provider request 之后最多允许的 retry 次数。summary、memory、recommendation、workflow、Core 和其他调用方 MUST 对一次 logical invocation 只调用模型边界一次，MUST NOT 再包裹同模型 retry loop、重置 timeout 或叠加 retry 次数。validation、authentication、unsupported option、invalid tool arguments、normalization failure、cancellation 和其他 non-recoverable failure MUST NOT 重试。

全部 retry 和 backoff MUST 受同一个 cancellation signal、effective timeout 和 execution budget 约束。流式调用产生任何 public delta 后 MUST NOT 重新发起 provider request。模型边界在 retry 耗尽后 MUST 返回当前 `modelId` 的安全失败，MUST NOT 自行选择其他模型；cross-model fallback 仍由受治理的 fallback flow 决定。

**需求类别**：系统质量属性
**质量属性**：可靠性/恢复
**适用范围**：该 Function

#### Scenario: Profile 和请求都未设置 max retries
- **WHEN** `ModelProfile.maxRetries` 和 `ModelInvocationRequest.maxRetries` 均缺失
- **THEN** effective `maxRetries` 为 `2`
- **AND** 最多执行一次初始 provider request 和两次 retry

#### Scenario: 请求覆盖 profile 默认值
- **WHEN** profile 声明非负整数 `maxRetries` 且调用请求声明另一个合法值
- **THEN** 本次调用使用请求值
- **AND** runtime execution budget 继续约束实际可执行次数

#### Scenario: 可恢复失败
- **WHEN** provider request 在尚未产生 public stream delta 时返回明确 recoverable failure
- **AND** cancellation、effective timeout、execution budget 和 effective max retries 允许再次尝试
- **THEN** 模型边界使用同一 `modelId` 和相同有效输入执行 retry

#### Scenario: 不可恢复失败
- **WHEN** failure 未被 provider 或 SDK 明确标记为 recoverable
- **THEN** 模型边界不执行 retry
- **AND** 返回归一化安全失败

#### Scenario: Stream 已产生可见增量
- **WHEN** 流式调用产生至少一个 public delta 后发生失败
- **THEN** 模型边界不重新发起 provider request
- **AND** stream 以一个安全失败终态结束

#### Scenario: 调用方不得叠加同模型 retry
- **WHEN** summary、memory、recommendation、workflow 或 Core 发起一次 logical model invocation
- **THEN** 调用方 MUST 只调用一次 `complete()` 或 `stream()`
- **AND** 全部同模型 retry、backoff 和 request count MUST 由模型边界在同一个 effective timeout 内完成

### Requirement: 成功调用尽量保留 provider usage

成功的非流式和流式终态结果 MUST 尽量保留 provider 报告的 token usage。`ModelFinalResult.usage` 和其中的 `inputTokens`、`outputTokens`、`totalTokens` MUST 保持 optional；provider 报告的每个非负整数值 MUST 原样保留，缺失、不支持或非法的单个值 MUST 被省略。系统 MUST NOT 合成、估算、从其他字段推导或用零填充 usage；usage 缺失、不支持、部分缺失或包含非法字段 MUST NOT 把其他方面成功的模型调用改为失败。

**需求类别**：功能性需求

#### Scenario: Provider 返回完整 usage
- **WHEN** 成功调用返回三个有效 token usage 值
- **THEN** 成功终态结果原样包含三个值

#### Scenario: Provider 返回部分 usage
- **WHEN** 成功调用只返回部分有效 token usage 值
- **THEN** 成功终态结果只包含有效值
- **AND** 系统不推导缺失值

#### Scenario: Provider 不返回或不支持 usage
- **WHEN** 其他方面成功的 provider result 没有 usage
- **THEN** 模型调用仍返回成功终态
- **AND** 终态结果省略 usage

#### Scenario: Provider 返回非法 usage 字段
- **WHEN** 成功结果中的某个 usage 值为负数、小数、非有限数或非数值
- **THEN** 终态结果省略该非法值
- **AND** 其他有效 usage 值和成功模型结果保持不变

### Requirement: 流式输出只暴露完整的 provider-neutral 事实

流式调用 MUST 只发送有序的 provider-neutral content、reasoning 和完整 tool-call delta。provider transport 内部的 tool-call fragments MUST 在模型边界内保持顺序和关联，直到形成带稳定 `toolCallId`、`toolName` 和结构化 JSON arguments 的完整 call；public stream MUST NOT 暴露 fragment、raw chunk 或 provider-native event。同一完整 tool call MUST 按相同顺序出现在终态结果中。无法归一化的 tool arguments 或 stream event MUST 产生恰好一个安全失败终态。

**需求类别**：功能性需求

#### Scenario: Stream 返回文本和 reasoning
- **WHEN** provider stream 报告 content 或 reasoning text
- **THEN** public stream 按接收顺序发送对应 provider-neutral delta

#### Scenario: Tool call 以 fragments 到达
- **WHEN** provider 内部通过多个 fragments 传递 tool call
- **THEN** public stream 不发送 fragments
- **AND** 完整且有效的 tool call 只发送一次，并按同一顺序进入终态结果

#### Scenario: Stream 无法安全归一化
- **WHEN** 完整 tool call arguments 非法或 stream event 无法映射
- **THEN** stream 以一个安全失败终态结束
- **AND** raw provider fact 不被暴露

### Requirement: Agent App system config 使用 canonical model/provider 配置

`DefaultSystemConfig` 的模型配置 MUST 只使用 recursively frozen app-owned `modelProfiles: readonly ModelProviderProfile[]` 与 `modelProfileValidationEvidence: readonly ModelProfileValidationEvidence[]`。每个 closed `ModelProviderProfile` 的 required fields MUST 恰好为唯一 `providerId` 和至少包含一个元素的 `models: readonly ModelProfile[]`；optional fields MUST 恰好为合法 `baseUrl` 和合法 `credentialRef`。产品配置允许的 exact `providerId` MUST 恰好为 `openai-compatible | model-gateway`，语义和装配前置条件由本规格的 `全局模型目录提供安全模型配置` 唯一定义。每个 closed 子 `ModelProfile` 的 required fields MUST 恰好为 `modelId` 和 `fallbackEligible`；optional fields MUST 恰好为 `displayName`、`contextWindowTokens`、`temperature`、`maxOutputTokens`、`topP`、`topK`、`presencePenalty`、`frequencyPenalty`、`thinking`、`providerOptions`、`reasoningTextMode`、`timeoutMs` 和 `maxRetries`。子 profile 出现在 `models[]` 中即表示配置并进入后续目录装配。`providerId` MUST NOT 在子 profile 重复出现；全部父项中的 `modelId` MUST 全局唯一。父项和子项 MUST 拒绝显式 `null`、未知字段、重复 identity 和空 `models`。

`ModelProfileValidationEvidence` 的 required fields MUST 恰好为 `modelId`、低基数 `code` 和安全 `message`。`modelProfiles` MUST 保持父项配置顺序与每个父项的子项顺序；模型配置对象、嵌套 inference/provider options、validation evidence 数组及每个 evidence item MUST 在配置校验完成后冻结。Host 若需扁平模型清单、fallback-eligible ids 或 exact model lookup，MUST 直接从该冻结配置快照派生，系统 MUST NOT 为这些无独立生命周期的视图维护第二个 public registry 或 index。

每个父项的 `providerId` MUST 解析到恰好一个受信 provider access。该 provider access MUST 对父层 `baseUrl/credentialRef` 执行封闭校验：`baseUrl` 存在时 `openai-compatible` MUST 接受合法 http/https URL、`model-gateway` MUST 拒绝该字段；`credentialRef` 存在时 MUST 是合法 `env:`/`file:` reference。`openai-compatible` 的 `baseUrl` 为 optional，缺失时该父项视为未配置接入参数；`credentialRef` 为 optional，支持 credential 的 provider 在 `credentialRef` 缺失时不发送 credential。unknown 或重复 provider access MUST 在目录发布前安全失败，且解析 MUST 只使用 exact `providerId`。

custom fetch、provider SDK client 和 transport MUST NOT 进入 system config；模型调用使用的 custom fetch MUST 只来自 trusted gateway configuration 的 optional `GatewayBindings.fetch`，其余 provider runtime facts MUST 只来自 `providerId` 对应的受信 provider access。raw config 环境引用解析 MUST 解析父项的 `baseUrl`、`credentialRef` 和子项的 `modelId`；父项和子项均 MUST 按本 Requirement 的 closed schema 校验。raw config 环境引用解析 MUST NOT 把 `OPENAI_API_KEY` 或 `OPENAI_BASE_URL` 作为隐式默认环境变量名注入 `modelProfiles`；`baseUrl` 和 `credentialRef` 只能来自配置本身。

provider access 校验 MUST 遵守 fail-fast/degraded-ready 边界。除下一句的受控例外外，任一 model/provider 配置失败 MUST 阻止 ready，MUST NOT 被静默丢弃。唯一受控例外是：某个父项的 `credentialRef` grammar 非法，且其全部 configured 子 profiles 都是 `fallbackEligible=true`，并且排除这些 profiles 后仍至少存在一个 viable configured non-fallback profile；此时系统 MAY 排除全部受影响 profiles 并进入 degraded-ready，采用该例外时 MUST 产生只含相关 `providerId`、`modelId` 和安全 code 的 validation evidence，未采用时 MUST fail closed。`openai-compatible` 父项因 `baseUrl` 缺失而未配置时，其子 profile MUST 保留并通过安全 validation evidence 标记为未配置，evidence MUST 不影响 readiness；当配置中不存在任何 viable configured provider profile 时，应用 MUST 进入 `DEGRADED_READY` 并可启动，相关模型目录项 MUST 为 `UNAVAILABLE` 且 `unavailableReason=MODEL_PROVIDER_NOT_CONFIGURED`。父项同时包含任一 configured non-fallback profile、排除后没有 viable profile，或失败属于 duplicate/unknown provider access、identity、access config、base URL 非法值、inference field、provider option、context window 或其他配置错误时，startup MUST fail closed；本句不适用于仅因 `openai-compatible` `baseUrl` 缺失导致的 provider 未配置。

**需求类别**：功能性需求

#### Scenario: Provider 父项包含多个模型
- **WHEN** raw system config 在一个 `modelProfiles[]` 父项声明 `providerId`、provider access config 和一个或多个子模型
- **THEN** validated system config MUST 在该父项只保存 raw config 提供且对应 provider access 接受的 optional `baseUrl/credentialRef`
- **AND** 每个 `models[]` 子项 MUST 只保存单一 `modelId`、模型画像、availability input、fallback policy、全部已配置的 provider-neutral 推理参数、`providerOptions`、`timeoutMs` 和 `maxRetries`
- **AND** 所有子模型 MUST 通过父项的同一 `providerId` exact lookup 到同一个可信 provider access

#### Scenario: 配置存在且已配置接入参数即进入模型目录
- **WHEN** `models[]` 包含通过 schema、security 和 provider-owned access validation 的子 profile
- **AND** 其父项已配置接入参数（`openai-compatible` 提供合法 `baseUrl`，或 `model-gateway` 不需要 `baseUrl`）
- **THEN** 该 profile MUST 进入模型目录装配并按其可解析事实提供 `AVAILABLE` 目录项

#### Scenario: 模型 profile 配置全部推理参数
- **WHEN** 子 profile 同时提供合法 `temperature`、`maxOutputTokens`、`topP`、`topK`、`presencePenalty`、`frequencyPenalty`、`thinking`、`providerOptions` 和 `reasoningTextMode`
- **THEN** validated frozen profile MUST 保留全部显式值
- **AND** 模型调用边界 MUST 对 `providerOptions` 执行 selected-provider reserved-field validation，并按 request-over-profile 规则解析 effective values
#### Scenario: openai-compatible 父项缺失 baseUrl
- **WHEN** 一个 `modelProfiles[]` `openai-compatible` 父项未提供 `baseUrl`
- **THEN** 该父项的子 profile MUST 在模型目录中为 `UNAVAILABLE` 且 `unavailableReason=MODEL_PROVIDER_NOT_CONFIGURED`
- **AND** 系统 MUST NOT 因该父项缺失 `baseUrl` 而 fail closed；即使配置中不存在其他 viable provider profile，应用也 MUST 保持 `DEGRADED_READY`
- **AND** 安全诊断 MUST NOT 回显环境变量值、endpoint 或 credential

#### Scenario: 内置默认模型名覆盖缺失
- **WHEN** 内置默认配置的子项 `modelId` 引用 `env:OPENAI_MODEL_NAME`
- **AND** 该环境变量未提供或为空
- **AND** 其 `openai-compatible` 父项未配置 `baseUrl`
- **THEN** raw config 解析 MUST 使用安全占位模型名 `default-model`
- **AND** 应用 MUST 保持 `DEGRADED_READY` 且 MUST NOT 因未解析的模型名环境引用阻止启动
- **AND** 该模型目录项 MUST 保持 `UNAVAILABLE` 且 `unavailableReason=MODEL_PROVIDER_NOT_CONFIGURED`

#### Scenario: 内置默认模型使用明确调用画像
- **WHEN** 系统加载内置 `default-system.yaml` 并完成环境引用解析
- **THEN** 默认子 profile MUST 显式包含 `temperature=0.2`、`maxOutputTokens=2048`、`topP=1` 和 `timeoutMs=300000`
- **AND** catalog 固定默认值 MUST NOT 覆盖这些显式值

#### Scenario: Provider id 不能唯一绑定
- **WHEN** 父项的 `providerId` 未命中可信 provider access、命中多个 provider access，或对应 provider 拒绝该父项 access config
- **THEN** 系统 MUST 在模型目录发布前安全失败
- **AND** MUST NOT 从字符串前缀、子 profile、环境变量自动发现或其他摘要字段推导 provider access

#### Scenario: Fallback-only provider credential grammar 非法
- **WHEN** 一个 `modelProfiles[]` 父项的 `credentialRef` grammar 非法
- **AND** 该父项的全部 configured 子 profiles 都是 fallback-eligible
- **AND** 排除这些 profiles 后仍存在 viable configured non-fallback profile
- **THEN** 系统 MAY 排除全部受影响 profiles 并进入 degraded-ready
- **AND** safe validation evidence MUST 标识相关 `providerId`、`modelId` 和安全 code

#### Scenario: Primary profile 引用无效 provider credential
- **WHEN** 一个 `modelProfiles[]` 父项的 `credentialRef` grammar 非法
- **AND** 该父项至少一个 configured 子 profile 不是 fallback-eligible，或排除全部受影响 profiles 后没有 viable profile
- **THEN** startup MUST fail closed

#### Scenario: 可信 Host 从唯一配置快照读取模型事实
- **WHEN** 可信 App Host 读取 `NextAgentApp.systemConfig.modelProfiles` 或 `modelProfileValidationEvidence`
- **THEN** 它 MUST 观察通过校验且冻结的 canonical `providerId/modelId` 配置与安全 validation evidence
- **AND** Host MAY 在自身调用栈中按需派生扁平清单、fallback ids 或 exact lookup 结果
- **AND** production App object MUST NOT 提供重复的 `modelProfileRegistry`、configured ids 或 membership index
- **AND** provider access route、assembly selection 和 model-information projection仍由各自 owning module 提供

### Requirement: 可信 App Host 可读取配置快照但运行期模型功能不依赖它

production `NextAgentApp` MUST 只通过不可变 `systemConfig` 暴露模型配置与 validation evidence，供可信进程内 entrypoint、部署/package host、readiness/release evidence 和 test harness 履行宿主职责。production object MUST NOT 暴露 `modelProfileRegistry`、`productModelProviderKind` 或等价的模型索引/provider-class 摘要；canonical `providerId` MUST 是 provider selection 与 access resolution 的唯一身份。运行期模型行为 MUST NOT 把该公共 App 投影当作目录、选择或 provider access 权威。

运行期模型消费者 MUST 只通过本规格定义的安全目录 query 或对应窄化契约取得模型事实，MUST NOT 把上述公共 App 投影当作运行期目录、选择或 provider access 权威。这些字段 MUST 只停留在可信 App Host 边界，MUST NOT 被投影到 Web、stream、模型输入、Capability 输入、持久化 runtime fact 或 observability payload。

**需求类别**：系统质量属性
**质量属性**：安全
**适用范围**：该 Function

#### Scenario: 可信 Host 读取配置快照
- **WHEN** 可信 App Host 读取 `NextAgentApp.systemConfig`
- **THEN** 它获得同一个不可变启动配置事实
- **AND** `modelProfiles` 使用父层 `providerId/baseUrl/credentialRef/models` 与子层单一 `modelId` 的 closed two-level config
- **AND** 该读取不向不可信边界传播完整配置

#### Scenario: 可信 Host 获得公共 App 对象
- **WHEN** 可信 App Host 获得 production `NextAgentApp`
- **THEN** 对象包含 immutable `systemConfig`
- **AND** `systemConfig` 的模型配置与 validation evidence 使用 canonical `modelId` 并保持冻结
- **AND** 对象 MUST NOT 包含 `modelProfileRegistry` 或其他重复模型配置索引
- **AND** 对象 MUST NOT 包含 `productModelProviderKind` 或等价 provider-class 摘要
- **AND** 对象不新增 model catalog、query 或其他模型运行时公共 API

#### Scenario: Host 需要识别 provider
- **WHEN** 可信 App Host 需要检查已配置 provider
- **THEN** MUST 从 immutable canonical `systemConfig.modelProfiles[].providerId` 读取 provider identity
- **AND** 系统 MUST NOT 提供平行 provider-kind projection

### Requirement: Provider options remain an open selected-provider extension

Optional inner `providerOptions` MAY 为 selected provider 提供未被 canonical 顶层字段表达的推理扩展参数，并 MUST 在各 authoring/invocation contract 中保持 optional non-null `JsonObject`。`providerOptions` 的授权来源 MUST 恰好为：启动期 schema 与安全校验通过的 `ModelProfile.providerOptions`；已编译并选中的 Prompt Template `modelOptions.providerOptions`；受治理 Skill Tool 从 accepted `SkillMetadata.modelOptions.providerOptions` 原样映射并通过 Capability result governance 的 request-local patch；可信 Agent 开发代码在 `ModelInputRenderRequest.providerOptions` 或 `ModelInvocationRequest.providerOptions` 契约边界提供的值；以及已激活且具有 model-invocation transform authority 的 `BEFORE_MODEL_INVOKE` hook 经 mutation schema 校验后产生的 `providerOptions`。中间处理只可传递已授权值，MUST NOT 构成新的授权来源。调用请求的 `providerOptions` MUST 只表示 inner provider options，MUST NOT 包含 provider namespace。前八个 provider-neutral inference fields 的 effective precedence MUST 固定为 profile、selected Prompt Template、governed Capability patch、trusted request、governed hook，后层逐字段覆盖前层；`providerOptions` MUST 使用相同层次顺序，但 Capability layer MUST 只接受 governed Skill patch，并 MUST 在各层之间执行顶层浅合并，同名嵌套对象 MUST 整体替换，MUST NOT 执行递归合并。

模型调用边界 MUST 根据 selected `modelId` 解析 `providerId`，并把 effective inner provider options 交给 selected provider 的扩展参数边界。该对象 MUST 保持开放：系统 MUST 接受并原样转交未知的 JSON 字段，MUST NOT 使用封闭 schema 或 allowlist 拒绝未来 provider 扩展。selected provider 明确定义的 option MAY 由 provider 解释，其他非保留字段 MUST 原样进入 provider-native request。canonical `toolChoice` MUST 由 adapter 映射为 provider-native `auto | none | required` 或语义等价值；它 MUST NOT 通过开放 `providerOptions` 传递。

开放扩展只受 authority collision 约束。provider options MUST 拒绝与 canonical 顶层模型请求字段或最终 provider body authority 重复的字段，包括 model/messages/tools/stream、顶层 inference/thinking/tool-choice controls、timeout/retry，以及 provider identity、endpoint、credential、headers、fetch/transport 和 Owner/Agent scope；比较 MUST 同时覆盖 NextAgent camelCase 名称与 provider-native 名称。除此之外的未知字段 MUST 被接受。顶层 `thinking` MUST 是 reasoning 语义的唯一权威，系统 MUST NOT 在顶层字段与 provider options 之间选择或合并第二套值。不可信 Web/client、RuntimeCommand、Capability 参数、非 Skill Tool Capability result、Skill Tool input/body、history、模型输出或 metadata MUST NOT 直接提供该字段；raw option 值 MUST NOT 进入 error、log、metric、trace、audit 或用户可见输出。

**需求类别**：系统质量属性
**质量属性**：安全
**适用范围**：该 Function

#### Scenario: 调用覆盖 profile provider option
- **WHEN** profile 和调用请求都提供合法 `providerOptions`，并包含相同顶层字段
- **THEN** effective provider options 使用调用值
- **AND** 其他未被覆盖的 profile 顶层字段保持不变
- **AND** 同名嵌套对象不执行递归合并

#### Scenario: Adapter 接收有效 provider option
- **WHEN** effective provider options 包含未与受保护 authority 冲突的已知或未知 JSON 字段
- **THEN** 模型边界将其交给 selected provider 的 extension path
- **AND** 调用方不选择或提交 provider namespace

#### Scenario: Adapter 接收未来未知 provider option
- **WHEN** effective provider options 包含 NextAgent 未预定义、且不与受保护 authority 冲突的 JSON 字段
- **THEN** provider execution MUST 启动并把该字段和值原样交给 OpenAI-compatible provider request
- **AND** 系统 MUST NOT 因字段未知而拒绝调用

#### Scenario: 授权来源携带 provider option
- **WHEN** profile、已编译并选中的 Prompt Template、受治理 Skill metadata patch、可信 Agent 开发代码构造的 `ModelInvocationRequest`，或受治理的 `BEFORE_MODEL_INVOKE` mutation 为本次调用提供结构合法的 provider options
- **THEN** 系统 MUST 将该值送入 effective provider options 合并与 selected-provider 校验

#### Scenario: Provider option 尝试覆盖受治理字段
- **WHEN** effective provider options 包含受保护的身份、消息、工具、执行、接入或 transport 字段
- **THEN** provider execution 不启动
- **AND** failure 不暴露 option value

#### Scenario: Provider option 重复 thinking authority
- **WHEN** effective provider options 包含 `reasoning`、`thinking`、`reasoningEffort`、`reasoning_effort` 或其他与顶层 `thinking` 语义重复的字段
- **THEN** provider execution MUST NOT 启动
- **AND** 系统 MUST NOT 在顶层 `thinking` 与 provider options 之间选择或合并第二套 reasoning authority

#### Scenario: 不可信来源提供 provider option
- **WHEN** Web/client、RuntimeCommand、Capability 参数、非 Skill Tool Capability result、Skill Tool input/body、history、模型输出或不可信 metadata 携带 provider options
- **THEN** 该字段在进入 `ModelInvocationRequest` 前被拒绝
#### Scenario: Provider options 不能覆盖 canonical tool choice

- **WHEN** `providerOptions` 包含 `toolChoice`、`tool_choice` 或规范化比较后为 `toolchoice` 的字段
- **THEN** selected-provider reserved-field validation MUST 拒绝该 invocation
- **AND** adapter MUST 只使用 canonical 顶层 `toolChoice` 生成 provider-native control

### Requirement: 模型 profile 可声明隐式 reasoning 起点

`ModelProfile.reasoningTextMode` MUST 是 optional closed enum，允许值 MUST 恰好为 `EXPLICIT_THINK_TAG | IMPLICIT_OPEN_THINK_TAG`；字段缺失 MUST 等同于 `EXPLICIT_THINK_TAG`，显式 `null` 和未知值 MUST 在模型目录发布前被拒绝。该字段 MUST 只允许用于 `providerId=openai-compatible` 的子 profile；其他 provider profile 携带该字段时，系统 MUST 在模型目录发布前安全失败。

当 selected model 的 effective `reasoningTextMode` 为 `IMPLICIT_OPEN_THINK_TAG` 时，OpenAI-compatible 模型调用 MUST 把 text-level 响应解释为从首个文本字符起即处于 reasoning 状态，并把首个 `</think>` 视为 reasoning 与公开 content 的分界；分界之前的文本 MUST 归一化为 provider-neutral reasoning，分界之后的文本 MUST 归一化为 provider-neutral content。流式标签跨任意增量边界时 MUST 保持相同结果。非流式与流式调用 MUST 使用相同分界语义。

当字段缺失或值为 `EXPLICIT_THINK_TAG` 时，系统 MUST 保持原生 reasoning 字段与显式 `<think>...</think>` 文本归一化行为，并 MUST NOT 把无显式 reasoning 证据的普通 content 解释为 reasoning。`reasoningTextMode` MUST 只来自可信启动模型配置，MUST NOT 进入 `ModelInvocationRequest`、`providerOptions`、模型输入、Web 请求、runtime command、Capability 参数或 hook mutation。

**需求类别**：功能性需求

#### Scenario: 隐式起点流式响应完成归一化
- **WHEN** 一个 OpenAI-compatible 子 profile 配置 `reasoningTextMode=IMPLICIT_OPEN_THINK_TAG`
- **AND** provider stream 依次返回 `分析过程`、`</thi`、`nk>最终答案`
- **THEN** public stream 和成功终态 MUST 把 `分析过程` 归一化为 reasoning
- **AND** MUST 把 `最终答案` 归一化为 content
- **AND** MUST NOT 在公开 content 中保留任一 think 标签

#### Scenario: 隐式起点非流式响应完成归一化
- **WHEN** 一个 OpenAI-compatible 子 profile 配置 `reasoningTextMode=IMPLICIT_OPEN_THINK_TAG`
- **AND** native non-stream response text 为 `分析过程</think>最终答案`
- **THEN** `ModelFinalResult.reasoning` MUST 为 `分析过程`
- **AND** `ModelFinalResult.content` MUST 为 `最终答案`

#### Scenario: 未配置时保持显式模式
- **WHEN** OpenAI-compatible 子 profile 缺失 `reasoningTextMode`
- **AND** provider 返回普通 content 或显式 `<think>分析过程</think>最终答案`
- **THEN** 普通 content MUST 保持 content
- **AND** 显式标签内文本 MUST 归一化为 reasoning
- **AND** 标签之后文本 MUST 归一化为 content

#### Scenario: 不支持的 provider 配置隐式模式
- **WHEN** `providerId=model-gateway` 的子 profile 携带任一 `reasoningTextMode`
- **THEN** 应用 MUST 在模型目录发布前安全失败
- **AND** MUST NOT 启动该 profile 的 provider execution

#### Scenario: 配置值非法
- **WHEN** 子 profile 的 `reasoningTextMode` 为显式 `null`、未知字符串或非字符串值
- **THEN** 应用 MUST 在模型目录发布前安全失败

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
