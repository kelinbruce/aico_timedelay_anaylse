## 背景与问题（Why）

模型调用需要被定义成一个可长期演进的请求执行步骤，而不是 provider 访问代码的薄包装，也不能把最小流程契约原样固化为长期终态。当前最需要审视的是：

- 调用前需要哪些稳定输入
- 当前 `providerKind`、`providerOptions`、messages/tools 和 `finishReason` 是否足以作为长期公共契约
- 调用在请求生命周期的什么位置触发
- 非流式与流式如何共享同一终态语义，同时避免把非流式实现长期绑定为 stream 聚合
- provider 原始结果与上层可消费结果之间的边界在哪里

这个 change 的目标是审视并收敛“模型调用”的首版目标态规格，明确当前最小流程契约哪些可以保留、哪些需要 contract refinement，并直接落地目标态实现。

## 变更范围（What Changes）

- 保留 change 名称，但将目标改为审视并收敛稳定的 `ModelInvocationRequest`、`ModelInvocationService`、`ModelFinalResult`、`ModelStreamDelta` 的长期行为语义。
- 明确模型调用在请求生命周期中的触发位置、前置条件、成功终态和失败终态。
- 明确 `agent-model` 负责通过内部 provider adapter 将 provider-native 接口、响应和失败转换为标准 `ModelFinalResult` / `ModelStreamDelta` 边界。
- 明确流式调用模式输出有序增量事实，并以统一终态结果结束。
- 明确当前 TS 首版可先沿用最小流程契约，但不得把最小流程字段形状视为长期终态。
- 明确需要重点收敛的 contract refinement：provider identity 语义、`ModelCommonOptions` 与 adapter-owned `ModelProviderOptions` schema / allowlist 边界、provider-neutral `ModelMessage` / `ModelToolDescriptor` 目标结构，以及 `ModelFinishReason` 稳定枚举。
- 明确 AI SDK alignment policy：public model contract 可以吸收经评审的 AI SDK 稳定语义，但必须保持 NextAgent-owned；AI SDK DTO、stream part union、providerOptions wire shape、provider error、client object 和 provider-specific metadata 不得进入 public contract。
- 明确 TS 首版 OpenRouter-backed 访问使用 `@openrouter/ai-sdk-provider@2.9.0` 与 `ai@^6.0.195` 作为 `agent-model` provider adapter 内部实现选择，其中 `ai@^6.0.195` 满足 OpenRouter provider 的 `ai@^6.0.0` peer dependency；AI SDK / OpenRouter provider 类型和 raw part 不得改变 public model contract、stream normalization 责任或 safe error 边界。

## 相邻 Change 关系（Adjacent Change Relationship）

本 change 定义模型调用这一步的公共生命周期、输入前置条件、`complete()` / `stream()` 的统一终态关系，以及 provider adapter 与 normalization boundary 的交接边界。它只要求 `stream()` 输出有序 `ModelStreamDelta` 并以 `ModelFinalResult` 收敛，不展开 provider-native stream chunk 的分类、tool-call fragment 拼接或 malformed chunk 收敛规则。

`add-ts-model-stream-normalization` 承接这些流式归一化细节，并通过直接相关的 agent-model stream normalization 测试验证 raw stream 到 `ModelStreamDelta` / `ModelFinalResult` 的行为。本 change 不吞并 stream normalization 的细节，stream normalization 也不得重新定义 `ModelInvocationRequest`、调用生命周期、fallback policy、runtime timeline 或 channel stream 协议。

`add-ts-provider-error-safe-mapping` 承接 provider/model failure 的分类、脱敏、unknown error normalization 和跨边界 `SafeError` 输出规则。本 change 只定义失败终态通过 `ModelFinalResult.safeError` 暴露，不展开 provider error taxonomy、raw provider detail 裁剪、fallback 安全消费或 observability 安全消费规则。

## Capability 影响（Capabilities）

### 修改的 Capability
- `model-invocation-contract`: 明确模型调用的生命周期语义、输入前置条件、终态语义和消费边界。
- `model-provider-adapter`: 明确 `agent-model` 内部 provider adapter 如何消费 `ModelInvocationRequest`、接收 provider-native raw response / raw stream，并把 provider 接口结果转换到 invocation / normalization 标准边界。

### 需审视的 Contract Refinement
- `providerKind`：当前可打通最小流程，但长期语义需要区分 provider family、route/profile selection、adapter implementation 和 deployment endpoint，避免一个字段同时承担多层选择语义。
- `providerOptions`：当前 `JsonObject` 太宽，必须收敛为明确 refinement 目标：跨 provider 稳定选项提升为 provider-neutral `ModelCommonOptions`，provider-specific options 保留在 adapter-owned `ModelProviderOptions` schema / allowlist 内；AI SDK `providerOptions` wire shape 只能作为 `agent-model` adapter 内部映射目标，不得成为 public contract。
- `messages` / `tools`：当前偏最小问答与最小 tool-call 流程，必须收敛为 provider-neutral `ModelMessage`、`ModelMessageContentPart` 和 `ModelToolDescriptor` refinement 目标，用来表达 tool descriptor、tool result message、multi-part content、provider-neutral tool schema 和 capability binding 的稳定边界；AI SDK message/tool 类型只能作为 `agent-model` 内部映射目标。
- `finishReason`：当前 `string` 容易泄漏 provider 原始 finish reason，必须定义 provider-neutral `ModelFinishReason` stable vocabulary，并将 `ModelFinalResult.finishReason?: string` 替换为 `ModelFinalResult.finishReason?: ModelFinishReason`；raw provider finish reason 只能停留在 `agent-model` 内部诊断边界。

## 影响范围（Impact）

- 受影响模块：
  - `modules/agent-model`
  - `modules/agent-core`
  - `modules/agent-runtime`
  - `tests/contract`
- 受影响接口（本 change 需要审视，是否实际修改须经 contract refinement 评审确认）：
  - `ModelInvocationRequest`
  - `ModelInvocationService`
  - `ModelFinalResult`
  - `ModelStreamDelta`

## TS 首版补齐范围（TS First-Release Closure Scope）

本 change 在 TS 首版补齐以下可独立验收的 invocation boundary 行为：

1. `timeoutMs` 不只作为正数配置存在，还必须形成 profile 级 provider invocation timeout，并与上层 request cancellation signal 合并。
2. 在 provider execution 前校验 message、tools 和 `providerOptions` 的可消费 shape；非法边界输入不得进入 provider adapter。
3. `complete()` 与 `stream()` 保持统一终态语义。TS 首版目标态的 `complete()` 必须调用 provider / AI SDK 原生 non-stream 接口并归一化为同一个 `ModelFinalResult`，不得通过 stream 聚合实现。
4. `locale` 关联通过 invocation request 与 runtime-owned request context / timeline 关联保留，不在每个 delta 和 terminal result 中重复新增公共字段。
5. OpenRouter-backed adapter 使用 `@openrouter/ai-sdk-provider@2.9.0` 发起 provider 访问时，AI SDK / OpenRouter provider model/client/options/part/error 类型只停留在 `agent-model` 内部，不进入 `ModelInvocationRequest`、`ModelStreamDelta`、`ModelFinalResult` 或上游 package。

## 已知遗留事项（Deferred Work）

- provider-specific `thinking` wire mapping：`thinking` 保持为稳定 invocation 输入，但 OpenRouter-backed 首版不发明非标准 wire 字段。后续如支持特定 provider 扩展，必须在 adapter-specific change 中定义映射、校验和测试。
- provider-native non-stream implementation：TS 首版目标态直接使用 provider / AI SDK 原生 non-stream 调用路径实现 `complete()`，并复用统一 `ModelFinalResult` 终态和 safe mapping 语义，不形成平行公共协议或第二套行为口径。

## 归档前基线提升计划（Baseline Promotion Plan）

行为契约：
- `openspec/specs/model-invocation-contract/spec.md`：新增，作为稳定调用契约的语义补充
- `openspec/specs/model-provider-adapter/spec.md`：新增，作为 `agent-model` 内部 provider capability 的落地契约

设计视图：
- `openspec/designs/modules/agent-model.md`
- `openspec/designs/architecture/context-engine-and-model-routing.md`
- `openspec/designs/spec-to-design-map.md`

验证入口：
- `tests/contract` invocation contract tests
- `tests/integration` request -> context -> model invocation tests
