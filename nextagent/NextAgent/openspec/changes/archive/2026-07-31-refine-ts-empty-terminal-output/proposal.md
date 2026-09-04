# Proposal: Refine TS empty terminal output guard

## 背景（Background）

某些模型 provider 可能以 `finishReason="stop"`、无 tool call 且 assistant 内容为空来完成 tool 后规划轮。当前请求路径把它当作成功的 terminal 结果，这会持久化一条空的可见 assistant message 并发布 `REQUEST_COMPLETED`。

## 变更范围（What Changes）

1. Agent Core 在生命周期 terminal hook 之前、发出最终内容之前，拒绝最终 assistant 内容为空或仅空白字符的 terminal 决策。
2. 当模型以 reasoning 停止但没有可见内容或 tool call 时，Agent Core 执行恰好一次同模型纠正调用，使用固定的 provider 中立指令，然后才把结果分类为 `MODEL_EMPTY_OUTPUT`。
3. 如果纠正调用仍为空，则评估既有模型 fallback 策略；fallback 仍受可见输出重放、取消、deadline、路由可用性和路由耗尽防护约束。
4. Runtime terminal commit 新增防御性兜底：内容为空或仅空白字符的 `COMPLETED` terminal commit 被转换为带 `MODEL_FINAL_CONTENT_EMPTY` 的 safe `FAILED`。
5. 诸如 `Rag` 的检索 tool 在返回零结果时仍视为成功；只有模型的空 terminal 回答被拒绝。

## 原因（Why）

已完成的请求必须产生一条可见、可渲染的 assistant terminal message。空的模型 terminal 输出是模型输出质量缺陷，不是有效的业务回答。有界的纠正调用给仅 reasoning 的模型结果一次产生回答或 tool call 的机会，而不要求配置 fallback 模型。在有界恢复之后安全失败，使重试、恢复、stream 和历史行为保持可审计，而不是呈现一个看似成功的空白回答。

## 影响范围（Impact）

- `agent-core`：output guard、有界的仅 reasoning 恢复和 default agent terminal 决策路径。
- `agent-runtime`：针对自定义 agent 或未来绕过路径的 terminal commit 兜底。
- `ts-minimal-agent-kernel` spec：terminal assistant message 完整性 requirement。
- 不改变 Web API、gateway contract、RAG contract、memory contract 或 provider adapter contract。
