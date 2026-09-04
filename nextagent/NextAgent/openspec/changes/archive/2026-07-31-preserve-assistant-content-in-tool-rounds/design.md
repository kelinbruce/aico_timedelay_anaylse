# Design: Preserve assistant content in tool-call rounds

## 当前状态与缺口

`DefaultAgent` 已从 `ModelFinalResult.content` 获得模型公开正文，并通过 `LLM_CONTENT_DELTA` 实时投影。模型同时返回 tool calls 时，`executeToolCallsInOrder` 只接收 `toolCalls`，`appendAssistantToolUseMessage` 持久化 `JSON.stringify({ toolCalls })`。Context Engine 随后只能从这段 JSON 生成 `tool-call` parts。

现有 `ModelMessage` 和 provider adapter 已支持同一 assistant message 同时包含 text 与 tool-call，因此不需要修改 `agent-contracts/model` 或 provider contract。现有 recovery parser 只读取 JSON 的 `toolCalls` 字段，能够忽略新增字段。

## 唯一实现路径

### 1. Agent Core 写入完整公开 assistant 工具消息

`executeToolCallsInOrder` 的 input 增加实现内可选字段 `assistantContent?: string`。正常模型工具轮和 `BEFORE_AGENT_TERMINAL` hook 产生工具调用的路径传入当前轮公开 content；recovery 重新执行 pending calls 时不构造未知 content。

`appendAssistantToolUseMessage` 写入规则固定为：

- 非空 `assistantContent`：`JSON.stringify({ content: assistantContent, toolCalls })`；
- 空或缺失 `assistantContent`：保持 `JSON.stringify({ toolCalls })`；
- message 继续使用 `role=ASSISTANT`、`visible=false`、`metadata.kind=ASSISTANT_TOOL_USE` 和原有 toolCallIds-based idempotency key。

这里的 `assistantContent` 必须来自当前已接受模型调用的 `ModelFinalResult.content`。请求级 `finalContent` 会跨 tool round 累计已投影文本，只用于流式和终态展示，不得作为单轮 `ASSISTANT_TOOL_USE` 的 content。连续多个 tool round 必须分别写入各自的公开 content；output continuation 只在同一次模型输出恢复边界内合并，model fallback 未被接受的输出不得进入已接受 tool round message。

公开 content 已受现有 `maxModelVisibleChars` 输出边界约束。本 change 不增加第二套截断、外置或降级机制；任何持久化失败继续沿现有 request failure 路径显式失败，不静默丢弃 content 后继续执行 tool call。

### 2. Context Engine 还原 text + tool-call

`messageContentParts` 对带 `toolCalls` 的 assistant JSON 执行固定映射：

1. `content` 是非空 string 时先生成一个 text part；
2. 按持久化顺序生成所有合法 tool-call parts；
3. `content` 缺失、为空或不是 string 时不生成 text part；
4. 旧 `{ toolCalls }` message 保持 tool-call-only 行为；
5. tool pairing assertion 和 capability-result 顺序不变。

该映射不读取 reasoning 字段，也不从 timeline、stream delta 或 raw provider response 补写内容。

### 3. Recovery 与兼容

Recovery 的 authoritative tool state 仍是 `toolCalls`、`ToolCallState`、capability results 和 checkpoint。新增 `content` 只是后续 model render 使用的公开 assistant 正文，不参与 replay policy、stable idempotency key 或 pending/completed 判断。

历史消息兼容采用单向宽容读取：新代码读取旧 tool-call-only JSON；新消息中的额外 `content` 字段被旧 recovery parser 忽略。不迁移既有消息，不批量重写 active context。

## 所有权与边界

- `agent-core` 继续拥有模型轮次 orchestration 和 execution-time assistant tool-use message 组装。
- `agent-runtime` 继续通过 `AgentRunStatePort` 补齐可信 owner/agent/session/run 坐标并执行 composite message write；本 change 不改变该 port。
- `agent-context-engine` 继续拥有 session message 到 provider-neutral model input 的渲染。
- `agent-model` 继续只做 provider 映射，不增加 NextAgent 持久化语义。
- `agent-channel-web` 不变；前台继续消费现有 stream projection。

## 质量属性审视

- 安全：只持久化已经作为公开 `LLM_CONTENT_DELTA` 投影的 assistant content；不记录 reasoning、raw provider response、credential、路径或新的日志字段。隐藏 message 不进入普通 conversation/history。
- 性能/容量：不增加模型调用或 gateway round trip；每个工具轮最多增加现有公开 content 的字符数，且受现有模型输出上限约束。
- 可靠性/恢复：message 与 active context 仍由同一 composite write 保证；写入失败显式失败。Recovery 忽略可选 content，replay 判定不变。
- 可维护性：复用现有 `SessionMessage.content` JSON 与 `ModelMessage` content parts，不新增 DTO、port、schema 或 adapter 分支。
- 可测试性：通过真实第二次 model invocation request 断言 text/tool-call/result 顺序，并用 renderer 与 recovery characterization 覆盖边界。
- 审计/可追溯：不新增 audit/log payload；持久化 message 保留现有 owner/agent/request/run 坐标和 toolCallIds 关联。

## 验证与回滚

验证入口：focused Vitest、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`（CLI 可用时）。回滚只需移除可选 content 写入和 renderer text part；旧、新消息都保持可读取，不需要数据迁移。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-4.1-调用模型` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/context-engine/spec.md`、`openspec/specs/ts-minimal-agent-kernel/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
