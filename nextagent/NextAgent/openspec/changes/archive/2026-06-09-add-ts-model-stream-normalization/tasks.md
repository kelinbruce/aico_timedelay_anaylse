## 1. Spec Alignment

- [x] 1.1 将 stream normalization 明确为独立可验证的流式归一化行为。
  来源：proposal 目标；design 黑盒目标
- [x] 1.2 移除平行公共调用协议的叙述。
  来源：design 相邻 Change 关系
- [x] 1.3 明确 `ModelStreamDelta` 与 terminal `ModelFinalResult` 的关系。
  来源：spec requirement "Streaming converges to the same terminal result contract"；design 关键约束
- [x] 1.4 明确引入 `@openrouter/ai-sdk-provider@2.9.0` 与 `ai@^6.0.195` 的目标是减少自研 provider stream parsing / tool-call fragment handling 代码量、降低错误概率，并通过 OpenRouter-backed 内部 adapter 映射支持更多 provider，而不扩展 public stream contract。
  来源：spec requirement "Stream deltas are provider-neutral"；design 黑盒目标

## 2. Design

- [x] 2.1 写清 `@openrouter/ai-sdk-provider@2.9.0` stream part / provider-native chunk 到 `ModelStreamDelta` 的归一化边界。
  来源：spec requirement "Stream deltas are provider-neutral"；design 核心实现策略

- [x] 2.1a 写清 normalizer 优先复用 `@openrouter/ai-sdk-provider@2.9.0` stream abstraction，只有目标语义无法表达时才在 `agent-model` 内部补充最小 adapter 映射。
  来源：design 核心实现策略

- [x] 2.1b 写清 `ai@^6.0.195` 满足 `@openrouter/ai-sdk-provider@2.9.0` 的 `ai@^6.0.0` peer dependency，且该版本选型只作为 `agent-model` 内部 normalizer / adapter 依赖。
  来源：spec requirement "Stream deltas are provider-neutral"；design 核心实现策略

- [x] 2.2 写清 tool-call fragment 的顺序、关联和完整调用尽快 delta 暴露语义。
  来源：spec requirement "Tool-call fragments preserve order and association"；design 关键约束

- [x] 2.3 写清 completion/failure 如何显式收敛为 `ModelFinalResult`。
  来源：spec requirement "Streaming converges to the same terminal result contract"；spec requirement "Stream failure is explicit"；design 关键业务流程

## 3. Validation

- [x] 3.1 覆盖 content delta 流式样例。
  来源：spec requirement scenario "Provider emits content chunks"
- [x] 3.2 覆盖 `@openrouter/ai-sdk-provider@2.9.0` stream part 到 NextAgent delta 的逐项映射样例。
  来源：spec requirement scenario "OpenRouter AI SDK provider stream parts are normalized"
- [x] 3.2a 覆盖新增 provider 通过 `@openrouter/ai-sdk-provider@2.9.0` stream abstraction 接入时，public `ModelStreamDelta` / `ModelFinalResult` 不出现 provider-specific payload 或 AI SDK DTO 的样例。
  来源：spec requirement scenario "Additional provider is introduced through AI SDK"
- [x] 3.3 覆盖 tool-call fragment 流式样例，断言完整 tool call 在终态前通过 `ModelStreamDelta.toolCall` 尽快返回，并在 `ModelFinalResult.toolCalls` 保留。
  来源：spec requirement scenario "Provider streams tool arguments in pieces"
- [x] 3.4 覆盖 malformed chunk / normalization failure 的终态样例。
  来源：spec requirement scenario "Stream normalization fails"

验证：2026-06-05 运行 `npm test`、`npm run build`、`npm run lint:architecture`；`packages/agent-model/tests/openrouter-provider.test.ts` 覆盖 OpenRouter AI SDK content/reasoning/tool-call parts、完整 tool call 尽快 delta、reasoning/usage/provider metadata terminal aggregate、malformed stream safe failure 和 provider-neutral 输出。
