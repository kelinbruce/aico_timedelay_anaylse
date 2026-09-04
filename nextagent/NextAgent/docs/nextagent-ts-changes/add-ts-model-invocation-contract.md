# add-ts-model-invocation-contract

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Model Invocation

状态：active
类型：实施 change
主要 owner：`agent-model`
依赖：`establish-ts-core-contracts`、`add-ts-context-prompt-shaping`

目标：
- 审视并收敛长期 `ModelInvocationRequest`、`ModelInvocationService`、`ModelFinalResult` 和 `ModelStreamDelta` 行为语义，定义模型调用在请求生命周期中的触发位置、前置条件以及 `complete()` / `stream()` 共享的统一终态；当前最小流程契约不得直接视为长期终态。

能力组共享输入：

整理状态：本分组当前仅此一个共享输入起点，详细输入由本文件维护

能力组目标：
- 审视并固化模型调用生命周期、统一终态和 provider adapter 与上层消费边界；明确最小流程契约中需要长期 refinement 的字段。

共享规格输入：
- 进入 `ModelInvocationService` 前，core/runtime 必须把 `RenderedModelInput` 转换为扁平 `ModelInvocationRequest`。
- `ModelInvocationRequest` 必须包含 `requestId`、`stepId`、`providerKind`、`modelName`、`baseUrl`、`credentialRef`、`messages`、`tools`、模型参数、`providerOptions` 和 `timeoutMs`。
- `providerKind` 在 TS 目标中必填，用于让 `agent-model` 选择内部 provider adapter；provider SDK、AI SDK 或平台推理网关类型不得进入核心契约。
- 必须审视 `providerKind` 是否混合 provider family / adapter / route/profile / deployment endpoint 语义；如混合，需记录 contract refinement 结论。
- 必须审视 `providerOptions` 的长期边界：稳定跨 provider 选项应进入 common options，provider-specific options 必须由 adapter-owned schema / allowlist 校验。
- 必须审视 messages/tools 是否足以承载长期 provider-neutral tool calling、tool result message 和协议配对。
- `ModelInvocationRequest` 不包含完整 `ContextAssembly`、`RenderedModelInput`、`streamingContext` 或 `stream` 字段。
- `ModelInvocationService` 提供 `complete(request, signal): Promise<ModelFinalResult>` 和 `stream(request, signal): AsyncIterable<ModelStreamDelta | ModelFinalResult>` 两个方法；调用模式由方法选择，不由 request 字段表达。
- `stream()` 必须输出有序 `ModelStreamDelta`，并以 `ModelFinalResult` 结束；`complete()` 与 `stream()` 必须共享同一终态语义。
- `complete()` 当前可通过聚合 normalized stream 打通最小流程；长期默认目标必须调用 provider / SDK 原生 non-stream 同步接口，再归一化为同一 `ModelFinalResult`。继续 stream 聚合必须记录 provider / SDK 能力缺口或 adapter 约束。
- `ModelFinalResult` 必须保留 `responseId?`、`modelId?`、`content`、`thinking?`、`finishReason?`、`usage`、`toolCalls` 和 `safeError?`。
- 必须审视 `ModelFinalResult.finishReason?: string` 是否应收敛为 provider-neutral stable vocabulary，避免 raw provider finish reason 泄漏给上游。
- 本 change 定义模型调用这一步的公共生命周期和终态契约，不创建平行的公共调用协议；若审视结论要求修改已冻结核心契约，必须记录 contract refinement 评审结论后再实施。

并行边界：
- 不得在 runtime、core、channel 或 context 模块重新定义模型调用入口或终态 DTO。
- provider-native raw response 和 raw stream 不得直接泄漏到 `agent-model` 之外的公共边界。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先完成 contract refinement 评审确认，记录修改理由、影响范围、目标边界和验证要求后再实施。
