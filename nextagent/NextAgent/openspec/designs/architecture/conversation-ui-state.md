# 对话界面 UI 状态契约

## 目的

本文档是 UCD 设计人员、前端工程师理解 NextAgent 对话界面可观察 UI 状态的单一入口。它整合分散在多个 stable spec 与源代码中的 stream event、capability result、pending input、reconnect/replay、safeError、Live vs History 事实，**只引用、导航或摘要**现有 specs，不重复定义状态机、API schema、数据 owner 或接口语义。

读者回答以下问题时应从本文档入口：

- 某个 stream event 在 UI 上怎么呈现？哪些字段可渲染？历史对话能不能看到？（→ 第 1 节）
- 某个 capability 结果在 UI 上采用哪一级安全呈现？平台上限与集成策略如何共同生效？（→ 第 2 节）
- 某种 pending input 在 UI 上怎么呈现？answer shape 是什么？terminal 怎么投影？（→ 第 3 节）
- 断线重连时 UI 状态怎么流转？cursor 语义对应什么视觉？（→ 第 4 节）
- 某个 safeError code/category 在 UI 上呈现什么失败卡片？能不能重试？（→ 第 5 节）
- 同一对话在 live 模式与 history 浏览模式有哪些呈现差异？（→ 第 6 节）

## 主承载关系

| 事实类型 | 主承载 spec / design | 本文档角色 |
|---|---|---|
| 23 种 channel `StreamEventType` vocabulary | `ts-run-status-visibility` 与相关 stable specs；其中 22 种来自 canonical timeline projector，`OUTPUT_GUARD_BLOCKED` 是受控 delivery relay | 导航 + UI 渲染映射 |
| Stream projection artifact 与 safe field 约束 | `ts-run-status-visibility` 的 `Stream projection artifact contract 约束`、`Capability result stream payload MUST expose only safe result projections` | 导航 + UI 渲染映射 |
| Stream resume / replay / cursor 语义 | `ts-stream-resume-replay` | 导航 + UI 状态阶梯 |
| History uses visible messages 规则 | `ts-stream-history-consistency` | 导航 + Live/History 分叉 |
| SSE/WS transport 等价 | `ts-web-sse-ws-transports` | 引用 |
| Pending input runtime 语义 | `question-pending-input`、`authorization-pending-input`、`confirmation-pending-input`、`human-pending-input-core`、`human-pending-input-timeout`、`human-handoff`、`workflow-interaction-nodes` | 导航 + UI 渲染矩阵 |
| 跨会话 Activity 状态、连接、列表呈现与终态消费 | `cross-session-activity-awareness` | 导航 + UI 呈现/消费条件摘要 |
| Attachment intake / lifecycle | `ts-attachment-intake`、`ts-attachment-cleanup`、`request-attachments` | 引用 |
| Context engine compaction | `context-engine` | 引用 |
| Capability Result safe projection 实现 | `packages/agent-channel-common/src/projections/capability-result-presentation.ts`、`stream-envelope.ts` | 事实校对来源；平台安全上限、三档策略与 live/history 共用 projector |
| History envelope 重建 | `agent-channel-web` run-event history + `frontend/agent-web` process history scheduler | 事实校对来源；普通 conversation 不提供工具结果详情输入 |

本文档的每一节明确标注事实主承载来源；当 spec 与代码不一致时，以 spec 为准，并在“已知实现与规格差异”章节记录。

---

## 第 1 节：StreamEventType → UI 状态映射

Channel contract 当前包含 23 种 `StreamEventType`。其中 22 种由 `streamVisibleTimelineEvents` 从 canonical timeline 投影；`OUTPUT_GUARD_BLOCKED` 是 output guard 在 delivery boundary 注入的受控 terminal relay，不是 timeline event。下表列出 UI 渲染责任、safe field 约束与 live/history 来源。

> 前端还保留 `HOOK_DEGRADED` compatibility event；它不是 channel contract 或 canonical timeline vocabulary，只能由前端兼容路径消费。

> 事实来源：`packages/agent-channel-common/src/projections/stream-envelope.ts` 的共享 projector；`packages/agent-contracts/src/channel/index.ts` 的 `StreamEventType` union；`ts-run-status-visibility` 的 canonical vocabulary、Capability Result 平台安全上限与可信后端投影 Requirements；`conversation-process-history.md` 的 history 规则。

| # | StreamEventType | UI 渲染责任 | safe field 约束（payload） | Live | History |
|---|---|---|---|---|---|
| 1 | `REQUEST_ACCEPTED` | 用户消息气泡 + "已受理"指示 | `attempt`、`agentId`、`agentVersion`、`status` | ✅ | ✅ 由 USER 消息重建 |
| 2 | `LLM_THINKING_DELTA` | 思考过程条目（可折叠） | `reasoning`、`content`、`text`、`contentType=PLAIN_TEXT`、`metadata.accumulated`、完成态 `metadata.completed` | ✅ | ✅ 由 run event history 的 completed 累计 delta 重建；不是 message |
| 3 | `LLM_CONTENT_DELTA` | 助手消息气泡（流式追加） | `content`、`text`、`contentType`、`role` | ✅ | ✅ 由 ASSISTANT 消息重建 |
| 4 | `CAPABILITY_STARTED` | 能力卡片（running 态） | `capabilityId`、`toolCallId`、`status`、`safeErrorCode`、`safeErrorCategory` | ✅ | ✅ 当 durable event 存在时由 run event history 重建 |
| 5 | `CAPABILITY_RESULT_DELTA` | 能力卡片（结果增量） | `capabilityId`、`toolCallId`、`status`、`resultPresentationLevel`、可选 `safeSummaryCode`/`safeSummaryArgs`/兼容 `safeSummary`、DETAIL 才允许的 `safeResult`/详情、safe failure 字段 | ✅ | ❌ live-only；完成态由 persisted completion + Message association 经同一 projector 恢复 |
| 6 | `CAPABILITY_COMPLETED` | 能力卡片（终态） | 同一共享 projector 允许的有效级别、摘要、详情、截断与失败字段 | ✅ | ✅ 由 run event history 与关联 result Message 在后端 join 后安全投影 |
| 7 | `TOOL_STRUCTURED_DELTA` | 结构化工具条目（TITLE/DETAIL/ANSWER/SUB_TITLE/SUB_DETAIL/SUB_CONCLUSION） | `capabilityId`、`toolCallId`、`toolEventType`、`toolMessageType`、`content`、`contentType`、`metadata` | ✅ | ✅ 由 run event history 与关联 Message 在后端恢复安全结构化投影 |
| 8 | `DEGRADATION_NOTICE` | 固定业务语义的警告级系统过程提示；显式安全 `code` 默认收起 | 普通界面只使用 event type 选择标题、摘要和严重程度；仅顶层非空 `code` 可作为技术详情 | ✅ | ✅ 由持久化消息重建 |
| 9 | `REQUEST_COMPLETED` | 助手消息终态 + "已完成"指示 | `status=COMPLETED`、`content`、`text`、`code`、`message`、`category`、`retryable` | ✅ | ✅ 由 terminal ASSISTANT 消息重建 |
| 10 | `REQUEST_FAILED` | 失败终态卡片 | `status=FAILED` + 同上 | ✅ | ✅ 由 terminal ASSISTANT 消息重建 |
| 11 | `REQUEST_CANCELED` | 取消终态卡片 | `status=CANCELED` + 同上 | ✅ | ✅ 由 terminal ASSISTANT 消息重建 |
| 12 | `REQUEST_SUPERSEDED` | 被取代终态卡片 | `status=SUPERSEDED` + 同上 | ✅ | ✅ 由 terminal ASSISTANT 消息重建 |
| 13 | `USER_INPUT_REQUIRED` | Pending input 卡片 | `pendingInputId`、`id`、`kind`、`timeoutAt`、`status`、`questions[]` | ✅ | ✅ 由 stored event type 重建 |
| 14 | `USER_INPUT_RECEIVED` | Pending input 卡片（已应答） | `pendingInputId`、`id`、`kind`、`status`、`safeSummary` | ✅ | ✅ 由 stored event type 重建 |
| 15 | `USER_INPUT_TIMEOUT` | Pending input 卡片（超时） | 同 `USER_INPUT_RECEIVED` | ✅ | ✅ 由 stored event type 重建 |
| 16 | `USER_INPUT_CANCELED` | Pending input 卡片（已取消） | 同 `USER_INPUT_RECEIVED` | ✅ | ✅ 由 stored event type 重建 |
| 17 | `ATTACHMENT_ACCEPTED` | 附件 accepted 指示 | `attachmentId`、`status`、`mediaType`、`reasonCode`、`safeSummary` | ✅ | ❌ 不重建 |
| 18 | `ATTACHMENT_REJECTED` | 附件 rejected 指示 | `attachmentId`、`status`、`mediaType`、`reasonCode`、`safeSummary` | ✅ | ❌ 不重建 |
| 19 | `CONTEXT_COMPACTED` | 固定业务语义的信息级上下文整理提示 | 普通界面只使用 event type 选择标题、摘要和严重程度，不显示被整理内容或 payload 文本 | ✅ | ✅ 由持久化消息重建（`SUMMARY` 消息被过滤） |
| 20 | `BACKGROUND_TASK_STARTED` | 后台任务运行状态 | bounded task identity、status、safe summary | ✅ | ✅ 当对应 durable event 在可见 run history 中存在 |
| 21 | `BACKGROUND_TASK_COMPLETED` | 后台任务完成状态 | bounded task identity、status、safe summary | ✅ | ✅ 当对应 durable event 在可见 run history 中存在 |
| 22 | `BACKGROUND_TASK_FAILED` | 后台任务失败状态 | bounded task identity、status、safe error | ✅ | ✅ 当对应 durable event 在可见 run history 中存在 |
| 23 | `OUTPUT_GUARD_BLOCKED` | 输出被安全阻断的 terminal 状态 | bounded guard code/status；无 raw model output | ✅ delivery relay | ✅ 由 terminal message metadata 重建，不来自 timeline history |

> ⚠️ 前端 `processDetails.ts` 的 `buildProcessEntries` 跳过 `ATTACHMENT_ACCEPTED`/`ATTACHMENT_REJECTED`（不生成过程面板条目），仅 `buildProcessTimelineEntries` 在历史时间线中渲染。
| — | `HOOK_DEGRADED`（前端专用） | 与 `DEGRADATION_NOTICE` 同语义、同严重程度的兼容警告提示 | 普通界面忽略 Hook 名称、标识和任意 payload 文本，不显示技术详情 | ✅ | ❌ 不重建（后端不投影） |

### 系统过程事件业务呈现

`frontend/agent-web/src/features/chat/process/systemEventPresentation.ts` 是 `DEGRADATION_NOTICE`、`CONTEXT_COMPACTED` 和前端兼容 `HOOK_DEGRADED` 的唯一普通界面业务呈现入口。resolver 只依据 event type 与当前界面语言返回固定标题、基础摘要和 `warning | info` 严重程度，不读取 store、不修改 event，也不允许 AICOConfig 或宿主覆盖语义。

- `DEGRADATION_NOTICE` 与 `HOOK_DEGRADED` 使用“本次任务有部分内容未完成”的警告语义；`CONTEXT_COMPACTED` 使用“已整理较早的对话”的信息语义。三类提示都不推断请求终态、自动恢复、后续行动或最终答复内容。
- `message`、`content`、`summary`、`detail`、`reason`、`uiMessage` 和 `safeSummary` 等 payload 文本不得成为标题、基础摘要或默认详情。只有 `DEGRADATION_NOTICE` 顶层显式非空 `code` 可作为默认收起的纯文本技术详情；未知 code 不改变业务语义。
- `processDetails.ts` 的折叠过程与时间线、`buildRunGraphViewState.ts` 的完整运行图以及 `TurnBlock.tsx` 的上下文整理短暂提示复用同一 resolver。warning 使用既有橙黄色警告语义，info 使用既有中性信息语义，不新增请求状态或颜色体系。
- durable `DEGRADATION_NOTICE` 与 `CONTEXT_COMPACTED` 在 live 和 history 中使用同一标题、摘要与严重程度。transport failure notice、上下文整理短暂动画和 `HOOK_DEGRADED` 保持 live-only；浏览器不得为了界面一致伪造 durable fact 或历史条目。
- 请求终态失败继续由 terminal/failure presenter 根据可信 terminal fact 与安全错误事实呈现；系统过程提示不得覆盖、复制或替代终态失败总结。完整运行图的 raw diagnostics 仍属于既有受控诊断面。

### 通用 safe field 约束

所有 envelope 共享以下字段：`eventId`、`sessionId`、`requestId`、`sequence`、`eventType`、`payload`、`createdAt`、可选 `runId`、可选 `requestContextId`、可选 `timelineEventRef`。Live projector 默认输出空 `transportHints`；browser 对已校验 REST history envelope 增加 `history-load` hint。Message-derived history envelope 没有 canonical timeline ref；event-history envelope 保留 shared projector 提供的 canonical correlation。

### `safeProgress` 字段（`CAPABILITY_RESULT_DELTA` 可选）

`safeProgress`（可选）：`{ current: number, total: number, label?: string }`。仅当工作流节点能提供结构化进度时填充（如批量处理的当前项/总项数、长轮询的当前轮次/总轮次）。不提供时省略——前端回退到纯计时器 + 文本状态。

- 进度通过 `CAPABILITY_RESULT_DELTA` 承载，不新增 `CAPABILITY_PROGRESS` 事件类型（`tool-loop` spec 明确要求 "MUST NOT introduce a parallel capability progress event name"）。
- 每个 delta 携带**当前完整进度状态**（累积的），非增量——如 `{ current: 23, total: 50 }`，而非 `{ current: 1 }`。
- 有 `safeProgress` 时 UI MAY 显示 current/total 或百分比；无 `safeProgress` 时 MUST NOT 显示百分比（无数据来源）。
- 工作流节点应通过 `emitOutputDelta` 发射进度文本（`text`/`content` 字段），并在 payload 中投影 `safeProgress` 结构化字段。

### 禁止渲染的字段

无论 live 还是 history，UI MUST NOT 渲染：raw prompt、raw model output 全文、tool args、raw tool result、attachment content bytes、local file path、credential、raw validation error、policy internals、internal context-engine state、runtime correlation ids（除 `runId`/`requestContextId` 这类 business coordinates）。来源：`ts-run-status-visibility` 的 `Projection decision order 约束`、redaction 场景与 `Capability result stream payload MUST expose only safe result projections`。

### 预览容量限制

`text`/`content` 字段单次最大 4000 字符（`resultTextPreviewMaxChars`）；`fileList` safeResult 最大 50 项（`resultListPreviewMaxItems`）。超长截断并以 `...` 标记，`truncated=true`。来源：`stream-envelope.ts` 的 `previewText`、`projectFileListSafeResult`。

### RAG 检索结果展示摘要

`agent-channel-common` 共享 projector 为 `capabilityId="Rag"` 的成功 `CAPABILITY_RESULT` 生成唯一 RAG 分支：从结果数组读取长度、字符串 `source` 和字符串 `content`，生成 `kind="ragRetrieval"`、`totalCount` 与有序 `items`。每个条目包含 `displaySource`、`sourceMissing`、`contentPreview` 和 `contentTruncated`。预览上限按原始 `content` 中汉字与拉丁字母数量确定：汉字数量大于拉丁字母数量时最多 40 个 Unicode code point，其他内容最多 100 个 Unicode code point；超出时 `contentTruncated=true`。缺少可显示字符串 `source` 的结果计入 `totalCount` 并标记 `sourceMissing=true`，`displaySource` 为空字符串；缺少字符串 `content` 的结果 `contentPreview` 为空且 `contentTruncated=false`。摘要 MUST NOT 包含完整 `content`、`provenance`、`score`、`rankHint`、诊断对象或其他原始结果字段。

实时 stream 投影与历史重建 MUST 为同一 RAG 结果生成同形摘要。过程面板显示召回总数、每个 `displaySource` 及其 `contentPreview`；`sourceMissing=true` 的条目显示本地化的来源缺失标签；`contentTruncated=true` 时在预览末尾追加 `...`。每个 `displaySource` 渲染为与内容预览视觉分离的紧凑来源标签；`contentPreview` 中连续空白字符（包括换行和空行）替换为单个空格并去除首尾空白后再展示。前端 `processDetails.ts` 只消费该形状，不读取原始结果正文或其他字段。

---

## 第 2 节：Capability Result 三级呈现矩阵

普通 Agent Web 不按 `safeResult.kind` 自行决定是否展示原始结果。可信后端先计算平台安全上限，再应用启动期冻结的集成级别，并在传输前删除更高等级字段。`resultPresentationLevel` 是浏览器的显式解释依据；空摘要不能被猜成结果不可用或另一种策略。

> 事实来源：`ts-run-status-visibility` 的 `Capability 结果呈现策略受平台安全上限约束`、`Capability 结果的用户可见投影由可信后端统一产生`；`agent-channel-common` 共享 projector。

| 有效级别 | 用户看到 | Web payload 上限 | 浏览器行为 |
|---|---|---|---|
| `STATUS_ONLY` | Capability 公开身份、执行状态和生命周期 | 身份、关联、状态、`resultPresentationLevel`；成功结果无摘要、`safeResult` 或详情正文 | 不补写“暂无摘要”，不显示空详情入口；running 仍保留活动态 |
| `SUMMARY` | 状态 + 当前语言的安全摘要 | 增加闭合 `safeSummaryCode`、按 code 白名单化的有界 `safeSummaryArgs`，可带兼容 `safeSummary`；无 `safeResult`/详情 | 使用现有 zh-CN/en-US 资源解释 descriptor；未知成功 descriptor 省略摘要 |
| `DETAIL` | 状态 + 摘要 + 可展开安全详情 | 增加通过类别 schema、字段 allowlist、脱敏和容量限制的 `safeResult`/详情文本 | 只渲染后端安全投影，不从 Message、Tool 参数或本地状态补内容 |

平台安全上限优先：通过受支持 schema 的已知类别最高可到 `DETAIL`；内部 Skill 正文、未知身份/形状、关联或 schema 失败、没有安全 projector 的扩展 Tool 最高为 `STATUS_ONLY`。`Skill`、`Agent`、`ApiCall`、`search_memory`、`get_memory_detail`、`add_memory`、`acquire_skill` 的内置配置为 `STATUS_ONLY`；`AskUserQuestion`、`TodoWrite`、`Cron` 为 `DETAIL`；`Rag`、`Read`、`Write`、`Edit`、`Glob`、`Grep`、`Bash`、`Python`、`ToolSearch`、`Workflow` 为 `SUMMARY`。`search_memory`、`get_memory_detail`、`add_memory`、`acquire_skill` 当前没有平台安全成功 projector，集成方精确覆盖请求 `SUMMARY` 或 `DETAIL` 时有效投影仍为 `STATUS_ONLY`，不返回记忆正文、记忆标识、检索分数、SkillHub provider 信息或任意原始结果字段。Skill、ToolSearch 或直接调用等来源不改变最终 Tool `capabilityId` 的安全上限和策略。

AskUserQuestion accepted answer 是用户已提交的公开对话事实，先经过专用 bounded projector，并在三种普通结果配置下保持同一答案；`USER_INPUT_RECEIVED` 仍不携带正文。可信 CLIP 结果可由 completion 上的 `CLIP_STREAM_V1` classifier 选择共享 projector，但 classifier 不进入 Web payload；无可信 classifier 的自定义结果不能仅凭 shape 获得详情。

### 历史能力结果的安全恢复

普通 conversation 请求不再把 Capability Result Message 作为过程详情输入。run-event history 在后端批量解析当前页关联 Message，并用与 live 相同的策略快照和共享 projector 返回安全 `StreamEnvelope`。关联缺失、scope/tool 坐标冲突或内容解析失败时降级为不高于 `STATUS_ONLY`，不得搜索其他 Message 或回退 legacy event body。浏览器展开详情或快速滚动不按结果追加请求；已加载页面直接复用其中的安全投影。

---

## 第 3 节：4 种 durable pending input kind → UI 渲染矩阵

Pending input runtime 语义由 7 个 stable spec 分别主承载。本节整合 UI 渲染视图，**不重复定义** pending input 创建、回答、超时、取消的生产路径。

> 事实来源：`stream-envelope.ts` 的 `projectStreamPayload` 对 `USER_INPUT_*` 的处理；`ts-run-status-visibility` 的 `Pending input status visibility 约束`；`question-pending-input`、`authorization-pending-input`、`confirmation-pending-input`、`human-pending-input-core`、`human-pending-input-timeout`、`human-handoff`、`workflow-interaction-nodes` 各 spec。

| # | pending input kind | UI 渲染 | safe field（`USER_INPUT_REQUIRED` payload） | answer shape | terminal projection | runtime spec 主承载 |
|---|---|---|---|---|---|---|
| 1 | `question`（AskUserQuestion） | 问题卡片（含 `questions[]` prompt/options/multiple/custom） | `pendingInputId`、`id`、`kind=question`、`timeoutAt`、`status`、`questions[]` | 每个 question 的 `prompt` + 选中的 `options[].value` 或 custom 文本 | `USER_INPUT_RECEIVED`/`TIMEOUT`/`CANCELED` | `question-pending-input`、`ask-user-question-tool` |
| 2 | `authorization` | 授权卡片（单操作 approve/deny） | 同上（`kind=authorization`） | approve / deny | 同上 | `authorization-pending-input` |
| 3 | `confirmation` | 确认卡片（approve/reject） | 同上（`kind=confirmation`） | approve / reject | 同上 | `confirmation-pending-input` |
| 4 | `human-handoff` | 人工接管卡片 | 同上（`kind=human-handoff`） | operator 接管事实 | 同上 | `human-pending-input-core`、`human-pending-input-timeout`、`human-handoff` |
### 通用 safe field 约束

`USER_INPUT_REQUIRED` payload MUST 只暴露 `pendingInputId`、`id`、`kind`、`timeoutAt`、`status`、`questions[]`；MUST NOT 暴露 identity、idempotency key、timeout behavior、raw prompt、raw answer、model-formatted answer。`USER_INPUT_RECEIVED`/`TIMEOUT`/`CANCELED` payload MUST 只包含 pending input id、kind、status、safeSummary；raw answer content MUST NOT 通过 status visibility 输出。来源：`ts-run-status-visibility` 的 `Pending input status visibility 约束`。

### deferred gap：pending input 前端状态机

4 种 durable kind 的统一前端状态流转（`USER_INPUT_REQUIRED` → answer → `RECEIVED`/`TIMEOUT`/`CANCELED`）、answer idempotency 的前端表现、late answer 的 UI 处理目前散在各 pending input spec，仍待独立规格收敛。Workflow interaction node 复用这些 runtime-owned kind，不新增 `workflow-interrupt` durable vocabulary。

---

## 第 4 节：Reconnect/replay UI 状态阶梯

Stream resume / replay / cursor 语义由 `ts-stream-resume-replay` 主承载，transport 等价由 `ts-web-sse-ws-transports` 主承载。本节描述 UI 视觉契约与 cursor 语义的对应关系，**不重复定义** resume 协议。

> ⚠️ 以下状态图是**概念模型**，描述 resume/replay 协议的 UI 视觉契约。前端 `StreamConnectionPhase`（`conversationStore.ts` L69）实现为 5 种 phase：`idle`/`connected`/`reconnecting`/`resyncing`/`disconnected`。概念模型中的 `degraded` 和 `replayed` 在前端实现中分别由 `reconnecting`（含"连接不稳定"语义）和 `resyncing`（含 gap replay 语义）覆盖。

> 事实来源：`ts-stream-resume-replay` 的 lastSeenSequence、activeRun bootstrap、accepted-run bounded recovery、in-memory cursor 语义；`ts-web-sse-ws-transports` 的 SSE/WS 等价、optional cursor 解析、bootstrap transport selection；`ts-stream-history-consistency` 的 opening reconcile 与 stream replay/live details 分离。

```
┌─────────────┐
│ connected   │  live-tail：新事件按 sequence 到达，UI 实时追加
│             │  cursor: lastSeenSequence 持续推进
└──────┬──────┘
       │ gap detected（client 发现 sequence 跳跃或 transport heartbeat 超时）
       ▼
┌─────────────┐
│ degraded    │  UI 显示"连接不稳定"指示；已收到的最新内容保持可见
│             │  cursor: lastSeenSequence 保留；不伪造缺失内容
└──────┬──────┘
       │ transport close（SSE onerror / WS close）
       ▼
┌─────────────┐
│ disconnected│  UI 显示"已断开"指示；保留已有对话状态
│             │  cursor: lastSeenSequence 持久化（前端 in-memory）
└──────┬──────┘
       │ 自动重连 / 用户手动重连
       ▼
┌─────────────┐
│ reconnecting│  UI 显示"正在重连"指示；带 lastSeenSequence 重新订阅
│             │  cursor: 上送 lastSeenSequence 给 backend
└──────┬──────┘
       │ backend 校验 cursor，返回 gap events 或 live-tail
       ▼
┌─────────────┐
│ replayed    │  gap events 按序回放，UI 按序插入；不重复渲染已收事件
│             │  cursor: 推进到 gap 末端
└──────┬──────┘
       │ gap 填充完成，backend 继续 live-tail
       ▼
┌─────────────┐
│ connected   │  回到 connected 状态
└─────────────┘
```

### cursor 语义对应

- **无 cursor（首次订阅）**：backend 执行 no-cursor live-tail，从当前最新事件开始推送；不回放历史。来源：`ts-stream-resume-replay`。
- **activeRun bootstrap**：若 frontend 持有 `activeRunId`，可在重连时附上以 bootstrap 当前 run 的已发生事件；backend 执行 accepted-run bounded recovery，回放该 run 内 cursor 之后的事件。来源：`ts-stream-resume-replay`。
- **cursor 不可伪造**：frontend MUST NOT 把 omitted cursor 合成为 `0`；backend MUST NOT 维护 transport-private replay buffer。来源：`ts-run-status-visibility` 的 `Stream projection artifact contract 约束`、`ts-stream-resume-replay`。
- **terminal projection 不可伪造**：transport close、client disconnect、projection retry MUST NOT 触发 `REQUEST_COMPLETED`/`FAILED`/`CANCELED`。terminal 只能来自 runtime terminal commit。来源：`ts-run-status-visibility` 的 `Canonical stream projection vocabulary 约束` 的 terminal scenario、`stream-projection.md` 的"终态"章节。

### History 与 stream 的边界

- 打开历史对话时，frontend 通过 `conversationMessagesToHistoryEnvelopes` 重建可见消息 envelopes（见第 6 节）；这是 history 浏览，不是 stream replay。
- 若历史对话有 active run，frontend 可在 history 之上叠加 stream subscription（带或不带 cursor）；stream replay SHALL NOT 重构 final conversation history。来源：`ts-stream-history-consistency`。

---

## 第 5 节：事实性失败卡片与行动边界

Capability 步骤失败和 request terminal failure 是不同的用户决策点。前者由 `Capability 安全失败投影必须只陈述已确认事实` 主承载；后者由 `请求终态失败只在有可靠行动依据时提供指导` 主承载。界面不得从单个 Capability 的 code/category/retryable 推断整轮已经结束、系统将自动恢复或用户一定能执行某项操作。

### Capability 步骤失败语义选择

可信后端按固定优先级选择唯一语言中立失败 descriptor：

1. 已审计且与当前 category 相容的具体 `safeErrorCode`；
2. 完整 `safeErrorCategory`；
3. 通用失败。

一码多类或 code/category 冲突时服从 category。`CAPABILITY_PATH_REJECTED` 只有与 `AUTHORIZATION` / `POLICY_DENIED` 组合时才表示路径被策略阻止；与 `CONFLICT` 组合时显示状态冲突，category 缺失时使用通用事实。code-only `DEGRADATION_NOTICE` 不覆盖、降级、改写或重复同一步骤已经存在的完整失败事实。

| 已确认语义 | 默认状态标签 | 默认事实原因 |
|---|---|---|
| 输入无效或校验失败 | 未能执行 | 本次工具输入未满足执行要求。 |
| 修改前未完整读取 | 未能完成 | 修改文件前需要先完整读取最新内容。 |
| 目标已变化 | 未能完成 | 文件在处理期间发生变化，本次修改未应用。 |
| 对象不存在 | 未找到 | 未找到本次操作所需的对象。 |
| 命令、路径或策略拒绝 | 已阻止 | 当前安全策略不允许执行该操作。 |
| 平台不支持 | 无法执行 | 当前运行环境不支持此能力。 |
| 依赖不可用 | 暂不可用 | 执行所需能力当前不可用。 |
| 超时 | 已超时 | 未在规定时间内完成。 |
| 取消 | 已取消 | 该步骤已取消。 |
| 状态冲突 | 未能完成 | 当前状态与操作要求不一致。 |
| 结果过大 | 结果不可展示 | 返回结果超过安全展示范围。 |
| 内部异常 | 系统异常 | 系统处理该步骤时出现异常。 |
| 通用兜底 | 未能完成 | 该步骤未能完成。 |

失败步骤默认只显示 Capability 公开身份、状态标签和一条事实性原因。用户展开后只显示当前失败事实中已存在的安全错误码、错误类别和本地化调用状态；字段缺失则省略。技术详情不得包含原始异常、stack、路径、工具参数、结果正文、provider error、credential、token、runtime correlation id、`safeSummaryCode` 或内部状态枚举。`STATUS_ONLY` / `SUMMARY` / `DETAIL` 只控制成功结果，三档失败效果相同。

`CAPABILITY_STARTED` 没有受治理的业务说明字段，只显示本地化公开身份和执行中状态；Event type、任意启动自由文本、未知 descriptor 和内部枚举不得成为正文。模型调用工具前的公开执行说明继续作为独立过程 Message 呈现。

### Request terminal failure 的行动指导

request terminal 卡片只使用可信 terminal event 与稳定 safe code/category/retryable 确定阶段和事实原因。只有稳定 code 已定义行动，且当前 surface 提供该行动或明确指导目标时，才显示固定指导。例如模型认证失败可以指向检查凭据/配置或联系管理员；限流/网络失败只有在 `retryable=true` 且当前 surface 确有 request retry control 时才提示重试。内部或未知错误只显示事实原因和默认收起的技术详情，不生成通用修复建议。

---

## 第 6 节：Live vs History 状态分叉

同一 completed turn 的最终过程由 message history 与 run event history 组合形成。Message API 负责 user/final answer 和 AskUserQuestion bounded compatibility；run event API 负责 completed thinking、durable lifecycle，以及在后端与 canonical Capability Result Message 关联后生成的安全结果投影。两类查询分别失败，在浏览器 shared projection 中按 visible turn 的 display run 汇合。完整 owner、分页、fork snapshot 和失败语义由 `conversation-process-history.md` 主承载。

### Message 与 event 的重建边界

| 历史事实 | 来源 | UI 结果 |
|---|---|---|
| USER / terminal ASSISTANT / answer content | `SessionMessage` conversation page | 用户气泡、最终回答和请求终态 |
| ordinary capability result content | canonical `CAPABILITY_RESULT` message，仅由后端 association port 读取 | shared projector 生成的状态/摘要/安全详情；conversation 不返回原文 |
| completed thinking 与 durable capability/lifecycle event | run-scoped event page | 过程条目、完成状态，以及随 event 返回的 Capability 安全投影 |
| upgrade-era fork without snapshot | explicit legacy availability | 可区分的过程历史不可用状态，不伪装 empty |

Thinking 不是 message。调用中的累计 `LLM_THINKING_DELTA` 只在 live stream；模型调用最后累计 delta 以 `completed=true` 持久化，并由 REST history 通过同一 projector 返回 `metadata={ accumulated:true, completed:true }`。Final answer 仍只来自 ASSISTANT message，event history 不进入 Active Context、模型输入或 prefix cache。

Browser 先展示 message window，再由 shared `ProcessHistoryScheduler` 按用户意图和真实视口异步 hydrate display run。仅当前过程面板/preview 的 `EXPLICIT` intent、真实 `VIEWPORT` 和上下各一屏 `PRELOAD` 能选择自动加载目标；message window 本身、preview hover 和快速滚动经过的远端 turn 不触发全窗口查询。automatic target 与 explicit intent 分别最多 16 个，单 session 同时最多 4 个 active run request。

Target generation 只管理尚未启动的队列和交互副作用。已经启动的请求在 session 存续时继续到唯一 outcome；只有 session clear/dispose 可以 abort。Identity-matched 的过期 generation 结果只能进入自身 run cache，不能恢复旧 preview、旧 disclosure 或移动 viewport。`AVAILABLE`、`FAILED`、`LEGACY_UNAVAILABLE` 与 teardown cancellation 的 UI 边界由 `conversation-process-history.md` 主承载。

Process cache 以 `sessionId + runId` 原子保存 state 与 validated envelopes。当前 viewport/preload、current preview、active request 和 live run 可以 pin；单纯 expanded disclosure 在 outcome 后不永久 pin。最后一个 pin 释放时，浏览器按 whole-run LRU 收敛到最多 64 个 unpinned available runs 和 2,000 个 unpinned envelopes，state 与 envelopes 一起淘汰。Disclosure 与 cache 分离，所以 offscreen expanded run 被淘汰后仍保持展开，返回视口时在原面板重新加载。

### Process Detail PIU 的可见性与 render membership

Process Detail 的视觉 disclosure 与 React render membership 是两个不同的浏览器 view state。`ProcessPanel` 只从当前 `processDisplayEntries` 派生包含 `toolMessageType: "PIU"` 的 persistent Detail key，并由 `useProcessEntryDisclosure` 管理同一份 entry lifecycle；浏览器不得把该状态提升为后端 lifecycle、stream truth 或持久化事实。

- 只有已经进入 `renderedKeys` 的 PIU Detail 才能在条目自动收起、手工收起、整个过程面板收起或 reduced-motion 收起后继续挂载。收起必须同时移除可见/展开状态，并在隐藏 panel 与 Detail subtree 上设置 `aria-hidden` 和 `inert`，使其不可见且不可交互；不得为了保留实例而提前挂载尚未查看的 PIU。
- 普通文本、Markdown、RAG、DSL 与其他非 PIU Detail 继续按既有 disclosure timer 或 reduced-motion 路径退出 render tree。PIU-only 持久 membership 不得扩大为所有 Process Detail 的通用 pin，也不得改变 process-history cache 的 pin/LRU 规则。
- `rootMessageId + displayRunId` 定义 PIU render owner scope。过程条目离开当前投影或 scope 被替换时，旧 Detail 必须卸载；`PiuMessage` 取消组件拥有的迟到 emit，并清空捕获的 DOM 容器。PIU host 没有通用 `dispose`/`destroy` contract，容器外资源仍由外部 PIU 管理。
- `PiuMessage` 按 JSON-safe 内容值稳定加载 effect。相同内容的父级 rerender 不重复调用 `Prel.autoLoad` 或 `piu.emit`，真实内容值变化仍沿既有更新路径执行。
- capability completion 中的 `completed`、`capability completed` 或 `<toolName> completed` 只是 lifecycle-only text，不得替换同一 capability 已投影的 message-derived PIU Detail。显式 `safeResult`、非空 `safeSummary`、`contentUnavailable` 或非通用 completion content 仍是 canonical completion projection。

Cold event envelopes 不复制进 message/history 的扁平 envelope 层。对应 `TurnBlock` 只把当前 display run 的缓存 events 与 message-derived base facts 局部组合，再进入共享 `buildSessionProjection` / `buildTurnBlocks` / `buildProcessEntries` 路径。相同非空 `sessionId + runId + rootMessageId + stepId` 的 persisted completed thinking 覆盖 live/settled 副本；不同 `stepId` 不合并，缺少 `stepId` 时只按精确 `eventId` 去重。

Event loading/failure/legacy/available-empty 是独立 view state，失败不清除 message。后台加载在 300 ms 内不创建 loading-only row，也不替换既有“执行详情”标题；用户主动展开时才在面板 body 显示加载文案并提升 explicit priority。成功原位填充，失败只显示安全重试，legacy unavailable 不允许重试。

### Live 与 cold history 的完成态

| 维度 | live | cold history |
|---|---|---|
| Thinking | 累计内容流式 replace；完成事件 settle 当前条目 | 直接加载同一 completed 累计内容 |
| Capability | lifecycle 和结果渐进呈现 | durable lifecycle 与 result message 组合呈现 |
| Final answer | content delta 后由 message terminal truth 收敛 | 直接从 ASSISTANT message 呈现 |
| Entry disclosure | 新 active 条目展开，settled 后 800ms 折叠 | completed panel 默认折叠；用户展开后全部原始条目可检查 |
| PIU Detail lifecycle | 已挂载 PIU 在条目/面板视觉折叠时保留同一实例并变为不可交互；owner scope 移除才卸载 | 已挂载 PIU 在 disclosure 间复用同一实例；尚未查看的 PIU 不预挂载 |
| Panel terminal | 既有 150ms auto-collapse | 已完成状态直接呈现，不重启 auto-collapse |
| Motion | normal transition 200ms；reduced motion 立即落状态 | 无 live 流式动画；manual disclosure 仍遵守 reduced motion |

完成的 live turn 与 cold history 使用相同的 canonical envelope shape 和 process projection，因此内容、条目数量和终态一致；live 独有的只是 token 级中间帧、running 动画和延迟折叠过程。连续累计 thinking 更新必须保留一个稳定条目，completed event 不得创建第二份卡片。

### 安全过滤的延期边界

本基线只定义持久化、查询和呈现一致性，不定义新的 thinking/answer 脱敏、限长、截断、externalize、管理员策略或分享行为。现有 public projection 和日志安全边界继续生效；字段级内容安全策略必须由独立 OpenSpec change 明确 authoritative owner、fail-closed 行为和 live/history/share 一致性后实施。

### 任务输出与上下文解耦原则（目标状态）

> 2026-07-18 拍板的架构原则，对应 `10-implementation-gap-analysis.md` A3 / A4 / B19 / B20。

**核心原则**：长时任务的输出是否进入会话 active context，由用户在任务发起或运行中**显式选择**，系统不隐式决定。这条原则统一了长时能力扩展态（A3）、Fork-to-Continue（A4）、cron 执行会话归属（B19）三个原本散落的设计。

**三个选择**：

| 选择 | 触发条件 | 输出与上下文关系 | 用户继续对话位置 | 原会话状态 |
|---|---|---|---|---|
| **1. 等待**（默认） | 用户愿意等 | ✅ 输出进入当前会话 active context | 当前会话 | 阻塞，等任务完成 |
| **2. 转后台** | 用户不愿等 + 输出**不需要**进上下文 | ❌ 输出不进 active context，存到监控面板 | 当前会话继续 | 不阻塞，任务在后台跑 |
| **3. Fork 继续** | 用户不愿等 + 输出**需要**进上下文 | ✅ 输出进入**原会话** active context（任务完成后） | **新派生会话**继续 | 原会话继续等任务完成 |

**选择 2（转后台）的约束**：
- 任务从对话流移到后台监控，输出存到独立存储（shell 的 stdout/stderr，或 tool 的 safeResult ref），**不追加到 session active context**
- 对话流中保留"任务已转后台"的标记卡片（含 `backgroundHandle`），作为回到监控面板的入口
- `⚡` 监控面板展示所有 backgrounded 态任务（不限 Bash，含 tool 类型）
- 任务完成后对话流追加终态卡片（completed/failed），**仍不进 active context**——用户需主动从监控面板查看输出
- 转后台后输出**不能事后注入 context**：如需输出参与推理，用户应复制内容到 composer 或重新发起同步调用（避免隐式污染）

**选择 3（Fork 继续）的约束**：
- Fork 点：**上一轮已完成对话的答案处**（非当前运行中的任务）
- 新会话继承 fork 点之前的全部 active context
- **原会话继续等待任务完成**——任务输出仍进入原会话 active context
- 任务完成后，用户可切回原会话查看完整结果
- 原会话任务失败不影响派生会话（已 fork 独立存在）

**`outputContextMode` 工具声明**：

工具在 spec 中声明输出与上下文的关系，决定可用 CTA：

| 模式 | 含义 | 允许的选择 | 典型工具 |
|---|---|---|---|
| `required` | 输出必须进 context | 1（等待）、3（Fork 继续） | 网络诊断、配置审计、复杂分析 |
| `decoupled` | 输出可不进 context | 1（等待）、2（转后台） | dev server、build、log watch、批量采集 |
| `user-choice`（默认） | 用户决定 | 1、2、3 全部可选 | 通用工具 |

**CTA 可见性规则**（长时能力扩展态）：
- 默认显示"等待"（无需 CTA，正常同步执行）
- `cancellable=true` 时显示"取消"按钮（适用所有选择）
- `backgroundable=true`（即 `outputContextMode` 允许选择 2）时显示"转后台" CTA
- 始终显示"Fork 继续" CTA（除非 `outputContextMode=decoupled`，此时 fork 无意义）

**与 cron 任务的关联**（B19）：cron 触发执行等价于**选择 2 转后台**——输出不应进入原会话 active context。这为 B19 三个候选方案提供共同约束：任何方案都必须保证 cron 触发产生的 think/tool/answer 不污染原会话 context。

### 历史失败能力的渲染

历史 Capability 失败必须复用 live 的闭合 descriptor 和事实性卡片：默认只显示一次本地化原因，安全 code/category/本地化调用状态默认收起；三档成功结果配置不得隐藏或扩大失败内容。history 不从 raw Message、legacy event body 或 code-only degradation 重新解释原因，也不得暴露 raw result、上游错误文本、路径、工具参数或 correlation id。

### 历史失败 terminal 的部分答案渲染

`REQUEST_FAILED` terminal 事件在 history 重建时，其 content 若不是 safe failure placeholder（`Request failed`、`Request failed: ...`、`Request failed safely: CODE`），MAY 作为 partial answer fallback 渲染；safe failure placeholder MUST NOT 渲染为 assistant answer content。来源：`ts-run-status-visibility` scenario "Failed terminal history keeps only real partial answer content"。

---

## 第 7 节：跨会话 Activity → 列表提示与终态消费

Session Activity 是与 Request Execution Stream 分离的全 scope attention projection。每个 session 的公开状态只有 `WAITING_FOR_INPUT`、`RUNNING`、`UNREAD_FAILURE`、`UNREAD_RESULT` 和 `NONE`，优先级按该顺序固定。浏览器每个 app instance 只按可信 `transportKind` 建立一条 Activity SSE 或 WebSocket connection；首帧稀疏 `SNAPSHOT` 原子重建 store，后续 `DELTA` 按 session 更新，`NONE` 表示清除。该流没有 timeline cursor、request/run filter，也不因 session switch、列表分页、搜索或 detail execution stream 改变范围。事实主承载为 `cross-session-activity-awareness`，transport 关系见 `ts-web-sse-ws-transports`。

四个用户可见列表入口——local/immersive Sidebar、`SessionHistorySearchDialog`、immersive History CardList 和 collaborative History Popover——复用同一 `SessionActivityTrailingSlot`、store、selector、状态语义与可访问文案。普通状态下按唯一 activity 显示等待输入 tag、运行 indicator、未读失败 marker、未读结果蓝点或既有时间；支持行操作的入口在 hover、focus-within 或菜单打开时切换为既有 More，SearchDialog 继续无 More。当前 active session 只有在 `isConversationSurfaceVisible=true` 时本地抑制 marker；route active 但 conversation 被 History/Favorites/Memory/custom panel 覆盖时仍显示 Activity。Collaborative History trigger 在存在至少一个未被当前可见 conversation surface 排除的非 `NONE` session 时显示无数量的聚合蓝点。

终态 consume 不是列表交互：只有 shared conversation projection 已成功呈现 matching terminal run、activity store 仍保存同一 terminal unread、document 可见且 host conversation surface 可见时，frontend 才提交 `{ activityId, observedRunId }`。列表打开/hover/focus/分页、route selection、Activity delta、terminal frame、内容加载失败、document hidden 或 surface 被覆盖都不消费；滚动位置、anchored mode、列表底部和 terminal block 是否进入 viewport 也不是附加条件。marker 本身不可点击，`observedRunId` 只能来自已呈现 terminal projection，不能从 Activity payload 推断。

---

## 已知实现与规格差异

以下差异尚未进入稳定规格，后续由对应 capability 或 UI contract owner 收敛：

1. **Capability 公开身份的多语言业务名称**：当前结果策略按可信 `capabilityId` 与结构化类型显示既有身份；Agent/Skill 的可本地化公开业务名称需要独立 change 定义 owner、fallback 和批量装配，不能由结果 projector 猜测。
2. **Pending input 前端状态机无单一 spec**：4 种 durable kind 的统一 UI 状态流转散在各 pending input spec。

本文档第 2 节、第 3 节已标注这些 gap 的当前位置；后续 change 收敛后，本节同步更新。

## 验证关注点

- 本文档的事实陈述与 `stream-envelope.ts`、`conversationAdapter.ts`、`processDetails.ts` 当前代码一致；代码变更时需同步审查本文档。
- 本文档不引入新的 SHALL/MUST；所有 SHALL/MUST 均引用自 stable spec。
- `openspec validate --all --strict` 是本文档的长期一致性验证入口。
- UCD 设计表达文档（`docs/ucd/`）引用本文档作为事实来源，不重复定义契约。
