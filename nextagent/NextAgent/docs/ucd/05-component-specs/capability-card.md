# 组件规范：能力卡片（Capability Card）

> 长期设计导航：`openspec/designs/architecture/conversation-ui-state.md` 第 1、2、5、6 节；当前事实以 stable OpenSpec、最新 `origin/main` 的 channel 投影、前端 `SafeCapabilityResult` parser、`processDetails.ts` 和测试为准。本文档是 UCD 设计表达层，非 OpenSpec 基线，不定义契约。

## 职责

渲染一次能力调用的生命周期与结果。能力卡片是用户观察 Agent 执行过程的核心组件。

## 状态机

```
┌──────────┐   CAPABILITY_RESULT_DELTA   ┌──────────┐   CAPABILITY_COMPLETED   ┌──────────┐
│ running  │ ──────────────────────────▶ │ result   │ ───────────────────────▶ │ terminal │
│ (STARTED)│                              │ (RESULT_  │                           │(COMPLETED)│
└──────────┘                              │  DELTA)  │                           └──────────┘
     │                                    └──────────┘
     │ CAPABILITY_RESULT_DELTA (failure)
     ▼
┌──────────┐
│ failed   │  safeErrorCode/safeErrorCategory 驱动失败卡片
│(RESULT_  │
│  DELTA)  │
└──────────┘
```

### 长时运行扩展

> ⚠️ **实现状态标注**：long-running 扩展态（计时器、取消入口、"此能力可能需要较长时间完成"提示、进度状态、转后台 CTA、Fork 继续 CTA）为 UCD 设计建议。当前 `processDetails.ts` 中无计时器逻辑、无超时检测、无 long-running 状态分支、无进度渲染、无 CTA。进度状态需工作流节点发射 `NODE_OUTPUT_DELTA` 及 `safeProgress` 投影支持。以下描述是面向 UCD 设计人员的设计目标，非当前代码实现。

工作流（Workflow）引擎的长时轮询节点（`is_long_api`）和批量节点（batch）可能执行数分钟。在此期间**无中间 stream event**——只有 `CAPABILITY_STARTED` 和 `CAPABILITY_COMPLETED` 可见，中间无 `CAPABILITY_RESULT_DELTA`。

#### 三选择分流框架

> 对应 `openspec/designs/architecture/conversation-ui-state.md` "任务输出与上下文解耦原则"章节、`02-dynamic-behavior-and-interaction.md` 第 1.7 节。

长时任务执行中，能力卡片在 long-running 态展示**三个 CTA**，让用户根据"输出是否需要参与后续上下文"选择处理方式。CTA 可见性受工具声明的 `outputContextMode` 调控。

**三个选择**：

| 选择 | 触发 CTA | 输出与上下文关系 | 用户继续对话位置 | 原会话状态 |
|---|---|---|---|---|
| **1. 等待**（默认） | 无 CTA（继续等） | ✅ 输出进入当前会话 active context | 当前会话 | 阻塞，等任务完成 |
| **2. 转后台** | "转后台" CTA | ❌ 输出不进 active context，存到监控面板 | 当前会话继续 | 不阻塞，任务在后台跑 |
| **3. Fork 继续** | "在新分支继续 →" CTA | ✅ 输出进入**原会话** active context（任务完成后） | **新派生会话**继续 | 原会话继续等任务完成 |

**CTA 可见性规则**（受 `outputContextMode` 调控）：

| `outputContextMode` | 含义 | 转后台 CTA | Fork 继续 CTA | 典型工具 |
|---|---|---|---|---|
| `required` | 输出必须进 context | ❌ 隐藏（输出不能脱离 context） | ✅ 显示 | 网络诊断、配置审计、复杂分析 |
| `decoupled` | 输出可不进 context | ✅ 显示 | ❌ 隐藏（输出不进 context，fork 无意义） | dev server、build、log watch、批量采集 |
| `user-choice`（默认） | 用户决定 | ✅ 显示 | ✅ 显示 | 通用工具 |

**`cancellable` 字段**：工具可选实现 `cancel()` 接口。未实现时"取消执行"按钮 disabled 并 tooltip "此任务不支持取消"。`cancellable` 与三个选择正交——任何选择下都可提供取消。

**与 backgroundHandle 后台分离执行的关系**：

- **backgroundHandle（已实现，仅 Bash）**：工具调用发起时即声明 `background: true`，能力调用立即返回 `backgroundHandle`，turn 不阻塞，**跳过 inline-running 态直接进入 backgrounded 态**——等价于发起时即选择 2
- **转后台 CTA（UCD 设计建议）**：任务已进入 inline-running 态后，用户中途选择 2——卡片转为"已转后台"标记态，`⚡` 面板新增条目

两者都是选择 2 的实例，区别仅在触发时机（发起时 vs 运行中）。转后台后输出均**不进 active context**。

来源：`packages/agent-workflow/src/nodes/capability-nodes.ts` L44-237（长时轮询和批量执行不发射 `NODE_OUTPUT_DELTA`）；`WorkflowRuntimeEventProjector` 将工作流事件翻译为标准 stream 事件，但轮询/批量中间无事件可翻译。

```
┌──────────┐     超过阈值（如 10s）      ┌──────────────┐   CAPABILITY_COMPLETED   ┌──────────┐
│ running  │ ──────────────────────────▶ │ long-running │ ───────────────────────▶ │ terminal │
│ (STARTED)│                              │ (可选进度delta)│                          │(COMPLETED)│
└──────────┘                              └──────────────┘                           └──────────┘
```

## 生命周期阶段

### running（对应 `CAPABILITY_STARTED`）

- 显示 `capabilityId`、`status`。
- 可选展开查看 `toolCallId`（second-level details）。
- live 模式：running/settled 动画（`ProcessPanel` 的 `executionDetailsPhase`；`settling` 在类型中定义但 `resolveExecutionDetailsPhase` 当前未使用）。
- history 模式：不显示 running 态（`CAPABILITY_STARTED` 不重建），直接呈现终态。
- **并行徽标（UCD 设计建议）**：当 `toolBatchExecutionMode = "PARALLEL"` 时，running 态显示"并行 N/M"徽标（N = `toolBatchOrdinal`，M = `toolBatchSize`）。徽标为小字号标签，位于卡片标题行右侧。徽标在能力进入终态后保留（指示该能力曾并行执行）。history 模式不显示徽标。
  - 来源：`CAPABILITY_STARTED` payload 的 `toolBatchExecutionMode`/`toolBatchOrdinal`/`toolBatchSize` 字段。
  - > ⚠️ 当前 `stream-envelope.ts` 未投影批次字段到前端流，此徽标为 UCD 设计建议，需补流投影后实现（见 `10-implementation-gap-analysis.md` B10）。

### long-running（running 的扩展态）

当能力执行超过一定时间（建议 10 秒，UCD 设计人员可调整）且未收到任何 `CAPABILITY_RESULT_DELTA` 时，能力卡片进入 long-running 态：

| 维度 | running（短时） | long-running（长时） |
|---|---|---|
| 视觉指示 | ⏳ 执行中动画 | ⏳ 执行中 + **已用时 N 秒**计时器 |
| 进度信息 | 无 | 可选：文本状态（`text`/`content`）+ `safeProgress`（若工作流节点发射） |
| 用户预期 | 即将完成 | 可能需要等待较长时间 |
| 取消入口 | 可选 | **建议提供**（允许用户取消长时任务） |
| 转后台 CTA | 不显示 | 受 `outputContextMode` 调控（见三选择分流框架） |
| Fork 继续 CTA | 不显示 | 受 `outputContextMode` 调控（见三选择分流框架） |
| 动画建议 | 脉冲/旋转 | 持续旋转 + 计时器，避免"卡住"错觉 |

**long-running 态的渲染建议**（含三选择 CTA，以 `outputContextMode=user-choice` 为例）：

```
┌─ 🔧 networkDiagnostic · ⏳ 执行中（已 45 秒）─────┐
│                                                    │
│  能力 ID：networkDiagnostic                        │
│  状态：执行中                                      │
│  已用时：45 秒                                     │
│                                                    │
│  ℹ️ 此能力可能需要较长时间完成                      │
│                                                    │
│  💡 想同时处理其他事？                              │
│     [转后台] [在新分支继续 →]                      │
│                                                    │
│                              [取消执行]            │
└────────────────────────────────────────────────────┘
```

> CTA 可见性受 `outputContextMode` 调控：`required` 仅显示 Fork 继续；`decoupled` 仅显示转后台；`user-choice` 两者都显示。`cancellable=false` 时"取消执行"按钮 disabled。

**进度状态渲染**（当工作流节点发射进度 delta 时）：

工作流节点可通过 `emitOutputDelta` 发射进度文本（投影为 `CAPABILITY_RESULT_DELTA` 的 `text`/`content` 字段），并在 payload 中投影 `safeProgress: { current, total, label? }` 结构化字段。两种渲染形态：

有 `safeProgress` 时（结构化进度 + 文本状态）：
```
┌─ 🔧 configAudit · ⏳ 执行中（已 45 秒）──────────────────┐
│                                                          │
│  能力 ID：configAudit                                    │
│  状态：执行中                                            │
│  已用时：45 秒                                           │
│                                                          │
│  📊 进度：23/50 台设备                                   │  ← safeProgress
│  ℹ️ 已处理 23 台，失败 0 台                              │  ← text/content
│                                                          │
│  ℹ️ 此能力可能需要较长时间完成                            │
│                                                          │
│                              [取消执行]                  │
└──────────────────────────────────────────────────────────┘
```

仅文本状态（无 `safeProgress`）：
```
┌─ 🔧 networkDiagnostic · ⏳ 执行中（已 45 秒）─────────────┐
│                                                          │
│  能力 ID：networkDiagnostic                              │
│  状态：执行中                                            │
│  已用时：45 秒                                           │
│                                                          │
│  ℹ️ 第 2 次轮询，已获取 2 个结果                         │  ← text/content
│                                                          │
│  ℹ️ 此能力可能需要较长时间完成                            │
│                                                          │
│                              [取消执行]                  │
└──────────────────────────────────────────────────────────┘
```

不发射进度 delta 时：回退到纯计时器 + "此能力可能需要较长时间完成"提示（即上方 long-running 态渲染建议）。

**约束**：
- 计时器从 `CAPABILITY_STARTED` 的 `createdAt` 开始计算，非客户端本地计时。
- MUST NOT 显示预估剩余时间（后端不提供此信息）。
- 工作流节点**应通过 `emitOutputDelta` 发射进度文本**，经投影为 `CAPABILITY_RESULT_DELTA` 到达前端——当前轮询/批量节点未发射，设计建议在执行循环中添加。
- 有 `safeProgress` 时 MAY 显示 current/total 或百分比；无 `safeProgress` 时 MUST NOT 显示百分比（无数据来源）。
- 进度 delta 是累积的——每个 `CAPABILITY_RESULT_DELTA` 携带当前完整进度状态（如 `{ current: 23, total: 50 }`），非增量。
- 进度是可选的——不发射进度的能力仅显示计时器。
- long-running 态是 running 态的视觉扩展，不改变状态机——仍等待 `CAPABILITY_RESULT_DELTA` 或 `CAPABILITY_COMPLETED`。
- history 模式：long-running 态不可见（`CAPABILITY_STARTED` 不重建）。

> **工作流进度当前不可见的原因及设计建议**：工作流引擎的 `NODE_OUTPUT_DELTA` 事件被 `WorkflowRuntimeEventProjector`（`packages/agent-core/src/agent/workflow-runtime-event-projector.ts`）翻译为标准 stream 事件（`LLM_CONTENT_DELTA`/`LLM_THINKING_DELTA`/`CAPABILITY_RESULT_DELTA`）。但长时轮询和批量节点**当前不发射** `NODE_OUTPUT_DELTA`，因此翻译层无事件可翻译，前端在轮询/批量期间无任何进度更新。**设计建议**：在工作流节点执行循环中调用 `context.emitOutputDelta()` 发射进度文本，并在 `CAPABILITY_RESULT_DELTA` payload 中投影 `safeProgress: { current, total, label? }` 结构化字段。工作流引擎内部已有进度数据（批量 `index`/`config.items.length`、长轮询 `attempt`/`pollMaxTimes`、循环 `iteration`/`effectiveMax`），仅需通过 `emitOutputDelta` 对外发射。

#### fork-to-continue 引导 CTA（选择 3）

> ⚠️ **实现状态标注**：本引导为 UCD 设计建议。当前能力卡片无 fork CTA、无 long-running 态检测、无自动 anchor 选择逻辑。依赖 long-running 扩展态（计时器/阈值检测）落地后实现。

**场景**：长时任务执行中，用户不愿等待且任务输出**需要参与后续上下文**（`outputContextMode=required` 或 `user-choice` 且用户判断输出需进 context），希望从**上一轮已完成对话的答案处** fork 新会话继续对话。原会话继续等待任务完成，输出仍进入原会话 active context。

> **与转后台 CTA（选择 2）的区别**：转后台适用于输出**不需要**进 context 的场景（`outputContextMode=decoupled` 或 `user-choice` 且用户判断输出不需进 context）——任务移到 `⚡` 监控面板，输出存独立存储不进 context，用户在当前会话继续。Fork 继续适用于输出**需要**进 context 的场景——输出仍进入原会话 context，用户在新会话继续。两者由 `outputContextMode` 调控可见性，互斥呈现（`required` 仅 Fork；`decoupled` 仅转后台；`user-choice` 两者都显示由用户选）。

> **与 backgroundHandle 后台分离执行的区别**：本引导 CTA 针对的是**能力调用本身长时未返回**（阻塞 turn，`CAPABILITY_STARTED` 后无 `CAPABILITY_RESULT_DELTA`，结果将进入上下文）。后台分离执行（当前实例：Bash `run_in_background: true`）的场景不同——能力调用已返回 `backgroundHandle`、turn 已完成、结果不进入上下文、后台进程独立运行，不阻塞对话，因此不显示 fork CTA，改由 capability-card 终态卡片的**后台任务追踪区**（见上方 commandOutput + backgroundHandle 扩展）承载观测和终止。

**位置**：long-running 能力卡片底部，"取消执行"按钮左侧。

**时机**：能力卡片进入 long-running 态（超过阈值且无 `CAPABILITY_RESULT_DELTA`）时出现；进入终态或被取消时消失。

**可见性约束**：仅当 `outputContextMode` 为 `required` 或 `user-choice` 时显示；`decoupled` 时隐藏（输出不进 context，fork 无意义）。

**样式**：tertiary 色，12px，💡 图标，与"取消执行"按钮同行或其上方一行。

```
┌─ 🔧 configAudit · ⏳ 执行中（已 45 秒）──────────┐
│                                                    │
│  能力 ID：configAudit                              │
│  已用时：45 秒                                     │
│                                                    │
│  ℹ️ 此能力可能需要较长时间完成                      │
│                                                    │
│  💡 想同时处理其他事？基于已有对话开个新分支         │
│     [在新分支继续 →]                               │
│                                                    │
│                          [取消执行]                │
└────────────────────────────────────────────────────┘
```

**文案规范**：
- 标题："想同时处理其他事？"（提问式，非命令）
- 说明："基于已有对话开个新分支"（强调携带历史，非空白会话）
- 动作："[在新分支继续 →]"
- 用"新分支"而非"新会话"——强调连续性，降低"从零开始"误解

**行为**：点击 → Popconfirm "将派生新会话继续对话，原会话继续等待任务完成？" → 确认后触发智能 fork（见下方 anchor 选择规则）→ 导航到子会话 → 聚焦子会话 composer，用户可直接输入新任务。**原会话不被关闭**，任务继续执行，输出仍进入原会话 active context；用户可切回原会话查看完整结果。

**智能 fork anchor 选择**（用户不感知 fork 机制）：

| 边界情况 | 处理 |
|---|---|
| 长时任务前有多个 COMPLETED turn | 选最近的（携带最完整历史） |
| 长时任务前无 COMPLETED turn（首轮即长时） | **不显示引导 CTA**——子会话无历史可携带，fork 无意义 |
| 前面有 SUPERSEDED turn | 跳过 SUPERSEDED，找最近 COMPLETED |

**与 supersede 的关系**：本引导是**建议非强制**。用户仍可直接在 composer 发送消息（触发 supersede，终止长时任务）。引导只提供替代方案，不阻断 supersede 通道。composer 侧的配套引导见 `composer.md`"长时任务执行中的 fork 引导"。

**契约引用**：fork 资格与流程见 `message-bubble.md`"派生（Fork）"章节；fork notice 见 `message-bubble.md`"派生来源指示"；三选择分流框架见 `02-dynamic-behavior-and-interaction.md` 第 1.7 节与 `openspec/designs/architecture/conversation-ui-state.md` "任务输出与上下文解耦原则"章节。

### result（对应 `CAPABILITY_RESULT_DELTA`）

- 渲染 `safeResult`（按 kind 分支，见下文）、`safeSummary`、`text`/`content`（safe detail text）。
- 失败时渲染 `safeErrorCode`/`safeErrorCategory` 驱动的失败卡片（见 `degradation-notice.md` 与第 5 节）。
- live 模式：增量更新（`metadata.accumulated=true`）。
- history 模式：由 `CAPABILITY_RESULT` 消息重建，`safeResult`/`safeSummary` 复用相同渲染路径，但 MUST NOT 复制 raw message content 到 `text`/`content`。

### terminal（对应 `CAPABILITY_COMPLETED`）

- 终态指示，可能携带 failure 投影。
- live 模式：实时到达。
- history 模式：`CAPABILITY_COMPLETED` 不重建，终态由 `CAPABILITY_RESULT_DELTA` 隐含。

**terminal 成功态样例**：
```
┌─ 🔧 queryAlerts · ✅ 已完成 ──────────────────────┐
│                                                    │
│  ✅ 查询完成，返回 3 条告警                         │
│  （safeSummary: "Found 3 alerts."）                │
└────────────────────────────────────────────────────┘
```

**failed 态样例**（`CAPABILITY_RESULT_DELTA` 携带 failure）：
```
┌─ 🔧 configAudit · ❌ 已失败 ──────────────────────┐
│                                                    │
│  ❌ 能力执行失败                                   │
│  失败原因：CAPABILITY_RESULT_LIMIT_EXCEEDED        │
│  类别：RESOURCE_TOO_LARGE · 可重试                 │
│  （safeSummary: "Result too large to display."）   │
│                                                    │
│  ▶ 可展开查看详情（code/category/retryable）       │
└────────────────────────────────────────────────────┘
```

## safeResult.kind 呈现分支

`safeResult` 的“可产生”和“已专门呈现”不是同一层事实。当前实现必须按以下四层读取：

1. backend/agent-core 或 channel 是否会产生安全投影；
2. 前端 `readSafeCapabilityResult` 是否接受该 `kind`；
3. `processDetails.ts` 是否有专门呈现分支；
4. 没有专门分支时是否回退到 `safeSummary` / 通用结果文案。

| kind / 结果形态 | backend / channel 安全投影 | 前端 parser | `processDetails` 专门呈现 | 当前用户可见结果 |
|---|---|---|---|---|
| `commandOutput` | ✅ channel 按结果形状投影 | ✅ | ✅ | 命令输出、exit code、截断后的 stdout/stderr |
| `fileRead` | ✅ channel 按结果形状投影 | ✅ | ✅ | 安全路径、内容预览、行范围 |
| `fileList` | ✅ channel 按结果形状投影 | ✅ | ✅ | 安全路径列表与截断状态 |
| `grepResult` | ✅ channel 对 Grep 显式安全投影 | ✅ | ✅ | 文件命中列表或有界位置摘要，不暴露匹配正文 |
| `fileWrite` | ✅ channel 按结果形状投影 | ✅ | ✅ | create/update 与安全路径 |
| `skillLoaded` | ✅ channel 对 `Skill` 显式投影 | ✅ | ✅ | 技能名与加载状态 |
| `todoList` | ✅ channel 对 `TodoWrite` 显式投影 | ✅ | ✅ | 本地化 Todo 列表、状态与空态 |
| `workflowResult` | ✅ channel 对 `Workflow` 显式投影 | ✅ | ✅ | recipe、状态与 answer previews |
| `ragRetrieval` | ✅ channel 对 Rag 显式安全投影 | ✅ | ✅ | 召回总数、来源与有界内容预览 |
| `pendingInputAnswer` | ✅ AskUserQuestion durable answer / conversation adapter | ✅ | 补充信息专用关联路径 | 只关联 matching `pendingInputId` 的 QUESTION 补充信息状态，不作为普通能力结果摘要 |
| `httpResponse` | ⚠️ channel 不构造；history adapter 可从 `http_request` 结果构造 | ✅ | ❌ | 当前没有 HTTP 专门卡片，回退到 `safeSummary` 或通用结果文案 |
| `toolSearch` | ✅ channel 对 `ToolSearch` 显式投影 | ✅ | ✅ | 工具名称、类型、Capability ID、描述预览与截断状态 |
| `cron` | ✅ channel 对 `Cron` 显式投影 | ✅ | ✅ | create/delete/list 对应的本地化结构详情 |
| `clipStreamEvent` | ✅ `agent-core` 对 `clip_server` 结果投影，channel 透传上游安全字段 | ❌ | ❌ | `safeSummary` / safe detail 通用呈现 |
| `clipStreamCompletion` | ✅ 同上 | ❌ | ❌ | `safeSummary` / safe detail 通用呈现 |
| `clipStreamResult` | ✅ 同上 | ❌ | ❌ | `safeSummary` / safe detail 通用呈现 |
| parser 未识别或 `safeResult` 缺失 | 视能力而定 | — | — | 仅显示有效 `safeSummary`；无有效摘要时只保留标题与状态，绝不从 raw detail/JSON 生成文案 |

> `[已实现]` 前端 `SafeCapabilityResult` union 当前还接受 `toolSearch` 与 `cron`。`httpResponse` 没有专门 formatter；`pendingInputAnswer` 由补充信息关联路径消费；三种 `clipStream*` 尚未进入前端 parser。这里不维护易漂移的静态数量。
>
> `[UCD目标]` 如需为 `httpResponse` 或 `clipStream*` 增加专门视觉，必须先形成对应 change；不能把 backend/channel 已投影等同于前端已具备专门模板。

来源：`packages/agent-channel-common/src/projections/stream-envelope.ts`、`packages/agent-core/src/tools/clip-result-safe-projection.ts`、`frontend/agent-web/src/features/chat/utils/safeCapabilityResult.ts`、`frontend/agent-web/src/features/chat/process/processDetails.ts`。

### 系统内置工具与 kind 映射

能力卡片的结果呈现由 `safeResult.kind` 决定，不由 `capabilityId`（工具名）决定。多个工具可共享同一种 kind。`capabilityId` 只在 running 态显示。

> 📋 **跨组件总览**：本节是 safeResult 投影接口的映射表。工具与 UI 的完整交互路径（8 类接口：Stream 事件 / safeResult 投影 / TOOL_STRUCTURED_DELTA / Pending Input / PIU 回调 / 后台任务 API / OPERATOR CustomEvent / 工具定义字段）的 consolidated 视图见 `tool-ui-interface-overview.md`。

来源：`packages/agent-capability/src/builtins/index.ts`（lines 25-40）、`stream-envelope.ts` 的 `projectSafeCapabilityResultProjection`（lines 366-403）。

| capabilityId | 映射到 safeResult.kind | 映射方式 | 说明 |
|---|---|---|---|
| `Read` | `fileRead` | 结果形状推断 | 读文件 |
| `Write` | `fileWrite` | 结果形状推断 | 写文件（create/update） |
| `Glob` | `fileList` | 结果形状推断 | 文件搜索 |
| `Grep` | `grepResult` | 显式安全投影 | 按 `files_with_matches` / `content` 提供有界文件或位置摘要，不投影匹配正文 |
| `Bash` | `commandOutput` | 结果形状推断 | 命令执行 |
| `Python` | `commandOutput` | 结果形状推断 | Python 执行 |
| `Edit` | `fileWrite`（operation=update） | 结果形状推断 | 文件编辑 |
| `Rag` | `ragRetrieval` | 显式安全投影 | 知识检索总数、来源和有界内容预览 |
| `Skill` | `skillLoaded` | **显式 capabilityId 检查** | 技能加载 |
| `TodoWrite` | `todoList` | **显式 capabilityId 检查** | 待办列表、系统摘要、状态标签和空态均按当前界面语言呈现 |
| `AskUserQuestion` | `pendingInputAnswer`（durable answer/history） | 专用安全投影 | REQUIRED 走 pending input 卡片；answer 只进入 matching QUESTION 的补充信息关联路径 |
| `Agent` | 无平台安全结果 projector | — | 子 agent；即使请求 `DETAIL`，普通 Web 有效级别仍为 `STATUS_ONLY`，只显示身份和状态 |
| `ToolSearch` | `toolSearch` | **显式 capabilityId 检查** | 前端 parser 与 `processDetails` 均有本地化专门呈现 |
| `Workflow` | `workflowResult` | **显式 capabilityId 检查** | 前端 parser 与 `processDetails` 均有专门呈现 |
| `Cron` | `cron` | **显式 capabilityId 检查** | 定时任务管理（create/list/delete）；前端 parser 与 `processDetails` 均有本地化专门呈现。详见 `cron-task.md` |
| `CUSTOM clip_server` | `clipStreamEvent` / `clipStreamCompletion` / `clipStreamResult` | `agent-core` 按 provider 与结果形状投影，channel 透传上游安全字段 | ⚠️ 前端 parser 不接受，当前走 `safeSummary` / safe detail 通用呈现 |
| `search_memory` | 无已识别 kind（通用兜底） | 结果形状推断 | 搜索长期记忆；结果形状 `{ entries, totalCount, limit, offset }` 不匹配现有安全 kind |
| `get_memory_detail` | 无已识别 kind（通用兜底） | 结果形状推断 | 获取记忆详情；结果形状 `{ results }` 不匹配现有安全 kind |
| `add_memory` | 无已识别 kind（通用兜底） | 结果形状推断 | 添加记忆；结果形状 `{ longTermMemoryId, state, ... }` 不匹配现有安全 kind |
| `acquire_skill` | 无已识别 kind（通用兜底） | 结果形状推断 | 从 SkillHub 获取 skill；结果形状 `{ outcomeCode, requiresReplan, ... }` 不匹配现有安全 kind |

> 映射并非全部隐式：通用文件/命令结果主要按字段形状推断；`TodoWrite→todoList`、`Skill→skillLoaded`、`Cron→cron`、`Workflow→workflowResult`、`ToolSearch→toolSearch` 使用显式 capabilityId 检查；`CUSTOM clip_server` 由 `agent-core` 的 provider-aware projector 产生上游安全投影。
>
> ⚠️ **前端 kind 消费缺口**：三种 `clipStream*` 已可由 backend/channel 产生，但前端 parser 不接受，当前走 generic fallback。`httpResponse` 情况相反：parser 接受、history adapter 可构造，但 `processDetails.ts` 没有专门分支。`pendingInputAnswer` 是补充信息状态事实，不应误计为普通 capability formatter。`search_memory`/`get_memory_detail`/`add_memory`/`acquire_skill` 没有平台安全 projector，普通 Web 有效级别保持 `STATUS_ONLY`。
>
> 📋 **呈现策略**：当前已实现启动期 `STATUS_ONLY` / `SUMMARY` / `DETAIL` 三档 Capability 结果配置，且配置不能提高平台安全上限；截断阈值和字段白名单仍由平台固定。`tool-output-presentation-policy.md` 中按场景配置 `detailLevel` / `truncationThreshold` / `redactionPolicy` 的四策略框架仍是 `[UCD目标/Clarify]`，不是当前可用配置。完整截断限制见 `11-ux-limits-and-constraints.md` §3。

### safeResult.kind 样例参考

以下样例同时覆盖“已有专门呈现”和“仅有安全投影/通用回退”的代表结果；视觉示意中会明确标注当前实现或 UCD 目标。样例 payload 取自代码库测试与投影代码。

---

#### commandOutput（命令输出）

**样例 payload**（来源：`processDetailsProjection.test.ts` L421-428）：

```json
{
  "kind": "commandOutput",
  "exitCode": 126,
  "stdoutPreview": "",
  "stderrPreview": "COMMAND_NOT_ALLOWED: Bash command is not allowed by policy.",
  "stdoutTruncated": false,
  "stderrTruncated": false
}
```

**期望视觉渲染**：

```
┌─ 🔧 bash · ✅ 已完成 ────────────────────────────┐
│                                                    │
│  退出码：126                                       │
│                                                    │
│  stdout：（无输出）                                │
│  stderr：                                          │
│  ┌──────────────────────────────────────────────┐ │
│  │ COMMAND_NOT_ALLOWED: Bash command is not     │ │
│  │ allowed by policy.                           │ │
│  └──────────────────────────────────────────────┘ │
│                                                    │
│  ⚠️ 此命令被安全策略阻止                           │
└────────────────────────────────────────────────────┘
```

> exitCode≠0 时 SHOULD 用视觉区分（如黄色/红色边框）。`COMMAND_NOT_ALLOWED` 走策略阻止呈现，非普通命令完成。

##### commandOutput + backgroundHandle 扩展（后台任务追踪区）

> ⚠️ **实现状态标注**：后台任务追踪区为 UCD 设计建议。`backgroundHandle` 是本文档使用的**概念术语**，指代后台分离执行返回的句柄——对应 `bash-schemas.ts` `bashBackgroundOutputSchema` 中的 `taskId`（句柄标识）+ `backgroundReason`（`EXPLICIT | TIMEOUT_AUTO_BACKGROUND | ABORT_AUTO_BACKGROUND`）字段。`bashBackgroundOutputSchema` 不存在名为 `backgroundHandle` 的字面字段；能力调用返回的对象形如 `{ taskId, status, stdoutRef, stderrRef, backgroundReason, message }`（`bash-tool.ts` `shapeBackgroundHandle`）。

**触发条件**：工具以后台分离模式执行（当前实例：Bash `run_in_background: true` 或前台超时自动转后台）时，能力调用立即返回 `backgroundHandle`（而非等待命令完成）——任务结果**不参与对话上下文**，模型 turn 不阻塞。capability-card 进入终态，但后台进程仍在运行。此时卡片底部追加**后台任务追踪区**，承载输出观测和 SIGTERM 终止能力。

**与 `⚡` header 监控的关系**：`[已实现-主干]` `BackgroundTaskHeaderMonitor` 是 header 级快速查找入口，状态来自一次性 REST seed + 当前 session 的 `BACKGROUND_TASK_*` stream envelopes + Kill local override。内联追踪区仍是 `[UCD目标]`；若实施，应复用同一 session task snapshot，而不是建立第二条轮询链。stdout/stderr 仍在展开时按需读取，Kill 仍调用 REST。详见 `background-task-monitor.md`。

**与 long-running 扩展态的区别**：两种模式的核心差异是**任务结果是否参与后续上下文**。long-running 扩展态（场景 9）：能力调用本身长时未返回，结果将进入模型上下文，模型阻塞等待（同一 turn）。backgroundHandle 后台分离（场景 22）：能力调用已返回句柄、实际结果不进入模型上下文、模型不阻塞、后台进程独立运行。前者用 fork-to-continue CTA + 取消执行处理；后者当前仅由 header monitor / `[UCD目标]` 内联追踪区观测，并通过按需 output REST 读取输出，不触发 Agent 续跑。两者是不同场景，追踪区不显示 fork CTA。

**追踪区渲染**（RUNNING 态）：

```
┌─ 🔧 bash · ✅ 已完成 ────────────────────────────┐
│  后台任务已启动（EXPLICIT）                         │
│                                                    │
│  ▼ ⏳ npm run dev              [processing] 2m     │
│    npm run dev --port 3000                         │
│  stdout                              [↻ 刷新]      │
│  ┌──────────────────────────────────────────────┐ │
│  │ > next dev@14.2.3                             │ │
│  │ - Local: http://localhost:3000                │ │
│  │ ✓ Ready in 1.2s                               │ │
│  └──────────────────────────────────────────────┘ │
│                              [Kill]                │
└────────────────────────────────────────────────────┘
```

**追踪区渲染**（KILLED 终态）：

```
┌─ 🔧 bash · ✅ 已完成 ────────────────────────────┐
│  后台任务已启动（TIMEOUT_AUTO_BACKGROUND）         │
│                                                    │
│  ▶ ⏹️ npm run dev              [default] 3m12s    │
│    退出码：null（SIGTERM 终止）                    │
└────────────────────────────────────────────────────┘
```

**追踪区渲染**（COMPLETED 终态）：

```
┌─ 🔧 bash · ✅ 已完成 ────────────────────────────┐
│  后台任务已启动（EXPLICIT）                         │
│                                                    │
│  ▶ ✅ npm run build            [success] 1m45s    │
│    退出码：0                                       │
│  stdout                              [↻ 刷新]      │
│  ┌──────────────────────────────────────────────┐ │
│  │ ✓ Build completed                             │ │
│  │ ✓ Output: dist/                               │ │
│  └──────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────┘
```

**追踪区渲染**（FAILED 终态）：

```
┌─ 🔧 bash · ✅ 已完成 ────────────────────────────┐
│  后台任务已启动（EXPLICIT）                         │
│                                                    │
│  ▶ ❌ npm run test            [error] 32s         │
│    退出码：1                                       │
│  stderr                              [↻ 刷新]      │
│  ┌──────────────────────────────────────────────┐ │
│  │ FAIL src/app.test.ts                          │ │
│  │ ✗ should render header                        │ │
│  │   Expected: "NextAgent"                       │ │
│  │   Received: undefined                          │ │
│  └──────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────┘
```

**任务状态**：4 种，沿用 `BackgroundTaskStatus`：

| 状态 | 图标 | Tag | Kill 按钮 |
|---|---|---|---|
| RUNNING | ⏳ | processing | ✅ 显示（Popconfirm 确认） |
| COMPLETED | ✅ | success | ❌ |
| FAILED | ❌ | error | ❌ |
| KILLED | ⏹️ | default | ❌ |

**数据来源目标**：复用 header monitor 已形成的 session task snapshot；该 snapshot 由一次性 REST seed、`BACKGROUND_TASK_*` stream live update 和 Kill local override 合成。三个 REST 端点见 `tool-ui-interface-overview.md` §6：
- `GET /api/v1/sessions/:sessionId/background-tasks` — session mount 时恢复已有任务并补 `commandLine`，不是轮询
- `GET .../background-tasks/:taskId/output?stream=stdout|stderr` — 输出（每流限 65536 字节）
- `POST .../background-tasks/:taskId/kill` — SIGTERM 终止

**输出展示**：展开追踪区时并行加载 stdout + stderr，`<pre>` 块渲染，maxHeight 200px，monospace 12px，`whiteSpace: pre-wrap`。截断时显示 `…`。带 [↻ 刷新] 手动重新加载。

**Agent 续跑边界**：`[已实现-主干]` 后台任务自然完成只写入终态并发射 `BACKGROUND_TASK_COMPLETED` / `BACKGROUND_TASK_FAILED` timeline event；Kill 写入 `KILLED`，也不发送 chat notification。两条路径都不会调用 `RequestLifecycleCoordinator.submit`，不会把 stdout/stderr 自动送回 Agent 上下文。当前结果仅供 header monitor 状态观察和 output REST 按需读取；若未来需要 Agent context 恢复或 continuation，必须另立 contract change，定义触发条件、上下文 owner、安全投影与幂等边界。

**约束**：
- 后台分离执行是通用模式（结果不参与上下文，模型不阻塞），当前仅 Bash 工具支持（`run_in_background: true` 或前台超时自动转后台）。
- Kill 仅对 RUNNING 状态显示；终态任务不显示。
- Kill 发送 SIGTERM（非 SIGKILL），进程可捕获并优雅退出。
- 输出限制 65536 字节/流，超出截断显示 `…`。
- 列表 live 状态来自 `BACKGROUND_TASK_STARTED/COMPLETED/FAILED` canonical stream envelopes；这些事件不生成 ProcessPanel message entry。
- 输出手动刷新或展开时加载；Kill 当前无 stream event，使用 local override 即时反映 KILLED。
- history 模式：历史会话的后台任务通常已终态，追踪区显示终态信息；输出引用可能已过期。

---

#### fileRead（文件读取）

**样例 payload**（来源：`processDetailsProjection.test.ts` L345-353）：

```json
{
  "kind": "fileRead",
  "filePath": "frontend/agent-web/src/features/chat/process/processDetails.ts",
  "contentPreview": "export function buildProcessEntries() {}",
  "truncated": true,
  "offset": 0,
  "limit": 2000,
  "nextOffset": 2000
}
```

**期望视觉渲染**：

```
┌─ 🔧 read · ✅ 已完成 ────────────────────────────┐
│                                                    │
│  已读取 frontend/agent-web/src/.../processDetails.ts│
│  从第 1 行开始，最多 2000 行                        │
│                                                    │
│  ┌─ 内容预览 ───────────────────────────────────┐ │
│  │ export function buildProcessEntries() {}     │ │
│  └────────────────────────────────────────────────┘ │
│                                                    │
│  📄 文件还有更多内容，本次未包含第 2001 行之后的内容│
└────────────────────────────────────────────────────┘
```

> SHOULD 用用户语言解释行范围（"从第 1 行开始，最多 2000 行"），不暴露 `offset`/`limit`/`nextOffset` 字段名。截断时提示后续内容未包含。

---

#### fileList（文件列表）

**样例 payload**（来源：`processDetailsProjection.test.ts` L172）：

```json
{
  "kind": "fileList",
  "filenames": ["src/a.ts", "src/b.ts"],
  "totalCount": 2,
  "truncated": false
}
```

**期望视觉渲染**：

```
┌─ 🔧 glob · ✅ 已完成 ────────────────────────────┐
│                                                    │
│  找到 2 个匹配文件                                 │
│                                                    │
│  ┌─ 文件列表 ───────────────────────────────────┐ │
│  │ src/a.ts                                      │ │
│  │ src/b.ts                                      │ │
│  └────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────┘
```

> `filenames` 最多 50 项；`truncated=true` 时提示"列表已截断，仅显示前 50 项"。

---

#### fileWrite（文件写入）

**样例 payload**（来源：`processDetailsProjection.test.ts` L387-391）：

```json
{
  "kind": "fileWrite",
  "operation": "create"
}
```

附带 `safeSummary: "File was created."`

**期望视觉渲染**：

```
┌─ 🔧 write · ✅ 已完成 ───────────────────────────┐
│                                                    │
│  📄 文件已创建                                     │
│  File was created.                                 │
└────────────────────────────────────────────────────┘
```

> `operation: "update"` 时显示"文件已更新"。MUST NOT 暴露 file path、raw content、credential。

**fileWrite update 操作样例**：

```json
{
  "kind": "fileWrite",
  "operation": "update"
}
```

附带 `safeSummary: "File was updated."`

```
┌─ 🔧 Edit · ✅ 已完成 ─────────────────────────────┐
│                                                    │
│  📝 文件已更新                                     │
│  File was updated.                                 │
└────────────────────────────────────────────────────┘
```

---

#### skillLoaded（技能加载）

**样例 payload**（来源：`processDetailsProjection.test.ts` L106）：

```json
{
  "kind": "skillLoaded",
  "name": "network-diagnostics",
  "status": "loaded"
}
```

**期望视觉渲染**：

```
┌─ 🔧 Skill · ✅ 已完成 ───────────────────────────┐
│                                                    │
│  ✅ 已加载 network-diagnostics 技能                │
└────────────────────────────────────────────────────┘
```

> MUST NOT 暴露 skill content、raw skill body、credential。

---

#### todoList（待办列表）[已实现-主干；系统文案已本地化]

**样例 payload**（来源：`processDetailsProjection.test.ts` L205-219）：

```json
{
  "kind": "todoList",
  "todos": [
    {
      "content": "Inspect AMF registration alarms",
      "activeForm": "Inspecting AMF registration alarms",
      "status": "in_progress"
    },
    {
      "content": "Summarize affected cells",
      "activeForm": "Summarizing affected cells",
      "status": "pending"
    }
  ]
}
```

**期望视觉渲染**：

```
┌─ 🔧 TodoWrite · ✅ 已完成 ───────────────────────┐
│                                                    │
│  待办列表有 2 项                                   │
│                                                    │
│  ┌──────────────────────────────────────────────┐ │
│  │ 🔄 Inspecting AMF registration alarms        │ │
│  │ ⏳ Summarizing affected cells                 │ │
│  └──────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────┘
```

> `status` 可能为 `in_progress`/`pending`/`completed`，当前前端已用不同图标和本地化安全摘要呈现。`activeForm` 是进行时描述（用户看到的当前动作），`content` 是待办事项本身；两者属于工具/Agent 产生的业务内容并保持原文。前端只本地化自己拥有的摘要、状态标签和空态；非法或未知 `status` 仍由 `readSafeCapabilityResult` 拒绝并退回通用安全摘要，不扩展 schema。

**3 种 todo status 视觉区分**：

```
┌─ 🔧 TodoWrite · ✅ 已完成 ───────────────────────┐
│                                                    │
│  待办列表有 3 项                                   │
│                                                    │
│  ┌──────────────────────────────────────────────┐ │
│  │ ✅ Inspect AMF registration alarms           │ │  ← completed（已完成）
│  │ 🔄 Inspecting AMF registration alarms        │ │  ← in_progress（进行中）
│  │ ⏳ Summarizing affected cells                 │ │  ← pending（待处理）
│  └──────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────┘
```

---

#### workflowResult（工作流结果）[已实现-主干]

**样例 payload**（来源：`frontend/agent-web/tests/processDetailsProjection.test.ts`）：

```json
{
  "kind": "workflowResult",
  "recipeName": "alarm-localization",
  "status": "succeeded",
  "answerPreviews": [
    "Root cause: high CPU on cell-1.",
    "Action: restart AMF service."
  ]
}
```

`processDetails.ts` 已按 `status` 生成工作流摘要，并将有界 `answerPreviews` 作为可展开详情呈现。这是 frontend parser 与专门呈现均已接通的主干事实。

---

#### httpResponse（HTTP 响应）[parser 已识别；专门呈现未实现]

**样例 payload**（来源：`httpResponseVerification.test.ts` L19-26）：

```json
{
  "kind": "httpResponse",
  "httpStatus": 200,
  "responseMode": "STREAMING",
  "streamCompleted": false,
  "bodyPreview": "{\"piuId\":\"PIU-2026-001\",\"severity\":\"critical\",...}",
  "bodyPreviewTruncated": false
}
```

**当前实际呈现**：`readSafeCapabilityResult` 接受该 payload，但 `processDetails.ts` 没有 `httpResponse` 分支，因此不会渲染下述 HTTP 专门卡片；当前走 `safeSummary` 或通用结果文案。

**UCD 目标视觉（需独立 change）**：

```
┌─ 🔧 http_request · ✅ 已完成 ────────────────────┐
│                                                    │
│  HTTP 200 · STREAMING（流式，未完成）              │
│                                                    │
│  ┌─ 响应预览 ───────────────────────────────────┐ │
│  │ {"piuId":"PIU-2026-001","severity":"critical",...} │ │
│  └────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────┘
```

> ⚠️ channel 的标准 projector 不构造此 kind；history adapter 会调用 `buildSafeCapabilityResult` 从 `http_request` 的能力结果构造，`readSafeCapabilityResult` 也会校验已有投影。parser 支持只证明字段可被安全读取，不代表 `processDetails` 已有专门视觉。`responseMode` 可能为 `BUFFERED`/`STREAMING`；`streamCompleted` 标识流是否完成。

**httpResponse BUFFERED 模式样例**（非流式，完整响应一次性返回）：

```
┌─ 🔧 http_request · ✅ 已完成 ────────────────────┐
│                                                    │
│  HTTP 200 · BUFFERED（完整响应）                    │
│                                                    │
│  ┌─ 响应预览 ───────────────────────────────────┐ │
│  │ {"piuId":"PIU-2026-001","severity":"critical",│ │
│  │  "title":"核心交换机故障","status":"open",      │ │
│  │  "createdAt":"2026-07-14T08:30:00Z"}           │ │
│  └────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────┘
```

- `responseMode: "STREAMING"` → 标注"流式，未完成"。
- `responseMode: "BUFFERED"` → 标注"完整响应"。

---

#### toolSearch / cron（已实现专门呈现）

| kind | channel 已投影安全字段 | 当前用户可见结果 |
|---|---|---|
| `toolSearch` | 有界 `tools[]`、`totalCount`、`truncated`；过滤 provider/private schema 等字段 | parser 接受并按当前语言显示工具名称、类型、Capability ID、描述预览和截断状态 |
| `cron` | create/delete 的 action、id；list 的有界 jobs、`totalCount`、`truncated`；不投影任务 prompt | parser 接受并按当前语言显示 create/delete/list 对应结构详情 |

> `[已实现-主干]` `refine-capability-result-card-presentation` 已完成 frontend parser、专门 formatter 和中英文回归测试；该能力卡片仍只消费后端批准的安全字段，不替代独立 Cron Dashboard。

---

#### clipStream*（CLIP 流安全投影）[backend 已实现；frontend 专门呈现未实现]

`agent-core/src/tools/clip-result-safe-projection.ts` 已对 provider 为 `CUSTOM/clip_server` 的结果产生 `clipStreamEvent`、`clipStreamCompletion`、`clipStreamResult` 安全字段；channel 的 upstream-safe-projection 分支会透传这些字段。当前缺口在 frontend：parser 不接受三种 kind，`processDetails.ts` 也没有专门分支，因此用户看到的是 projector 同时提供的 `safeSummary` / safe detail 通用呈现。

| kind | 已投影安全字段 | UCD 目标视觉 |
|---|---|---|
| `clipStreamEvent` | `eventType?`、`chunk?`，或规范化事件的有界 data preview | CLIP 流事件已接收 |
| `clipStreamCompletion` | `reason?`、`event_count?` | CLIP 流已完成 |
| `clipStreamResult` | `event_count` | CLIP 流结果包含 N 个事件 |

> `[UCD目标]` 如需专门 CLIP 视觉，应新增 frontend parser 与 `processDetails` 分支并补前端测试；不能继续把工作描述成“等待后端投影”。

---

#### parser 未识别或 safeResult 缺失（通用兜底）

**样例 payload**（parser 不接受的 kind）：

```json
{
  "kind": "unknown"
}
```

或 safeResult 为空对象 `{}`。

**期望视觉渲染**：

```
┌─ 🔧 customTool · ✅ 已完成 ──────────────────────┐
│                                                    │
│  （仅显示标题与状态）                              │
└────────────────────────────────────────────────────┘
```

> `unknown` 不是当前 `SafeCapabilityResult` union 的成员；`readSafeCapabilityResult` 对该 payload 返回 `null`。通用兜底 MUST NOT 展示 raw result、raw JSON、raw fields，也不得从 raw detail、关键词或首句生成占位摘要。没有有效受信摘要时只保留标题与状态。

---

### 样例数据来源汇总

| kind | 样例来源 | 可信度 |
|---|---|---|
| `commandOutput` | `processDetailsProjection.test.ts` L421-428 | ✅ 真实测试 fixture |
| `fileRead` | `processDetailsProjection.test.ts` L345-353 | ✅ 真实测试 fixture |
| `fileList` | `processDetailsProjection.test.ts` L172 | ✅ 真实测试 fixture |
| `fileWrite` | `processDetailsProjection.test.ts` L387-391 | ✅ 真实测试 fixture |
| `skillLoaded` | `processDetailsProjection.test.ts` L106 | ✅ 真实测试 fixture |
| `todoList` | `processDetailsProjection.test.ts` L205-219 | ✅ 真实测试 fixture |
| `workflowResult` | `frontend/agent-web/tests/processDetailsProjection.test.ts` | ✅ parser + 专门呈现 fixture |
| `httpResponse` | `frontend/agent-web/tests/httpResponseVerification.test.ts`、`safeCapabilityResult.httpResponse.test.ts` | ✅ parser fixture；⚠️ 无 `processDetails` 专门呈现 |
| `toolSearch` | `packages/agent-channel-web/tests/tool-search-result-projection.test.ts`、`frontend/agent-web/tests/safeCapabilityResult.test.ts`、`processDetailsProjection.test.ts` | ✅ channel 投影 + frontend parser/formatter fixture |
| `cron` | `packages/agent-channel-web/tests/cron-result-projection.test.ts`、`frontend/agent-web/tests/safeCapabilityResult.test.ts`、`processDetailsProjection.test.ts` | ✅ channel 投影 + frontend parser/formatter fixture |
| `clipStreamEvent` / `clipStreamCompletion` / `clipStreamResult` | `packages/agent-core/tests/tool-structured-delta-emission.test.ts`、`clip-result-safe-projection.ts` | ✅ agent-core 安全投影证据；⚠️ frontend parser 不接受 |
| parser 未识别 / safeResult 缺失 | `processDetails.ts` generic fallback | ✅ 通用安全降级路径 |

### 命令输出的特殊渲染

- 当 stderr 首行形如 `CODE: message` 时，SHOULD 把 error code 与 error information 分别呈现。
- 单行 error information 内联渲染；多行以 labeled block 渲染。
- 策略阻止的命令（`COMMAND_NOT_ALLOWED`）SHOULD 用"阻止"状态呈现，而非普通命令完成。来源：`ts-run-status-visibility` scenario "Command output is projected as bounded safe result"。

### 文件读的特殊渲染

- SHOULD 用用户语言解释行范围（如"从第 3 行开始，最多 50 行"），而非暴露 `offset`/`limit`/`nextOffset` 字段名。
- 截断时 SHOULD 提示"文件还有更多内容，本次未包含第 N 行之后的内容"。来源：`ts-run-status-visibility` scenario "File read, write, and list results are projected as bounded safe results"。

## 失败卡片呈现

当 `CAPABILITY_RESULT_DELTA`/`CAPABILITY_COMPLETED` 携带 `safeErrorCode`/`safeErrorCategory` 时：

- 渲染失败卡片（视觉区分于成功结果）。
- 用户可读 reason 从 `safeErrorCode`/`safeErrorCategory`/`safeSummary` 派生（见 `conversation-ui-state.md` 第 5 节映射表）。
- second-level details 可展开查看 `safeErrorCode`/`safeErrorCategory`/`status`。
- MUST NOT 显示 raw validation error text、rejected path、file system detail、policy internals、raw safe error message、tool arguments、runtime correlation ids。
- `DEGRADATION_NOTICE` 可作为次要提示并存，但 MUST NOT 是失败能力的唯一解释。

### 失败卡片样例 — 按 safeErrorCode

**CAPABILITY_PATH_REJECTED（路径被策略拒绝，不可重试，不升级 run failure）**：
```
┌─ 🔧 Read · ❌ 已失败 ─────────────────────────────┐
│                                                    │
│  🔒 路径访问被策略阻止                             │
│  Path access was blocked by policy.                │
│  （可展开：code=CAPABILITY_PATH_REJECTED           │
│   category=AUTHORIZATION retryable=false）         │
└────────────────────────────────────────────────────┘
```

**COMMAND_NOT_ALLOWED（命令被安全策略阻止，不可重试）**：
```
┌─ 🔧 Bash · ❌ 已失败 ─────────────────────────────┐
│                                                    │
│  🚫 命令被安全策略阻止                             │
│  Command not allowed by policy.                    │
│  （可展开：code=COMMAND_NOT_ALLOWED                │
│   category=AUTHORIZATION retryable=false）         │
└────────────────────────────────────────────────────┘
```

**CAPABILITY_INPUT_INVALID / INVALID_INPUT（输入无效，可重试）**：
```
┌─ 🔧 queryConfig · ❌ 已失败 ──────────────────────┐
│                                                    │
│  ⚠️ 工具输入无效                                   │
│  Input validation failed. Please check parameters. │
│  （可展开：code=CAPABILITY_INPUT_INVALID           │
│   category=VALIDATION retryable=true）             │
└────────────────────────────────────────────────────┘
```

**CAPABILITY_RESULT_LIMIT_EXCEEDED / RESOURCE_TOO_LARGE（结果过大，可重试）**：
```
┌─ 🔧 faultQuery · ❌ 已失败 ───────────────────────┐
│                                                    │
│  📦 能力结果过大                                   │
│  Result too large to display. Please narrow scope. │
│  （可展开：code=CAPABILITY_RESULT_LIMIT_EXCEEDED  │
│   category=UNAVAILABLE retryable=true）            │
└────────────────────────────────────────────────────┘
```

### 失败卡片样例 — 按 safeErrorCategory 色调

| category | 视觉色调 | 适用场景 |
|---|---|---|
| AUTHORIZATION / POLICY_DENIED | 策略阻止色调（红色/橙色边框） | 路径/命令被安全策略阻止 |
| VALIDATION | 输入校验色调（黄色边框） | 工具输入参数无效 |
| TIMEOUT | 超时色调（橙色边框） | 能力执行超时 |
| UNAVAILABLE | 不可用色调（灰色边框） | 子系统不可用、结果过大 |
| fallback | 中性失败色调（红色边框） | 未分类的失败 |

> `retryable=true` 时 SHOULD 在卡片中提示"可重试"；`retryable=false` 时 SHOULD 提示"不可重试"。

### `CAPABILITY_PATH_REJECTED` 的特殊处理

- 渲染"路径被策略拒绝"卡片，safeSummary="Path access was blocked by policy."。
- 不升级为 run failure（`RunStatus` 不转为 `FAILED`），run 可继续。
- 不暴露被拒绝的路径。来源：本 change `Capability Path Rejected Failure Visibility` requirement。

## "完整过程"按钮

- 过程面板 summary row 右侧提供"完整过程"按钮（来源：`ProcessPanel.tsx`），打开 run-graph drawer。
- live 模式：展示实时 timeline。
- history 模式：仅当存在 `timelineEventRef` 的历史能力结果才视为完整 timeline；无 `timelineEventRef` 的历史 `CAPABILITY_RESULT` MUST NOT 被当作完整 timeline。来源：`ts-run-status-visibility` scenario "History replay keeps full-process affordance for timeline-backed process events"。

## 展开与折叠动画

- 展开/折叠时使用 `grid-template-rows` 过渡（0fr → 1fr），非 measured height 方案。
- 过渡期间内容 MUST 保持 clipped，不能与下方答案内容视觉重叠。
- 展开详情面板与 summary row 间距为 12px。来源：`ts-run-status-visibility` scenario "Execution details expand and collapse without visual overlap"。

## live 模式 vs history 模式

核心原则：**完成后呈现相同的持久化事实**，仅实时过程效果不同。能力卡片本身不渲染 think；thinking 的历史恢复与安全边界见 `process-panel.md` 和 B17/B18。

| 维度 | live 模式 | history 模式 |
|---|---|---|
| running 态 | 可见（动画） | 不恢复瞬时动画；持久化 lifecycle 直接投影为终态 |
| 增量结果 | 实时追加 | 直接终态 |
| `CAPABILITY_COMPLETED` | 实时到达 | 从 Event history 恢复并与结果 Message 合并 |
| 失败卡片 | 实时 | 重建（同渲染路径） |
| 结果内容 | 增量投递 | 终态一次性呈现（内容相同） |
| `transportHints` | `[]` | `["history-load"]` |

## 视觉规范（UCD 设计人员决定）

- 卡片边框、图标（think/skill/process-complete/final-complete/circle）、背景色、圆角。
- 5 种图标类型对应不同能力阶段（来源：`ProcessPanel.tsx` L24）：`think`（思考条目）、`skill`（能力运行中）、`process-complete`（能力完成）、`final-complete`（最后一个条目且 hasAnswerContent）、`circle`（`TOOL_STRUCTURED_DELTA` 的 `SUB_TITLE` 类型）。
- running/settling/settled 动画曲线与时长。
- 失败卡片视觉区分（红色边框/图标/背景）。
- 约束：不得通过视觉暗示非契约字段；不得把 `safeResult` 渲染为 raw JSON。

## kind 图标设计建议

> 本节是设计方向建议，非契约约束。UCD 设计人员可自行决定是否采纳。
>
> ⚠️ 注意区分两个层级的图标概念：
> - **phase icon**（能力阶段图标）：`ProcessPanel.tsx` 中的 5 种图标类型（think/skill/process-complete/final-complete/circle），对应能力的**执行阶段**，与 kind 无关。见上文"视觉规范"。
> - **kind icon**（结果语义图标簇）：按文件、命令、编排、流式与通用等稳定语义分组，对应能力的**结果类型**，仅在 success 结果态使用。两个层级正交，不冲突。

### 问题

安全结果种类会随 backend/channel projector、前端 parser 与专门呈现能力分别演进，若为每个 kind 固化一个图标，不仅认知负载高，也会让视觉资产数量持续漂移。但如果所有结果统一用同一个 `🔧` 图标，在过程面板展开态多能力条目并列时又难以快速区分。

### 建议方向：按聚类分组，不按 kind 全区分

按稳定业务语义聚类，而不是按当前 kind 清单逐一绑定图标：

| 图标簇 | 涵盖 kind | 设计意图 |
|---|---|---|
| 📁 文件操作 | `fileRead`、`fileList`、`fileWrite` | 都是对文件系统的读写操作，语义同族 |
| ⌨️ 命令执行 | `commandOutput` | Bash/命令行执行，语义独立 |
| 🧭 编排与任务 | `todoList`、`workflowResult`、`toolSearch`、`cron` | 都表达受治理的计划、工作流或任务结果；四者当前均有专门 formatter |
| 📡 流式结果 | `clipStreamEvent`、`clipStreamCompletion`、`clipStreamResult` | CLIP 安全投影已由 agent-core 产生；当前前端未识别，落地专门图标前仍使用通用回退 |
| 🔧 通用能力 | `skillLoaded`、`httpResponse`、parser 未识别或 safeResult 缺失 | 无稳定专属视觉或尚未接通专门呈现时使用通用图标兜底 |

### 区分手段分层

| 层级 | 区分载体 | 适用场景 |
|---|---|---|
| 语义图标簇 | 视觉快速扫描 | 展开态多能力条目并列时 |
| `capabilityId` 文本 | 工具名（`read`/`bash`/`rag`/`Skill`） | 卡片标题行，展开后可见 |
| `safeSummary` 文案 | "命令执行完成"/"已读取 xxx"/"找到 5 个匹配文件" | 卡片结果区，展开后可见 |

三层递进：图标簇给方向 → 工具名给精确身份 → 文案给结果摘要。折叠态靠图标簇 + 序号，展开态靠工具名 + 文案。

### 约束

- 图标簇是**视觉辅助**，不能替代 `capabilityId` 文本。`capabilityId` 是契约层 safe field，必须展示。
- 图标不能暗示非契约字段（如 raw path、tool args）。
- parser 未识别或 safeResult 缺失时必须用通用图标（🔧），不得用一个可能误导用户以为是特定 kind 的图标。

## 能力卡片视觉模板分层

不维护“模板总数”：backend/channel 可投影集合、frontend parser union 与 `processDetails` 专门分支不是同一清单，使用固定总数会在任一层演进后失真。设计与交付按下表分层验收：

| 层级 | 当前范围 | 设计与交付要求 |
|---|---|---|
| 生命周期共享模板 | running / terminal / failure | 与 kind 无关，所有能力复用；failure 继续按 SafeError code/category/fallback 呈现 |
| `[已实现]` 专门 success 呈现 | `commandOutput`、`fileRead`、`fileList`、`grepResult`、`fileWrite`、`skillLoaded`、`todoList`、`workflowResult`、`ragRetrieval` | 保持当前 parser + `processDetails` 行为，视觉可按语义簇复用，不要求每个 kind 独占整套卡片 |
| `[已实现]` parser 接受但无专门呈现 | `httpResponse` | 当前走 `safeSummary` / 通用结果；专门 HTTP 卡片属于候选 change，不算已交付模板 |
| `[已实现]` 补充信息关联呈现 | `pendingInputAnswer` | 只用于 matching QUESTION 的 waiting/final 状态和安全摘要，不进入普通 capability result formatter |
| `[已实现]` 其他专门 success 呈现 | `toolSearch`、`cron` | 已有 parser、本地化 formatter 和回归测试 |
| `[已实现]` backend/channel 投影但 frontend 未识别 | `clipStreamEvent`、`clipStreamCompletion`、`clipStreamResult` | 当前走 `safeSummary` / safe detail 通用呈现；专门视觉需先补 parser、呈现与测试 |
| 通用安全兜底 | parser 未识别或 `safeResult` 缺失 | 有效受信摘要存在时才呈现；否则只保留标题和状态。MUST NOT 展示 raw result / raw JSON 或占位结果文案 |

> UCD 的可分配任务应写成“接通某个缺口层级并提供验收证据”，而不是“补齐第 N 个模板”。这样 `workflowResult` 等新增能力不会再次导致静态总数失真。

## 动态行为与交互响应

> 跨组件的通用模式见 `02-dynamic-behavior-and-interaction.md`。本节补充能力卡片特有行为。

### 已实现

| 行为 | 说明 | 代码位置 |
|------|------|---------|
| 展开/折叠过渡 | `grid-template-rows: 0fr → 1fr` + opacity，200ms transition；过渡期间内容 clipped | L806-809 |
| 失败卡片文本内容 | `safeErrorCode`/`safeErrorCategory`/`safeSummary` 派生用户可读文本（code/category/summary 的文字呈现） | L726-798 |

### UCD 设计建议

| 行为 | 说明 |
|------|------|
| 失败卡片色调映射 | `safeErrorCategory` 按类别（TIMEOUT/UNAVAILABLE/VALIDATION/AUTHORIZATION）映射不同边框色/背景色/图标。当前代码只有文本内容，**视觉色调映射未实现** |
| running 态动画 | running 态显示旋转/脉冲图标动画，指示正在执行 |
| 状态过渡 | running → completed/failed 时色调过渡 200ms（从 running 色到终态色） |
| 结果渐入 | `CAPABILITY_RESULT_DELTA` 到达时结果内容 fade-in 200ms |
| hover | 卡片 hover 时边框/阴影变化，120ms transition |
| long-running 扩展态动画 | 持续旋转图标 + 计时器，避免"卡住"错觉 |
| 进度条动画 | `safeProgress` 进度条宽度过渡 300ms ease-out |
| 卡片 appear | `CAPABILITY_STARTED` 时卡片 fade-in 200ms |

> ⚠️ 以上均为 UCD 设计建议，当前能力卡片无独立组件，无 running 动画、无结果渐入、无状态过渡。见 `10-implementation-gap-analysis.md` B12-B13。
