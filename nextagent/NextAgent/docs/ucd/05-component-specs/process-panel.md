# 组件规范：过程面板（Process Panel）

> 长期设计导航：`openspec/designs/architecture/conversation-process-history.md`。通用事件呈现另见 `conversation-ui-state.md`。当前事实以 stable OpenSpec、public contracts、当前代码和测试为准；本文档是 UCD 设计表达层，非 OpenSpec 基线，不定义契约。

> **状态基线（2026-08-13）**：Process Activity affordances 已进入 `agent-web-process-panel` 稳定规格与主干；未标状态的视觉与行为按 `[UCD目标]` 理解。任务准入以 [`docs/roadmap/ucd-capability-delivery.md`](../../roadmap/ucd-capability-delivery.md) 为准。

## 职责

过程面板是一个**容器组件**，承载单个 turn 内的执行过程条目：思考、能力调用、降级提示、上下文压缩。面板位于 USER 消息气泡与 ASSISTANT 消息气泡之间，不混入任一气泡正文。

面板**不定义**条目内部的视觉细节（think 文本格式、capability 结果预览、degradation 文案等），这些由各叶子组件规范承担。面板只定义容器级行为：折叠状态、条目排序、per-entry 展开/折叠、条目组合规则。

## 容器状态 — 3 种

| 状态 | 触发条件 | 视觉特征 |
|---|---|---|
| **expanded（展开）** | `executionDetailsPhase = running`（auto）/ `user-expanded` | 全高可滚动，所有条目可见 |
| **collapsed（折叠）** | `executionDetailsPhase = settled` 且视口在底部（auto）/ `user-collapsed` | 仅显示 summary row（终态文本 + 展开箭头），条目区域不渲染，点击可展开 |
| **absent（不存在）** | 无 run 或无过程条目 | 面板不渲染（absent 是隐式效果——代码中无显式 `absent` 状态分支，而是通过条件渲染跳过面板） |

### auto-expand/collapse 状态机

来源：`ProcessPanel.tsx` 的 `ProcessPanelMode`、`processDetails.ts` 的 `resolveExecutionDetailsPhase`。

```
                    run 开始
                       │
                       ▼
              ┌─ auto-expanded ─┐
              │  (running)       │
              └──────┬───────────┘
                     │
            run 终态 + 视口在底部
                     │
                     ▼
              ┌─ auto-collapsed ─┐
              │  (settled)        │
              └──────┬───────────┘
                     │
            新 run 开始
                     │
                     ▼
              ┌─ auto-expanded ─┐
              └─────────────────┘
```

- **running**：`runStatus = ACCEPTED / QUEUED / PLANNING / EXECUTING` → `executionDetailsPhase = running` → auto-expanded
- **entry settled**：thinking 或 capability 条目完成后默认保持展开 800ms，再自动折叠；若其后已有可见过程步骤或 assistant content，则按同一 composed presentation 立即完成视觉交接。用户手动展开覆盖自动行为。
- **panel settled**：`runStatus = COMPLETED / FAILED / CANCELED / SUPERSEDED` 后等待 150ms，再将外层过程面板切为 auto-collapsed。

> ⚠️ `ExecutionDetailsPhase` 类型定义为 `"running" | "settling" | "settled"`（3 种），但 `resolveExecutionDetailsPhase` 当前仅返回 `"running"` 和 `"settled"`，`"settling"` 未被使用（预留中间态）。

### 用户手动覆盖

| 当前 auto 状态 | 用户操作 | 新状态 | 行为 |
|---|---|---|---|
| auto-expanded | 点击折叠 | user-collapsed | 折叠，**不因 run 继续而自动展开** |
| auto-collapsed | 点击展开 | user-expanded | 展开，**不因视口在底部而自动折叠** |
| user-collapsed | 新 run 开始 | auto-expanded | 恢复 auto 行为 |
| user-expanded | 新 run 开始 | auto-expanded | 恢复 auto 行为 |

> 用户手动状态只在当前 run 存活期内有效；新 run 开始时恢复 auto 行为。

### History hydration 状态

| 状态 | 面板表现 |
|---|---|
| Message 已加载、Event 未排队 | 保持稳定 summary row，不显示 loading 文案 |
| Event 请求等待不足 300ms | 不新增 loading-only 行，避免刷新时标题闪烁 |
| Event 请求超过 300ms | 仅在展开后的内容区显示非文本 spinner；summary title 不变 |
| Event 加载成功 | 按 run/root/step identity 合并条目，不能追加重复 thinking |
| Event 加载失败 | Message 与已有过程条目保持可见，内容区提供安全重试 |
| Legacy Event unavailable | 显示终态“历史过程不可用”，不提供会造成循环请求的重试 |

### history 模式 collapsed

history 模式下面板**默认折叠**（collapsed），呈现 summary row（终态文本 + 展开箭头），与 live 完成后的折叠态一致。用户可点击展开查看已持久化的 completed thinking、capability lifecycle、degradation 和 compaction 条目。Message history 先建立回合结构，Event history 在后台渐进补齐过程条目。

## 条目类型与排序 — 7 种模板

面板内每个条目是以下 7 种之一。条目按 stream event 序列（`sequence`）时间序排列。

| # | 条目类型 | 状态 | 图标 | 内部视觉归属 |
|---|---|---|---|---|
| 1 | 💭 think | streaming（⏳） | 💭 | `message-bubble.md`（思考条目） |
| 2 | 💭 think | completed（✅） | 💭 | `message-bubble.md`（思考条目） |
| 3 | 🔧 capability | running（⏳） | 🔧 | `capability-card.md`（含 long-running 扩展态 + 可选进度状态：`safeProgress` 结构化指示器 + `text`/`content` 状态文本） |
| 4 | 🔧 capability | success（✅） | 🔧 | `capability-card.md` |
| 5 | 🔧 capability | failure（❌） | 🔧 | `capability-card.md` |
| 6 | ⚠️ degradation | — | ⚠️ | `degradation-notice.md` |
| 7 | 📦 compaction | — | 📦 | `07-content-copy.md`（压缩文案） |

### 条目排序规则

条目按 stream event 到达顺序排列。关键规则：

- **think 条目的拆分**：`flushThinking()` 在遇到非思考事件（`CAPABILITY_STARTED` / `CAPABILITY_RESULT_DELTA` / `TOOL_STRUCTURED_DELTA` 等）时关闭当前 `activeThinking` 条目并推入条目数组，下一轮 `LLM_THINKING_DELTA` 开新条目。来源：`processDetails.ts`。
- **TOOL_STRUCTURED_DELTA**：结构化工具事件（`toolEventType` 为 `TITLE` / `DETAIL` / `ANSWER` / `SUB_TITLE` / `SUB_DETAIL` / `SUB_CONCLUSION`）也会触发 `flushThinking()`，并产生独立的 tool 条目（非 thinking 条目）。其中 `ANSWER` 类型的 `TOOL_STRUCTURED_DELTA` 不创建过程面板条目，而是追加到答案内容（由 `answerContent.ts` 处理）。其他类型用于结构化工具（如 DSL/DslRenderer）的分步展示。来源：`processDetails.ts` L951/981/1273/1601。
- **多轮结构**：think → capability → think → capability → … 产生**多个独立 think 条目**，不是一条累积。每个 think 条目内部仍是累计快照 replace（`metadata.accumulated = true`）。
- **degradation / compaction**：作为独立条目追加到当前序列末尾，不嵌入其他条目内部。
- **`LLM_CONTENT_DELTA` 不进面板**：内容输出只进助手消息气泡，过程面板构建时对 `LLM_CONTENT_DELTA` 直接跳过。来源：`processDetails.ts`。
- **并行批次识别**：当多个 `CAPABILITY_STARTED` 事件携带相同的 `toolBatchSize`（≥ 2）且 `toolBatchExecutionMode = "PARALLEL"` 时，这些条目属于同一并行批次。批次内条目按 `toolBatchOrdinal` 排序。
- **当前限制**：`stream-envelope.ts` 未将批次元数据（`toolBatchExecutionMode`/`toolBatchOrdinal`/`toolBatchSize`）投影到前端流，当前前端无法识别并行批次，条目按 sequence 到达顺序排列。UCD 设计建议补充流投影（见 `10-implementation-gap-analysis.md` B10）。

> ⚠️ **思考与内容严格二分**：`LLM_THINKING_DELTA`（PLAIN_TEXT）只进过程面板，`LLM_CONTENT_DELTA`（MARKDOWN）只进助手气泡。若模型想让中途说明显示在过程面板，后端必须发 `LLM_THINKING_DELTA`。

## 展开态组合

### 基础组合 — 6 种

| 组合 | 描述 | 条目序列示例 |
|---|---|---|
| **单 think streaming** | 仅思考中，无 capability | `💭⏳` |
| **单 think + 单 capability running** | 思考完成折叠，能力执行中 | `💭✅(折叠) → 🔧⏳` |
| **单 think + 单 capability success** | 思考+能力都完成 | `💭✅(折叠) → 🔧✅(预览)` |
| **单 think + 单 capability failure** | 能力失败 | `💭✅(折叠) → 🔧❌` |
| **多 think + 多 capability（多轮）** | N think + M capability 交错 | `💭#1✅ → 🔧#1✅ → 💭#2✅ → 🔧#2✅ → 💭#3⏳` |
| **单 think + 并行多 capability（单轮并行）** | 一次思考后并发调用 N 个工具 | `💭✅(折叠) → 🔧#1⏳ + 🔧#2⏳ + 🔧#3⏳` |

> ℹ️ 第 6 种并行组合中 `+` 号表示条目几乎同时到达（同一批次），区别于 `→` 的严格先后。并行批次中的条目各自独立进入 running → settling → settled，互不阻塞。

### 可叠加元素 — 2 种

以下元素**不构成独立基础布局**，而是追加到任一基础组合末尾：

| 叠加元素 | 条目 | 来源事件 | history 可见 |
|---|---|---|---|
| 降级提示 | `⚠️` | `DEGRADATION_NOTICE` | ✅ 是（由持久化消息重建） |
| 上下文压缩 | `📦` | `CONTEXT_COMPACTED` | ✅ 是（由持久化消息重建） |

叠加示例：
- 单 think + 单 capability success + 降级：`💭✅ → 🔧✅ → ⚠️`
- 单 think + 单 capability success + 压缩：`💭✅ → 🔧✅ → 📦`
- 多轮 + 降级 + 压缩：`💭#1✅ → 🔧#1✅ → 💭#2✅ → 🔧#2✅ → ⚠️ → 📦`

### 并行徽标（UCD 设计建议）

并行批次中的每个能力卡片在 running 态显示"并行 N/M"徽标：

- **N** = 当前能力在批次中的序号（`toolBatchOrdinal`，1-indexed）
- **M** = 批次中能力总数（`toolBatchSize`）
- 徽标为小字号标签，位于卡片标题行右侧
- 徽标在能力进入终态后保留（指示该能力曾并行执行）
- history 模式不显示徽标（无 streaming 中间态）

来源：`CAPABILITY_STARTED` payload 的 `toolBatchExecutionMode`/`toolBatchOrdinal`/`toolBatchSize` 字段。

> ⚠️ 当前 `stream-envelope.ts` 未将批次字段投影到前端流，此徽标为 UCD 设计建议，需补流投影后实现（见 `10-implementation-gap-analysis.md` B10）。

## 折叠态

折叠态下，整个条目区域**不渲染**（DOM 移除），仅显示一行 summary row（摘要文本 + 展开箭头）。用户点击 summary row 才展开面板，看到各条目。

### summary row 呈现 — 4 种终态

summary row 的终态文本随 `runStatus` 变化，共 4 种：

**COMPLETED（已完成 ✅）**：
```
┌─ 📋 过程面板（auto-collapsed ▶）─────────────────┐
│  ✅ 已完成  ▶                                       │
└──────────────────────────────────────────────────┘
```

**FAILED（已失败 ❌）**：
```
┌─ 📋 过程面板（auto-collapsed ▶）─────────────────┐
│  ❌ 已失败  ▶                                       │
└──────────────────────────────────────────────────┘
```

**CANCELED（已取消 ⏹️）**：
```
┌─ 📋 过程面板（auto-collapsed ▶）─────────────────┐
│  ⏹️ 已取消  ▶                                       │
└──────────────────────────────────────────────────┘
```

**SUPERSEDED（已被取代 🔁）**：
```
┌─ 📋 过程面板（auto-collapsed ▶）─────────────────┐
│  🔁 已被取代  ▶                                     │
└──────────────────────────────────────────────────┘
```

- 摘要文本：run 终态指示（✅ 已完成 / ❌ 已失败 / ⏹️ 已取消 / 🔁 已被取代）。
- 箭头图标：折叠态 `▶`，展开态 `▼`（旋转 180°）。
- 点击 summary row 切换 expanded / collapsed。

来源：`ProcessPanel.tsx` 的 `shouldShowProcessDetails`（L173-175，collapsed 时为 false）、summary row 渲染（L531-591）。

### 折叠态设计约束

- 折叠态 MUST 足够紧凑（单行），不挤压消息气泡可读宽度。
- 折叠态 MUST NOT 渲染任何条目（think/capability/degradation/compaction 均不可见）。
- 折叠态 MUST 可点击展开为完整面板。
- summary row 显示 run 终态指示（✅/❌/⏹️/🔁）。
- **并行批次 summary row（UCD 设计建议）**：若本轮包含并行工具调用，summary row 可标注"并行执行了 N 个工具"，帮助用户快速了解执行规模。此标注需补流投影后实现（见 `10-implementation-gap-analysis.md` B10）。

## absent 态（不渲染）

当无 run 或无过程条目时，面板不渲染（DOM 不存在）。absent 是隐式效果——代码中无显式 `absent` 状态分支，而是通过条件渲染跳过面板。

**样例 1：纯文本回复（无 think、无 capability）**：

用户发送"你好"，Agent 直接回复纯文本，未触发思考事件或能力调用：

```
┌─ Turn 1 ──────────────────────────────────────────┐
│  > 🧑 用户                                        │
│  > 你好                                           │
│                                                    │
│  > 🤖 助手 · ✅ 已完成                             │
│  > 你好！有什么可以帮你的？                        │
│                                                    │
│  （过程面板 absent——无 think/capability 条目）     │
└────────────────────────────────────────────────────┘
```

**样例 2：会话初始态（无 run）**：

用户刚打开会话，尚未发送任何消息：

```
┌─ 会话窗口 ────────────────────────────────────────┐
│                                                    │
│           欢迎使用 NextAgent                       │
│           请输入您的问题…                          │
│                                                    │
│  （无 turn，无 run，过程面板 absent）               │
│                                                    │
│  ┌─ composer ──────────────────────────────────┐  │
│  │  输入消息…                              [发送]│  │
│  └──────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────┘
```

## 展开态的 per-entry 展开/折叠

面板展开后，每个条目（think/capability/degradation/compaction）**各占一行**，垂直排列。每个条目有独立的展开/折叠按钮，点击条目标题可单独切换其详情区域的显示。

```
┌─ 📋 过程面板（expanded ▼）───────────────────────┐
│  已完成  ▼                                         │
├──────────────────────────────────────────────────┤
│  💭 思考 #1 · ✅ 已完成                    ▸      │  ← 独占一行，详情折叠
│  🔧 queryAlerts · ✅ 已完成                ▸      │  ← 独占一行，详情折叠
│  💭 思考 #2 · ✅ 已完成                    ▸      │
│  🔧 queryConfig · ✅ 已完成                ▸      │
│  💭 思考 #3 · ✅ 已完成                    ▸      │
└──────────────────────────────────────────────────┘
```

点击某个条目的 `▸` 可展开该条目的详情（思考文本 / 能力结果预览），再点折叠。其他条目不受影响。

### per-entry 展开/折叠行为

| 行为 | 说明 | 来源 |
|---|---|---|
| 面板刚展开时 | 所有条目自动展开详情 | `ProcessPanel.tsx` L274-312（`justOpened` 时全部加入 `expandedProcessEntryKeys`） |
| run 进行中新增条目 | 新条目自动展开详情 | 同上（`executionDetailsPhase !== "settled"` 时） |
| settled 阶段新增条目 | 不自动展开详情 | 同上 |
| 用户点击条目标题 | 切换该条目详情的显示，其他条目不受影响 | `toggleProcessEntryExpansion`（L211-272） |
| 条目详情展开/折叠动画 | CSS grid `grid-template-rows: 0fr → 1fr` 过渡 | L671-713 |

### 三组 per-entry 状态

| 状态 Set | 用途 | 来源 |
|---|---|---|
| `expandedProcessEntryKeys` | 逻辑上是否展开 | L180 |
| `renderedProcessEntryDetailKeys` | 是否渲染详情 DOM（延迟移除等动画完成） | L181 |
| `visibleProcessEntryDetailKeys` | 详情是否可见（触发动画） | L182 |

## capability success 呈现分层

条目模板 #4（capability success）不能只按一张 `safeResult.kind` 清单计数。当前实现要区分 backend/channel 是否能投影、frontend parser 是否接受、`processDetails.ts` 是否已有专门分支，以及最终通用回退：

| kind / 结果形态 | backend / channel 投影 | 前端 parser | 专门呈现 | 当前 ProcessPanel 结果 |
|---|---|---|---|---|
| `commandOutput` | ✅ | ✅ | ✅ | exitCode + 有界输出预览 |
| `fileRead` | ✅ | ✅ | ✅ | 安全路径 + 行范围 + 内容预览 |
| `fileList` | ✅ | ✅ | ✅ | 安全路径列表 |
| `fileWrite` | ✅ | ✅ | ✅ | create/update + 安全路径 |
| `skillLoaded` | ✅ | ✅ | ✅ | 技能名 + 加载状态 |
| `todoList` | ✅ | ✅ | ✅ | 本地化 Todo 列表、状态与空态 |
| `workflowResult` | ✅ | ✅ | ✅ | recipe、状态与 answer previews |
| `httpResponse` | ⚠️ channel 不构造；history adapter 可构造 | ✅ | ❌ | `safeSummary` / 通用结果；没有 HTTP 专门卡片 |
| `toolSearch` | ✅ channel 显式投影 | ✅ | ✅ | 本地化工具清单与有界描述预览 |
| `cron` | ✅ channel 显式投影 | ✅ | ✅ | create/delete/list 本地化结构详情 |
| `clipStreamEvent` / `clipStreamCompletion` / `clipStreamResult` | ✅ agent-core 产生，channel 透传上游安全字段 | ❌ | ❌ | `safeSummary` / safe detail 通用呈现 |
| parser 未识别或 `safeResult` 缺失 | 视能力而定 | — | — | 仅显示有效安全摘要；否则只保留标题与状态，绝不渲染 raw JSON |

> 结果专门呈现由已验证的 `safeResult.kind` 分支决定，不由 `capabilityId`（工具名）直接决定；但 channel projector 可能用 capabilityId 或 provider 选择安全投影。系统内置能力和自定义 `clip_server` 的映射详情见 `capability-card.md` 的“系统内置工具与 kind 映射”章节。
>
> `[UCD目标]` `httpResponse` 与 `clipStream*` 的专门视觉必须分别补齐缺失层并形成 change；backend/channel 已投影不等于前端已交付模板。

## capability failure 子模板 — SafeError 映射

条目模板 #5（capability failure）内部按 `safeErrorCode` / `safeErrorCategory` 映射。视觉细节见 `capability-card.md`，此处仅列索引。

### safeErrorCode

| code | 用户可读文案 | 是否允许重试 |
|---|---|---|
| `CAPABILITY_PATH_REJECTED` | 路径访问被策略阻止 | 否（不升级为 run failure） |
| `COMMAND_NOT_ALLOWED` | 命令被安全策略阻止 | 否 |
| `CAPABILITY_INPUT_INVALID` / `INVALID_INPUT` | 工具输入无效 | 是（修正输入后） |
| `CAPABILITY_RESULT_LIMIT_EXCEEDED` / `RESOURCE_TOO_LARGE` | 能力结果过大 | 是（缩小范围后） |

### safeErrorCategory

| category | 卡片视觉色调 | 是否允许重试 |
|---|---|---|
| `AUTHORIZATION` / `POLICY_DENIED` | 策略阻止色调 | 否 |
| `VALIDATION` | 输入校验色调 | 是 |
| `TIMEOUT` | 超时色调 | 是 |
| `UNAVAILABLE` | 不可用色调 | 是（稍后） |
| fallback | 中性失败色调 | 视情况 |

来源：`conversation-ui-state.md` 第 5 节、`stream-envelope.ts` 的 `summarizeSafeCapabilityFailure`。

## live 模式 vs history 模式

核心原则（`[已实现-主干]`）：完成后呈现相同的持久化过程事实，仅实时过程效果不同。

| 维度 | live 模式 | history 模式 |
|---|---|---|
| 面板容器 | 渲染（expanded/collapsed） | 渲染（默认 collapsed，可展开） |
| 💭 think 条目 | 可见（streaming/completed）；同一 `stepId` 内累计 snapshot replace | 可见完成 snapshot；同一 `sessionId + runId + rootMessageId + stepId` 与 live 条目合并，不按文本去重 |
| 🔧 capability running 态（含 long-running + 进度） | 可见（计时器 + 取消 + 可选进度） | 不可见（transient streaming 状态；进度 delta 由 CAPABILITY_RESULT 消息重建，终态由 CAPABILITY_RESULT_DELTA 承载） |
| 🔧 capability 结果 | 增量投递 | 持久化 lifecycle Event 与同一 run 的 CAPABILITY_RESULT Message 合并呈现 |
| ⚠️ 降级提示 | 可见 | 可见（由持久化消息重建） |
| 📦 压缩通知 | 可见 | 可见（由持久化消息重建，`SUMMARY` 消息被过滤但压缩通知独立重建） |
| 过程动画 | running/settling/settled 动画 | 无动画，直接呈现终态 |
| 面板默认状态 | 流式过程中 auto-expanded，完成后 auto-collapsed | 默认 collapsed |

> history 模式下，过程面板的持久化内容与 live 完成后一致。history 不呈现未完成 delta、running 动画和渐进式披露；字段级安全过滤的 owner、配置与 live/history/share 一致性仍属于 B17/B18。

## 视觉模板分层

UCD 设计人员需为过程面板设计以下视觉模板：

| 层级 | 当前设计范围 | 说明 |
|---|---|---|
| 面板容器 | expanded / collapsed / absent | 容器状态复用，不随 kind 增长 |
| summary row | 折叠态单行摘要 | 终态文本 + 展开箭头 |
| 条目基础模板 | thinking、capability、degradation、compaction 及其生命周期状态 | 以状态变化设计，不按工具数量复制 |
| 条目折叠态行 | 单一复用形态 | 图标 + 标题 + 终态 + 展开箭头 |
| `[已实现]` capability success 专门呈现 | `commandOutput`、`fileRead`、`fileList`、`fileWrite`、`skillLoaded`、`todoList`、`workflowResult` | parser 与 `processDetails` 均已接通；允许按语义簇复用视觉 |
| 通用 success 回退 | `httpResponse`、`clipStream*` 及其他没有专门 formatter 的结果 | 有可信 `safeSummary` / safe detail 时按安全投影呈现；无有效受信摘要时只保留业务标题和状态，不生成“结果已返回”等占位文案。`toolSearch`、`cron` 已进入专门 formatter |
| capability failure 呈现 | SafeError code / category / fallback | 与 success kind 正交，不按工具复制 |

> 不再维护“独立模板总数”。降级/压缩是可叠加元素，多轮复用单轮条目；backend/channel projector、frontend parser 和 `processDetails` 分支各自演进，固定总数会产生错误交付口径。详见 `capability-card.md` 的“能力卡片视觉模板分层”。

## Run Graph 抽屉

> 本节描述过程面板"完整过程"按钮打开的 Run Graph 可视化。来源：`features/run-graph/` 目录的完整实现。

### 触发方式

- 过程面板 summary row 右侧的"完整过程"按钮（`ProcessPanel.tsx` L588，`onOpenFullProcess(block, target)`）。
- 点击后打开 `TurnRunGraphPanel`（懒加载，`ChatPage.tsx` L61-62）。

### 布局模式

`TurnRunGraphPanel` 有两种布局模式（`graphDetailLayout.ts` L30 的 `shouldUseGraphDrawer` 决定）：

| 模式 | 触发条件 | 布局 |
|---|---|---|
| **side-split（分栏）** | 视口宽度充足 | 对话区与 Run Graph 并排，graph 占右侧 |
| **drawer（抽屉）** | 视口宽度不足 | Run Graph 作为 Drawer 覆盖对话区 |

**side-split 布局样例**（视口宽度充足，对话区与 Run Graph 并排）：

```
┌──────────────────────────────────────────────────────────────────┐
│  [会话列表] │  对话区（收窄）         │  Run Graph（side-split）  │
│             │                         │  [Fit] [Reset]  [Close]   │
│  ● 会话 A  │  > 🧑 用户              ├────────────────────────────┤
│  ▸ 会话 B  │  > 网络健康诊断         │  ┌──────┐                  │
│             │  > 🤖 助手 · ✅         │  │request│                  │
│             │  📋 过程面板 ▶          │  └───┬──┘                  │
│             │    [完整过程] ←点击    │      ▼                     │
│             │                         │  ┌──────┐  ┌────────────┐ │
│             │                         │  │model │  │节点详情面板 │ │
│             │                         │  └───┬──┘  │            │ │
│             │                         │      ▼     │ 选中：model │ │
│             │                         │  ┌──────┐  │ 状态：✅    │ │
│             │                         │  │capab.│  │ 事件：3    │ │
│             │                         │  └──────┘  └────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

**drawer 布局样例**（视口宽度不足，Run Graph 覆盖对话区）：

```
┌──────────────────────────────────────────────────────────────────┐
│  [会话列表] │  Run Graph（drawer 覆盖对话区）                     │
│             │  [Fit] [Reset]                          [Close]     │
│  ● 会话 A  │──────────────────────────────────────────────────────│
│  ▸ 会话 B  │                                                      │
│             │   ┌──────┐                                           │
│             │   │request│                                          │
│             │   └───┬──┘                                           │
│             │       ▼                                              │
│             │   ┌──────┐     ┌────────────────┐                   │
│             │   │model │     │ 节点详情面板    │                   │
│             │   └───┬──┘     │ 选中：capability│                   │
│             │       ▼        │ 状态：✅        │                   │
│             │   ┌──────┐     │ toolCallId: c-1 │                   │
│             │   │capab.│     │ 事件：5         │                   │
│             │   └──────┘     └────────────────┘                   │
│             │                                                      │
│             │  （对话区被覆盖，关闭 drawer 后恢复）                │
└──────────────────────────────────────────────────────────────────┘
```

### 全屏布局

全屏布局展示一个包含全部 7 种节点类型的完整 Run Graph（含 userInput、degradation、terminal）：

```
┌─────────────────────────────────────────────────────────┐
│  [Fit 适配] [Reset 重置]              [Close 关闭]       │  ← header 控件
├─────────────────────────────────────────────────────────┤
│                    │                                    │
│   X6 流程图画布     │      节点详情面板                   │
│   (垂直布局)        │      (选中节点时显示)               │
│                    │                                    │
│   ┌──────────┐     │      节点标题                       │
│   │ request  │     │      状态徽章                       │
│   └────┬─────┘     │      阶段标签                       │
│        ▼           │      事件计数                       │
│   ┌──────────┐     │      指标（toolCallId / 事件数）    │
│   │  model   │     │      详情行                         │
│   └────┬─────┘     │      引用列表                       │
│        ▼           │      (eventType, sequence, time)   │
│   ┌──────────┐     │                                    │
│   │capability│     │                                    │
│   └────┬─────┘     │                                    │
│        ▼           │                                    │
│   ┌──────────┐     │                                    │
│   │userInput │     │  ← Pending input 节点               │
│   └────┬─────┘     │                                    │
│        ▼           │                                    │
│   ┌──────────┐     │                                    │
│   │  model   │     │  ← 第二轮模型思考                   │
│   └────┬─────┘     │                                    │
│        ▼           │                                    │
│   ┌──────────┐     │                                    │
│   │degradation│    │  ← 降级提示节点                     │
│   └────┬─────┘     │                                    │
│        ▼           │                                    │
│   ┌──────────┐     │                                    │
│   │  answer  │     │                                    │
│   └────┬─────┘     │                                    │
│        ▼           │                                    │
│   ┌──────────┐     │                                    │
│   │ terminal │     │  ← 终态节点（✅/❌/⏹️/🔁）           │
│   └──────────┘     │                                    │
└─────────────────────────────────────────────────────────┘
```

### 节点类型（`RunGraphNodeKind`）

来源：`types.ts` L14-21。每种节点有独立的相位颜色（`X6FlowDiagram.tsx` L43-51）。

| 节点类型 | 说明 | 颜色 |
|---|---|---|
| `request` | 请求起始 | 相位色 1 |
| `model` | 模型思考/内容生成 | 相位色 2 |
| `capability` | 能力调用 | 相位色 3 |
| `userInput` | Pending input | 相位色 4 |
| `degradation` | 降级提示 | 相位色 5 |
| `answer` | 答案内容 | 相位色 6 |
| `terminal` | 终态（完成/失败/取消/取代） | 相位色 7 |

### 节点状态（`RunGraphNodeState`）

每个节点显示状态徽章，共 5 种：

```
  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
  │  model   │   │  model   │   │  model   │   │  model   │   │  model   │
  │    ⏳    │   │    ✅    │   │    ❌    │   │    ⏹️    │   │    🔁    │
  └──────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘
   进行中          已完成          已失败          已取消          被取代
  (running)      (completed)     (failed)       (canceled)     (superseded)
```

- **⏳ 进行中**：run 尚未进入终态（ACCEPTED / QUEUED / PLANNING / EXECUTING）。
- **✅ 已完成**：run 正常完成（COMPLETED）。
- **❌ 已失败**：run 因错误终止（FAILED）。
- **⏹️ 已取消**：用户主动取消（CANCELED）。
- **🔁 被取代**：被新 run 取代（SUPERSEDED，如 fork 后原 run 被取代）。

### 画布交互

| 操作 | 控件 | 行为 |
|---|---|---|
| 适配视图 | `ExpandOutlined` 按钮（Fit） | `zoomToFit` + `centerContent` |
| 重置视图 | `CompressOutlined` 按钮（Reset） | `zoomTo(1)` + `centerContent` |
| 关闭 | Close 按钮 | 关闭 panel/drawer |
| 鼠标滚轮缩放 | 滚轮 | 缩放范围 0.6–1.35（`X6FlowDiagram.tsx` L146） |
| 拖拽平移 | 鼠标拖拽 | 画布平移 |
| 点击节点 | 鼠标点击 | 选中节点 → 详情面板更新 |

### 节点详情面板（`SelectedNodeDetail`）

选中节点后，右侧/下方详情面板显示（`TurnRunGraphPanel.tsx` L327-386）：

- **节点标题**：节点类型 + 序号。
- **状态徽章**：当前状态。
- **阶段标签**：节点所属阶段。
- **事件计数**：该节点包含的 stream event 数量。
- **指标**：`toolCallId`（capability 节点）或事件计数。
- **详情行**：节点的详细信息。
- **引用列表**：每个引用包含 `eventType`、`sequence`、`timestamp`。

### 数据来源

`buildRunGraphViewState.ts` 将 `TurnBlock` 的 AI 事件流转换为 `RunGraphViewState`（nodes、edges、activities）。每个节点对应一个或多个 stream event，边表示执行顺序。

### X6 实现

- **动态导入**：`@antv/x6` 在 `X6FlowDiagram.tsx` L131 动态导入（避免初始 bundle 过大）。
- **自定义节点**：`Shape.HTML.register` 注册 `"turn-run-graph-html-node"`（L318），HTML 节点支持复杂内容渲染。
- **节点尺寸**：292×132px，垂直间距 30px。
- **边样式**：classic 箭头标记，连接连续节点。

## 上下文压缩通知

来源：`TurnBlock.tsx` L641-668、L1077、L1305-1318；`processDetails.ts` L792-800、L1510-1527。

### 双重呈现

`CONTEXT_COMPACTED` 事件有两种 UI 呈现：

| 呈现 | 位置 | 触发 | 生命周期 |
|---|---|---|---|
| **过程面板条目** | 过程面板内 | `CONTEXT_COMPACTED` 事件到达 | 持久（随面板条目存在） |
| **瞬时通知** | ASSISTANT 气泡内/下方 | 压缩事件在最新答案之后到达 | 自动消失（timeout） |

### 过程面板条目

- `processDetails.ts` L792-800、L1510-1527 创建 `system` kind 条目。
- 标题："Context Compacted"。
- 详情：事件的 `message`/`summary` 字段。
- 图标：📦（compaction 标记）。

### 瞬时通知（`buildTransientCompactionNotice`）

- **位置**：ASSISTANT 气泡内/下方，小型居中文本（`TurnBlock.tsx` L1305-1318）。
- **触发条件**：压缩事件在最新答案内容之后到达（`TurnBlock.tsx` L641-668）。
- **自动消失**：通过 timeout 自动移除（L1077），约 3 秒。
- **视觉**：小型居中文本，不抢占答案区注意力。

```
┌─ ASSISTANT 气泡 ──────────────────────────┐
│  [答案内容...]                            │
│                                            │
│        📦 上下文已压缩                     │  ← 瞬时通知，3 秒后消失
└────────────────────────────────────────────┘
```

### live vs history

`CONTEXT_COMPACTED` 在 history 模式由持久化消息重建，过程面板条目在 history 可见。瞬时通知（`buildTransientCompactionNotice`）是 live-only 的——它依赖实时事件到达触发，history 不重建瞬时通知。但过程面板中的压缩条目在 history 可见（默认折叠，可展开）。来源：`conversation-ui-state.md` 第 6 节。

> 压缩是可选元素，非每次对话必然出现。仅当上下文窗口接近限制时触发。mock server 正常路径为测试覆盖每次发送压缩事件，不代表真实后端行为。

## 动态行为与交互响应

> 跨组件的通用模式见 `02-dynamic-behavior-and-interaction.md`。本节补充过程面板特有行为。

### 已实现

| 行为 | 说明 | 代码位置 |
|------|------|---------|
| 面板级过渡 | height + opacity + padding-top，200ms transition | `ProcessPanel.tsx` L607-619 |
| 条目级过渡 | `grid-template-rows: 0fr → 1fr` + opacity + margin-top，200ms transition | `ProcessPanel.tsx` L700-707 |
| 新条目 auto-expand | running 阶段新条目自动展开详情 | `ProcessPanel.tsx` L276-314 |
| 面板刚展开时全展开 | `justOpened` 时所有条目加入 expanded set | `ProcessPanel.tsx` L283-289 |
| idle-sweep 扫光 | active entry 2.5s 无新序列后触发，4s 循环。扫光作用于条目展开详情区域内的 `entry.summary` 文本（非 `entry.title` 标题行），条目折叠时不可见 | `ProcessPanel.tsx` L83-110, L634-638, L710 |
| 折叠箭头旋转 | `transform: rotate(180deg)`，200ms transition | `ProcessPanel.tsx` L577, L678 |
| 滚动锚定补偿 | 面板高度变化导致内容偏移时 `onRequestAnchorCompensation` | `ProcessPanel.tsx` L199-211 |
| 面板 auto-collapse | settled 时 150ms 延迟后折叠。⚠️ 代码在 `isTerminal` 为 true 时即使视口不在底部也触发折叠（通过锚定补偿保持视觉位置），而非保持展开 | `ProcessPanel.tsx` L377-414 |
| phase 转换 auto-expand | `executionDetailsPhase` 从 settled 变为 running 时自动展开 | `ProcessPanel.tsx` L369-375 |
| 自然高度模式 | 面板可见且不在过渡中且有条目详情渲染时，使用 `height: auto` + `overflow: visible`，而非固定高度 | `ProcessPanel.tsx` L185 |
| 图标系统 | 5 种 SVG 图标（think/skill/process-complete/final-complete/circle），区分 dark/light 主题。最后一个条目若为 process-complete 且有答案内容则替换为 final-complete 图标 | `ProcessPanel.tsx` L11-25, L640-642 |
| 条目间垂直连接线 | 非最后条目下方渲染 1px 宽垂直连接线（`var(--color-border)`） | `ProcessPanel.tsx` L687-689 |
| Expand Panel 集成 | 条目有 `hasExpandPanel` + `expandPanelData` 时，点击标题不展开/折叠详情，而是打开 Expand Panel | `ProcessPanel.tsx` L517-524, L648-651 |
| 面板高度测量上报 | 通过 `ResizeObserver` 持续测量面板内容高度，经 `onPanelHeightChange` 回调上报 | `ProcessPanel.tsx` L416-435 |

### 动态行为状态

| 行为 | 说明 |
|------|------|
| per-entry disclosure | `[已实现-主干]` active entry 自动展开；完成/后续公开文字到达时无延迟视觉交接；用户手动选择在当前 run 内优先 |
| running 条目提示 | `[已实现-主干]` 固定节点使用主题感知活动视觉与 shimmer 文本；reduced-motion 使用静态退化 |
| 新条目进入反馈 | `[已实现-主干]` 首次 live committed render 使用一次性 200ms/4px 进入反馈；history、rerender、detail 更新和重开不重放 |
| active 条目视口跟随 | `[已实现-主干]` 把 active key/sequence 接入共享 bottom-following viewport owner；不调用 `scrollIntoView`，不创建第二 viewport controller |
| summary row hover | hover 时背景色变化 + cursor pointer，120ms transition |

> Process Activity 已整体交付。后续视觉调整必须保持共享 disclosure/viewport owner、三宿主一致和 reduced-motion 结果，不得恢复独立 `scrollIntoView` 或第二套活动状态机。

## 导航

### 面板 → 叶子组件

| 本文档章节 | 下钻目标 | 文档 |
|---|---|---|
| 条目模板 #1/#2（think） | think 条目内部视觉（PLAIN_TEXT 格式、累计 replace、折叠行为） | `message-bubble.md`（思考条目） |
| 条目模板 #3/#4/#5（capability） | 能力卡片内部视觉（参数表、10 kind 结果预览、SafeError 失败卡片） | `capability-card.md` |
| 条目模板 #6（degradation） | 降级提示内部视觉 | `degradation-notice.md` |
| 条目模板 #7（compaction） | 压缩通知文案 | `07-content-copy.md` |

### 面板 → 全屏上下文

| 关注点 | 文档 |
|---|---|
| 面板在全屏 UI 中的位置 | `03-full-ui-layout.md` 第 1/2/3 节 |
| 面板作为对话区一个区域 | `04-information-architecture.md` |
| 面板在交互时序中的演变 | `03-full-ui-layout.md` 第 3/4 节 |
| 面板的场景样例渲染 | `08-sample-scenarios.md`（各场景的过程面板阶段） |

### 面板 → 契约

| 关注点 | 文档 |
|---|---|
| 23 种 channel contract event；22 种 canonical timeline projection + `OUTPUT_GUARD_BLOCKED` guard relay 例外 | `11-ux-limits-and-constraints.md` 第 6 节；`conversation-ui-state.md` 的旧数量已登记治理刷新 |
| auto-expand/collapse 状态机 | `ProcessPanel.tsx`、`processDetails.ts` |
| Live vs History 状态分叉 | `conversation-ui-state.md` 第 6 节 |
| SafeError code/category 映射 | `conversation-ui-state.md` 第 5 节 |

## 视觉细节说明

- 本文 ASCII 图标（💭🔧⚠️📦✅❌⏳⏹️🔁）是**语义标记**，不是最终视觉样式。实际图标样式由 UCD 设计人员决定。
- `✅` / `❌` / `⏳` / `⏹️` / `🔁` 表示条目终态/失败/进行中/已取消/被取代，可用颜色辅助区分（如绿/红/蓝/灰/橙）。
- 能力条目的 `🔧` 图标可按稳定业务语义聚类（如文件、命令、编排、流式、通用），而不按会漂移的 kind 总数逐一绑定；见 `capability-card.md` 的“kind 图标设计建议”章节。展开态多能力条目并列时，图标簇差异有助于快速扫描。
- 展开态每个条目独占一行，条目标题行的排版规则（图标、标题、终态指示、展开箭头的间距与对齐）需要 UCD 设计人员定义。
- 面板容器不混入消息气泡正文；面板内条目也不混入消息气泡。
