# add-ts-model-stream-normalization

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Model Invocation

状态：active
类型：实施 change
主要 owner：`agent-model`
依赖：`add-ts-model-invocation-contract`

目标：
- 定义 AI SDK stream part / provider-native stream 到 provider-neutral `ModelStreamDelta` / `ModelFinalResult` 的归一化规则，覆盖 delta vocabulary、tool-call fragment 拼接、完整 tool call 尽快返回、finish signal 和 malformed chunk 收敛。

能力组共享输入：

整理状态：本分组当前仅此一个共享输入起点，详细输入由本文件维护

能力组目标：
- 固化流式模型访问的归一化行为，避免 provider raw stream 直接泄漏到上层。

共享规格输入：
- stream normalization 必须把 AI SDK stream part / provider-native raw chunk 归一化为 provider-neutral `ModelStreamDelta`。
- AI SDK Core `text` / `reasoning` / `tool-call-streaming-start` / `tool-call-delta` / `tool-call`、AI SDK UI `text-delta` / `reasoning-delta` / `tool-input-start` / `tool-input-delta` / `tool-input-available` / `finish` 或 provider 等价 chunk 必须有明确映射规则；SDK/raw 类型不得越过 `agent-model`。
- tool-call fragment 必须按顺序拼接，并在终态前保持可追踪关联；完整 tool call 一旦可判定，必须尽快通过 `ModelStreamDelta.toolCall` 返回，同时终态 `ModelFinalResult.toolCalls` 保留完整集合。
- transport 结束不等于业务终态；流式路径必须显式收敛为 `ModelFinalResult`。
- malformed chunk、normalization failure 或提前结束必须通过统一终态收口，不得把半成品 raw chunk 暴露给上层。
- stream normalization 不产生 runtime timeline、channel envelope 或第二套模型调用协议；它只服务 `ModelInvocationService.stream()` 路径。
- 本 change 不重新定义 `ModelInvocationRequest`、模型调用触发时机、fallback policy、runtime timeline 或 channel stream 协议。

并行边界：
- 不得把 provider-specific chunk taxonomy、SDK 类型或 transport 私有对象暴露到 `agent-model` 之外。
- 不得在本 change 中重写 `complete()` / `stream()` 共享终态语义；该语义归 `add-ts-model-invocation-contract`。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
