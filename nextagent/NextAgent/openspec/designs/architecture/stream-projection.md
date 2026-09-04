# Stream 投影

## 目的

stream projection 定义 runtime canonical event 如何被投影为 public `StreamEnvelope`。它隔离 runtime lifecycle truth 和 transport delivery details。

## 事件信封原则

- runtime event 是事实来源；channel 只做 schema validation、ordering、safe projection 和 delivery。
- `sequence` / replay anchor 必须来自 canonical event stream，不由 transport adapter 自造。
- replay/live-tail 语义由 runtime `streamEvents` 拥有；channel 不得把 omitted cursor 合成为 `0`，不得维护 transport-private replay buffer 或 timeline-to-envelope truth。
- reasoning、final、tool-use、status、terminal、diagnostic 等事件必须使用稳定 vocabulary。
- delta 和 replace 语义由后端事件字段表达；frontend 只按字段应用增量或替换。

## 增量和替换

模型输出或 reasoning 输出可以以增量 delta 追加，也可以以 replace snapshot 更新。replace 不是降级；它表达该字段的完整当前内容。投影层必须尊重后端字段，不把 replace 当成 delta 追加，也不在 delta 缺失时制造文本。

`LLM_THINKING_DELTA` 的 producer 输出完整累计内容。调用中事件省略 `completed`、仅用于 live；单次模型调用的最后一个非空累计事件带 `completed=true`，由 runtime 先持久化再发布。两者复用同一 event type 和 projector：live payload 使用 `metadata.accumulated=true`，完成态增加 `metadata.completed=true`。完成标记只 settle 当前连续 thinking entry，不建立跨 capability 边界的 segment identity。

## Live 与历史共享投影

SSE、WebSocket、resume 和 `GET /api/v1/sessions/:sessionId/runs/:runId/events` 必须逐 event 复用 `projectTimelineEventToStreamEnvelope`。REST event history 只返回持久化的过程事实；conversation API 继续只返回 message。任何 event 投影失败时整页失败，不返回 partial page。完整 owner、scope、gateway metadata、raw timeline payload 和 source lineage 均不得进入 public envelope。

浏览器 history layer 给已校验的 REST envelope 增加 `history-load` transport hint，再与 message-derived envelopes 进入同一 turn/process projection。完整数据流、失败隔离与 fork snapshot 规则由 `conversation-process-history.md` 主承载。

普通 Tool 的 in-flight result delta 继续复用 canonical `CAPABILITY_RESULT_DELTA`。当 Tool 在一次调用内发出多个结果 delta 时，每个 delta 都必须表达该 Tool 当前累计可见状态，而不是仅表达最新 chunk；projection 只做 safe allowlist 和 transport delivery，不创造平行 capability progress event。

受治理 Tool 的结构化展示事件使用 canonical `TOOL_STRUCTURED_DELTA`。事件仅在受信 producer/adapter 明确提供、`structuredPayload` 匹配受控 `{ eventType, messageType, content }` shape 且内容通过安全校验时产生；平台不得从任意 stdout、JSON 或自由文本猜测结构化语义。它不替代 `CAPABILITY_RESULT_DELTA` 或 canonical `CAPABILITY_RESULT` Message：Message 继续拥有模型协议与后续 Context 使用的语义结果，`TOOL_STRUCTURED_DELTA` 只服务 stream/frontend presentation。projection 只透传 `toolEventType`、`toolMessageType`、`content`、`capabilityId`、`toolCallId` 和可信 `truncated` 等 allowlisted 字段，不投影 credential、token、raw provider error、host path、prompt 或 provider-private payload。

非 agentic ApiCall 流式执行时，编排层逐 chunk 判断结构化格式：匹配的发 `TOOL_STRUCTURED_DELTA`（`inlinePayload.streaming = true` 标记），不匹配的发 per-chunk `CAPABILITY_RESULT_DELTA`（`LIVE_ONLY`）。流式结束后，若全部 chunk 均被识别为结构化 delta，编排层 MUST 跳过终态 `LLM_CONTENT_DELTA { final: true }`；若存在非结构化残留，只对该残留聚合发 `LLM_CONTENT_DELTA`。终态 `CAPABILITY_RESULT_DELTA`（携带聚合数据）MUST 被跳过，避免与 per-chunk delta 重复；`CAPABILITY_COMPLETED` 和 `appendCapabilityResultMessage` 不受影响。`terminalContent` 保留原值用于 `assertTerminalContentReady` 和 terminal commit，抑制只影响 emit。该终态抑制适用于编排层两条 non-agentic 路径；model-driven tool-loop 路径不从 ApiCall 结果发 `LLM_CONTENT_DELTA`，只需解包 `structuredPayload`。

runtime 对非 Workflow `TOOL_STRUCTURED_DELTA` 采用同一聚合持久化策略，不再由 `streaming` 区分 durable owner。共享 accumulator 以 `(runId, toolCallId)` 隔离并限制每 run group 数、每 group event 数和原始 UTF-8 bytes；PIU 按顺序聚合 `data`，STREAM_DSL 聚合文本，其余受控 shape 保持同形。普通完成结果先成功写入 canonical `CAPABILITY_RESULT` Message，再由 runtime 私有 flush 写入有界的过渡 presentation snapshot；Core 不持有公开 flush 命令。direct flush 与 `finishRun` fallback 在 gateway 前执行相同的 49,000-byte JSON UTF-8 normalization，发生内容裁剪时保留结构并投影 `truncated=true`。真实 timeline append failure 继续传播，不能吞掉或伪造成成功。

Workflow `NODE_COMPLETED` product 是独立、封闭的 Event-owned process product：runtime 在发布与持久化前对同一 settled payload 执行有界 normalization，使该产品的 live/history 形状一致。它不把 Workflow product 变成 ordinary Capability semantic result，也不改变 Workflow outer Tool 的 Message-first 边界。结构化 Event 的正文或 `truncated` 标记都不得进入 Context、改变 request terminal status，或推导 degradation/completion limitation。

`emitResultDelta` 回调在编排层（`default-agent.ts`）和 tool-loop（`tool-loop.ts`）中 MUST 使用一致的 `structuredPayload` 解包：`sdiCandidate = structuredPayload?.['structuredPayload'] ?? structuredPayload`，消除 executor 桥接层多包一层导致的结构化识别失败。per-chunk `CAPABILITY_RESULT_DELTA` 的 `result` 字段统一为解包后的 `sdiCandidate`，两侧 shape 一致。

## AskUserQuestion 回答投影

canonical `AskUserQuestion` 的 `QUESTION` 回答只有在 runtime 已把原始 tool call 的可见 `CAPABILITY_RESULT` message 持久化后，才能通过现有 `CAPABILITY_RESULT_DELTA` 发布实时结果。该 event 继续是 `LIVE_ONLY`，不写 timeline、不推进持久化 session sequence，也不能作为 `lastSeenSequence` 的 replay anchor；没有 subscriber 或客户端漏收时，conversation/history 必须从 durable message 恢复同一回答。

stream 与 conversation 必须复用 `agent-channel-common` 的 `projectAskUserQuestionAnswerResult(...)`。只有 capability identity、`toolCallId`、`pendingInputId`、`kind="QUESTION"`、`status="RECEIVED"` 和 ordered non-empty `answers` 全部有效时，projector 才输出回答投影：stream 把它合并到 `CAPABILITY_RESULT_DELTA` payload，conversation item 把同一对象放入可选 `pendingInputAnswer` 字段。投影顶层保留受控关联字段，`safeResult` 只包含 `kind="pendingInputAnswer"`、有序 `answers` 和 `truncated`。安全预算固定为最多 20 个 answer group、每组 9 个字符串、每个字符串 4096 个 Unicode code point、全部字符串合计 24576 个 code point；任一边界被裁剪都必须标记 `truncated=true`。校验失败时 fail closed，不猜测坐标，也不把回答复制到 `text`、`content`、`safeSummary` 或 `metadata`。

`USER_INPUT_RECEIVED` 始终只表达 pending input 已接收状态，不能携带 answer body 或 `safeResult`。回答正文的 Web 可见来源只有上述 allowlisted live projection 和 durable conversation projection；浏览器 request body 与本地 composer state 都不是恢复事实。

## Capability Result 安全呈现投影

`CAPABILITY_STARTED` 与 `CAPABILITY_COMPLETED` 对受治理 Capability 只公开生成过程标题所需的最小执行身份：合法 `capabilityKind`、`capabilityId`、`toolCallId`，以及 `Agent`、`Skill`、`Workflow` 通用入口可确定时的 `targetCapabilityId`。started/completed 对同一次调用逐值复用该身份；`CAPABILITY_RESULT_DELTA` 不重复这些新增字段，继续按 `toolCallId` 关联。共享 projector 只允许闭集 kind 和有界、无控制字符的 target id，非法单字段局部省略；SSE、WebSocket、live history 与刷新后 history 必须得到同一身份投影。

`CAPABILITY_STARTED` 在 `Skill`、`Agent` 或普通 Tool 生命周期下的 `ApiCall` 与同一 owner、Agent、session、request、run、tool call、Capability 的模型工具调用唯一关联时，可额外投影 optional `capabilityTargetName`。`readReferencedToolCall` 必须在已解析 Message 内只有恰好一个匹配 `toolCallId` 且 `toolName` 匹配且 `arguments` 为对象的工具调用时才返回；零个或多个匹配走既有 `contentUnavailable` 路径。投影 helper 只允许三个 wrapper/字段映射：`Skill` → `name`、`Agent` → `agentId`、`ApiCall` → `apiName`，trim 后匹配 `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`，否则省略字段。helper 不得读取其他 `arguments` 字段，也不得从 Capability Result Message、结果正文或 metadata 恢复名称。`capabilityTargetName` 只加到通过关联门禁的 `CAPABILITY_STARTED` payload，`CAPABILITY_COMPLETED` 和结果事件不增加新查询或重复字段。`capabilityTargetName` 与 `STATUS_ONLY`、`SUMMARY`、`DETAIL` 结果级别独立，不提高平台安全上限、不创建 `safeSummary`/`safeResult`、不开放结果正文。

Workflow 外层 wrapper 使用 `TOOL + Workflow + targetCapabilityId` 标识 Recipe；内部 Tool、Skill、Agent、Subflow 节点公开其直接 capability kind/id，不再携带 wrapper target，并继续通过 `parentToolCallId` 关联。投影层不得从参数、结果、描述或相邻事件恢复身份，也不得增删过程条目。

普通 Agent Web 的 Capability 结果只由 `agent-channel-common` 共享 projector 生成。canonical `CAPABILITY_RESULT` Message 保存模型协议和后续上下文所需的结果事实，timeline Event 保存时序、状态、`messageId`、`toolCallId`、`capabilityId` 与必要的闭集 projector classifier；Event 不复制结果正文、摘要或详情。SSE、WebSocket 和 run-event history 取得同一 event/message association 后，使用同一启动期 `CapabilityResultPresentationPolicy` 生成同一 `StreamEnvelope` 安全投影。

投影顺序固定为：校验 scope、Capability 身份和 Message/Event 坐标；按身份优先的受支持 schema 生成字段白名单并确定平台安全上限；按大小写敏感的精确 `capabilityId` 读取集成级别；取集成级别与安全上限中更保守的一档；最后删除高于有效级别的字段。有效级别只有 `STATUS_ONLY`、`SUMMARY`、`DETAIL`：`STATUS_ONLY` 只含身份、关联、级别和状态；`SUMMARY` 只增加平台生成的闭合 `safeSummaryCode`、白名单化 `safeSummaryArgs` 与不扩大披露范围的兼容 `safeSummary`；`DETAIL` 才允许有界、脱敏、schema 校验后的 `safeResult` 和详情文本。内部 Skill 正文、未知身份/形状、schema 或关联失败、无平台安全 projector 的扩展 Tool 最高为 `STATUS_ONLY`。

Grep 的 canonical producer 必须提供实际 `output_mode`，共享 projector 不从结果数组推断模式。文件模式摘要只使用 `total_files_with_matches`；内容模式摘要使用 `total_matches` 与 `total_files_with_matches`。`DETAIL` 的 `grepResult` 最多包含 50 个 execution-view-relative 文件路径，内容模式条目只额外保留 1-based 行号；matched line、pattern、glob filter、物理路径和调用参数不得进入 Web envelope。缺失模式、模式与专属字段矛盾、非法总数或不安全详情条目使平台上限降为 `STATUS_ONLY`。live stream 与 run-event history 通过同一 projector 得到相同摘要、详情和降级结果。

AskUserQuestion accepted answer 先进入专用 bounded projector，不因普通结果的三档策略而消失。可信 CLIP descriptor 可让 persisted completion 保存 `resultProjectionKind=CLIP_STREAM_V1`；该 classifier 由 `agent-common` 单一 owning，只选择共享 projector，不进入 Web allowlist，也不携带结果副本。未知 classifier 必须被拒绝；没有可信 classifier 的自定义结果不能凭形状获得 CLIP 详情。

失败投影与成功结果级别分离。共享 projector 按“已审计且与 category 相容的具体 `safeErrorCode` → 完整 `safeErrorCategory` → 通用失败”生成唯一失败 `safeSummaryCode`，失败 args 固定为空。Capability 卡片以自身 `CAPABILITY_RESULT_DELTA` 或 `CAPABILITY_COMPLETED` 的完整失败事实为准；随后 code-only `DEGRADATION_NOTICE` 不覆盖、改写或重复该原因。三种成功结果级别均保留同一失败状态和事实性原因，且 `DETAIL` 不扩大失败技术详情。

`CAPABILITY_STARTED` 没有受治理的自由文本字段。projector 不得把 Event type、descriptor 或内部状态枚举回退为用户正文；模型调用工具前的公开说明继续由独立 `LLM_CONTENT_DELTA` / message-referenced process content 承载。conversation API 即使显式请求普通 Capability Result Message，也不得把其原始 `content` 或未白名单 metadata 交给浏览器；普通过程详情只来自 run-event history 安全投影。

## 安全错误

stream error 只使用 safe error shape。不得投影 prompt、模型输出全文、raw provider error、token、credential、文件路径或 capability raw payload。

## 终态

terminal projection 只能来自 runtime terminal commit 或 recovery failed terminal fact。channel 不得因为 transport close、client disconnect 或 projection retry 自行产生 terminal。

Transport frame 不是 stream fact。SSE connection-open comment、heartbeat、WebSocket ack/close 等只表达连接状态或 delivery housekeeping，不得作为 `StreamEnvelope`、terminal event、timeline event 或 conversation history 来源。

## 验证关注点

- ordering、replay anchor、delta/replace、terminal projection 有 stream tests。
- SSE 和 WebSocket envelope schema 等价。
- SSE、WebSocket、resume 和 REST history 对同一完成事件的 envelope 等价。
- 完成 thinking settle 既有连续条目，不产生重复 thinking 卡片。
- safe error projection 不泄漏敏感字段。
- transport close 不产生 fake terminal。
- ordinary Tool streamed delta 不产生额外 terminal capability result message。
- AskUserQuestion 的 stream/conversation projector 输出一致，`USER_INPUT_RECEIVED` 保持 answer-free，live delivery 缺失可由 durable conversation 恢复且不伪造 cursor。
- Capability 结果三档策略、平台安全上限、内置摘要 descriptor、失败 code/category 联合语义和 unknown/custom 降级有共享 projector contract tests。
- Grep 两种模式、合法零匹配、canonical totals、50 条详情上限、matched line 删除和非法旧结果 fail-closed 有 producer/projector/frontend contract tests。
- SSE、WebSocket 与 run-event history 对同一 Capability 结果返回相同有效级别、摘要、详情、截断和失败事实；浏览器不会收到 raw Message content 或 `resultProjectionKind`。
- `CAPABILITY_STARTED`、未知 descriptor 和内部状态枚举不能成为用户文案；code-only degradation 不能覆盖完整 Capability 失败。
- Capability lifecycle 身份 allowlist、started/completed 一致性、wrapper/内部节点边界和非法单字段局部省略有共享 projection contract tests。
