## 背景与问题（Why）

NextAgent 的 CLIP Server（`clip_server`）通过 sandbox boundary 执行远端 API 调用，返回结果以 `CapabilityInvocationResult.structuredPayload` 形式进入 tool-loop。当前 tool-loop 将结果统一投影为 `CAPABILITY_RESULT_DELTA` timeline event，stream-envelope 再尝试将其映射为已知 shape（`commandOutput`、`fileRead`、`fileList`、`fileWrite`、`skillLoaded`）的 `safeResult`。但 CLIP API 返回的数据不匹配任何已有 shape，导致 `safeResult` 为空、`detailText` 为空、`safeSummary` 退化为通用兜底（`"result fields=N"`），前端过程面板只显示一句话摘要，回答正文区域完全不可见。

电信网络智能体的 CLIP API 返回有三种需要结构化渲染的场景：

1. **纯字符串**：类似于模型 API 返回，前端累积展示。
2. **结构化事件 JSON（非流式）**：满足 `{eventType, content, messageType}` 格式，`eventType` 枚举为 `TITLE`、`DETAIL`、`ANSWER`、`SUB_TITLE`、`SUB_DETAIL`、`SUB_CONCLUSION`，用于指定数据展示位置；`messageType` 枚举为 `PIU`、`DSL`、`ACTION`、`OPERATOR`、`FILE`、`TEXT`，用于指定 content 渲染方式。
3. **结构化事件流式**：每次返回一个 `{eventType, content, messageType}` 对象，逐条流式到达。当前 CLIP 尚未支持流式返回，但数据格式与场景 2 一致，前端处理逻辑可统一。

普通 JSON（不满足结构化事件格式）走原有 `CAPABILITY_RESULT_DELTA` 通道，不发 `TOOL_STRUCTURED_DELTA`。

当前架构缺少一个能原生承载结构化工具数据的 timeline event 类型。现有 `CAPABILITY_RESULT_DELTA` 通道把结构化数据硬塞进文本通道或 `safeResult`，要么丢失结构化语义，要么需要大改 `buildAnswerContent()`。现有 `LLM_CONTENT_DELTA` 通道只认文本，无法承载 PIU/OPERATOR/ACTION 等需要特殊渲染的结构化内容。

## 变更范围（What Changes）

- 新增 `TOOL_STRUCTURED_DELTA` timeline event 类型（`agent-common`），原生承载 CLIP 结构化工具数据，不挤进 `CAPABILITY_RESULT_DELTA` 或 `LLM_CONTENT_DELTA`。
- 在 tool-loop 投影层（`agent-core/src/tools/tool-loop.ts`）增加识别逻辑：**只对 CLIP 来源**（`providerKind=CUSTOM, providerType=clip_server`）的工具结果做识别。检查 `structuredPayload` shape，区分纯字符串和结构化事件两种情况，按需发出 `TOOL_STRUCTURED_DELTA`。普通 JSON 不走此通道。
- 在 stream-envelope 投影层（`agent-channel-web/src/projections/stream-envelope.ts`）增加 `TOOL_STRUCTURED_DELTA` 的 SSE/WebSocket envelope 投影，将其加入 `streamVisibleTimelineEvents` 列表。
- 在前端 `StreamEventType`（`agent-contracts/channel` 和 `agent-web/src/state/contracts.ts`）新增 `TOOL_STRUCTURED_DELTA`。
- 在前端 `buildProcessTimelineEntries()`（`agent-web/src/features/chat/process/processDetails.ts`）新增 `TOOL_STRUCTURED_DELTA` 处理：按 `toolEventType` 生成独立过程面板条目（TITLE/SUB_TITLE 为条目标题，DETAIL/SUB_DETAIL/SUB_CONCLUSION 累积到就近条目的 detail），新增小圆圈图标用于 `SUB_TITLE` 类型条目。当同一 `toolCallId` 有 `TOOL_STRUCTURED_DELTA` 事件时，`CAPABILITY_STARTED`/`CAPABILITY_COMPLETED` 不在过程面板生成条目。
- 在前端回答正文区域按 **sequence 混排** `LLM_CONTENT_DELTA` 和 `TOOL_STRUCTURED_DELTA`（ANSWER 类型）事件，按 `toolMessageType` 分发到对应渲染组件。
- 在前端新增六种 `messageType` 渲染组件：`TEXT`（复用 MarkdownContent）、`FILE`（文件卡片）、`ACTION`（自动触发 CustomEvent，data 为对象字符串需 JSON.parse）、`OPERATOR`（用户点击触发 CustomEvent，data 为对象字符串需 JSON.parse）、`DSL`（DSLEngine，content 原样传入，vite alias stub 本地降级）、`PIU`（PiuMessage，依赖 PiuContext + mock Prel）。
- 在前端新增 `PiuContext`：将 `piu` 对象和 `site` 从入口层传入 context，供 PiuMessage 组件任意取用；新增 `prel-mock.ts` 提供本地 dev 模式的 mock Prel/PIU/site。
- 在前端 vite 配置新增 `@cloudsop/dsl-engine-web` 的 alias，本地 dev 指向 stub 组件，远端 build 指向真实包。
- 更新 PIU 类型定义（`host/prel.ts`），修正 `attach` handlers 结构为 `{ $stateChange?, userAction? }`。
- 存储只存一份：`appendCapabilityResultMessage` 全量存不变。历史重建时 conversation adapter 检测 payload shape，匹配则重建为 `TOOL_STRUCTURED_DELTA` envelope。
- **BREAKING**：无。现有 `CAPABILITY_RESULT_DELTA` / `LLM_CONTENT_DELTA` 行为不变；`TOOL_STRUCTURED_DELTA` 是新增能力，不匹配结构化事件 shape 的工具结果仍走原有通道。非 CLIP 工具完全不受影响。

## Capability 影响（Capabilities）

### 新增 Capability
- `tool-structured-delta`: 定义结构化工具数据 delta 的 timeline event 类型、CLIP 来源限定、投影规则、安全边界和结果识别逻辑。
- `agent-web-structured-message-rendering`: 定义前端对 `TOOL_STRUCTURED_DELTA` 事件的解析、分发、六种 `messageType` 的渲染组件规范、CAPABILITY 抑制逻辑、回答正文混排、PiuContext 和 DSL alias stub。

### 修改的 Capability
- `agent-web-process-panel`: ProcessPanel 需扩展以支持 `TOOL_STRUCTURED_DELTA` 事件生成的独立条目、小圆圈图标和 CAPABILITY 抑制。
- `api-backed-tool-source`: CLIP API 结果投影补充说明——结构化事件走 `TOOL_STRUCTURED_DELTA` 通道。

## 影响范围（Impact）

- `agent-common`：`TimelineEventType` 新增 `"TOOL_STRUCTURED_DELTA"`；新增 `ToolEventType`、`ToolMessageType` 类型。
- `agent-contracts/channel`：`StreamEventType` 新增 `"TOOL_STRUCTURED_DELTA"`。
- `agent-core/src/tools/tool-loop.ts`：新增 CLIP provider 识别、structured payload shape 识别和 `TOOL_STRUCTURED_DELTA` 发射逻辑。
- `agent-channel-web/src/projections/stream-envelope.ts`：新增 `TOOL_STRUCTURED_DELTA` 投影和可见事件列表更新。
- `agent-web/src/state/contracts.ts`：`STREAM_EVENT_TYPES` 新增 `"TOOL_STRUCTURED_DELTA"`。
- `agent-web/src/features/chat/hooks/useStreamConnection.ts`：`FRAME_BATCHABLE_EVENT_TYPES` 新增 `"TOOL_STRUCTURED_DELTA"`。
- `agent-web/src/features/chat/process/processDetails.ts`：`buildProcessTimelineEntries` 新增 `TOOL_STRUCTURED_DELTA` 处理分支和 CAPABILITY 抑制逻辑。
- `agent-web/src/features/chat/presentation/answerContent.ts`：改为同时处理 `LLM_CONTENT_DELTA` 和 `TOOL_STRUCTURED_DELTA` ANSWER 事件，按 sequence 混排。
- `agent-web/src/features/chat/components/structured/`：新增 FileCard、ActionCard、OperatorButtons、DslRenderer、PiuMessage 组件。
- `agent-web/src/features/chat/context/PiuContext.tsx`：新增 PiuContext Provider。
- `agent-web/src/host/prel.ts`：更新 PIU 类型定义。
- `agent-web/src/host/prel-mock.ts`：新增 mock Prel/PIU/site。
- `agent-web/src/entries/local.tsx`：注入 mock Prel，包裹 PiuContext.Provider。
- `agent-web/src/entries/immersive.tsx`：将 piu 传入 PiuContext。
- `agent-web/src/piu/registerAIAgentPIU.tsx`：将 piu 传入 PiuContext。
- `agent-web/src/piu/AIAgentPiuRuntime.tsx`：从 store 取 piu 传入 PiuContext。
- `agent-web/vite.config.ts`：新增 `@cloudsop/dsl-engine-web` alias。
- `agent-web/src/assets/process-icons/`：新增 circle-dark.svg、circle-light.svg。
- `agent-web/src/features/chat/adapters/conversationAdapter.ts`：历史重建时检测 payload shape，匹配则重建为 `TOOL_STRUCTURED_DELTA` envelope。
- 安全：`TOOL_STRUCTURED_DELTA` 的 content 按 `messageType` 做安全校验；ACTION/OPERATOR 的 `data` 字段是对象字符串，前端 `JSON.parse` 后作为 `CustomEvent.detail`，不得包含 credential、token 等敏感信息；PIU 的 `piuName`/`piuVersion` 经格式校验；结构化识别只对 CLIP 来源触发。
- 测试：需要 contract 测试（timeline event 类型、stream envelope 投影、CLIP-only 识别）、architecture 测试（边界隔离）、前端组件测试（六种 messageType 渲染、PiuContext mock、DSL stub、CAPABILITY 抑制、回答正文混排、历史重建）。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/tool-structured-delta/spec.md`：新增——`TOOL_STRUCTURED_DELTA` event 类型、CLIP 来源限定、payload 规范、投影规则、安全校验、单份存储与历史重建。
- `openspec/specs/agent-web-structured-message-rendering/spec.md`：新增——前端解析、分发、六种 messageType 渲染组件规范、CAPABILITY 抑制、回答正文混排、PiuContext、DSL alias stub。
- `openspec/specs/agent-web-process-panel/spec.md`：修改——新增 `TOOL_STRUCTURED_DELTA` 条目、小圆圈图标和 CAPABILITY 抑制。
- `openspec/specs/api-backed-tool-source/spec.md`：修改——补充结构化事件走 `TOOL_STRUCTURED_DELTA` 通道说明。

设计视图：
- `openspec/designs/architecture/tool-structured-delta.md`：新增——跨模块数据流、CLIP 来源识别、投影层识别逻辑、前端分发渲染、CAPABILITY 抑制、回答正文混排。
- `openspec/designs/modules/agent-core.md`：补充 tool-loop 结构化 delta 发射职责。
- `openspec/designs/modules/agent-channel-web.md`：补充 stream-envelope 投影职责。
- `openspec/designs/modules/agent-web.md`：补充结构化消息渲染组件、PiuContext 和历史重建。
- `openspec/designs/adr/tool-structured-delta-event-type.md`：新增——引入新 timeline event 类型而非复用现有通道的设计决策。
- `openspec/designs/adr/dsl-vite-alias-stub.md`：新增——DSL 二方件本地 stub 的设计决策。
- `openspec/designs/adr/piu-context-mock.md`：新增——PiuContext + mock Prel 的设计决策。
- `openspec/designs/spec-to-design-map.md`：补充新 spec 到 design 的导航。

验证入口：
- `openspec validate --all --strict`
- `npm run build`
- `npm test`
- `npm run test:contract`
- `npm run lint:architecture`
