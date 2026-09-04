# Proposal: Preserve assistant content in tool-call rounds

## 背景

当模型在同一响应中同时返回公开 assistant content 和 tool calls 时，Agent Core 会把 content 作为 `LLM_CONTENT_DELTA` 实时投影给用户，但隐藏的 `ASSISTANT_TOOL_USE` session message 只持久化 `toolCalls`。后续模型轮次通过 active context 读取该消息时，只能看到 assistant tool call 和匹配的 capability result，看不到已经向用户展示的同轮 assistant content。

这会使用户可见对话与后续模型输入不一致。在多轮电信诊断、配置检查和跨资源分析中，同轮公开 content 可能承载阶段结论、下一步方向或约束说明；丢失后会增加重复调用、遗漏后续检查和诊断路径漂移的概率。

## 变更内容

本 change 修改现有 `ts-minimal-agent-kernel` 与 `context-engine` capability：

1. Agent Core 在模型返回非空公开 content 与 tool calls 时，把该 content 与 `toolCalls` 持久化到同一个隐藏 `ASSISTANT_TOOL_USE` message；空 content 继续使用既有 tool-call-only 形态。
2. Context Engine 将该消息渲染为同一 `ASSISTANT` model message 内按 text、tool-call 顺序排列的 content parts，并继续在其后配对 capability results。
3. 旧版只包含 `{ toolCalls }` 的持久化消息继续可读；recovery 仍只从 `toolCalls` 重建 tool batch state，不依赖公开 content。
4. reasoning/thinking 不进入 session message，也不进入后续模型请求。

## 影响范围

- `agent-core`：把当前模型轮次的公开 content 传入 assistant tool-use message 写入路径。
- `agent-context-engine`：从 assistant tool-use message 还原可选 text 与 tool calls。
- `agent-runtime` recovery：仅增加新消息形态的兼容性 characterization，不改变 replay 决策和 owner。
- 测试：覆盖下一轮实际 model request、隐藏历史、空 content、旧消息兼容和 recovery。
- 不新增或修改 `agent-contracts` public type、Web API、stream event、runtime command、gateway port、persistence owner 或 provider adapter contract。

## 非目标

- 不持久化 reasoning/thinking 或 raw provider response。
- 不改变普通 conversation/history 对隐藏 `ASSISTANT_TOOL_USE` message 的过滤行为。
- 不新增摘要、规划状态、Todo 或其他中间状态机制。
- 不改变 tool execution、并发、幂等、risk policy、sandbox 或 capability result 语义。

## 归档前基线更新

- 把行为契约合并到 `openspec/specs/ts-minimal-agent-kernel/spec.md` 与 `openspec/specs/context-engine/spec.md`。
- 把稳定实现边界合并到 `openspec/designs/modules/agent-core.md`、`openspec/designs/modules/agent-context-engine.md` 和 `openspec/designs/architecture/core-contracts.md`。
- 更新 `openspec/designs/spec-to-design-map.md` 的相关导航；本 change 不需要新增 ADR 或修改 `openspec/overview.md`。
