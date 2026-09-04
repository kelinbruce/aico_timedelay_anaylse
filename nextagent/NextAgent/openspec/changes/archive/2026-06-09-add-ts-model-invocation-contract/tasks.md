## 1. Spec Alignment

- [x] 1.1 将 invocation change 明确为长期调用契约审视与边界语义，不把最小流程契约原样固化为终态。
  来源：proposal 目标；design 边界
- [x] 1.2 在 spec 中明确非流式模式与流式模式都属于同一调用能力。
  来源：spec requirement "Non-streaming and streaming invocation share one terminal result contract"；design 黑盒目标
- [x] 1.3 明确调用所需的 provider identity、access、messages、tools 和 timeout 等稳定输入。
  来源：spec requirement "Current request fields are review baseline inputs"；design 输入输出
- [x] 1.4 审视 `providerKind`、`providerOptions`、messages/tools、`finishReason` 是否需要 contract refinement，并记录评审结论。
  来源：spec requirement "Current request fields are review baseline inputs"；design Contract Refinement Review Points
- [x] 1.4d 写清 AI SDK alignment policy：contracts 可镜像经评审且 provider-neutral 的 AI SDK 稳定语义，但 public contract 必须保持 NextAgent-owned，不暴露 AI SDK DTO、stream part union、providerOptions wire shape、provider error、client object 或 provider-specific metadata。
  来源：spec requirement "Invocation semantics define one stable invocation capability"；design AI SDK 对齐策略
- [x] 1.4a 将 `finishReason?: string` 收敛为明确 contract refinement 目标：新增 `ModelFinishReason` 稳定枚举并替换 `ModelFinalResult.finishReason?: string`。
  来源：spec requirement "Terminal finish reasons are provider-neutral"；design Contract Refinement Review Points
- [x] 1.4c 将 `providerOptions: JsonObject` 收敛为明确 contract refinement 目标：定义 provider-neutral `ModelCommonOptions` 与 adapter-owned `ModelProviderOptions` schema / allowlist，AI SDK providerOptions wire shape 只允许停留在 `agent-model` adapter 内部。
  来源：spec requirement "Provider options are validated behind adapter-owned schemas"；design Contract Refinement Review Points
- [x] 1.4b 将 messages/tools 收敛为明确 contract refinement 目标：定义 provider-neutral `ModelMessage`、`ModelMessageContentPart` 和 `ModelToolDescriptor`，AI SDK message/tool DTO 只允许停留在 `agent-model` adapter 内部。
  来源：spec requirement "Messages and tools are provider-neutral contract inputs"；design Contract Refinement Review Points
- [x] 1.5 新增 `model-provider-adapter` spec，定义 `agent-model` 内部 provider capability 如何执行 raw provider 访问，并将 provider-native 结果转换为标准 invocation / normalization 边界。
  来源：spec requirement "Agent-model owns internal provider adapter capability"；design Provider Adapter Capability

## 2. Design

- [x] 2.1 写清模型调用在请求主流程中的触发位置。
  来源：spec requirement "Model invocation is triggered as a request-step execution stage"；design 关键业务流程
- [x] 2.2 写清调用前前置条件和固定判断顺序。
  来源：spec requirement "Invocation preconditions are validated before provider execution"；design 关键约束
- [x] 2.3 写清 `ModelFinalResult` 的成功、tool-call、失败消费语义。
  来源：spec requirement "Failure exits are explicit and safe"；design ModelFinalResult 消费语义
- [x] 2.4 写清 `stream()` 与 `complete()` 的统一终态关系。
  来源：spec requirement "Non-streaming and streaming invocation share one terminal result contract"；design 核心实现策略
- [x] 2.5 写清 provider adapter 在 `agent-model` 内部的职责：请求映射、provider-native response/failure 到标准结果边界的转换、raw stream 接入、与 normalization / safe mapping 的边界。
  来源：spec requirement "Provider adapter consumes stable invocation inputs"；spec requirement "Raw provider results stay inside agent-model boundaries"；design Provider Adapter Capability
- [x] 2.6 写清首版目标态 `complete()` 必须调用 provider / AI SDK 原生 non-stream 接口并归一化到同一 `ModelFinalResult`，不得通过 stream 聚合实现。
  来源：spec requirement "Non-streaming and streaming invocation share one terminal result contract"；design 核心实现策略

## 3. Validation

- [x] 3.1 覆盖正常 content completion 样例。
  来源：spec requirement scenario "Request reaches model step"
- [x] 3.2 覆盖 tool call completion 样例。
  来源：design ModelFinalResult 消费语义（工具调用）
- [x] 3.3 覆盖请求前置条件不满足的失败样例。
  来源：spec requirement scenario "Budget forbids model execution"
- [x] 3.4 覆盖 stream 终态与 non-stream 终态一致的样例。
  来源：spec requirement scenario "Streaming invocation completes"
- [x] 3.5 覆盖 provider raw finish reason 映射为 provider-neutral finish reason 的样例。
  来源：spec requirement "Terminal finish reasons are provider-neutral"
- [x] 3.5a 覆盖 `ModelFinishReason` vocabulary 样例，断言 public `ModelFinalResult.finishReason` 不接受 raw provider finish reason string。
  来源：spec requirement "Terminal finish reasons are provider-neutral"
- [x] 3.5b 覆盖 provider-neutral messages/tools contract 样例，断言 public model request 不包含 AI SDK `CoreMessage`、tool set、tool part 或 provider-specific tool schema。
  来源：spec requirement "Messages and tools are provider-neutral contract inputs"
- [x] 3.5c 覆盖 providerOptions schema / allowlist 样例，断言未知 option、错误类型、raw AI SDK providerOptions 或 credential-like value 在 provider execution 前失败且不泄漏 raw value。
  来源：spec requirement "Provider options are validated behind adapter-owned schemas"
- [x] 3.6 覆盖 `complete()` 使用 provider / AI SDK 原生 non-stream 接口且不依赖 stream 聚合的样例。
  来源：spec requirement scenario "Non-streaming provider API is available"
## 4. TS 首版缺口补齐

> 以下 tasks 4.1–4.4 为 TS 首版缺口补齐任务，尚未统一验收；spec 新增行为由后续 tasks（§1–§3）覆盖。

- [x] 4.1 将 profile `timeoutMs` 与上层 cancellation signal 合并，实际约束 provider fetch 与 stream 读取。
  来源：spec requirement "Invocation preconditions are validated before provider execution"；design 关键约束
- [x] 4.2 在 provider execution 前补齐 message、tools 和 `providerOptions` 的 runtime shape validation，并覆盖 negative case。
  来源：spec requirement "Current request fields are review baseline inputs"；design 输入输出
- [x] 4.3 明确 OpenRouter-backed 首版目标态 `complete()` 使用原生 non-stream 接口、`stream()` 使用 normalized stream 终态、`locale` context correlation、仅支持 `OPENAI` adapter，以及 provider-specific `thinking` wire mapping 延期边界。
- [x] 4.4 将 OpenRouter-backed provider 访问保持为 `agent-model` 内部 `@openrouter/ai-sdk-provider@2.9.0` 与 `ai@^6.0.195` 实现，并验证 AI SDK / OpenRouter provider 类型不泄漏到 contracts/core/runtime/channel。
- [x] 4.5 验证 `ai@^6.0.195` 满足 `@openrouter/ai-sdk-provider@2.9.0` 的 `ai@^6.0.0` peer dependency，且 AI SDK version selection 不进入 public contract。

验证：2026-06-08 运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run test:e2e:openai`、`npm run lint:architecture`、`openspec validate --all --strict`；另运行 `npm ls ai @openrouter/ai-sdk-provider --depth=0`，确认 `@openrouter/ai-sdk-provider@2.9.0` 与 `ai@6.0.195`。`packages/agent-model/tests/openrouter-provider.test.ts` 覆盖 native complete、stream 统一终态、稳定 finish reason、assistant text/tool-call multi-part 映射、runtime negative cases、运行中 cancellation 与 timeout 区分以及 OpenRouter-backed provider execution；`tests/contract/core-contracts.test.ts` 与 `tests/architecture/boundaries.test.ts` 覆盖目标态 contract 和 SDK 类型不外泄。
