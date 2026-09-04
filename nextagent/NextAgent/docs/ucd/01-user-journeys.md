# 用户旅程

> 长期设计导航：通用界面状态见 `openspec/designs/architecture/conversation-ui-state.md`；thinking persistence、Event history、fork snapshot 与 hydration 见 `openspec/designs/architecture/conversation-process-history.md`。当前事实必须与 stable OpenSpec、public contracts、当前代码和测试交叉核对；本文档是 UCD 设计表达层，非 OpenSpec 基线，不定义契约。

> **状态基线（2026-08-13，`origin/main@4f27c4a9f`）**：当前事实由 owning stable/active OpenSpec、代码和测试交叉确认；active change 尚待归档时会明确标注。任务准入以 owning spec 与 roadmap 为准。

本文档覆盖对话界面的核心用户旅程，标注每个旅程涉及的 UI 状态与契约层章节。

## 旅程 1：首次提问到答案输出 [A 核心对话与任务执行]

1. 用户进入对话页，看到空状态（见 `06-empty-loading-error-states.md`）。
2. 用户在 composer 输入问题，点击发送。
3. 前端收到`REQUEST_ACCEPTED`，用户消息气泡出现，显示"已受理"指示。
4. Agent 进入思考，前端收到`LLM_THINKING_DELTA`，思考过程条目出现（可折叠）。
5. Agent 调用能力（如读文件、查 RAG），前端收到`CAPABILITY_STARTED` → `CAPABILITY_RESULT_DELTA` → `CAPABILITY_COMPLETED`，能力卡片呈现 running → result → 终态。
6. 若能力失败，前端收到`CAPABILITY_RESULT_DELTA`/`CAPABILITY_COMPLETED` 携带 `safeErrorCode`，失败卡片呈现（见第 5 节）；可能伴随 `DEGRADATION_NOTICE`。
7. Agent 生成最终回答，前端收到`LLM_CONTENT_DELTA` 流式追加到助手消息气泡。
8. Run 终态，前端收到`REQUEST_COMPLETED`，助手消息气泡标记"已完成"。

**契约章节**：第 1 节（事件序列）、第 2 节（能力结果呈现）、第 5 节（失败呈现）。
**对应场景**：`08-sample-scenarios.md` 场景 1（正常路径）。

## 旅程 2：附件上传 [A 核心对话与任务执行]

1. 用户在 composer 添加附件（日志文件、配置截图等）。
2. 附件上传后，runtime 校验：
   - 通过：前端收到`ATTACHMENT_ACCEPTED`，附件显示 accepted 指示。
   - 拒绝（格式/大小/安全策略）：前端收到`ATTACHMENT_REJECTED`，附件显示 rejected 指示与可读原因。
3. 用户继续提问，Agent 在回答时引用附件内容（但 UI 不在流事件中暴露附件 content bytes）。

**契约章节**：第 1 节（`ATTACHMENT_ACCEPTED`/`REJECTED`）、本 change `Attachment Accepted/Rejected Stream Event Visibility` requirement。
**history 差异**：历史对话不重建附件流事件，附件状态依赖持久化 attachment metadata。
**对应场景**：`08-sample-scenarios.md` 场景 4（附件上传）。

## 旅程 3：Pending input 应答 [E 交互输入与上下文]

1. Agent 触发当前 4 种 durable pending input：`QUESTION` / `CONFIRMATION` / `AUTHORIZATION` / `HUMAN_HANDOFF`。workflow interrupt 当前复用 `QUESTION + WORKFLOW_NODE/INTERRUPT producerRef + 空 questions`，专用 durable kind 或 presentation-derived route 仍为 `[Clarify]`。
2. 前端收到`USER_INPUT_REQUIRED`，pending input 卡片出现，显示问题/授权请求/确认请求 + `timeoutAt`。
3. 用户在卡片内应答：
   - question：选择 options 或输入 custom 文本。
   - authorization / confirmation：approve / deny（reject）。
   - human-handoff：选择“最终答案”或“恢复指令”模式，填写交接内容并提交。
   - `[UCD目标/Clarify]` workflow-interrupt：只有 Web safe projection 能可靠区分并提供所需安全字段后，才按 workflow 语义显示专用应答。
4. runtime 接收答案，前端收到`USER_INPUT_RECEIVED`。`[已实现-主干]` 当前清空 composer 上方的 `RespondInput`，process details 显示独立 system 条目；`[UCD目标]` 卡片更新为"已应答"只读终态。
5. 若超时：前端收到`USER_INPUT_TIMEOUT`；当前清空 active input，目标卡片更新为"超时"终态。
6. 若取消：前端收到`USER_INPUT_CANCELED`；当前清空 active input，目标卡片更新为"已取消"终态。

**契约章节**：当前 4 种 durable kind 以 pending-input stable specs 和代码为准；`conversation-ui-state.md` 的 5-kind 矩阵已登记治理漂移。
**history 差异**：pending-input event 会按 stored event type 重建，但当前只形成彼此独立的 process system 条目；只读 lifecycle 终态卡仍是 `[UCD目标]`。
**对应场景**：`08-sample-scenarios.md` 场景 3（Pending Input 全 kind 矩阵）。

## 旅程 4：断线重连 [D 错误与异常恢复]

1. 用户正在观察 live 对话，网络波动导致 stream 断开。
2. UI 从 `connected` → `reconnecting`（显示"正在重连"）→ `disconnected`（显示"已断开"）。
3. 前端自动重连（或用户手动点击重连），UI 进入 `reconnecting`，上送 `lastSeenSequence` cursor。
4. backend 校验 cursor，回放缺失事件（断线期间遗漏的事件），UI 进入 `resyncing`（显示"同步中"），按序插入缺失事件（不重复渲染已收事件）。
5. 缺失事件补齐后，UI 回到 `connected`，继续 live-tail（实时接收后续新事件）。
6. 若重连失败或 cursor 失效，UI 显示错误状态并提供手动刷新入口。

> 前端使用 5 种 `StreamConnectionPhase`：`idle`/`connected`/`reconnecting`/`resyncing`/`disconnected`。`degraded`/`replayed` 是概念模型状态，不作为前端 phase 存在。

**契约章节**：第 4 节（Reconnect/replay UI 状态阶梯）。
**约束**：transport close 不触发伪造 terminal；用户已收内容保持可见。
**对应场景**：`08-sample-scenarios.md` 场景 5（断线重连）。

## 旅程 5：历史对话浏览 [C 会话组织与检索]

1. 用户在会话列表选择一条历史对话（见 `05-component-specs/session-list-item.md`）。
2. UI 先加载 Message history，立即建立用户消息与助手终态内容；Process history 通过 run Event 查询异步补齐，不能阻塞 Message 展示。
3. UI 只为当前可视回合、一个视口预加载范围和用户显式跳转目标调度 Event 请求；快速滚轮、滚动条拖动和预览点击遵循 `02-dynamic-behavior-and-interaction.md` 的调度规则。
4. 重建内容（与 live 完成后的持久化事实一致）：
   - USER 消息 → `REQUEST_ACCEPTED`（用户气泡）。
   - ASSISTANT 非 terminal answer → `LLM_CONTENT_DELTA`（助手气泡，终态完整内容，无 streaming 中间态）。
   - Event history 中完成的 `LLM_THINKING_DELTA` → 思考条目；每次模型调用只恢复最后一条累计 snapshot，不恢复中间 delta。
   - ASSISTANT terminal → `REQUEST_COMPLETED`/`CANCELED`/`SUPERSEDED`/`FAILED`（终态卡片）。
   - Event history 中的 capability lifecycle 与同一 run 的 CAPABILITY_RESULT Message 合并为能力卡片。
   - DEGRADATION 消息 → `DEGRADATION_NOTICE`（降级提示卡片）。
   - CONTEXT_COMPACTED 消息 → `CONTEXT_COMPACTED`（压缩通知）。
   - stored `USER_INPUT_*` event type → 对应 pending input 卡片。
5. 不重建的 transient streaming 内容：
   - 未完成 thinking delta、capability result delta 与 live-only 动画状态。
   - `ATTACHMENT_ACCEPTED`/`REJECTED`（附件流事件，附件状态依赖持久化 attachment metadata）。
6. 相同 `sessionId + runId + rootMessageId + stepId` 的历史条目只能补全或替换对应 live 条目，不能按文本内容生成第二份。
7. history 无打字机效果、running 动画和渐进式披露；过程面板默认折叠，可展开查看全部已持久化条目。
8. 若历史对话有 active run，live stream 提供该 run 的实时增量；后台 Event hydration 只补充持久化事实，并通过相同 identity 与 live 条目合并，不能生成第二份过程条目。

**契约章节**：第 6 节（Live vs History 状态分叉）。
**对应场景**：各场景的 history 视图（横切所有场景）。

## 旅程 6：上下文压缩 [E 交互输入与上下文]

1. 长对话中，context engine 触发 compaction（micro-compact 或 summary compression）。
2. 前端收到`CONTEXT_COMPACTED`，压缩通知出现，显示 `contextVersion`（可选 `safeSummary`/`tokenEstimate`）。
3. 通知不暴露 compacted prompt content、model output、raw message bodies、internal context-engine state。
4. 后续 Agent 回答基于压缩后的上下文，用户可通过 `contextVersion` 感知上下文已变化。

**契约章节**：第 1 节（`CONTEXT_COMPACTED`）、本 change `Context Compacted Stream Event Visibility` requirement。
**history 差异**：历史对话由持久化消息重建压缩通知，内容与 live 完成后完全相同（`SUMMARY` 消息被过滤，但压缩通知独立重建）。
**对应场景**：`08-sample-scenarios.md` 场景 24（上下文压缩——长对话中的上下文窗口管理）。

## 旅程 7：路径被策略拒绝 [D 错误与异常恢复]

1. Agent 调用能力尝试访问被策略禁止的路径（如敏感配置目录）。
2. runtime 阻止，前端收到`CAPABILITY_RESULT_DELTA`/`CAPABILITY_COMPLETED` 携带 `safeErrorCode=CAPABILITY_PATH_REJECTED` + `safeSummary="Path access was blocked by policy."`。
3. 能力卡片呈现失败态，显示安全失败原因（不暴露被拒绝的路径、file system detail、policy internals）。
4. `RunStatus` 不转为 `FAILED`（路径拒绝不升级为 run failure），run 继续下一 capability 或 model round。
5. 可能伴随 `DEGRADATION_NOTICE` 作为次要提示，但失败卡片是主要解释。

**契约章节**：第 5 节（`CAPABILITY_PATH_REJECTED`）、本 change `Capability Path Rejected Failure Visibility` requirement。
**对应场景**：`08-sample-scenarios.md` 场景 6（路径被策略拒绝）。

## 旅程 8：编辑已发消息并重发 [F 编辑与修正]

1. 用户发现最近一条 USER 消息需要修改（如错别字、表述不清）。
2. 用户通过三种方式之一进入编辑模式：
   - 输入 `/edit` slash 命令。
   - 点击 USER 消息气泡的编辑按钮。
   - 点击输入区的重试按钮旁的编辑入口。
3. Composer 进入 edit 模式：加载原消息到输入框 → 显示"编辑模式"提示 pill → primary 边框 + 蓝色阴影 → 光标定位到文本末尾。
4. 用户编辑文本，点击确认编辑或按 Enter 发送。
5. 创建 superseding request，旧 turn 被标记为 `REQUEST_SUPERSEDED`。
6. 新 turn 出现在对话区，Agent 基于编辑后的消息重新执行。
7. 用户可按 Escape 取消编辑，回到 normal 模式（旧 turn 不受影响）。

**UI 涉及**：`composer.md`（编辑模式）、`message-bubble.md`（REQUEST_SUPERSEDED 终态）。
**约束**：edit-mode replacement text 与 normal per-session draft 独立缓存；仅最新 USER 消息可编辑；编辑需 Write 权限。
**对应场景**：`08-sample-scenarios.md` 场景 10（阶段 10a-10c）。

## 旅程 9：取消运行中的请求 [D 错误与异常恢复]

1. 用户发送消息后，Agent 正在执行（思考/能力调用中），用户决定取消。
2. 用户通过两种方式之一触发取消：
   - 点击 Composer 中的"停止"按钮。
   - 按 Escape 键（两步确认：第一次 armed + 提示，1.8 秒内第二次确认取消）。
3. runtime 投影 `REQUEST_CANCELED`，turn 进入取消终态。
4. 根据取消时是否已有部分内容，呈现两种子情况：
   - **有部分内容**：ASSISTANT 气泡显示已到达的流式内容 + 下方"已取消（含部分内容）"通知。
   - **无内容**：仅显示"已取消"通知，无 ASSISTANT 气泡。
5. Composer 按钮从"停止"恢复为"发送"。

**UI 涉及**：`composer.md`（ESC 取消运行）、`message-bubble.md`（REQUEST_CANCELED 子情况）。
**约束**：transport close 不触发伪造 terminal；取消是用户主动行为，区别于系统发起的 SUPERSEDED。
**对应场景**：`08-sample-scenarios.md` 场景 11（取消与重试）。

## 旅程 10：重试失败请求 [D 错误与异常恢复]

1. 用户发送消息后，请求失败（`REQUEST_FAILED`），助手消息气泡显示失败终态。
2. 用户通过三种方式之一触发重试：
   - 点击 ASSISTANT 气泡 BubbleActions 中的重试按钮（仅最新 FAILED turn 显示）。
   - 点击输入区的重试按钮。
   - 输入 `/retry` slash 命令。
3. 创建新的 request 取代失败的 request（旧 turn 保留，新 turn 追加到对话区）。
4. Agent 基于原消息重新执行，新 turn 正常流转（思考 → 能力 → 回复）。
5. 重试成功：新 turn 标记"已完成"。
6. 重试失败：新 turn 同样标记 FAILED，用户可再次重试。

**UI 涉及**：`message-bubble.md`（重试入口）、`composer.md`（slash 命令 + 重试按钮）。
**约束**：仅最新 FAILED turn 可重试；重试需 Write 权限；非 executing 状态才可重试。
**对应场景**：`08-sample-scenarios.md` 场景 11（取消与重试）。

## 旅程 11：从已完成 turn 派生新会话 [C 会话组织与检索]

1. 用户在浏览对话时，发现某个已完成的 turn 的上下文有价值，想基于该点探索不同方向。
2. 用户点击 ASSISTANT 气泡 BubbleActions 中的派生按钮（`ForkOutlined`，tooltip "从此回复派生会话"）。按钮进入 busy 态：disabled + opacity 0.55 + tooltip 变 "正在派生..."，**无 spinner**（图标不变），仅该 turn 按钮 busy（其他 turn 仍可用）。
3. 前端根据 forkAnchor 类型自动选用 API（durable 消息走 `forkSessionFromMessage`，live-completed 走 `forkSessionFromRequest`），创建新会话。子会话获得分叉点之前的 Message history 与 durable Event snapshot；这些过程事实归子会话所有，但不复制 active run、checkpoint、pending input 或其他进行中生命周期。
4. 成功 → `navigation.openSession` 导航到新会话 + `loadSessions` 刷新会话列表（新会话高亮选中），对话区显示从派生点复制的内容和可展开的历史过程，无成功 toast。旧版本没有 Event snapshot 时显示安全的“历史过程不可用”，不伪造条目。失败 → 显示 error toast "派生会话失败，请稍后重试。"，保留原会话不导航，按钮恢复可点。无论成功/失败，`forkingAnchorKey` 在 `finally` 中清除。
5. 新会话顶部显示 fork notice banner（"由 [来源标题] 派生"），标明来源会话标题（快照，非动态）+ 可点击链接返回来源会话（仅标题可点）。
6. 用户在新会话中继续提问，Agent 基于派生的上下文回答；首次发送消息时 `clearForkNotice(sessionId)` 清除 store + live USER envelope 出现 → `activeForkNotice = null` → fork notice banner 消失，后续对话与普通会话一致。

**UI 涉及**：`message-bubble.md`（派生）、`06-empty-loading-error-states.md`（fork notice banner）。
**约束**：仅 `COMPLETED` 态（durable 已完成或 live-completed）+ 有 answer content 的 ASSISTANT 气泡可派生；failed / canceled / superseded / in-flight 不可派生；派生需 Write 权限；分享选择模式开启时派生按钮不渲染（模式互斥，需先退出分享模式）。
**与旅程 14 选择 3 的辨析**：本旅程是**消息级 fork**——用户对已完成的助手消息显式选择 anchor 点分叉，anchor 由用户点击决定；旅程 14 选择 3 是**执行中 fork**——长时任务执行中用户想另起分支，系统自动选择 active run 之前的最近 COMPLETED 作为 anchor，用户不感知 anchor 选择。两者 fork 时机不同（已完成 vs 执行中）、anchor 选择方式不同（用户显式 vs 系统自动）、原会话状态不同（本旅程原会话已完成无后续，旅程 14 选择 3 原会话仍等待任务完成）。
**对应场景**：`08-sample-scenarios.md` 场景 13（分享与派生）。

## 旅程 12：多轮思考与工具调用 [A 核心对话与任务执行]

1. 用户提出一个需要多步推理的问题（如"排查 Edge-RTR-02 丢包问题，先查告警再查配置"）。
2. Agent 进入第一轮思考，前端收到`LLM_THINKING_DELTA`，过程面板出现 think #1 条目（auto-expanded）。
3. Agent 调用第一个能力（如 `queryAlerts`），`flushThinking()` 关闭 think #1，能力卡片呈现 running → result → 终态。
4. Agent 进入第二轮思考，过程面板出现 think #2 条目（新条目，非累积到 #1）。
5. Agent 调用第二个能力（如 `queryConfig`），`flushThinking()` 关闭 think #2，能力卡片呈现。
6. Agent 可能进入第三轮思考，产生 think #3 条目。
7. Agent 生成最终回答，前端收到`LLM_CONTENT_DELTA` 流式追加到助手消息气泡。中途若有 content delta（如"告警已查到 3 条……"），与最终回复拼接为同一个 markdown 字符串，不分段。
8. Run 终态，过程面板 auto-collapsed，助手消息气泡标记"已完成"。

**关键 UI 状态**：
- 多个独立 think 条目（`flushThinking()` 在每个非思考事件时拆分）。
- 中途 content delta 与最终回复拼接（`buildAnswerContent` / `mergeStreamText`）。
- 事件类型决定渲染位置：`LLM_THINKING_DELTA` → 过程面板，`LLM_CONTENT_DELTA` → 助手气泡，无第三区域。

**契约章节**：第 1 节（事件序列）、`processDetails.ts` 的 `flushThinking()`。
**对应场景**：`08-sample-scenarios.md` 场景 7（多轮思考与工具调用）。

## 旅程 13：多会话后台 run [B 长时任务与并行工作流]

1. 用户在会话 C 发送消息（如"网络健康诊断"），Agent 开始执行。
2. 用户不等待结果，切换到会话 D 发起新问题。会话 C 的 run 在后台继续执行。
3. 会话列表中会话 C 标记 `⚡` + "执行中（后台 ⏳）"，会话 D 标记 `●`（当前选中，也有 active run）。
4. 两个会话的 run 互不影响（不同 session lane）。
5. 会话 C 的 run 完成后，Activity Stream 投影 `UNREAD_RESULT` 或 `UNREAD_FAILURE`；用户打开会话且匹配 terminal presentation 可见后才消费该未读状态。
6. 用户切换回会话 C，对话区显示已完成的 turn——过程面板 auto-collapsed，助手气泡展示完整回复。

**关键 UI 状态**：
- `[已实现-主干]` 会话列表按五态优先级显示等待输入、运行中、未读失败、未读结果或普通时间。
- 未读终态只有在匹配 presentation 可见后消费，不能因点击列表项或加载失败提前清除。
- 切换回已完成会话时，过程面板 auto-collapsed（run 已终态）。

**契约章节**：`session-list-item.md`（多会话后台 run 指示）、`session-lane-scheduling` spec。
**与旅程 14 选择 2 的辨析**：本旅程是**会话级后台 run**——用户切换到其他会话，原会话的 run 自动在后台继续执行（多会话并行调度），run 结果仍进入原会话上下文，原会话不能继续发新消息（run 仍占用 session lane）；旅程 14 选择 2 是**任务级转后台**——任务脱离原会话上下文，原会话被释放可继续发新消息，任务结果仅存于后台任务监控面板不回流。两者"后台"含义不同：本旅程的"后台"是"会话非活跃，run 仍在 session lane 内执行"；旅程 14 选择 2 的"后台"是"任务脱离 session lane，结果与原会话上下文解耦"。
**对应场景**：`08-sample-scenarios.md` 场景 8（多会话后台 run）。

## 旅程 14：长时运行能力与三选择分流 [B 长时任务与并行工作流]

> **状态边界**：`[UCD目标/Clarify]` 当前没有通用 10 秒 long-running 切态、`outputContextMode`、tool detach、三选择 CTA 或 `taskType="tool"` contract。主干已有 request cancel、session fork 与 Bash-specific background task，但它们属于不同 owner，不能按下述旅程直接拼成实现；应先按 `add-ts-long-running-capability-control` 拆分并生成新 OpenSpec。

1. 用户发起需要长时间执行的任务（如"批量核查 50 台设备的配置基线"）。
2. Agent 思考完成，调用能力（如 `configAudit`），能力卡片呈现 running 态。
3. 能力执行超过阈值（10 秒），未收到 `CAPABILITY_RESULT_DELTA`，能力卡片视觉切换为 long-running 态。
4. Long-running 态呈现：计时器（从 `CAPABILITY_STARTED` 的 `createdAt` 计算，非客户端本地计时）+ "取消执行"按钮 + **三选择 CTA**（可见性由 `outputContextMode` 调控，见第 7 步）。
5. 若工作流节点发射进度 delta（设计建议）：能力卡片显示进度状态——`safeProgress: { current, total, label? }` 驱动"📊 N/M"指示器，`text`/`content` 承载状态文本（如"已处理 23 台，失败 0 台"）。用户可看到"已处理 N/M 项"或"第 N 次轮询"等进度更新。
6. 若工作流节点不发射进度 delta（当前行为）：用户只看到计时器递增，无进度信息。
7. **三选择分流**（核心）：长时任务执行中，用户面临三种选择，CTA 可见性由能力声明的 `outputContextMode` 调控：

   | 选择 | 用户意图 | 行为 | CTA 可见性条件 |
   |------|---------|------|--------------|
   | **选择 1：等待** | 愿意等待，结果参与后续上下文 | 默认行为，不做任何操作，等待能力完成 | 始终可见（即"取消执行"按钮 + 计时器） |
   | **选择 2：转后台** | 不愿等待，结果**不参与**后续上下文，当前会话继续对话 | 点击"转后台执行 [→ 后台]"CTA，任务转为后台任务（`taskType: "tool"`），原会话不被阻塞，用户在当前会话继续对话；任务完成后结果仅出现在后台任务监控面板，**不进入原会话上下文** | 仅当 `outputContextMode ∈ {decoupled, user-choice}` 时显示 |
   | **选择 3：Fork 继续** | 不愿等待，但结果**需要参与**后续上下文，想基于已完成的上下文继续对话 | 点击"在新分支继续 →"CTA → Popconfirm 确认 → 系统 fork 当前 active run 之前最近的 `COMPLETED` ASSISTANT turn → 导航到子会话 → 聚焦 composer（草稿带到子会话）。**原会话继续等待任务完成**（不终止、不转后台），用户可在会话列表看到原会话 `⚡ (前台⏳)` 指示 | 仅当 `outputContextMode ∈ {required, user-choice}` 且存在可 fork 的历史时显示 |

   **`outputContextMode` 取值**：
   - `required`：能力声明结果必须参与上下文（如 Read/分析类能力）→ 仅显示选择 1 + 选择 3 CTA。
   - `decoupled`：能力声明结果可不参与上下文（如部署/清理类副作用能力）→ 仅显示选择 1 + 选择 2 CTA。
   - `user-choice`：能力允许用户自行判断 → 显示全部三种 CTA。

8. **选择 1（等待）子路径**：用户不做任何操作或点击"取消执行"。
   - **用户取消**：点击"取消执行"，触发 `request-cancel`，run 进入 `CANCELED` 终态，助手气泡显示取消时的部分结果（如有）。
   - **用户等待完成**：能力最终完成，能力卡片呈现终态结果，过程面板 auto-collapsed，助手气泡展示完整结果。

9. **选择 2（转后台）子路径**：用户点击"转后台执行 [→ 后台]"CTA。
   - 能力卡片切换为"已转后台"标记卡片（保留在原 turn 过程面板中，作为占位提示），卡片提供"打开后台任务监控"入口。
   - 任务以 `taskType: "tool"` 进入后台任务监控面板，状态为 `running`，显示 `toolName` + 计时器 + 进度（若发射）。
   - **原会话不被阻塞**——用户可立即在当前会话发送新消息继续对话；新消息的 LLM 上下文**不包含**此任务的输出（任务输出仅存于后台任务监控面板，用户需要时主动查看）。
   - 任务完成后：后台任务监控面板状态切换为 `completed`，展示 `safeResultRef`（结果摘要）；原会话过程面板中的"已转后台"标记卡片更新为"已完成（在后台任务监控面板查看）"。
   - 用户可在后台任务监控面板 Kill 此任务（若能力声明 `cancellable: true`），Kill 触发 `cancel()` 接口。

10. **选择 3（Fork 继续）子路径**：用户点击"在新分支继续 →"CTA。
    - 弹出 Popconfirm："原会话将继续等待任务完成。你将在新分支中基于上一轮已完成对话的答案处继续，新分支**看不到**当前长时任务的结果。是否继续？"
    - 用户确认后：系统 fork 当前 active run 之前最近的 `COMPLETED` ASSISTANT turn（智能 anchor，用户不感知）→ 导航到子会话 → 聚焦 composer（草稿带到子会话）。
    - **原会话不终止、不转后台**——长时任务在原会话继续前台执行，用户可在会话列表看到 `⚡ (前台⏳)` 指示，完成后切回原会话查看结果。
    - 子会话新任务基于 fork 点之前的完整历史执行，**看不到**长时任务结果——若新任务依赖长时任务结果，应等待而非 fork。
    - 若长时任务是会话首个 turn（前面无 COMPLETED），fork 无历史可携带，选择 3 CTA 不显示。
    - **与选择 2 的关键区别**：选择 3 的原会话仍在等待任务（前台阻塞 composer 但后台运行），任务结果最终进入原会话上下文；选择 2 的原会话已释放，任务结果仅存于后台监控面板。

**关键 UI 状态**：
- running → long-running（计时器 + 取消入口 + 可选进度状态 + 三选择 CTA）。
- 进度通过 `CAPABILITY_RESULT_DELTA` 承载，不新增 `CAPABILITY_PROGRESS` 事件类型。
- 进度是可选的、累积的——不发射进度的能力仅显示计时器。
- long-running 是 running 的视觉扩展，不改变状态机。
- 三选择 CTA 可见性受 `outputContextMode` 调控——能力在工具协议中声明，决定哪些 CTA 出现。
- 选择 2（转后台）不可逆——任务一旦转后台，无法再回到原会话上下文。
- 选择 3（Fork 继续）的原会话仍等待任务完成——fork 的是"上一轮已完成对话的答案处"，不是当前执行中的 run。
- 三选择是建议非强制——用户仍可直接发送触发 supersede（终止长时任务，见旅程 17）；引导不阻断 supersede 通道。

**与其他旅程的辨析**：
- **与旅程 11（消息级 fork）的区别**：旅程 11 是对**已完成的助手消息**进行 fork（从某条历史消息处分叉），属于消息级操作；本旅程选择 3 是**执行中**的 fork，从"上一轮已完成对话的答案处"分叉，用于在长时任务执行时另起分支。两者 fork 点选择逻辑不同：旅程 11 用户显式选择 anchor；本旅程选择 3 系统自动选择 active run 之前的最近 COMPLETED。
- **与旅程 13（会话级后台 run）的区别**：旅程 13 是**会话切换**场景——用户切换到其他会话，原会话的 run 自动进入后台执行（多会话并行）；本旅程选择 2 是**任务级转后台**——任务脱离原会话上下文，原会话可继续新对话。两者"后台"含义不同：旅程 13 的后台是"会话非活跃，run 仍在执行"；本旅程选择 2 的后台是"任务脱离会话上下文，结果不回流"。
- **与旅程 17（supersede）的关系**：旅程 17 是"放弃当前执行，发新消息"——旧 run 被终止；本旅程三选择都保留任务执行（等待/转后台/Fork），不终止任务。supersede 是三选择之外的第四条路径（放弃）。
- **与旅程 25（cron 定时任务）的关系**：`[UCD目标/Clarify]` cron 输出不得污染原会话 active context，但 occurrence 应进入派生 session、schedule-bound execution session 还是独立结果日志尚未决定；不能把“仅在管理面板可见”视为已冻结路线（见 B19）。

**当前基础**：`request-cancel`、`session-fork-from-message` 与 Bash-specific `agent-web-background-task-control`；后者存在 UCD-R19 polling 漂移，不定义 B20 tool 泛化。
**UCD 目标输入**：`capability-card.md`、`composer.md`、`message-bubble.md`、`background-task-monitor.md`、`02-dynamic-behavior-and-interaction.md` 与 `conversation-ui-state.md` 的导航性原则。`outputContextMode`、通用 progress/cancel/detach 和三选择 CTA 必须由新的 OpenSpec 分项承载。
**对应场景**：`08-sample-scenarios.md` 场景 9（长时运行，含阶段 9.2c 三选择分流）。

## 旅程 15：会话搜索与管理 [C 会话组织与检索]

1. 用户需要查找一条历史会话，点击会话列表的搜索按钮，打开搜索 dialog 模态框。
2. 用户输入关键词（debounce 180ms：ASCII ≥ 3 字符，非 ASCII ≥ 2 字符），可选添加日期范围（最大 90 天）。
3. 搜索结果分页显示（每页 20 条），点击结果加载对应会话。
4. 用户对某条会话进行管理操作（hover → "更多" dropdown）：
   - **重命名**：打开重命名模态框，输入新标题（100 字符限制 + 计数器），确认后更新会话标题。
   - **删除**：打开删除确认模态框（danger 样式），确认后会话删除。若删除的是活跃会话，对话区清空并导航到 `/`。
5. 用户点击收藏按钮切换到收藏夹列表，浏览已收藏的 turn/message 条目及其所属会话信息（每页 20 条）；当前不存在 session-level favorite truth。

**关键 UI 状态**：
- 搜索 dialog（关键词 + 日期范围 + debounce + 分页）。
- 重命名模态框（字符计数 + Enter 提交）。
- 删除确认（danger 样式 + 活跃会话删除后导航）。
- 收藏夹切换（替换最近会话列表）。

**契约章节**：`session-list-item.md`、`04-information-architecture.md`（模态框层）、`session-history-search` spec。
**对应场景**：`08-sample-scenarios.md` 场景 12（会话搜索与管理）。

## 旅程 16：Sub-agent 委派 [G 委派与能力扩展]

1. 用户提出需要特定领域专长的任务（如"探测核心交换机 Core-SW-01 的邻居拓扑"）。
2. 模型通过 system prompt 中的 "Available agents" 部分发现可用 sub-agent（如 `network-explorer`）。
3. 模型调用 Agent 工具，输入 `{ agentId: "network-explorer", prompt: "探测 Core-SW-01 的邻居拓扑" }`。
4. 过程面板出现能力卡片：标题 "Agent"，skill 图标，running 态。父 turn 阻塞等待子 agent 完成。
5. 子 agent 在独立 session/run 中执行（`priority: "LOW"`），其内部执行（思考、工具调用）对父 turn UI **不可见**——Agent 工具是内部过程不可见的单步能力。
6. 子 agent 完成，返回终态文本（上限 100,000 字节）。
7. 父能力卡片呈现终态：`Agent` 没有平台安全结果 projector，有效级别保持 `STATUS_ONLY`，只显示业务身份和成功状态，不显示子 agent 返回正文或“结果已返回”占位摘要。
8. 模型基于子 agent 返回的文本继续推理，生成最终回答。助手消息气泡流式追加最终回复。

**关键约束**：
- **禁止嵌套**：子 run 不可再调用 Agent 或 AskUserQuestion（`submit.ts` 自动注入 `forbiddenCapabilityIds` + `allowSubagents: false`）。
- **子 agent 内部不可见**：父 turn UI 只看到 Agent 工具的单步能力卡片，不展示 child session 内部的思考、工具调用、降级等过程。
- **结果保持 STATUS_ONLY**：Agent 结果没有安全 projector，不显示正文或结构化结果卡片。
- **图标与 Skill 相同**：`resolveProcessIconType` 检测到 title 含 "agent"，返回 `"skill"` 图标。
- **低优先级调度**：子 run `priority: "LOW"`，不抢占用户顶层请求。

**契约章节**：第 1 节（`CAPABILITY_STARTED`/`RESULT_DELTA`/`COMPLETED`）、`agent-tool` spec、`invoked-agent-discovery` spec。
**对应场景**：`08-sample-scenarios.md` 场景 14（Sub-agent 委派）。

## 旅程 17：执行中发新消息（触发 supersede）[B 长时任务与并行工作流]

1. 用户发送消息，Agent 开始执行（思考/能力调用中）。
2. 用户未等待执行完成，直接在 Composer 中输入新消息并发送。
3. 后端 `replaceOlderLaneWork` 检测到同一 session lane 有新的 submit 请求：
   - 对正在执行的 run 设置 `superseded = true` + `controller.abort()`，在 safe boundary 终止。
   - 旧 turn 终态为 `SUPERSEDED`，事件类型 `REQUEST_SUPERSEDED`。
   - 新请求进入 `QUEUED`，等旧 run 终止后开始执行。
4. 旧 turn 在 UI 中标记为 `🔁 被取代`，过程面板显示"已被新请求替代"。
5. 新 turn 出现在对话区（作为独立的用户消息），Agent 基于新消息执行。
6. 旧用户消息**原样保留**——不会被修改或替换。

**与旅程 8（编辑重发）的关键区别**：
- **触发方式**：本旅程是正常发送新消息，旅程 8 是进入 edit 模式修改后重发。
- **消息关系**：本旅程中旧消息和新消息是两条独立消息，旅程 8 中新消息替换旧消息（同一逻辑位置）。
- **用户意图**：本旅程可能是"不等了，问新问题"或"补充修正上一条"——系统无法区分这两种意图，统一按 supersede 处理。
- **UI 流程**：本旅程无 edit 模式（无 primary 边框、无草稿隔离），就是普通发送。
- **终态相同**：两者旧 turn 终态均为 `SUPERSEDED`，渲染相同（`🔁 被取代`）。

**认知差异风险**：用户可能以为发新消息是在"修正"上一条（类似编辑重发的效果），但实际上旧消息原样保留，对话中出现两条用户消息 + 一条被取代的旧 turn。这与编辑重发的"干净替换"效果不同，可能造成用户困惑。

**UI 涉及**：`message-bubble.md`（REQUEST_SUPERSEDED 终态）、`composer.md`（执行中发送不阻止）。
**约束**：前端 `handleSend` 不检查 `isExecuting`，允许执行中发送；`supersededByRequestId` 字段已定义但前端未渲染。
**与旅程 14 三选择的关系**：supersede 是三选择之外的**第四条路径（放弃）**——旅程 14 的三选择（等待/转后台/Fork 继续）都保留任务执行；本旅程用户直接发新消息触发 supersede，旧 run 被终止。用户在长时任务执行中发新消息时，系统不强制走三选择 CTA，用户可直接 supersede。supersede 通道与三选择 CTA 并存——三选择是"保留任务"的建议路径，supersede 是"放弃任务"的兜底路径。
**对应场景**：`08-sample-scenarios.md` 场景 10（阶段 10d）。

---

## 旅程 18：页面关闭与重开 [D 错误与异常恢复]

1. 用户在对话执行中或对话空闲时关闭浏览器标签页/刷新页面。
2. 浏览器终止 SSE/WebSocket 连接，内存中的 `lastSeenSequence` cursor 丢失（spec 禁止持久化 cursor 到 sessionStorage）。
3. 用户重新打开页面，前端执行 **conversation bootstrap**：先加载持久化 Message history，立即显示已完成 turn；随后只为可视区、一个视口预加载范围和显式导航目标渐进加载 run Event history。过程面板默认折叠，加载过程不改写“执行详情”标题。
4. 两种子路径：
   - **有 activeRun（turn 仍在执行）**：conversation bootstrap 返回非终态 `activeRun { requestId, runId, status }`。前端以 `lastSeenSequence=0` 打开 run-scoped stream，从开头重放该 run 的所有 stream 事件。用户看到正在执行的 turn 恢复为 running 态（思考、能力卡片等过程从 sequence 0 重放），随后继续接收 live 事件。
   - **无 activeRun（turn 已完成/失败/取消/被取代）**：用户直接从 Message history 看到终态，Event history 渐进补齐 completed thinking 与 capability lifecycle。前端打开 no-cursor live-tail stream（省略 `lastSeenSequence`），仅接收后续新事件。
5. no-cursor live-tail 建立后，前端执行一次 **opening reconcile**（打开时对账）：刷新会话并与已接收的实时事件合并（去重，不产生重复 turn 或过程条目）。
6. 若 activeRun stream 打开后 15 秒内无任何 stream activity（`ACCEPTED_STREAM_ACTIVITY_TIMEOUT_MS`），前端标记请求超时，force-refresh conversation + session list；若刷新后 `activeRun` 不再存在，停止 streaming 指示。

**与旅程 4（断线重连）的关键区别**：
- **cursor**：旅程 4 保留内存 cursor，重连时发送；旅程 18 cursor 丢失，从 `lastSeenSequence=0` 重放。
- **恢复方式**：旅程 4 是 stream resume（gap replay）；旅程 18 是 conversation bootstrap + activeRun bootstrap。
- **history 加载**：旅程 4 不加载（页面未关闭）；旅程 18 必须先加载持久化历史。
- **用户感知**：旅程 4 看到"重连中"→"已重连"指示（`continuityPhase` 状态阶梯）；旅程 18 无"重连中"态——`continuityPhase` 从 `idle` 直接到 `connected`，用户看到历史对话 → 正在执行的 turn 恢复 running。
- **断线指示器**：旅程 4 有 `continuityPhase` 指示器（🔄/⚫）；旅程 18 无断线指示器（冷启动，非断线）。

**契约章节**：`ts-stream-resume-replay` spec（cold-start session open、activeRun bootstrap）、`conversation-ui-state.md` 第 4 节（reconnect/replay 状态阶梯）、第 6 节（live vs history）。
**对应场景**：`08-sample-scenarios.md` 场景 15（页面关闭与重开）。

## 旅程 19：查看 Run Graph 完整执行流程 [A 核心对话与任务执行]

1. 用户在一个复杂 turn（多轮思考 + 多次能力调用）执行中或完成后，想查看完整的执行流程链路（request → model → capability → answer → terminal），理解 Agent 做了什么。
2. 用户点击过程面板 summary row 右侧的"完整过程"按钮（`ProcessPanel.tsx` `onOpenFullProcess`）。
3. 前端懒加载打开 `TurnRunGraphPanel`，根据视口宽度选择布局（`graphDetailLayout.ts` `shouldUseGraphDrawer`）：
   - 视口充足（≥ 560 + 360 + 12 = 932px）：**side-split 模式**，对话区与 Run Graph 并排，graph 占右侧，可拖拽调整宽度（360–1040px，键盘步进 32px）。对话区不被覆盖。
   - 视口不足（< 932px）：**drawer 模式**，Run Graph 作为 Drawer 覆盖对话区。
4. Run Graph 显示 X6 流程图画布：7 种节点类型（request / model / capability / userInput / degradation / answer / terminal），各有相位色；节点状态徽章（⏳✅❌⏹️🔁）。
5. 用户浏览画布：滚轮缩放（0.6–1.35）、拖拽平移、Fit 适配视图、Reset 重置。
6. 用户点击节点 → 右侧/下方节点详情面板（`SelectedNodeDetail`）显示：节点标题、状态徽章、阶段标签、事件计数、指标（toolCallId / 事件数）、详情行、引用列表（eventType / sequence / timestamp）。
7. 用户关闭 Run Graph（Close 按钮）→ 回到对话区。

**关键 UI 状态**：
- 触发入口是过程面板 summary row 右侧"完整过程"按钮——**不是**过程面板 ▶ 展开/折叠（后者展开 think/capability 条目，不打开流程图）。两者同名"完整过程"但不同物。
- 布局自适应：`shouldUseGraphDrawer` 根据视口宽度切换 side-split / drawer，**side-split 优先**（不覆盖对话区）。
- side-split 可拖拽分栏：宽度 360–1040px，`GRAPH_RESIZE_HANDLE_WIDTH = 12`，键盘步进 32px。
- Run Graph 是**只读查看**：不触发新执行、不修改 conversation。
- live / history 均可打开：基于已重建的 TurnBlock 事件流，`buildRunGraphViewState` 转换为 `RunGraphViewState`（nodes / edges / activities）。
- 每个节点对应一个或多个 stream event，边表示执行顺序。

**契约章节**：`process-panel.md`（Run Graph 抽屉）、`03` 第 2.6 节（run-graph drawer 布局）、`04`（run-graph drawer 区域职责）。
**对应场景**：`08-sample-scenarios.md` 场景 16（Run Graph 完整执行流程）。

## 旅程 20：查看右侧展开面板的富内容 [A 核心对话与任务执行]

1. 用户提出需要富内容呈现的问题（如"查看陆家嘴顺势故障分布"）。
2. Agent 执行能力调用，过程面板出现能力卡片；Agent 完成后对话气泡内显示摘要（PIU 占位符或摘要卡片）。
3. Agent 通过流式事件 `TOOL_STRUCTURED_DELTA` 且 `toolEventType === "EXPAND_PANEL"` 推送富内容（地图、图表、仪表盘等），前端 stream watcher 自动打开右侧展开面板（`useExpandPanelStreamWatcher.ts`）。
4. 对话区收到左侧固定宽度（`DOCKED_DEFAULT_WIDTH = 484px`，`flex: 0 0 484px`），Expand Panel 占满右侧剩余空间（`flex: 1 1 auto`）。
5. Expand Panel 根据事件的 `toolMessageType` 渲染内容：
   - **PIU**（最常见）：调用 `window.Prel.autoLoad(piuName, piuVersion)` 加载组件包，`piu.emit(method, { ...content, handleExpandPanelOpen, handleExpandPanelClose, expandPanelId })` 在容器内渲染。地图、图表、仪表盘等富交互组件均通过 PIU 机制承载，不新增内容类型。
   - TEXT / FILE / ACTION / OPERATOR / DSL：分别用 MarkdownContent / FileCard / ActionCard / OperatorButtons / DslRenderer 渲染。
6. 用户在面板内与富内容交互（地图缩放、点击故障标注查看详情等）。PIU 组件可通过 `handleExpandPanelOpen/Close` 控制面板开关。
7. 用户关闭面板：点击 Close 按钮、PIU 组件调用 `handleExpandPanelClose`、turn 切换、session 切换，或打开 Run Graph（互斥，二者共享右侧空间）。

**关键 UI 状态**：
- 触发方式是流式事件自动打开，**非用户点击气泡卡片**——气泡内仅显示 PIU 占位符（"PIU: {piuName}@{piuVersion}（等待宿主渲染）"），富内容在右侧面板呈现。
- 与 Run Graph 互斥：打开 Expand Panel 自动关闭 Run Graph（`setSelectedDetailRootMessageId(null)`），打开 Run Graph 时 Expand Panel 不显示。
- 位置可配：`layoutConfig.expandPanelPosition = "LEFT" | "RIGHT"`（默认 RIGHT）；immersive 模式下可左可右，local 模式固定右侧。
- 布局类型由宿主模式决定：flex sibling（本地/沉浸式，与对话区并排）/ fixed overlay（协作式/PIU，覆盖在 PIU 面板左侧）。docked/floating/maximized 是协作式（PIU）宿主面板的布局模式，非 Expand Panel 自身。
- history 模式不自动打开：`history-load` 事件被 stream watcher 跳过（`if (event.transportHints.includes("history-load")) continue;`）。用户浏览历史时看到过程面板中的工具条目，不自动展开右侧面板。
- PIU 依赖 `window.Prel`：本地开发环境不可用时显示"PIU 内容（本地不可预览）"。

**契约章节**：`expand-panel.md`（展开面板组件规范）、`03`（布局——对话区与展开面板并排）、`04`（expand panel 区域职责）。
**对应场景**：`08-sample-scenarios.md` 场景 17（右侧展开面板——地图故障分布）。

## 旅程 21：从对话通知集成方打开系统页面 [A 核心对话与任务执行，UCD目标/部分实现]

1. 用户在对话中请求打开系统其他页面（如"打开 OSS 配置"）。
2. Agent 执行，推送 `TOOL_STRUCTURED_DELTA`（`toolMessageType: "OPERATOR"`，content 中 `type: "LINK"`），对话气泡内联渲染**导航卡片**（标题 + 描述 + "打开"入口）。
3. 用户点击导航卡片 → `document.dispatchEvent(new CustomEvent(key, { detail: { url, title, embed, ... } }))`（`OperatorButtons.tsx` L64）。
4. **集成方应用**监听 CustomEvent → 在自身页面打开新 tab，激活导航 tab → **全屏显示外部页面**（NextAgent 对话不可见），嵌入目标页面（iframe 或 SPA 组件）。
5. 用户在集成方导航 tab 中操作目标页面（如配置 OSS Bucket、权限等）。
6. 页签切换/关闭由集成方管理——点击 NextAgent tab 全屏切回对话，对话状态完整保留（流式连接保持、草稿保留、过程面板状态保留），可继续对话。

**关键 UI 状态**：
- 触发方式是用户**点击导航卡片**主动触发——非流式事件自动打开（与 Expand Panel 的关键区别）。
- NextAgent 仅 dispatch CustomEvent 通知集成方。页签栏由集成方在 NextAgent 页面外部提供——NextAgent 嵌入区域始终保留，是用户的对话主界面。
- OPERATOR `type: "LINK"` 字段已在 `add-ts-tool-structured-delta/design.md` L69 声明，但 `OperatorButtons.tsx` 未区分 BUTTON/LINK 渲染（当前均渲染为按钮）。本旅程为 UCD 设计建议，待 LINK 卡片渲染落地。
- `document.dispatchEvent` 已实现（`OperatorButtons.tsx` L64）。NextAgent 前端不监听自身 dispatch 的事件——集成方负责 `addEventListener`，负责页签管理（打开/切换/关闭/去重）和页面嵌入（iframe/component）。
- 页签是集成方临时 UI 状态：打开/切换/关闭不持久化，不属于 conversation。history 模式下 `[已实现-主干]` 可重建普通 OPERATOR 按钮内容，但 LINK 专门卡片仍是 `[UCD目标]`；页签不重建。
- 集成方切到导航 tab 时**全屏显示外部页面**，NextAgent 对话不可见——但对话**不中断**：流式连接保持、草稿保留、过程面板状态保留。切回 NextAgent tab 时全屏恢复对话。此行为由集成方保证。
- `data` 字段 MUST NOT 包含 credential/token（来源：`design.md` L414）。
- 与 Expand Panel 不同：Expand Panel 是 NextAgent 内流式事件自动打开的**并排面板**（对话区与面板同时可见）；导航卡片是 dispatch 事件通知集成方打开外部页签的**全屏整页切换**（对话与外部页面互斥可见，用户点击触发）。

**契约章节**：`sub-window.md`（导航卡片与集成方页面跳转组件规范）、`add-ts-tool-structured-delta/design.md`（OPERATOR type:LINK 定义 L64-82）。
**对应场景**：`08-sample-scenarios.md` 场景 18（打开 OSS 配置——导航卡片与集成方页面跳转）。

## 旅程 22：下载 Agent 生成的文件 [A 核心对话与任务执行]

1. 用户请求需要文件模板或导出（如"开启节能自治"→Agent 生成区域列表模板）。
2. Agent 执行，推送 `TOOL_STRUCTURED_DELTA`（`toolEventType: "ANSWER"`，`toolMessageType: "FILE"`，content 为 object `{ fileName, downloadUrl, mimeType?, fileSize? }`）。
3. 对话气泡内渲染**文件下载卡片**（文件图标 + 文件名 + 大小 + [⬇ 下载] 按钮）。
4. 用户点击卡片或 [⬇ 下载] → 浏览器原生下载文件。
5. 用户在本地使用文件（填写模板 / 查看报告 / 导入数据）。

**关键 UI 状态**：
- FILE ToolMessageType 的 `content` 当前为纯文件名字符串（`design.md` L46-48），`FileCard.tsx` 纯展示无下载能力。UCD 建议扩展 content 为 object `{ fileName, downloadUrl, mimeType?, fileSize? }`，向后兼容（string 时纯展示，object 时下载卡片）。
- 前端零下载基础设施（无 `blob`/`createObjectURL`/`saveAs`）。落地需新建下载逻辑。
- 下载机制：`<a href={downloadUrl} download={fileName}>`（默认）或 `Blob` + `createObjectURL`（需鉴权时）。
- 文件下载卡片**内联在对话气泡中**，不在 Expand Panel 中呈现。
- history 模式：下载卡片重建（content 持久化），但 downloadUrl 指向的临时文件可能已过期（`openspec/designs/architecture/attachment-lifecycle.md` cleanup 机制）。
- `downloadUrl` MUST NOT 含 credential/token。需要鉴权时使用短期签名 URL 或 Blob 方式。
- 与导航卡片（旅程 21）不同：文件下载是浏览器原生下载行为，导航卡片是通知集成方打开外部页签。

**契约章节**：`file-download.md`（文件下载组件规范）、`add-ts-tool-structured-delta/design.md`（FILE 定义 L46-48）。
**对应场景**：`08-sample-scenarios.md` 场景 19（下载区域列表模板）。

## 旅程 23：在扩展面板中审核修改配置并保存 [A 核心对话与任务执行]

1. Agent 在对话中推送 `EXPAND_PANEL` 事件（`toolMessageType: "PIU"`），扩展面板打开配置审核 PIU（如节能自治配置页）。
2. PIU 组件渲染配置表单（区域列表 + 参数 + 预览），用户审核、修改配置。
3. 用户点击 PIU 内 [保存] → PIU 组件调用 `onPiuSubmit(configData)` 回调。
4. 配置数据反馈到对话 → Agent 处理 → 新 turn 在对话气泡内展示策略摘要。
5. Agent 可发起 confirmation pending input（"是否执行?"），用户确认后执行。

**关键 UI 状态**：
- 当前 `PiuMessage.tsx` L28-41 的 `piu.emit()` 仅传递 `handleExpandPanelOpen`/`handleExpandPanelClose`/`expandPanelId`，**无 save/submit 回调**——PIU 组件无法将用户修改反馈到对话。UCD 建议增加 `onPiuSubmit(data)` 回调。
- `sendQuestionToLui` 机制存在于 `registerAIAgentPIU.tsx` L76-85，但仅 AIAgent PIU host（协作式宿主）可用，扩展面板内 PIU 不可用。`onPiuSubmit` 面向扩展面板内 PIU，与 `sendQuestionToLui` 互补。
- `[UCD目标/Clarify]` nested PIU submit 必须由 shared composer/request owner 建立受控入口，复用同一 request lifecycle、identity、Agent Scope、Owner Scope 与校验；不能把 host-only `sendQuestionToLui` 或前端私有注入 helper 直接提升为新的业务契约。
- PIU 提交不直接修改后端状态——数据反馈到对话，由 Agent 处理后决定是否执行。
- 提交后扩展面板可保持打开（用户可继续修改）或关闭（由 PIU 组件控制）。
- history 模式：扩展面板不自动打开（`history-load` 被跳过），PIU 占位符可见，但交互式审核/保存不重建。
- 与旅程 20（查看扩展面板富内容）不同：旅程 20 是只读展示（地图/图表），旅程 23 是**交互式审核+保存反馈**（配置表单→对话）。

**契约章节**：`expand-panel.md`（交互式 PIU 保存→对话反馈章节）、`PiuMessage.tsx` L28-41。
**对应场景**：`08-sample-scenarios.md` 场景 20（在扩展面板中审核修改节能配置）。

## 旅程 24：监控后台任务执行（选择 2 实例）[B 长时任务与并行工作流]

> **状态边界**：`[已实现-主干]` 当前只有来源 A 的 Bash background + header `⚡` monitor/output/kill；capability-card 内联追踪区也是 `[UCD目标]`。来源 B、`taskType="tool"`、通用 `cancel()`/`safeResultRef` 均是 B20 `[UCD目标/Clarify]`，不能按现有 background spec 直接实施。

1. **后台任务的两种来源**（均属于旅程 14 的**选择 2：转后台**路径，任务输出不进入对话上下文）：
   - **来源 A：能力发起时即转后台**（`backgroundHandle` 模式）——工具声明结果不参与上下文（`outputContextMode: decoupled`），Agent 通过工具启动长时间运行的后台命令（当前实例：Bash 工具 `run_in_background: true` 或前台超时自动转后台）。能力调用立即返回句柄而非等待命令完成——模型 turn 不阻塞。
   - **来源 B：长时任务执行中用户主动转后台**（旅程 14 选择 2）——长时任务执行超过 10 秒阈值后，用户点击能力卡片的"转后台执行 [→ 后台]"CTA，任务脱离原会话上下文，原会话继续新对话。任务以 `taskType: "tool"` 进入后台任务监控面板。
2. **taskType 泛化**（UCD 设计建议，B20）：后台任务统一抽象为 `taskType: "shell" | "tool"` 两种类型，监控面板按类型差异化呈现：
   - **shell 类型**（来源 A，Bash 工具）：保留 stdout/stderr 输出（各限 65536 字节），Kill 发送 SIGTERM。
   - **tool 类型**（来源 B，长时能力转后台）：展示 `toolName` + `safeResultRef`（结果摘要）+ 进度条（若能力发射 `safeProgress`），Kill 调用能力的 `cancel()` 接口（要求能力声明 `cancellable: true`）。
3. 能力卡片在 ProcessPanel 中显示完成（返回 `backgroundHandle` 即完成，来源 A）或切换为"已转后台"标记卡片（来源 B），卡片进入终态/标记态。
4. 能力卡片终态底部内联**后台任务追踪区**（来源 A）或"已转后台"标记卡片提供"打开后台任务监控"入口（来源 B），显示任务状态图标、命令名/工具名、状态 Tag、运行时长。
5. 用户展开追踪区查看输出（shell 类型：stdout/stderr；tool 类型：`safeResultRef` 摘要 + 进度状态），可点击 [↻ 刷新] 重新加载。
6. 对 RUNNING 任务，用户可点击 [Kill] 按钮（Popconfirm 确认）——shell 类型发送 SIGTERM，tool 类型调用 `cancel()` 接口。
7. `BackgroundTaskHeaderMonitor` 在 session mount 时用一次 `listTasks` 恢复既有任务并补充 `commandLine`，随后消费当前 session 的 `BACKGROUND_TASK_*` stream envelopes 实时更新；不另建轮询。
8. 后台任务完成/失败时，`BACKGROUND_TASK_COMPLETED`/`BACKGROUND_TASK_FAILED` 已作为 canonical stream envelope 到达 monitor；它们不生成 ProcessPanel message entry。Kill 当前无对应 stream event，前端以 local override 立即更新为 KILLED。

**关键 UI 状态**：
- 后台任务是旅程 14 选择 2 的实例——任务输出不进入对话上下文，原会话不被阻塞，用户可在后台任务监控面板查看任务状态和结果。
- taskType 泛化（B20 设计建议）将 Bash 的 `backgroundHandle` 模式（来源 A）与长时能力转后台（来源 B）统一为后台任务的两种类型，差异仅在呈现和 Kill 机制。
- 追踪区内联在 capability-card 终态卡片底部（来源 A），或"已转后台"标记卡片提供入口跳转到后台任务监控面板（来源 B）。
- 追踪区触发条件（来源 A）：safeResult 为 `bashBackgroundOutputSchema` 形状（含 `taskId` + `backgroundReason: EXPLICIT | TIMEOUT_AUTO_BACKGROUND | ABORT_AUTO_BACKGROUND`，文档中用概念术语 `backgroundHandle` 指代此句柄）。
- 追踪区触发条件（来源 B）：能力卡片标记态 + `taskType: "tool"` + `taskId` 引用。
- `BACKGROUND_TASK_*` 已进入 canonical stream projection；列表采用一次性 REST seed + session stream live update，输出详情仍按展开/手动刷新读取。
- Kill 机制按 taskType 分发：shell → SIGTERM（进程可优雅退出），tool → `cancel()` 接口（要求能力声明 `cancellable: true`）。
- `[已实现-主干]` 后台任务自然完成与用户 Kill 都只更新 durable 终态/timeline；不会提交 task-notification、创建 continuation run 或把 stdout/stderr 自动送回 Agent 上下文。用户通过 header `⚡` monitor 与按需 output REST 查看结果。若未来需要 Agent 恢复上下文，必须另立 contract change；来源 B 同样不自动回注结果。
- history 模式：追踪区查询历史会话的后台任务，任务通常已终态，输出引用可能已过期。
- **与旅程 14 选择 2 的关系**：本旅程是选择 2 的监控侧视角——旅程 14 描述用户如何转后台，本旅程描述转后台后如何监控。两者共同构成选择 2 的完整用户旅程。

**当前 Bash control 参考**：`backgroundTaskService.ts` 与 `agent-web-background-task-control` stable spec；该 spec 的 polling 条款已登记 UCD-R19 漂移，只能与当前代码/tests 交叉核对。
**B20 目标输入**：`capability-card.md`、`background-task-monitor.md` 的 taskType 泛化与 `02-dynamic-behavior-and-interaction.md` 第 1.7 节。通用 tool detach/cancel/result reference 需要新的 OpenSpec，现有 Bash spec 不承载该扩展契约。
**对应场景**：`08-sample-scenarios.md` 场景 22（后台分离执行与任务追踪）。

## 旅程 25：管理定时任务 [A 核心对话与任务执行]

> **状态边界**：Cron Tool 的 `cron` safeResult parser 和本地化专门 formatter 已进入主干，对应 active change 待归档；独立 Cron Dashboard 与管理 REST API 已由 stable specs 和主干实现交付。

1. 用户请求定时执行任务（如"每天早上 9 点检查网络拓扑"），Agent 调用 Cron 工具 `action=create`。
2. Cron 能力卡片在 ProcessPanel 中显示完成；默认 `DETAIL` 下可展开查看本地化安全结构详情。
3. 后端投影生成 `safeResult.kind = "cron"`（含 `id`、`humanSchedule`、`recurring`）。
4. 前端 `SafeCapabilityResult` 接受 `cron` kind，并按 create/list/delete 显示任务 ID、调度计划、循环标记或有界任务清单。
5. 用户可让 Agent 调用 `action=list` 列出当前 session scope 的定时任务（最多 50 条）。
6. 用户可让 Agent 调用 `action=delete` 按 ID 删除定时任务。
7. 用户可从 sidebar 进入 Cron Dashboard，在“任务”与“执行记录”Tab 中查询、创建、修改、删除、启停和立即执行当前 trusted owner + active Agent scope 下的任务。

**关键 UI 状态**：
- Cron 工具支持 3 种 action：create（创建）、list（列出）、delete（删除）。
- cron 表达式为标准 5 字段（minute hour day-of-month month day-of-week），进程本地时区。
- `recurring` 默认 true（循环任务），`recurring=false` 为单次提醒。
- Cron 工具 `action=list` 仍按 session scope；Dashboard 管理 API 独立按 trusted owner + active Agent scope 查询。
- NON_IDEMPOTENT：创建和删除不可重放。
- 后端安全投影与前端 parser/formatter 已实现；非法或超出白名单的 shape fail closed。
- **Cron Dashboard**（`[已实现-主干]`）：sidebar route、任务/执行记录 Tab、任务名/日期筛选、按日期聚合且按运行状态着色的执行时间线、已识别稳定错误码本地化和受信 scope 管理操作已交付；没有稳定 code 的普通 `Error.message` 当前可能原样显示。结果会话跳转策略仍是独立 Clarify。
- history 模式：能力卡片由持久化消息重建并使用与 settled live 相同的 formatter；管理面板同样可用（Cron 任务持久，不依赖当前 run）。

**契约章节**：`cron-task.md`（Cron 定时任务组件规范 + Cron 管理面板章节）、`cron-tool.ts`（工具定义）。
**与旅程 14 选择 2 的关系**：架构目标要求 Cron 输出不污染原会话 active context；但 occurrence 的 session/log 归属和查看入口仍为 B19 Clarify，不能预设只在管理面板查看。
**对应场景**：`08-sample-scenarios.md` 场景 23（创建和管理 Cron 定时任务，含阶段 23.5 管理面板直接操作）。

---

## 旅程 26：宿主页面触发 AI 提问（sendQuestionToLui） [A 核心对话与任务执行]

1. 用户在宿主产品页面（如网管系统告警列表）看到一条告警，旁边有"询问 AI"按钮。
2. 用户点击按钮，宿主页面 JS 调用 `piu.sendQuestionToLui({ question: "分析 Edge-RTR-02 CPU 95% 告警原因", isSend: true })`。
3. PIU 宿主面板自动打开（`queueQuestion` 内调 `openPanel`），面板从折叠/关闭态切换到显示态。
4. 问题通过 `composerBridgeRef.current.sendQuestion()` 注入对话；若 composer 未就绪，每 16ms 重试直到成功。
5. `isSend=true` 时自动发送为新消息，对话区出现 USER 气泡 + Agent 开始执行；`isSend=false` 时仅填入 composer 输入框，用户可编辑后手动发送。
6. 后续与普通对话一致——Agent 执行能力调用、返回结果。

**关键 UI 状态**：
- 仅协作式（PIU）模式可用；本地/沉浸式无此机制。
- 调用后 PIU 面板自动打开，无论之前是折叠还是关闭。
- `isSend` 控制是自动发送（`true`）还是仅填入 composer（`false`/未设，默认）。
- `question` 必须为非空字符串，否则 warn 并忽略。
- 不改变 PIU 面板布局——面板保持当前 docked/floating/maximized。
- composer bridge 重试机制（16ms interval）确保注入可靠。
- history 模式：`isSend=true` 注入的问题作为普通 USER 消息持久化，与普通对话一致；`isSend=false` 未发送不产生持久化消息。
- 与 `onPiuSubmit` 互补：`sendQuestionToLui` 面向宿主页面→对话（外部注入），`onPiuSubmit` 面向 Expand Panel 内 PIU 组件→对话（内部反馈）。

**契约章节**：`05-component-specs/tool-ui-interface-overview.md`（其他 PIU 交互接口章节）、`05-component-specs/expand-panel.md`（与 `sendQuestionToLui` 的区别章节）。
**对应场景**：`08-sample-scenarios.md` 场景 25（宿主页面触发 AI 提问）。

---

## 旅程 27：并行工具调用 [A 核心对话与任务执行]

1. 用户提出需要同时获取多种信息的复杂问题（如"排查 Edge-RTR-02，同时查告警、查配置、查日志"）。
2. Agent 思考，前端收到 `LLM_THINKING_DELTA`，过程面板出现 think 条目（auto-expanded）。
3. `flushThinking()` 关闭 think 条目，前端**几乎同时**收到 3 个 `CAPABILITY_STARTED` 事件，过程面板出现 3 个 running 态能力卡片。
4. 3 个能力各自独立执行，`CAPABILITY_RESULT_DELTA` / `CAPABILITY_COMPLETED` 按各自完成顺序到达——先完成的工具先呈现终态，不等待其他工具。
5. 所有能力完成后，Agent 可能进入第二轮思考（再次串行调用工具）或直接生成最终回答。
6. 前端收到 `LLM_CONTENT_DELTA`，助手消息气泡流式追加综合分析结果。
7. Run 终态，过程面板 auto-collapsed，助手消息气泡标记"已完成"。

**关键 UI 状态**：
- 多个能力卡片同时处于 running 态（区别于旅程 12 的串行 think→tool→think→tool）。
- 并行指示：每个并行批次中的能力卡片显示"并行 N/M"徽标（UCD 设计建议，需 stream-envelope 补投影，见 `10-implementation-gap-analysis.md` B10）。
- 结果按各自完成顺序呈现，不阻塞彼此；但写入对话上下文的顺序按模型声明顺序（非完成顺序）。

**关键约束**：
- 每轮有副作用工具上限 5 个，只读工具上限 20 个；超限批次被拒绝并要求模型重新拆分。完整限制见 `11-ux-limits-and-constraints.md` §2.1。
- ToolSearch + Skill 同批次强制串行（Skill 加载依赖搜索结果）。
- AskUserQuestion 在批次中会中断后续工具执行（前置工具先执行完，后续不执行）。
- 结果按模型声明顺序写入对话上下文（保证 tool_use/tool_result 配对），而非按完成顺序。

**契约章节**：第 1 节（事件序列）、`process-panel.md`（并行组合 + 排序规则）、`11-ux-limits-and-constraints.md` §2（工具执行限制）。
**对应场景**：`08-sample-scenarios.md` 场景 26（并行工具调用）。

---

## 旅程与场景对应表

| 旅程 | 对应场景 | 关系说明 |
|---|---|---|
| 1：首次提问到答案输出 | 场景 1（正常路径） | 直接对应 |
| — | 场景 2（失败路径） | 旅程 1 的失败子路径（L6/L14 提到失败） |
| 2：附件上传 | 场景 4（附件上传） | 直接对应 |
| 3：Pending input 应答 | 场景 3（全 kind 矩阵） | 一对多 |
| 4：断线重连 | 场景 5（断线重连） | 直接对应 |
| 5：历史对话浏览 | 各场景的 history 视图 | 横切所有场景 |
| 6：上下文压缩 | 场景 24（上下文压缩——长对话中的上下文窗口管理） | 直接对应 |
| 7：路径被策略拒绝 | 场景 6（路径被策略拒绝） | 直接对应 |
| 8：编辑已发消息并重发 | 场景 10（请求被取代，阶段 10a-10c） | 直接对应 |
| 9：取消运行中的请求 | 场景 11（取消与重试） | 合并 |
| 10：重试失败请求 | 场景 11（取消与重试） | 合并 |
| 11：从已完成 turn 派生 | 场景 13（分享与派生） | 合并 |
| 12：多轮思考与工具调用 | 场景 7（多轮思考与工具调用） | 直接对应 |
| 13：多会话后台 run | 场景 8（多会话后台 run） | 直接对应 |
| 14：长时运行能力 | 场景 9（长时运行） | 直接对应 |
| 15：会话搜索与管理 | 场景 12（会话搜索与管理） | 直接对应 |
| 16：Sub-agent 委派 | 场景 14（Sub-agent 委派） | 直接对应 |
| 17：执行中发新消息 | 场景 10（请求被取代，阶段 10d） | 与旅程 8 共享场景 10，触发方式不同 |
| 18：页面关闭与重开 | 场景 15（页面关闭与重开） | 直接对应 |
| 19：查看 Run Graph 完整执行流程 | 场景 16（Run Graph 完整执行流程） | 直接对应 |
| 20：查看右侧展开面板的富内容 | 场景 17（右侧展开面板——地图故障分布） | 直接对应 |
| 21：从对话通知集成方打开系统页面 | 场景 18（打开 OSS 配置——导航卡片与集成方页面跳转） | 直接对应 |
| 22：下载 Agent 生成的文件 | 场景 19（下载区域列表模板） | 直接对应 |
| 23：在扩展面板中审核修改配置并保存 | 场景 20（在扩展面板中审核修改节能配置） | 直接对应 |
| 24：监控后台任务执行 | 场景 22（后台分离执行与任务追踪） | 直接对应 |
| 25：管理定时任务 | 场景 23（创建和管理 Cron 定时任务） | 直接对应 |
| 26：宿主页面触发 AI 提问 | 场景 25（宿主页面触发 AI 提问） | 直接对应；仅协作式（PIU）模式 |
| 27：并行工具调用 | 场景 26（并行工具调用） | 直接对应 |
| — | 场景 21（开启节能自治——端到端复合场景） | 串联旅程 1+3+22+2+20+23+3+14 |
