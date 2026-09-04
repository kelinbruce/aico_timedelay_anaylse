# 组件规范：消息气泡（Message Bubble）

> 长期设计导航：`openspec/designs/architecture/conversation-ui-state.md` 第 1、6 节。当前事实以 stable/active OpenSpec、public contracts、当前代码和测试为准；本文档是 UCD 设计表达层，非 OpenSpec 基线，不定义契约。

## 职责

渲染 USER 与 ASSISTANT 消息，承载对话回合的可见内容。USER 气泡对应 `REQUEST_ACCEPTED`，ASSISTANT 气泡对应 `LLM_CONTENT_DELTA`（流式追加）与 terminal 事件。

## 变体

### USER 消息气泡

- 对应 `REQUEST_ACCEPTED` envelope。
- 右对齐（或左对齐，视设计语言）；展示用户输入文本。
- 携带"已受理"指示（来自 `status` 字段）。
- 可附加附件指示区（见 `composer.md` 的附件上传与 `conversation-ui-state.md` 第 1 节 `ATTACHMENT_ACCEPTED`/`REJECTED`）。

```
┌─ Turn ───────────────────────────────────────────┐
│                              🧑 用户             │
│                    网络健康诊断                   │
│                          [📎 topology.json]      │
└──────────────────────────────────────────────────┘
  ← 右对齐，附附件指示区
```

### ASSISTANT 消息气泡（非 terminal）

- 对应 `LLM_CONTENT_DELTA` envelope。
- 左对齐；流式追加 `content` 字段（`contentType=MARKDOWN`，默认 `role=ASSISTANT`）。
- 渲染 markdown（`react-markdown`）；不渲染 raw prompt、raw model output 全文以外的字段。

```
┌─ Turn ───────────────────────────────────────────┐
│  🤖 助手 · ⏳ 生成中…                             │
│  # 网络诊断联调长回复                              │
│  ## 1. 摘要                                        │
│  本次诊断结论是：当前网络整体仍可█                 │  ← 流式打字机效果（光标█）
└──────────────────────────────────────────────────┘
  ← 左对齐，流式追加，打字机效果
```

### ASSISTANT 消息气泡（terminal）— 4 种终态指示器

- 对应 `REQUEST_COMPLETED`/`FAILED`/`CANCELED`/`SUPERSEDED`。
- **历史失败 terminal 的特殊渲染**：`REQUEST_FAILED` 的 content 若是 safe failure placeholder（`Request failed`、`Request failed: ...`、`Request failed safely: CODE`），MUST NOT 渲染为 assistant answer content；若是真实 partial answer，MAY 渲染并标注"部分答案"。来源：`conversation-ui-state.md` 第 6 节"历史失败 terminal 的部分答案渲染"。

**COMPLETED（已完成 ✅）**：
```
┌─ Turn ───────────────────────────────────────────┐
│  🤖 助手 · ✅ 已完成                              │
│  # 网络诊断联调长回复                              │
│  ## 1. 摘要                                        │
│  本次诊断结论是：当前网络整体仍可用…               │
│  ## 2. 关键发现                                    │
│  | F-01 | Edge-RTR-02 | CPU 持续高于 85% | … |     │
│                                                    │
│  👍 👎 ⭐ 🔀 ↻                                    │  ← BubbleActions
└──────────────────────────────────────────────────┘
```

**FAILED（已失败 ❌）**：
```
┌─ Turn ───────────────────────────────────────────┐
│  🤖 助手 · ❌ 已失败                              │
│  失败原因：CAPABILITY_RESULT_LIMIT_EXCEEDED        │
│  类别：RESOURCE_TOO_LARGE · 可重试                │
│                                                    │
│  👍 👎 ⭐ 🔀 ↻                                    │  ← BubbleActions（含重试）
└──────────────────────────────────────────────────┘
```

**CANCELED（已取消 ⏹️）**——有部分内容 vs 无内容：

```
┌─ 有部分内容 ────────────────────────────────────┐
│  [ASSISTANT 气泡：partial answer 文本]           │  ← 流式已到达的内容
│  ⏹️ 已取消（含部分内容）                         │  ← CanceledNotice
└──────────────────────────────────────────────────┘

┌─ 无内容 ────────────────────────────────────────┐
│  ⏹️ 已取消                                       │  ← CanceledNotice only
└──────────────────────────────────────────────────┘
```

**SUPERSEDED（已被取代 🔁）**——当前无专门 UI 指示器，UCD 设计建议：

```
┌─ Turn ───────────────────────────────────────────┐
│  🤖 助手 · 🔁 已被取代                            │
│  此请求已被新请求取代                              │
│  （过程面板 summary 标签：Superseded）             │
└──────────────────────────────────────────────────┘
  ← UCD 设计建议：可添加专门的指示器（类似 CanceledNotice）
```

> ⚠️ **实现状态标注**：safe failure placeholder 检测已实现（`answerContent.ts` L102, L268-283 的 `FAILED_TERMINAL_PLACEHOLDER` 正则检测，匹配 `Request failed` / `Request failed: ...` / `Request failed safely: CODE` 等模式时跳过该事件，不渲染为 assistant answer content）。4000 字符截断在投影层 `stream-envelope.ts` 的 `previewText` 完成（`resultTextPreviewMaxChars`），前端不额外截断。长消息折叠/展开为 UCD 设计建议，前端代码中未实现。

## REQUEST_SUPERSEDED 终态

来源：`TurnBlock.tsx` L872、`processDetails.ts` L852-861。

### 当前实现

- `SUPERSEDED` 在 `TERMINAL_EVENTS` 中列为终态（L88），但**无专门 UI 指示器**（无 `CanceledNotice` 或 `FailedNotice` 等效组件）。
- 当 `status === "SUPERSEDED"` 时，`TurnBlock.tsx` 既不渲染 `CanceledNotice` 也不渲染 `FailedNotice`——直接 fall through。
- 过程面板的时间线中有 terminal 条目（`processDetails.ts` L852-861）：标题"Execution ended"、详情"Superseded by newer request"、状态标签"Superseded"。
- 过程面板的 summary 标签为 `t("turn.process.superseded")`（L1769）。

### `supersededByRequestId` 字段

- 合约中已定义（`contracts.ts` L296），但**前端未在任何 UI 组件中读取或渲染**。
- `supersededByRequestId` 不暴露给用户——用户无法从被取代的 turn 直接跳转到取代它的新 turn。

### 设计建议

- UCD 设计人员可考虑为 `SUPERSEDED` 终态添加专门的视觉指示器（类似 `CanceledNotice`），如"🔁 此请求已被新请求取代"。
- 若暴露 `supersededByRequestId`，可提供跳转到取代 turn 的链接（但需评估安全约束）。

## REQUEST_CANCELED 子情况

来源：`TurnBlock.tsx` L769-786 的 `CanceledNotice` 组件。

### 有部分内容 vs 无内容

`CanceledNotice` 组件根据 `hasAnswerContent` 布尔值渲染两种不同的消息：

| 子情况 | 条件 | `data-canceled-partial` | 文案 |
|---|---|---|---|
| 有部分内容 | `hasAnswerContent === true` | `"true"` | `t("turn.canceledWithPartialContent")`——"已取消（含部分内容）" |
| 无内容 | `hasAnswerContent === false` | `"false"` | `t("turn.canceledWithoutAnswer")`——"已取消" |

### 视觉呈现

```
┌─ 有部分内容 ────────────────────────────┐
│  [ASSISTANT 气泡：partial answer 文本]   │  ← 流式已到达的内容
│  ⏹️ 已取消（含部分内容）                  │  ← CanceledNotice
└──────────────────────────────────────────┘

┌─ 无内容 ────────────────────────────────┐
│  ⏹️ 已取消                               │  ← CanceledNotice only
└──────────────────────────────────────────┘
```

- **有部分内容**：ASSISTANT 气泡正常渲染已到达的流式内容，下方附加 CanceledNotice。
- **无内容**：仅显示 CanceledNotice，无 ASSISTANT 气泡。

### 渲染位置

`TurnBlock.tsx` L1274：`{status === "CANCELED" ? <CanceledNotice hasAnswerContent={hasAnswerContent} /> : null}`

## 重试入口

来源：`TurnBlock.tsx` L1326-1331、`MessageInput.tsx` L1531-1548、`commandCatalog.ts` 的 `/retry`。

### 三种重试入口

| 入口 | 位置 | 条件 | 触发方式 |
|---|---|---|---|
| TurnBlock 重试按钮 | ASSISTANT 气泡的 `BubbleActions` 行 | `showRetry`（`showLatestTurnActions`，即 `isLatest && !turnActionsDisabled`）。⚠️ 代码未检查 `status === "FAILED"`，COMPLETED/CANCELED/SUPERSEDED turn 也会显示重试按钮 | 点击 `RedoOutlined` 按钮（`btn-retry-ai`） |
| Composer 重试按钮 | 输入区底部按钮行 | `showRetryLatestButton && onRetryLatest` | 点击 `RedoOutlined` 按钮（`btn-retry-latest`） |
| Slash 命令 | 输入区 | `hasRetryTarget && !isExecuting && hasWritePermission` | 输入 `/retry` + Enter |

### 启用条件

- **仅最新 turn**：`showLatestTurnActions` 要求 `isLatest && !turnActionsDisabled`。
- **⚠️ 未检查 FAILED 终态**：TurnBlock 重试按钮的 `showRetry` 值为 `showLatestTurnActions`，未检查 `status === "FAILED"`。COMPLETED/CANCELED/SUPERSEDED turn 也会显示重试按钮。Composer 重试按钮（`useChatComposerController.ts` L146）则正确检查了 `latestTurnBlock?.status === "FAILED"`。
- **非执行中**：`!isExecuting`——当前无运行中的请求。
- **Write 权限**：所有重试入口都通过 `AuthGate` 门控 `AICOServiceOperation.Write`。

### 重试行为

- 调用 `onRetry(rootMessageId)` → 创建新的 request 取代失败的 request。
- 旧 turn 保留（不删除），新 turn 追加到对话区。

## 派生（Fork）

来源：`TurnBlock.tsx` L76-79、L531-549、L904-914；`ChatPage.tsx` L1597-1629。

### 触发方式

- ASSISTANT 气泡的 `BubbleActions` 行中 `ForkOutlined` 按钮（`btn-fork-ai`）。
- 通过 `AuthGate` 门控 `AICOServiceOperation.Write`。

### 启用条件（`canForkAssistant`）

- `onFork` 回调存在。
- `sessionId` 存在。
- `forkAnchor` 存在（见下方派生规则）。
- `hasAnswerContent`——ASSISTANT 气泡有内容（不能从空 turn 派生）。

#### `forkAnchor` 派生规则（`TurnBlock.tsx` L925-936）

| 消息形态 | forkAnchor | 说明 |
|---|---|---|
| durable 已完成 ASSISTANT 消息 | message anchor（messageId） | 走 message-route |
| live-completed（`status=COMPLETED`） | request anchor（requestId） | 走 request-route |
| in-flight / failed / canceled / superseded | `undefined` | 按钮不显示 |

**注意**：可派生的"终态"仅指 `COMPLETED`。failed / canceled / superseded 虽是终态但**不可派生**（forkAnchor 为 undefined）。

### 派生流程

1. 用户点击 fork 按钮 → 调用 `onFork(forkAnchor)`。
2. `ChatPage.tsx` 的 `handleFork` 根据 `forkAnchor` 类型自动选用 API：
   - message anchor → `sessionService.forkSessionFromMessage(messageId)`
   - request anchor → `sessionService.forkSessionFromRequest(requestId)`

   路由选择由前端根据消息形态自动决定，用户感知一致（入口始终是一个 fork 按钮）。
3. 创建新会话。分叉点之前的 Message history 与 durable Event snapshot 成为子会话自有的只读历史事实；不复制 active run、timeline tail、checkpoint 或 pending input lifecycle。
4. 成功 → 导航到新会话。用户可展开分叉点之前的过程面板查看 completed thinking 与 capability history；legacy 数据没有 Event snapshot 时显示安全不可用状态，不伪造详情。

### 加载态与失败态

- **加载态**：`handleFork` 通过 `forkingAnchorKey` 记录正在派生的 anchor，对应按钮进入 busy 态，避免重复点击。
- **失败态**：统一 error toast（`antdMessage.error`，文案 `requestNotices.forkFailed` = "派生会话失败，请稍后重试。"），不区分来源会话不存在 / 网络失败 / 权限不足等分支（design D8：no source-specific failure branch）。失败时保留原会话，不导航。

### 派生来源指示（fork notice banner）

派生创建的子会话顶部显示 fork notice banner（`ChatPage.tsx` L1769-1803）。banner 样式为居中、tertiary 色、12px，结构为 `[prefix] [title link] [suffix]`。

#### 显示规则

| 条件 | 说明 | 来源 |
|---|---|---|
| 当前会话是派生创建的子会话 | fork notice 由 conversation bootstrap 投影 | spec L134-170 |
| 用户尚未在该派生点之后发送消息 | 子会话中无 user stream envelope 在 live layer | `ChatPage.tsx` L782-785 |
| 当前是 default/latest read | 非 preview / 非 explicit read | spec L134-170 |

三者同时满足时显示 banner；任一不满足则隐藏。

#### 消除时机

用户在子会话中**首次发送消息**后，live layer 出现 user stream envelope，`activeForkNotice` 被置空，banner 消失。`clearForkNotice` / `clearConversation` 也会清除（`conversationStore.ts` L1650、L1660）。

#### 标题为快照

banner 中的来源会话标题是派生时刻的**快照**，非动态绑定——来源会话后续改名不影响已显示的 banner。

#### 仅标题可点击

banner 整句不可点，**仅来源会话标题是 `<a>` 链接**（design D8）。点击标题打开来源会话。前缀/后缀文案为纯文本。

## 标注反馈（Annotation）

来源：`TurnBlock.tsx` L70-73、L489-530、L937-939；`annotationService.ts`。

### 数据模型

`AnnotationState`（L70-73）：
- `sentiment: "UP" | "DOWN" | null`——点赞/踩。
- `isFavorited: boolean`——是否收藏。

### 三个操作按钮

| 按钮 | 图标 | testid | 行为 |
|---|---|---|---|
| 点赞 | `LikeOutlined`/`LikeFilled` | `annotation-like` | 切换 `sentiment` 为 `"UP"`（再点取消） |
| 踩 | `DislikeOutlined`/`DislikeFilled` | `annotation-dislike` | 切换 `sentiment` 为 `"DOWN"`（再点取消） |
| 收藏 | `StarOutlined`/`StarFilled` | `annotation-favorite` | 切换 `isFavorited` |

- 点赞和踩互斥：点踩时若已点赞，先取消点赞，反之亦然。

### 启用条件（`canShowAnnotations`）

- terminal status（`COMPLETED`/`FAILED`/`CANCELED`/`SUPERSEDED`）——终态后才可标注。
- `hasAnswerContent`——ASSISTANT 气泡有内容。
- `sessionId` 和 `runId` 存在。
- 通过 `AuthGate` 门控 `AICOServiceOperation.Write`。

### 乐观更新 + 失败回滚

1. 用户点击 → 立即更新 UI（乐观）。
2. 后台调用 `annotationService.upsertAnnotation()`（`POST /api/v1/sessions/{sessionId}/runs/{runId}/annotations`）。
3. 失败时回滚到之前状态（L919-938）。

### API

- `upsertAnnotation`：POST `/api/v1/sessions/{sessionId}/runs/{runId}/annotations`，body 含 `sentiment` 和 `isFavorited`。
- `listSessionAnnotations`：GET `/api/v1/sessions/{sessionId}/annotations`——加载已有标注。
- `listFavoriteSessions`：GET `/api/v1/favorites`——尽管 service 方法保留 legacy 名称，当前数据语义是收藏的 turn/request-run 条目，不是 session-level favorite truth。若产品需要“收藏会话”，须另行定义聚合或持久化契约。

## 流式打字机效果

来源：`TurnBlock.tsx` L85-87、L152-163、L165-232、L1003-1016。

### 启用条件（`shouldTypewriteAnswer`）

- `hasAnswerContent`——有内容可打字。
- `isStreaming`——当前正在流式接收。
- `!prefersReducedMotion`——用户未启用减少动画偏好。
- live-streamed answer events——答案来自实时流（非历史重建）。

### 参数

| 参数 | 值 | 说明 |
|---|---|---|
| `TYPEWRITER_TICK_MS` | 32ms | 每帧间隔 |
| `TYPEWRITER_INITIAL_VISIBLE_CHARS` | 120 | 初始立即可见字符数（避免开头空白） |
| `TYPEWRITER_MAX_LIVE_STEP` | 96 | 单帧最大推进字符数 |

### 自适应步长（`resolveTypewriterStep`）

根据 backlog（待显示字符数）动态调整每帧推进速度：

| backlog | step（字符/帧） | 效果 |
|---|---|---|
| ≤ 80 | 8 | 接近实时，慢速追赶 |
| 81-250 | 24 | 中速追赶 |
| 251-1000 | 48 | 快速追赶 |
| > 1000 | 96 | 最大步长，避免落后过多 |

### Markdown 渐进渲染

- 可见内容通过 `splitProgressiveMarkdownContent` 拆分为 markdown prefix + live tail。
- prefix 部分（已完成的 markdown 块）正常渲染。
- tail 部分（可能不完整的 markdown）以流式样式渲染。

### 流式空闲动画

- 当 live stream idle（无新内容到达）时，应用 `STREAMING_TEXT_SWEEP_CSS` 动画（来自 `MarkdownContent.tsx`）。
- 动画效果：文字背景渐变扫光，表示"正在等待更多内容"。

### `prefers-reduced-motion` 支持

- 用户启用系统级"减少动画"偏好时，禁用打字机效果。
- 内容直接全量显示（无逐字推进）。

## 问题收藏（Pin）

来源：`TurnBlock.tsx` L553-567、L1137-1149；`userQuestionService.ts`。

### 触发方式

- USER 气泡的 `BubbleActions` 行中 `FolderAddOutlined` 按钮（`btn-pin-user`）。
- tooltip：`t("turn.pinQuestion")`。
- 通过 `AuthGate` 门控 `AICOServiceOperation.Write`。

### 启用条件

- `bubble === "user"`——仅 USER 气泡有 pin 按钮。
- `onPin` 回调存在。

### Pin 行为

1. 用户点击 pin 按钮 → 调用 `handlePinQuestion`（L1137-1149）。
2. 文本截断到 2000 字符（避免超长消息存入题库）。
3. 调用 `pinQuestion({ question: truncated })`（`userQuestionService.ts`）。
4. 成功/失败显示 toast 通知。

### 用途

- 收藏的问题可在"高频问题"或"分类问题浏览"中复用（见 `06-empty-loading-error-states.md`）。
- 收藏的问题会出现在 composer 的"问题关联推荐"面板中（`source: "pinned"`，见 `composer.md`）。

## live 模式 vs history 模式

| 维度 | live 模式 | history 模式 |
|---|---|---|
| ASSISTANT 内容呈现 | 流式追加，实时可见 | 仅 final content，无流式动画 |
| terminal 指示 | 实时到达 | 重建时直接呈现 |
| `transportHints` | `[]` | `["history-load"]` |
| `timelineEventRef` | 指向 source timeline event | `null` |
| 失败 terminal partial answer | 实时可见 | 同 live（按 safe failure placeholder 规则渲染） |

> **think/answer 内容安全过滤**（`[UCD目标/Clarify]`，见 `10-implementation-gap-analysis.md` B17/B18）：`[已实现-主干]` 已有 terminal `finalContent` 正则替换，以及 REMOTE guardrail 的输入/输出整轮拦截与 `OUTPUT_GUARD_BLOCKED`；两者都不等于统一的字段级 live stream 脱敏。字段级替换、整轮阻断、deployment 配置和 live/history/share 一致性的 owner 仍需先澄清，不能直接把“dev 原文/prod 替换”当作已批准契约。

## 禁止渲染的字段

无论 live 还是 history，消息气泡 MUST NOT 渲染：raw prompt、raw model output 全文（超出 `content` 字段的部分）、tool args、raw tool result、attachment content bytes、runtime correlation ids（除 `runId`/`requestContextId`）。来源：`conversation-ui-state.md` 第 1 节"禁止渲染的字段"。

## 预览容量限制

`content`/`text` 字段单次最大 4000 字符（`resultTextPreviewMaxChars`）；超长截断并以 `...` 标记，`truncated=true`。此截断在后端投影层（`stream-envelope.ts` 的 `previewText`）完成，前端不重复执行截断，但应读取 `truncated` 标记并在截断时提示"内容已截断"并提供查看完整内容的入口（如 run-graph drawer）——此提示为 UCD 设计建议，当前前端未实现。

## 交互

### 通用交互

- 鼠标 hover：显示时间戳与 `messageId`（second-level details）。
- 点击复制：复制消息文本。
- 长消息折叠：超过阈值高度时折叠，点击展开。（UCD 设计建议，当前前端未实现。）

### ASSISTANT 气泡的 BubbleActions

终态后 ASSISTANT 气泡底部显示操作按钮行（`BubbleActions`），按钮按条件出现：

| 按钮 | 图标 | 条件 |
|---|---|---|
| 点赞 | `LikeOutlined`/`LikeFilled` | `canShowAnnotations` |
| 踩 | `DislikeOutlined`/`DislikeFilled` | `canShowAnnotations` |
| 收藏 | `StarOutlined`/`StarFilled` | `canShowAnnotations` |
| 分享 | `ShareAltOutlined` | `onShare` 存在 + AuthGate Write 权限。`shareDisabled`：有答案时 `status === "FAILED"` 禁用；无答案终态时始终禁用。支持批量选择模式（`shareSelection` 时左侧显示 checkbox） |
| 派生 | `ForkOutlined` | `canForkAssistant` |
| 重试 | `RedoOutlined` | `showRetry`（`showLatestTurnActions`，⚠️ 未检查 FAILED 终态） |

### USER 气泡的 BubbleActions

USER 气泡底部可显示操作按钮：

| 按钮 | 图标 | 条件 |
|---|---|---|
| Pin（收藏问题） | `FolderAddOutlined` | `bubble === "user" && onPin` |
| 编辑 | `EditOutlined` | `showLatestTurnActions`（`isLatest && !turnActionsDisabled`）。⚠️ 代码未显式检查 `hasEditTarget`，该条件可能在调用方过滤 |

**ASSISTANT 气泡 BubbleActions 样例**（终态后底部按钮行）：

```
┌─ ASSISTANT 气泡 · ✅ 已完成 ─────────────────────┐
│  # 网络诊断联调长回复                              │
│  ## 1. 摘要                                        │
│  本次诊断结论是…                                   │
│                                                    │
│  👍  👎  ⭐  🔀  ↻                                │
│  点赞  踩  收藏  派生  重试                        │
└──────────────────────────────────────────────────┘
  ← 点赞/踩/收藏需 canShowAnnotations
  ← 派生需 canForkAssistant（仅 COMPLETED 终态）
  ← 重试需 showRetry（仅最新 FAILED turn）
```

**USER 气泡 BubbleActions 样例**（最新 USER 消息可编辑/收藏）：

```
┌─ USER 气泡 ──────────────────────────────────────┐
│                    网络健康诊断                   │
│                          [📎 topology.json]      │
│                                                    │
│                              📌  ✎                │
│                           Pin  编辑               │
└──────────────────────────────────────────────────┘
  ← Pin 仅 USER 气泡
  ← 编辑仅最新 USER 消息 + hasEditTarget
```

> 所有操作按钮均通过 `AuthGate` 门控 `AICOServiceOperation.Write`，无 Write 权限的用户不可见或禁用。

## 视觉规范（UCD 设计人员决定）

- 气泡圆角、内边距、背景色、字号、行高：由 UCD 设计人员根据设计语言决定。
- USER 与 ASSISTANT 气泡视觉区分（颜色/对齐/头像）。
- terminal 指示器图标与颜色（成功/失败/取消/取代）。
- `SUPERSEDED` 终态的视觉指示（当前无专门指示器，UCD 设计人员可添加）。
- CanceledNotice 的两种子情况（有/无部分内容）的视觉区分。
- BubbleActions 按钮的布局、间距、hover/active 态。
- 打字机效果的节奏与空闲扫光动画的视觉表现。
- `prefers-reduced-motion` 下的降级呈现（禁用动画，直接显示全量内容）。
- Fork notice banner 的视觉样式。
- 约束：不得通过视觉差异暗示非契约字段（如不得用颜色深浅暗示 `retryable`，除非显式渲染 `retryable` 字段）；`supersededByRequestId` 未在 UI 暴露，UCD 设计人员若要展示需确认安全约束。

## 动态行为与交互响应

> 跨组件的通用模式见 `02-dynamic-behavior-and-interaction.md`。本节补充消息气泡特有行为。

### 已实现

| 行为 | 说明 | 代码位置 |
|------|------|---------|
| 打字机效果 | 32ms tick，120 初始字符，自适应步长 8/24/48/96（backlog ≤80/81-250/251-1000/>1000） | `TurnBlock.tsx` L169-236 |
| idle-sweep 扫光 | 2.5s 无新 content delta 后触发文字扫光，时长自适应（3s/3.5s/4s） | `TurnBlock.tsx` L1060, `MarkdownContent.tsx` L40-49 |
| 分析中占位符扫光 | 最新 turn 无答案 + 流式中时占位文字扫光，时长自适应 | `TurnBlock.tsx` L735-785 |
| hover 显示操作按钮（USER 气泡） | USER 气泡 hover 时显示操作按钮。⚠️ ASSISTANT 气泡操作按钮始终可见（`visible` 为 true），不受 hover 控制 | `TurnBlock.tsx` L891-892, L1255, L1354 |
| 复制反馈 | 复制成功后显示"已复制"1.5s | `TurnBlock.tsx` L1126-1158 |
| 压缩通知自动消失 | `CONTEXT_COMPACTED` 通知显示 3s 后自动隐藏 | `TurnBlock.tsx` L1088-1113 |
| Skeleton loading | 历史加载时显示 antd Skeleton active | `TurnBlock.tsx` L1195-1211 |
| action 按钮 transition | hover 时颜色过渡 160ms | `TurnBlock.tsx` L274 |
| reduced-motion | 禁用打字机和扫光，直接全量显示 | `TurnBlock.tsx` L135-154, L773-779 |
| 滚动到底部 | 答案内容/面板高度变化 + viewport 在底部时 auto-scroll | `TurnBlock.tsx` L1181-1193 |

### UCD 设计建议

| 行为 | 说明 |
|------|------|
| 气泡 appear | 新消息气泡出现时 fade-in + slide-up 200ms ease-out |
| think 条目流式视觉 | 思考条目流式追加时显示左侧色条 + 半透明背景，区分思考与最终回复 |
| 气泡 hover 视觉 | 气泡整体 hover 时背景色微变，120ms transition |
| 长消息折叠动画 | 超过阈值高度时折叠，点击展开动画 200ms |
