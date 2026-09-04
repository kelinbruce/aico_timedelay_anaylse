# 组件规范：后台任务 Header 监控（Background Task Header Monitor）

> ✅ **实现状态标注**：已实现。以下当前事实以最新 `origin/main`、stable OpenSpec、代码和测试核对。`BackgroundTaskHeaderMonitor` 位于 `frontend/agent-web/src/features/background-tasks/components/BackgroundTaskMonitorPanel.tsx`，挂载在 `ChatPage.tsx` 的 `RightPaneLayout.headerExtra`。它消费会话 canonical stream envelope 更新 Header 监控状态，但不会把 `BACKGROUND_TASK_*` 事件渲染成消息或 `ProcessPanel` entry。

## 职责

per-session 的后台任务快速查找入口。会话存在后台任务时在 chat pane header 显示 `⚡` + running count badge，点击展开下拉面板列出本会话所有后台任务，支持查看 stdout/stderr、Kill（SIGTERM）。无任务时隐藏，不占用 header 空间。

典型场景：用户通过 Bash `run_in_background: true` 启动了多个后台命令，对话已继续多轮，用户需快速定位正在运行的异步任务——通过 header `⚡` 下拉面板一览全部任务，无需在消息历史中回找最初发起命令的上下文。

## 入口与位置

- `RightPaneLayout` header `headerExtra` 槽位（54px header，右侧）
- **per-session**：随会话切换变化，只显示当前会话的后台任务
- 与 `⏰` Cron 管理面板（agent 级、侧边栏）形成语义区分——一次性任务 vs 持久化任务
- 挂载：`ChatPage.tsx` 通过 `<BackgroundTaskHeaderMonitor sessionId={routeSessionId ?? ""} />` 注入 `headerExtra`

## 显示条件

| 条件 | 行为 | 来源 |
|---|---|---|
| `sessionId` 为空 | 清空本地 seed/override，不发起列表请求，并 `return null` | session seed effect + render guard |
| `tasks.length === 0` | `return null`（不渲染） | render guard |
| `tasks.length > 0` | 渲染 `⚡` 按钮 + Badge | derived tasks |

组件职责明确约束：无后台任务时不占用 Header 空间。

## Badge 行为

- count = RUNNING 状态任务数（`tasks.filter(task => task.status === "RUNNING").length`）
- count=0 时 antd Badge 不显示数字（但 `⚡` 图标仍显示，因 `tasks.length > 0`）——即任务全部终态但尚未从列表清除时，`⚡` 仍在但无数字角标
- 当前没有“全部终态后自动删除/隐藏”逻辑；只要 derived tasks 非空，`⚡` 仍显示
- Badge 随 canonical `BACKGROUND_TASK_*` envelope 或成功 Kill 后的本地状态覆盖即时更新，不依赖定时轮询

## 下拉面板布局

点击 `⚡` 按钮后浮出下拉面板（`open` state 切换）：

```
对话区 header
                                    ⚡ ¹  ← 点击
                          ┌─────────────────────────────────────────┐
                          │ ⚡ 后台任务                               │  ← 标题行（底部分隔线）
                          ├─────────────────────────────────────────┤
                          │ ┌─────────────────────────────────────┐ │
                          │ │ ▶ ⏳ npm run dev   [processing] 2m   │ │  ← RUNNING（折叠态）
                          │ │   npm run dev --port 3000    [Kill]  │ │
                          │ └─────────────────────────────────────┘ │
                          │ ┌─────────────────────────────────────┐ │
                          │ │ ▼ ✅ npm run build [success] 1m45s   │ │  ← COMPLETED（展开态）
                          │ │   npm run build                      │ │
                          │ │ stdout                   [↻ 刷新]    │ │
                          │ │ ┌─────────────────────────────────┐ │ │
                          │ │ │ ✓ Build completed               │ │ │
                          │ │ │ ✓ Output: dist/                 │ │ │
                          │ │ └─────────────────────────────────┘ │ │
                          │ └─────────────────────────────────────┘ │
                          └─────────────────────────────────────────┘
```

**容器样式**：
- absolute 定位，`top: 100%`，`right: 0`，`marginTop: 6`
- 宽 440px，`maxHeight: 520px`，`overflow: auto`
- `borderRadius: 10`，`border: 1px solid var(--color-border)`
- `background: var(--color-bg-primary)`，`boxShadow: 0 8px 24px rgba(15,23,42,0.12)`
- `zIndex: 30`

**标题行**：`⚡` 图标（ThunderboltFilled，primary 色）+ "后台任务"（`backgroundTasks.title`），fontWeight 600，fontSize 13，底部分隔线。

**空列表态**：`BackgroundTaskList` 保留了 antd `Empty` 防御分支，但父组件在 `tasks.length === 0` 时已 `return null`；正常交互路径不会展示空面板，任务集合变空时 Header 入口与已打开面板一并消失。

## 任务行

每个任务渲染为独立的 rounded card（`borderRadius: 8`，`border`，`background: var(--color-bg-secondary)`）。

**折叠态**：
- 左侧：▶ 展开箭头 + 状态图标 + commandName（或 taskId）+ commandLine（mono 11px，`var(--color-text-tertiary)`）
- 右侧：状态 Tag + exitCode（若有）+ 运行时长（`formatElapsed`）+ Kill 按钮（仅 RUNNING）
- 点击左侧按钮区域切换展开/折叠

**展开态**：
- ▼ 折叠箭头 + 同折叠态内容
- 下方追加：输出标签行（"输出" + [↻ 刷新] 按钮）+ stdout `<pre>` 块 + stderr `<pre>` 块
- 展开时若该任务输出未加载过，自动触发 `loadOutput`（并行加载 stdout + stderr）

**排序**：按 `startedAt` 降序（最新在前）。

## 状态矩阵

| 状态 | 图标 | Tag color | Kill 按钮 | 说明 |
|---|---|---|---|---|
| RUNNING | ⏳ LoadingOutlined（primary 色） | processing | ✅（Popconfirm 确认） | 由 REST seed 或 `BACKGROUND_TASK_STARTED` 建立，流事件实时更新 |
| COMPLETED | ✅ CheckCircleFilled（success 色） | success | ❌ | 由 REST seed 或 `BACKGROUND_TASK_COMPLETED` 建立/更新 |
| FAILED | ❌ CloseCircleFilled（error 色） | error | ❌ | 由 REST seed 或 `BACKGROUND_TASK_FAILED` 建立/更新，通常对应非零退出码 |
| KILLED | ⏹️ CloseCircleFilled（灰色） | default | ❌ | Kill REST 成功后立即写入本地 override；页面重载后可由 REST seed 恢复 |

状态图标与 Tag color 分别由组件内 `statusIcon`、`statusColor` 映射。

## 输出展示

- 展开任务行时并行加载 stdout + stderr（`Promise.all`），各限 65536 字节（`OUTPUT_LIMIT_BYTES`）
- `<pre>` 块：`maxHeight: 200px`，`overflow: auto`，monospace 12px，`lineHeight: 1.5`，`whiteSpace: pre-wrap`，`overflowWrap: anywhere`，`wordBreak: break-word`
- 截断时底部显示 `…`
- [↻ 刷新] 按钮手动重新加载输出（`loadOutput`）
- 加载中显示 `Spin`
- 加载失败显示错误文案（`backgroundTasks.outputLoadFailed`）
- 空输出显示 `backgroundTasks.outputEmpty`
- 任务状态走 stream，但输出详情不随 stream 推送；首次展开按需读取，后续只在用户点击刷新时重新读取

## Kill 交互

- 仅 RUNNING 状态显示 Kill 按钮（`task.status === "RUNNING"`）
- Kill 按钮：antd `Button`，`danger`，`type="text"`，`StopOutlined` 图标
- 点击触发 Popconfirm（`backgroundTasks.killConfirm`）→ 确认后调用 `backgroundTaskService.killTask`
- Kill 发送 **SIGTERM**（非 SIGKILL），进程可捕获并优雅退出
- Kill REST 成功后，组件立即把该任务本地覆盖为 KILLED，并重新加载该任务输出；**不会**再次调用列表 GET
- 当前没有 `BACKGROUND_TASK_KILLED` stream event，本地 override 的优先级高于 REST seed 与已有 stream envelope
- Kill 失败：Tooltip 显示 `backgroundTasks.killFailed`
- Kill 进行中：按钮 `loading`，Popconfirm `disabled`

## REST API

不重复定义，详见 `tool-ui-interface-overview.md` §6。三个端点：

| 端点 | 方法 | 本组件消费 | 作用 |
|---|---|---|---|
| `/api/v1/sessions/:sessionId/background-tasks` | GET | ✅ session mount / session 切换时一次性 seed | 恢复刷新前已存在的任务，并补齐 stream payload 不携带的 `commandLine`；不是轮询 |
| `/api/v1/sessions/:sessionId/background-tasks/:taskId/output?stream=stdout\|stderr&limitBytes=` | GET | ✅ 首次展开 + 手动刷新 | 按需读取 stdout/stderr（每个 stream 限 65536 字节） |
| `/api/v1/sessions/:sessionId/background-tasks/:taskId/kill` | POST | ✅ Kill 按钮 | 发送 SIGTERM；成功后由前端写入本地 KILLED override |

服务定义见 `frontend/agent-web/src/services/backgroundTaskService.ts`。任务数据模型 `BackgroundTaskView` 包含 `taskId` / `commandName` / `commandLine` / `status` / `startedAt` / `finishedAt` / `exitCode` / `stdoutRef` / `stderrRef`。

### taskType 泛化方向（UCD 设计建议）

> ⚠️ 当前 `BackgroundTaskView` 仅承载 Bash `run_in_background: true` 的 shell 进程。按"任务输出与上下文解耦原则"（`conversation-ui-state.md` 同名章节），后台任务应泛化为承载**任何工具调用**的"转后台"形态——Bash 是首个实例，未来应支持网络诊断、配置审计等长时工具转后台。

**数据模型扩展**（须先由对应 OpenSpec change 定义）：

| 字段 | 类型 | 适用 taskType | 说明 |
|---|---|---|---|
| `taskType` | `"shell" \| "tool"` | 两者 | 任务类型，区分 Bash 后台进程与其他工具转后台 |
| `taskId` | string | 两者 | 任务 ID（即 `backgroundHandle`） |
| `status` | running/completed/failed/killed | 两者 | 任务状态 |
| `startedAt` / `finishedAt` | ISO string | 两者 | 时间戳 |
| `commandName` / `commandLine` | string | shell | Bash 命令名与命令行（shell 专属） |
| `exitCode` | number \| null | shell | 退出码（shell 专属） |
| `stdoutRef` / `stderrRef` | string | shell | stdout/stderr 引用（shell 专属） |
| `toolName` | string | tool | 工具名（tool 专属） |
| `progress` | number \| null | tool | 进度百分比（tool 专属，工具按能力提供） |
| `safeResultRef` | string | tool | 结构化结果引用（tool 专属） |

**REST API 扩展**：
- `GET /api/v1/sessions/:sessionId/background-tasks` 响应包含 `taskType` 字段
- `POST /api/v1/sessions/:sessionId/background-tasks/:taskId/kill` 内部按 `taskType` 分发：shell → SIGTERM；tool → 工具 cancel API（依赖 B20）
- tool 类型的输出读取：`GET .../output` 返回结构化 safeResult 而非 stdout/stderr

**UI 呈现差异**：
- shell 类型：展开显示 stdout/stderr（终端风格）
- tool 类型：展开显示结构化 safeResult 卡片 + 进度条（若 `progress` 非 null）
- 两种类型在 `⚡` 列表中以图标区分（shell: `$`；tool: 工具图标）

**与 A3 长时能力扩展态的衔接**：A3 的"转后台" CTA 触发后，inline-running 态的能力卡片转入 backgrounded 态，对应的 `BackgroundTaskView` 中 `taskType="tool"` 记录出现在 `⚡` 面板。对话流中保留"任务已转后台"标记卡片，含 `backgroundHandle` 作为回到 `⚡` 面板的入口。

## 数据同步（非轮询）

当前组件没有 `POLL_INTERVAL_MS`、`setInterval` 或 2 秒列表轮询。任务集合按以下三层合成，后层覆盖前层：

| 层级 | 来源 | 时机 | 作用 |
|---|---|---|---|
| 1. REST seed | `backgroundTaskService.listTasks(sessionId)` | session mount / sessionId 变化时一次 | 页面刷新恢复、弥补连接前已启动任务，并提供 stream payload 缺少的 `commandLine` |
| 2. canonical stream | `useConversationStore.envelopesBySession[sessionId]` 中的 `BACKGROUND_TASK_STARTED/COMPLETED/FAILED` | 随会话 SSE/WebSocket 到达 | 按 store 中的 canonical `sequence` 顺序叠加实时状态；同一 task 的流事实覆盖 seed |
| 3. local kill override | 成功的 `killTask` POST | 用户确认 Kill 后 | 因无 KILLED stream event，立即固定本地 KILLED 终态，覆盖 seed 与流事实 |

- channel projection 已把三个 `BACKGROUND_TASK_*` 类型纳入可投影的 canonical stream envelope，并只复制安全任务字段。
- `STARTED` upsert RUNNING；`COMPLETED` / `FAILED` 更新已有任务，若错过 STARTED 也能建立缺少 `commandLine` 的最小任务视图。
- seed 请求失败会被静默忽略；已有/后续 stream event 仍可驱动任务状态，但当前不会定时重试列表 GET。
- 组件卸载时取消尚未完成 seed 的写回，并清理共享 background-task snapshot，避免陈旧 RUNNING 状态维持会话流连接。
- 这些 envelope 是 Header 监控的数据输入，不会因此成为对话消息或 `ProcessPanel` entry。

## 与 capability-card 内联追踪区的关系

当前 Header 监控使用“一次性 REST seed + canonical stream”的组合数据源；capability-card 内联追踪区仍是 UCD 设计建议，尚不存在可声称复用的数据接线。

| 维度 | `⚡` header 下拉面板 | capability-card 内联追踪区 |
|---|---|---|
| 位置 | chat pane header `headerExtra` | ProcessPanel 内 capability-card 底部 |
| 范围 | 本会话**所有**后台任务（跨卡片） | 单张卡片自身后台句柄（概念术语 `backgroundHandle`，即 `taskId`）对应的任务 |
| 定位 | 快速查找（多任务/多轮对话后定位目标任务） | 详细观测/控制（与卡片上下文绑定） |
| 实现状态 | ✅ 已实现 | ⚠️ UCD 设计建议 |

两者互补——`⚡` 用于跨卡片快速定位，内联追踪区用于单任务详情。详见 `capability-card.md`（commandOutput + backgroundHandle 扩展）。

## 与 `⏰` Cron 管理面板的区别

详见 `cron-task.md` 对比表（位置 / scope / 生命周期 / 实时性 / 实现状态）。核心区分：

- `⚡`：per-session、一次性任务（执行完结束）、一次性 REST seed + session stream 实时更新、已实现
- `⏰`：agent 级跨会话、持久化任务（一直生效直到删除）、按需查看、UCD 设计建议

## live 模式 vs history / 页面刷新

| 维度 | live 模式 | history / 页面刷新 |
|---|---|---|
| 初始任务集合 | session mount 时一次性 REST seed | 一次性 REST seed 恢复已有任务与 `commandLine` |
| 后续状态 | 复用会话 stream，按 `BACKGROUND_TASK_*` envelope 更新 | 若会话 stream 仍打开/恢复，则继续叠加 envelope；没有周期性列表刷新 |
| RUNNING 任务 | 可能有，Kill 可用 | 通常无；若 seed 返回 RUNNING，ChatPage 会维持会话 stream 以等待终态 |
| Kill 按钮 | RUNNING 时显示 | 通常不显示（无 RUNNING） |
| 输出引用 | 实时有效 | 可能已过期（后端存储可能清理） |
| `⚡` 显示 | derived tasks 非空时显示 | seed / stream 合成结果非空时显示 |

history 恢复依赖任务列表 seed，不依赖把后台任务事件渲染成历史消息；canonical envelope 只作为状态合成输入。

## 约束

- **无任务时隐藏**（`return null`），不占用 header 空间
- **per-session**：只显示当前会话的后台任务，不跨会话
- **canonical event 驱动但不生成消息 entry**：`BACKGROUND_TASK_STARTED/COMPLETED/FAILED` 已进入 channel stream envelope；Header monitor 消费它们更新任务状态，`ProcessPanel` 不据此新增 entry
- **无独立轮询**：列表 GET 每次 session mount / sessionId 变化只调用一次；实时状态复用会话 stream
- **Escape 键关闭下拉面板**，不关闭 `⚡` 本身
- **下拉面板 absolute 定位**：`right: 0`，不随消息流滚动
- **SIGTERM 终止**：Kill 发送 SIGTERM，非 SIGKILL，进程可优雅退出
- **输出限制 65536 字节/流**：超出截断显示 `…`
- **输出按需读取**：首次展开自动读取，之后仅手动刷新；任务状态更新不自动刷新输出
- **KILLED 为本地补偿路径**：当前无对应 stream event，Kill 成功后由 local override 保持终态
- **无 Agent continuation**：自然完成与 Kill 都只更新任务终态/timeline，不提交 chat notification 或新的 RequestRun；stdout/stderr 仅由用户通过 monitor 按需读取。未来若需把结果恢复到 Agent 上下文，必须另立 contract change
- **sessionId 为空时不发 REST 请求**：避免空 sessionId 命中不存在的路由

## 动态行为与交互响应

> 跨组件的通用模式见 `02-dynamic-behavior-and-interaction.md`。本节补充后台任务监控特有行为。

### 已实现

| 行为 | 说明 | 代码位置 |
|------|------|---------|
| RUNNING 状态指示 | LoadingOutlined（primary 色）+ processing Tag | `statusIcon` / `statusColor` |
| 流式状态迁移 | canonical `BACKGROUND_TASK_*` envelope 按顺序叠加，更新 Badge 与任务行 | `deriveTasks` / `applyBackgroundTaskEvent` |
| Kill 操作反馈 | Popconfirm 确认 → loading/disabled → REST → local KILLED override | `handleKill` / `handleTaskKilled` |
| 输出加载 | 首次展开和手动刷新时显示 Spin，并按需读取 stdout/stderr | `loadOutput` / `handleExpand` |
| FAILED 状态视觉 | error Tag；输出读取失败单独显示 `outputLoadFailed` | `statusIcon` / output branch |
| 面板 appear/disappear | `tasks.length > 0` 时渲染，`=== 0` 时 return null | render guard |

### UCD 设计建议

| 行为 | 说明 |
|------|------|
| Badge appear/disappear | 后台任务数量变化时 Badge scale 动画 150ms |
| 下拉面板 expand/collapse | slide-down/up 200ms |
| 列表项 hover | hover 时背景色变化 120ms |
| 任务状态变化 | RUNNING → COMPLETED/FAILED/KILLED 时图标过渡 + 色调变化 200ms |
| 面板 appear | 首次有任务时 fade-in 200ms |
| 面板 disappear | derived tasks 真正变空后 fade-out 200ms；“全部终态”本身不等于清空 |
| focus | `focus-visible` outline 2px primary + offset 2px |
