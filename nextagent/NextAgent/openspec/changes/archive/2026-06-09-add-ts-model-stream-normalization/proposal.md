## 背景与问题（Why）

流式模型访问需要一套稳定的归一化能力，用来把 provider-native raw stream 收敛为上层可消费的统一语义。当前最需要明确的是：

- 流式增量事实如何表达
- tool-call fragment 如何拼接
- 流式调用何时形成终态
- transport 结束与业务终态之间的边界

这个 change 的目标是定义流式模型访问的归一化规格，而不是把 provider raw stream 直接暴露给上层。

## 变更范围（What Changes）

- 将 change 定位为 provider-native stream 到 provider-neutral stream facts 的独立归一化能力。
- 明确 TS 首版使用 `@openrouter/ai-sdk-provider@2.9.0` 作为 `agent-model` 内部 AI SDK provider 组件和 stream part 输入基线，并定义 OpenRouter AI SDK provider stream part / provider-native chunk 如何归一化为 provider-neutral `ModelStreamDelta`。
- 引入成熟的 OpenRouter AI SDK provider abstraction，减少自研 provider stream parsing / tool-call fragment handling 代码量，降低 provider-native chunk 处理错误概率，并为后续通过 OpenRouter 接入更多 provider 保留内部 adapter 扩展路径。
- 明确 tool-call fragment、完整 tool call delta、finish signal 和 terminal result 的归一化要求。
- 明确 stream normalization 不产生 runtime timeline 或 channel envelope。

## 独立 Change 理由（Why Separate）

本 change 不合并进 `add-ts-model-invocation-contract`，因为它拥有独立可验证的流式归一化行为：`@openrouter/ai-sdk-provider@2.9.0` stream part / raw chunk 分类、现有字段型 `ModelStreamDelta` 输出、tool-call fragment 内部保序聚合、完整 tool call 尽快 delta 暴露、malformed chunk / normalization failure 的终态收敛。这些行为需要直接相关的 stream normalization 测试验证，而 `add-ts-model-invocation-contract` 只定义模型调用生命周期、`complete()` / `stream()` 的统一终态关系，以及 provider adapter 与 normalization boundary 的交接边界。

## 相邻 Change 关系（Adjacent Change Relationship）

`add-ts-model-invocation-contract` 定义模型调用的公共生命周期、输入前置条件、provider adapter 交接边界，以及 `complete()` / `stream()` 共享 `ModelFinalResult` 的统一终态关系。本 change 只承接 `stream()` 路径内部的归一化行为：`@openrouter/ai-sdk-provider@2.9.0` stream part / provider-native raw stream chunk 如何变成 provider-neutral `ModelStreamDelta`，完整 tool call 何时以 `ModelStreamDelta.toolCall` 暴露，以及最终如何收敛为 `ModelFinalResult`。

本 change 不重新定义 `ModelInvocationRequest`、模型调用触发时机、fallback policy、runtime timeline 或 channel stream envelope。它也不创建第二套模型调用协议；它只为 invocation contract 中的 `stream()` 路径提供独立可验收的归一化规则。

## Capability 影响（Capabilities）

### 修改的 Capability
- `model-invocation-contract`: 保持 `stream()` 与 `complete()` 共享统一终态的调用契约，并由本 change 补齐流式归一化行为。
- `model-stream-normalization`: 新增独立 baseline spec，用于验证 provider-native stream 到 `ModelStreamDelta` / `ModelFinalResult` 的归一化行为。

## 影响范围（Impact）

- 受影响模块：
  - `modules/agent-model`
  - `tests/contract`
  - `tests/integration`

## 归档前基线提升计划（Baseline Promotion Plan）

行为契约：
- `openspec/specs/model-stream-normalization/spec.md`：新增

设计视图：
- `openspec/designs/modules/agent-model.md`
- `openspec/designs/spec-to-design-map.md`

验证入口：
- agent-model stream normalization tests covering `@openrouter/ai-sdk-provider@2.9.0` part mapping, content deltas, earliest complete tool-call delta emission, terminal tool-call preservation, and malformed stream failure
