## 当前实现基线（Current Baseline）

### Runtime pending-input 与结果持久化

`packages/agent-core/src/tools/tool-loop.ts` 已经在普通 capability invocation 之前识别 canonical `AskUserQuestion`，通过 `AgentRunStatePort.requestPendingInput(...)` 创建 `QUESTION` pending input，并以 `AgentExecutionOutcome.status="PENDING_INPUT"` 暂停原始 run。该路径不产生普通 `CAPABILITY_STARTED`、`CAPABILITY_COMPLETED` 或即时 capability result。

`packages/agent-runtime/src/lifecycle/submit.ts` 的 answer path 先用 pending-input store 的 compare-and-set 解析回答，再发布不携带回答正文的 `USER_INPUT_RECEIVED`。恢复 capability producer 时，`materializePendingCapabilityResult(...)` 已经使用 durable `producerRef.toolCallId` 和 `producerRef.capabilityId` 写入幂等、可见的 `CAPABILITY_RESULT` message；其 payload 对 `QUESTION` 保存 `pendingInputId`、`kind`、`status`、`safeSummary` 和 `answers`。当前方法不发布对应的 live result event。

`RuntimeOwnedAgentRunStatePort.emitEvent(...)` 已经按 `TimelineEventPersistencePolicy` 处理 event。当前策略把全部 `CAPABILITY_RESULT_DELTA` 归为 `LIVE_ONLY`，通过既有 `onLiveTimelineEvent` 发布但不追加 timeline record。live-only event 不推进持久化 session sequence，因此不能通过 `lastSeenSequence` 重放。该机制已经是 model/tool delta 的唯一 runtime publication path，不需要新增 publisher。

`tests/agent-kernel/session-lane-scheduling.test.ts` 已覆盖 pending answer 的 CAS、`USER_INPUT_RECEIVED` 不泄露回答、durable `CAPABILITY_RESULT` materialization、timeout/cancel 和恢复；尚未断言 AskUserQuestion durable result 与 live result 的顺序和关联。

### Web 安全投影

`packages/agent-channel-common/src/projections/stream-envelope.ts` 已经把 `CAPABILITY_RESULT_DELTA` 投影为 Web `StreamEnvelope`，并对若干 allowlisted capability result 生成 bounded `safeResult`。`USER_INPUT_REQUIRED` 允许 pending request safe fields；`USER_INPUT_RECEIVED`、`USER_INPUT_TIMEOUT` 和 `USER_INPUT_CANCELED` 只允许 `pendingInputId`、`kind`、`status` 与安全摘要。

当前 projector 没有 canonical `AskUserQuestion` answer result shape。generic upstream `safeResult` 路径也不能替代该缺口，因为它不负责从 durable pending answer payload 建立 `pendingInputId` 关联和本 change 规定的 answer-specific 容量边界。

`packages/agent-channel-web/src/routes/requests.ts` 的 `projectConversation(...)` 当前直接返回 runtime message items，没有为 canonical AskUserQuestion result 生成 channel-owned answer projection。`tests/agent-kernel/run-status-visibility.test.ts`、`packages/agent-channel-web/tests/pending-input-projection.test.ts` 与 conversation route tests 已覆盖一般 capability result allowlist、pending-input event 脱敏和 conversation 读取；尚未覆盖 `pendingInputAnswer`。

### Frontend live、settled 与 history 投影

`frontend/agent-web/src/features/chat/adapters/conversationAdapter.ts` 已经把 visible `CAPABILITY_RESULT` message 重建为 history `CAPABILITY_RESULT_DELTA`，调用 `buildSafeCapabilityResult(...)` 从 message content 生成 frontend-owned safe vocabulary。当前 helper 不识别 pending answer payload，也不把 `pendingInputId` 投影到 history envelope。本 change 不扩展该 raw-content projector，而是让 adapter 只读取 Web channel 提供的 AskUserQuestion answer 安全投影。

`frontend/agent-web/src/features/chat/process/processDetails.ts` 已经在一个纯投影流程中构建 thinking、capability、pending-input 和 terminal entries。当前 `USER_INPUT_REQUIRED` 只尝试读取扁平 `prompt/content/message`，没有格式化 canonical `questions`；`USER_INPUT_RECEIVED` 只尝试读取被安全边界禁止的 `value/response/content`。history `CAPABILITY_RESULT_DELTA` 则进入通用 tool join，因此同一交互不能形成完整问答。

`conversationStore` 已经按 session、root 和 attempt 隔离 active/settled envelopes，在 terminal 时把 active bucket 原子迁移到 settled，并由 conversation/history layer 与 settled live layer构建最终 Turn。本 change 不需要修改 envelope retention、compaction watermark、terminal settle 或 latest-attempt selection。

`frontend/agent-web/tests/processDetailsProjection.test.ts`、`TurnBlock.process-history.test.tsx` 和 `tests/e2e/session-history-streaming.spec.cjs` 已覆盖一般 capability result、process-history merge 和 settled Turn 保留；尚未覆盖 AskUserQuestion 问答融合。

conversation capability-result item 的 durable 坐标稳定携带 `requestId` 与 `runId`，但不保证携带 live event 的 `requestContextId`。history adapter 会在字段缺失时把 `requestContextId` 回退为 request id。若 AskUserQuestion interaction key 使用 `requestContextId`，同一回答在 live 与 history 中会形成不同 key；本 change 已用真实缺字段 fixture 锁定该行为，关联必须改用两条路径共有的 root、run 与 `pendingInputId`。

### AskUserQuestion 问题数与当前表单

`packages/agent-capability` 的 canonical `AskUserQuestion` descriptor 当前以 `maxItems: 3` 限制 `questions`。Agent/core 在 `executeToolCallsInOrder(...)` 中先持久化整个 assistant tool-use batch，再解析 canonical descriptor 并校验 AskUserQuestion 参数；因此 4 个问题会在 tool-use 已写入后抛出 `INVALID_INPUT`，发布 degradation 并终止 run。当前不存在 count-specific 的模型纠正，也不会创建 pending input。

runtime-owned `AgentRunStatePort.requestPendingInput(...)` 已对所有 pending input 保留最多 20 个问题的防御边界。该边界是容量保护，不应被 frontend 当作产品交互上限，也不应由浏览器决定或覆盖。

`frontend/agent-web` 的 `QuestionInput` 当前一次渲染全部问题，使用本地 `answers[][]` 收集答案，并在全部问题有效后一次调用现有 answer route。数据提交形状已经满足多问题原子回答，不需要新的 API 或 pending state；缺少的是单问题分页视图和导航状态。

### 独立交付边界

现有 durable `CAPABILITY_RESULT` 已经包含 `producerRef` 对应的 tool call identity、`pendingInputId`、`QUESTION/RECEIVED` 状态和 runtime-accepted `answers`，足以同时驱动 live 回显与 conversation/history 恢复。本 change 不需要新增 completed-turn metadata、通用 capability final fact、terminal presentation index 或 `agent-contracts` extension。

本 change 只为 AskUserQuestion answer 增加一个 channel-owned 纯安全 projector。该 projector 复用当前 `agent-channel-common` projection package，不建立第二个 shared package 或通用 capability presentation abstraction；后续更广泛的 completed-turn 工作可以复用这一窄 projector，但不是本 change 的实施前置条件。

## 目标设计（Proposed Design）

本设计包含两条相连但 owner 清晰的增量路径。回答事实继续采用 durable-first：`agent-runtime` 拥有接受与恢复，`agent-channel-common` 只形成 Web safe projection，`frontend/agent-web` 只形成用户可见投影。问题创建路径中，`agent-capability` 拥有 canonical model-facing descriptor schema，`agent-core` 拥有 model tool-call 编排、4–20 题兼容校验和 count correction，runtime 仍只拥有 pending-input 接受与最终防御校验。既有 pending-input command、message persistence、stream transport、conversation loading 和 active/settled/history layer 全部保留。

### 决策 1：Runtime 在同一个 materialization 边界完成 durable write 和 live publication

`materializePendingCapabilityResult(...)` 继续构造并幂等写入现有 `CAPABILITY_RESULT` message。调用方把已经恢复的 `RequestRun` 与 `RequestContext` 传入该边界。仅当以下条件全部成立时，该边界在 message append 成功后调用现有 `RuntimeOwnedAgentRunStatePort.emitEvent(...)`：

- `producerRef.kind="CAPABILITY_INVOCATION"`；
- `producerRef.capabilityId="AskUserQuestion"`；
- pending input `kind="QUESTION"`；
- pending input `status="RECEIVED"`；
- durable response answers 存在。

内部 `CAPABILITY_RESULT_DELTA.inlinePayload` 使用：

```text
capabilityId = "AskUserQuestion"
toolCallId = producerRef.toolCallId
pendingInputId = pending.pendingInputId
kind = "QUESTION"
status = "RECEIVED"
safeSummary = "Pending input answer received."
answers = pending.responseAnswers
```

该 payload 是 runtime/channel 内部事实，不是新的 `agent-contracts` DTO。`answers` 来自已经通过 runtime validation 和 pending store CAS 固化的 durable fact。runtime 不接收 frontend projection shape，也不在该层创建 `safeResult`。

`emitEvent(...)` 继续使用现有 persistence policy，因此 event 保持 `LIVE_ONLY`。message append 失败时不会执行 event publication，既有 pending resume failure path 接管；message append 成功后没有 subscriber 或 live delivery 丢失不影响 run continuation。runtime 不等待浏览器 ack，也不为 delivery 缺失重试 materialization。

这一路径使 durable write 成为 publication 的前置条件，同时避免新增 outbox、timeline event、publisher 或事务。pending answer CAS 与 message append 仍不是一个数据库事务；该既有恢复边界不在本 change 中重建。

### 决策 2：建立 stream/conversation 共用的唯一 AskUserQuestion answer projector

在 `agent-channel-common` 现有 projection surface 增加纯函数 `projectAskUserQuestionAnswerResult(...)`。它接受 event 或 durable message 已规范化出的同一组 canonical 字段；stream `CAPABILITY_RESULT_DELTA` projection 与 `agent-channel-web` 单条 conversation capability-result projection 都调用该函数。不得在 `conversationAdapter`、runtime 或 capability package 创建第二套 answer projector。

该分支同时校验 capability identity、`QUESTION`、`RECEIVED`、非空 `toolCallId`、非空 `pendingInputId` 和 nested answer array；任一校验失败即不生成 `safeResult`。

通过校验后，projector 按 spec 定义的顺序和预算生成：

```text
safeResult.kind = "pendingInputAnswer"
safeResult.answers = bounded ordered string[][]
safeResult.truncated = boolean
```

Web safe projection 顶层保留 `capabilityId`、`toolCallId`、`pendingInputId`、`kind`、`status` 和安全摘要。stream projector 把该 projection 合并进 envelope payload；conversation projector 把完全相同的对象放入现有 capability-result item 的可选 `pendingInputAnswer` 字段。`pendingInputId` 是已经在 pending-input Web events 中公开的受控关联字段，不进入 `safeResult`，不改变 `agent-contracts`。projector 不把回答正文复制到 `text`、`content`、`safeSummary` 或 `metadata`；conversation item 既有 canonical `content` 保持兼容，但 frontend 不得从中推导回答展示。

live 和 history 必须使用相同预算算法：按 group、item、Unicode code point 有序裁剪；group 上限与 accepted pending question 技术上限一致，为 20；单 group item 上限 9，单 string 上限 4096，总 string 长度上限 24576。总预算耗尽后省略后续 item/group，不生成空 string，并标记 `truncated=true`。

`USER_INPUT_RECEIVED` projector 保持不变。这样 status event 继续满足 answer-free 安全契约，answer body 只存在于 capability-result safe projection。

### 决策 3：Conversation boundary 投影 durable result，frontend 只做形状映射

`agent-channel-web` 仅对 role 为 `CAPABILITY_RESULT` 的 conversation item 解析现有 canonical `{toolCallId, toolName, payload}` message content。当且仅当 tool identity 与 payload 满足 AskUserQuestion `QUESTION/RECEIVED` 前置条件时，channel 把规范化字段交给 `projectAskUserQuestionAnswerResult(...)`，并把返回值附加为可选 `pendingInputAnswer`。解析或校验失败时不附加该字段，也不根据不完整坐标猜测回答。

`frontend/agent-web/src/features/chat/utils/safeCapabilityResult.ts` 只在 frontend-owned read union 中增加 `pendingInputAnswer` type guard，不实现预算或裁剪算法。`conversationAdapter.ts` 把 conversation item 的 `pendingInputAnswer` 映射为 history `CAPABILITY_RESULT_DELTA`；`toolCallId`、capability identity、`pendingInputId`、`kind`、status、safe summary 和 safe result 原样来自该字段。malformed 或缺少该字段的 DTO 不产生回答正文，只进入既有安全 fallback；adapter 不从 message content 中读取 `answers`。

该路径保证 live 和 history 的裁剪只存在一个 owner，同时保持 frontend 不依赖 channel 实现 package。对于 AskUserQuestion answer，frontend 只验证 public safe shape 并投影 UI，不读取 raw persisted `answers`；其他既有 capability result 的兼容投影不在本 change 中重写。

### 决策 4：Process projection 以 pendingInputId 形成单个补充信息条目

`buildProcessEntries(...)` 在单次纯函数构建中先收集 `pendingInputAnswer` result，再投影 pending-input entries。上游 Turn projection 已经按 session 与 root 隔离 envelope；函数内部使用 `rootMessageId + runId + pendingInputId` 作为 interaction key。`runId` 是 live event 与 durable conversation result 共有的 attempt 身份；`requestContextId` 只用于其他 envelope lane，不作为该 join 的必要字段。

投影规则唯一确定为：

1. 同一 attempt 的一个 `pendingInputId` 最多形成一个 process entry。仅有 `USER_INPUT_REQUIRED` 时，该条目的本地化标题为“等待补充信息”，detail 按原始顺序展示问题；option question 同时保留可选项以及单选、多选和允许自定义输入的可见含义。
2. `USER_INPUT_RECEIVED` 不创建第二个 response entry。只有该状态、尚无 matching `pendingInputAnswer` 时，同一条目的本地化标题更新为“用户补充信息”，detail 使用不包含回答正文的“回答内容暂不可用”安全文案，不显示“已响应”标题或状态后缀，也不从浏览器本地值补齐。
3. 存在 matching `pendingInputAnswer` 时，同一条目的标题为“用户补充信息”，detail 按 question position 显示问题与回答。单问题显示一个问题—回答对；多问题按原始顺序编号并逐项显示问题—回答对；每个多选回答在对应问题内保持 runtime-accepted 顺序。
4. 对 option question，answer 与 option `value` 精确匹配时显示 `label`；custom 或未匹配值显示 safe answer text。安全投影 `truncated=true` 时，detail 末尾显示本地化“内容过长，已截断”提示，不得静默隐藏截断事实。
5. 被该补充信息条目匹配并消费的 result 不进入 generic tool join。`USER_INPUT_RECEIVED`、live answer result 和 history answer result 都不增加该 `pendingInputId` 的 process entry 数量。
6. 有 answer result 但没有 matching `USER_INPUT_REQUIRED` 时，形成一个标题为“用户补充信息”的 process entry，按 answer group 顺序显示实际 safe answer并明确“问题内容不可用”；仍不形成 generic tool row。
7. 相同 root、run 和 `pendingInputId` 的 live/history/duplicate result 使用同一 semantic key 合并。conversation item 缺少 `requestContextId` 时不得因此形成 orphan；不同 run 或不同 pending input 永不关联。同一 run 先后发生的多个 AskUserQuestion 各自保留一个独立条目。

该关联只改变 `processDetails` 的 projection，不向 `conversationStore` 增加 pending-input cache、join state 或第二套 lifecycle，也不创建新的顶层用户消息、conversation turn 或 root request。active 到 settled 的迁移和 history merge 继续复用现有 envelope layer。

### 决策 5：Recovery 使用 durable message，不改变 stream cursor

answer result event 保持 live-only，不进入 timeline replay，也不推进 `lastSeenSequence`。同页已接收该 event 时，settled live layer 保留其展示；未接收、刷新或 stream gap 时，conversation load/opening reconcile 通过 durable `CAPABILITY_RESULT` message 重建 answer result。process event history可用于恢复问题与 status，但回答正文的最终来源仍是 visible message。

live 与 history result 同时出现时按 semantic key 合并，history 决定 durable result body，settled live 保留当前页面已经接受的 process presentation。该规则复用现有“message 决定 durable result、event 决定 lifecycle 与 ordering”的受控 join，不新增 stream 或 conversation request。

### 决策 6：边界与独立交付

回答结果路径的主要 owner 为 `agent-runtime`，因为新增事实的触发条件是 pending answer 已接受且 capability result 已持久化。问题数路径由 `agent-capability` 的 canonical descriptor 定义模型正常可提交的 1–3 题 shape，由 `agent-core` 在模型 tool-call 编排中处理 4–20 题兼容校验和超过 20 题的 count correction；runtime 只保留通用 pending-input 最终技术防御。`agent-channel-common` 和 `frontend/agent-web` 是必要消费者，不获得 pending lifecycle、model correction 或 persistence ownership。逐题页码和未提交草稿仅归 frontend view state。

本 change 只复用当前已经存在的 AskUserQuestion producer、runtime-owned pending input、durable capability-result message、run-state live publisher、conversation route、agent-web pending response surface 和 conversation process-history continuity。它不重新定义这些既有行为。实施时必须保留 shared chat core、三种 host mode、latest-attempt selection 和 current envelope compaction/settle 机制。

本 change 不依赖未实施 change，也不新增通用 presentation abstraction。对 conversation API 的唯一 additive public shape 是现有 capability-result item 上 channel-owned 的可选 `pendingInputAnswer` 字段；`SessionMessage`、`agent-contracts`、stream event vocabulary 和 persistence shape 均不改变。与其他修改相同 channel/frontend 文件的工作只能按文件串行集成，但不存在产品或契约前置依赖。任何需要新增 `agent-contracts` DTO、event type、message role、store 或通用 safe-result contract 的发现都超出本设计，必须停止实施并先走独立 contract refinement 与升级确认。

### 决策 7：模型仍限制 3 题，系统以 20 题作为兼容兜底

canonical `AskUserQuestion` descriptor 的 `questions.maxItems=3` 和字段描述保持明确：模型每次只能提出 1–3 个当前必要问题。context rendering 与 provider adapter 必须原样保留该限制，不得向模型暴露 20 题为正常可用额度。

runtime-owned pending-input boundary 现有的 20 项检查保持不变。该数字只用于系统接收模型偏差时的兼容兜底和最终容量保护：模型返回 4–20 个其他方面均有效的问题时，系统仍创建一个 pending input；超过 20 个时不接收。frontend 必须能显示 runtime 已接受的 4–20 题，但这不改变 model-facing 3 题契约，也不得在 UI 中把 20 宣传为建议额度。

Agent/core 在 `executeToolCallsInOrder(...)` 内按以下唯一顺序处理 canonical AskUserQuestion：

1. 解析当前 Agent assembly 和 canonical descriptor，确认 resolved descriptor 的 `questions.maxItems=3`，再使用现有 `normalizeAskUserQuestionArguments(...)` 对精确名称的 AskUserQuestion 做无副作用的 question count 预检。descriptor 缺失、不可用或不再提供该明确上限时不得猜测兼容行为，继续既有 safe failure。
2. 预检必须发生在 `appendAssistantToolUseMessage(...)` 之前。预检不得创建 pending input、写入 tool-use/result message、发布 `USER_INPUT_REQUIRED` 或修改 `RequestContext.toolCallStates`。
3. 1–3 题继续直接使用 resolved descriptor schema 校验。4–20 题进入唯一的兼容分支：Agent/core 从 resolved descriptor 构造一次 request-local validation view，只把 `questions.maxItems` 从 3 放宽为 20；其余 object shape、required/additional properties、question/option item schema 和 string bounds 完全复用 resolved descriptor，之后继续执行既有 visible-text、option uniqueness、forbidden-purpose 和 pending intent 校验。该 view 不写回 descriptor、不进入 capability catalog、context rendering 或 provider adapter，也不得复制第二套 question item schema。
4. 20 是 Agent/core producer 的内部兼容上限，同时 runtime 保留独立的通用 pending-input 防御。两层必须由 3/4/20/21 characterization 锁定一致行为；以后修改任一边界时必须同时评审另一层，不能只扩大 model-facing schema。
5. 仅当 normalized `questions` 是数组且数量超过 20 时，在写入前抛出内部 `AgentError{ code="INVALID_INPUT", category="VALIDATION" }`，并以受控 `safeDetails.reasonCode="ASK_USER_QUESTION_COUNT_EXCEEDED"` 标识 count-specific recoverable validation。非数组 shape 不得进入 count recovery，继续原有执行与失败路径。
6. `DefaultAgent` 只识别上述 reason code，复用现有 request-local meta USER correction 机制，要求模型把问题合并到最多 3 题，并重新发出该批次中仍然需要的其他 tool call；correction 只包含实际 question count、model-facing maximum 3 和 attempt 号，不复制问题正文、20 题兼容上限或其他 tool arguments。每次进入 correction 时发布现有类型的 `DEGRADATION_NOTICE`，使用安全 code `ASK_USER_QUESTION_COUNT_EXCEEDED` 和低基数 count/max/attempt，不发布 terminal event。越界 assistant tool-use batch 不持久化，批次中的任何 tool call 都不执行，从而保持 tool-use/tool-result pairing 并避免部分 side effect。
7. count correction 使用独立的连续重试计数器，但复用 `minimalToolLoopLimits.toolCallLimitRecoveryLimit` 的既有 3 次预算值；不得与 tool-call-count 或 empty-tool-name 的重试计数互相消耗。任何被正常或兼容接收的后续 model batch 都重置该 counter。有效重试重新走完整 schema、安全目的和 producer 校验；成功时只创建一个 pending input。
8. 纠正次数耗尽后，才使用 safe `INVALID_INPUT` 终止 run。4–20 题兼容分支中的其他 schema shape、可见文本预算、重复 option、forbidden-purpose、descriptor unavailable 或 pending acceptance 错误不纳入 count recovery，继续使用现有失败语义。

禁止静默截断问题、从一个 tool call 自动生成多个 pending input、持久化无配对的越界 assistant tool-use，或让 frontend 猜测/修复模型参数。兼容校验只允许放宽 question count 这一处，不建立通用 schema self-repair 框架，也不把 20 题回写给模型。

### 决策 8：多问题使用前端逐题视图，最终仍原子提交

`QuestionInput` 继续拥有 `answers[][]`、custom selection 和 submit status 等本地 view state，并新增当前问题索引。`safeCapabilityResult` 的 frontend read guard 同步接受至多 20 个 answer group，但继续只校验 Web safe shape，不自行裁剪或从 raw content 重建。多问题 pending input 的交互规则为：

1. 弹层顶部显示“当前序号 / 总数”，正文区域只渲染当前一个问题；单问题保持现有直接填写体验。
2. “上一步”在第一题禁用；“下一步”只在当前题满足既有 text/single/multi/custom 校验后可用。返回已回答问题时保留草稿并允许修改。
3. 前后翻页只更新 frontend view state，不发送 answer request、不创建 pending input、不推进 run，也不改变 stream 订阅。
4. 非最后一题不显示最终提交动作；最后一题且全部问题有效时，使用现有 `onSubmit(answers[][])` 一次提交全部答案。提交期间复用现有 disabled/submitting/error 行为，失败时保留当前草稿和页码供重试。
5. active pending input id 变化时，答案与页码一起重置；页面刷新后由现有 pending input 恢复问题，但未提交草稿不持久化。
6. 对系统兜底接收的 4–20 个问题不得出现内容溢出导致的不可达按钮，也不得一次渲染全部问题。该交互不改变完成后的 process detail：回答接受后仍在一个“用户补充信息”entry 内按问题顺序展示全部问题—回答对。

该修改只触达现有 `QuestionInput` 及其本地化和测试，不修改 pending-input store、answer DTO、route、runtime validation、session stream 或 host-mode composition。local、immersive、collaborative 三种宿主继续复用同一 composer。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证方向 |
|---|---|---|
| 安全 | 回答只从 runtime-accepted durable fact产生；owner/agent/session scope 复用现有 stream 与 conversation authorization。`USER_INPUT_RECEIVED` 继续 answer-free，Web 只输出 bounded allowlist，回答不进入 log、audit、metric、trace 或其他 payload 字段。 | channel negative contract tests、frontend malformed-history tests、安全审查 |
| 性能/容量 | 每个成功 AskUserQuestion answer 至多增加一个 live-only event，不增加 timeline row。模型正常每次最多提出 3 题，系统兜底接收的单个 pending input 最多包含 20 个问题；单 event 的 answer text 总量不超过 24576 Unicode code point。projection 为有界线性遍历，frontend 每次只渲染一个待回答问题，不增加 request 或 store subscription。 | descriptor 3 题 contract tests、4/20/21 fallback tests、projector boundary tests、500+ envelope frontend regression、浏览器 long-answer/rAF 观察 |
| 可靠性/恢复 | durable message 先于 live publication；live 缺失通过 conversation/history 恢复。answer command 与 message append 继续幂等，frontend 对 live/history duplicate 再做 semantic idempotency。 | runtime characterization、refresh/gap integration、duplicate delivery tests |
| 可维护性 | 复用现有 event type、run-state publisher、message shape、channel-common projection surface、safe-result vocabulary 和 pure process projection；只新增一个 AskUserQuestion answer projector，不新增通用 abstraction、owner、状态机、第二 projector、shared package 或配置。 | architecture lint、模型语义 review、stream/conversation deep-equality fixture |
| 可测试性 | runtime order、channel shape、history reconstruction、process fusion 和 browser lifecycle 都有确定输入输出；缺少 subscriber、malformed payload、跨 attempt 和 duplicate 均可用 deterministic fixture 覆盖。 | unit、contract、integration、component、Playwright |
| 审计/可追溯性 | durable `CAPABILITY_RESULT` 保留 request/run/toolCall/pendingInput 关联并继续由 conversation history提供；live-only event不充当审计事实。 | message/history assertion、无新增 audit/log payload 的审查 |

## 验证策略（Verification Strategy）

- runtime characterization/integration 验证 durable result 先写、live result 后发布、resumed model output 再继续；同时覆盖 idempotent replay、message append failure、无 subscriber、timeout 和 cancel。
- Web projection contract 使用同一 runtime-accepted answer fact 同时驱动 stream payload 与 conversation item 的 `pendingInputAnswer`，验证 projector output deep equality、canonical identity、顶层关联字段、nested answer order、全部容量边界、Unicode 截断、总预算、malformed shape fail-closed，以及 `USER_INPUT_RECEIVED` 不包含回答。
- frontend unit tests 从 live envelope 和 conversation `pendingInputAnswer` 构建同形 history envelope，验证同一 `pendingInputId` 始终只有一个补充信息条目、等待到回答的标题变化、自由输入、单选、多选、自定义输入、多问题配对、option label mapping、截断提示、orphan answer fallback、received-only fallback、result consumption、duplicate merge 和跨 attempt 隔离，并断言 adapter 不读取 raw stored payload。
- Agent/core characterization 验证 model-facing descriptor 始终明确最多 3 题；4 个和 20 个其他方面有效的问题通过兼容分支创建一个 pending input；21 个问题在任何 assistant tool-use/pending/event 写入前触发要求最多 3 题的 model correction，纠正后继续原 run，连续 3 次纠正失败后才 safe terminal；非 count validation 不被误重试。
- frontend component tests 验证 1、4、20 个问题的进度、单题渲染、前后导航、草稿保留、逐题校验、最后一次提交和提交失败重试；断言翻页期间 answer/conversation/stream 请求数不变。
- store/component tests 验证 terminal settle 与后续 submit 不删除补充信息条目，matching history 不重复 response/tool row，展开后的 detail 保持完整。
- Playwright 使用真实页面和可控后端 fixture 覆盖 live answer、terminal completion、第二次 submit、answer 后刷新、answer delivery 缺失后的 conversation recovery 和长回答；请求断言确保没有额外 conversation/stream loop。
- architecture/code review 验证未修改 `agent-contracts`、未新增 event/route/store、未让 frontend 使用 request body 作为事实、未改变 stream cursor 或 timeline persistence。
- strict OpenSpec validation、frontend build/targeted tests、root contract/architecture gates 作为实施完成门禁。

## 风险与取舍（Risks / Trade-offs）

- runtime event 与 durable message不是原子事务。durable-first 顺序消除了“只看到不可恢复 live result”，但 message 成功后客户端仍可能错过 live event；conversation/history recovery 是明确补偿路径。
- conversation capability-result item 增加一个可选 channel-owned 字段，会扩大该 Web DTO 的安全投影面；通过单一 projector、additive optional shape、malformed fail-closed 和 transport contract tests 控制兼容风险，不升级 `agent-contracts`。
- 历史 process events 可能缺少 `USER_INPUT_REQUIRED`。orphan fallback 保证“用户补充信息”条目与回答仍可见，但不能重建未知问题；UI 明确标记问题不可用，禁止猜测。
- 用户回答属于 conversation-visible user content。该 change 增加同 owner/agent/session 范围内的实时可见性，但不扩大受众；严格 allowlist、容量限制和禁止进入 observability payload 缓解泄露风险。
- model-facing 3 题与内部 20 题兜底是两个有意不同的边界。窄兼容 validation view 和双层 20 项防御增加了少量维护成本，但避免把异常容量宣传给模型；必须用 descriptor 与 3/4/20/21 characterization 防止两层语义漂移。
- 20 项技术上限仍是硬容量边界，但它不决定模型正常用法或前端布局；超过该边界时用有界模型纠正改善成功率，不能保证任意问题数都在一个 pending input 内完成。
- 24576 Unicode code point 的总预算不会保证 20 个最长 custom answer 全量进入 Web 投影；runtime durable answer 仍完整，Web 按既有总预算确定性截断并明确提示。未来扩大 pending-input 技术预算时必须同时评审 answer group 和总字符预算。
- 多问题草稿只存在于当前页面 view state，刷新会丢失未提交内容。这保持了 frontend ownership 和最小范围；如需草稿恢复，应另立包含 persistence/隐私边界的 change。

## 待确认问题（Open Questions）

无。
