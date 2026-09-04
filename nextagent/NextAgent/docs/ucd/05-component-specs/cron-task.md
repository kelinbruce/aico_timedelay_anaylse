# 组件规范：Cron 定时任务（Cron Task）

> **状态基线（2026-08-13）**：Cron Tool 的 `safeResult.kind="cron"` 已由后端投影，前端 parser 与 create/delete/list 本地化 formatter 已进入主干。独立 Cron Dashboard、可信 Owner + Agent scope 管理 API、创建/修改/删除/即时执行、执行记录和日期/任务筛选也已交付。两条呈现路径职责不同：能力卡片记录对话内 Tool 操作结果，Dashboard 管理 Owner + Agent scope 下的持久化任务与执行记录。

## 职责

Agent 通过 Cron 工具管理定时任务——创建定时 prompt、列出当前 scope 的任务、按 ID 删除任务。任务在 ProcessPanel 中以能力卡片呈现，展示操作类型、任务 ID、调度计划。

典型场景：用户说"每天早上 9 点检查网络拓扑并报告异常"，Agent 调用 Cron 工具 `action=create`，能力卡片显示"定时任务已创建：每天 09:00（recurring）"。

## Cron 工具定义

来源：`packages/agent-capability/src/builtins/cron/cron-tool.ts`。

| 属性 | 值 |
|---|---|
| capabilityId | `Cron` |
| replayPolicy | `NON_IDEMPOTENT` |
| disclosurePolicy | `EAGER` |
| requiredDependencies | `cronTasks` |

### 三种 action

| action | 说明 | 输入参数 | 输出 |
|---|---|---|---|
| **create** | 创建定时任务 | `cron`（5 字段 cron 表达式）、`prompt`（定时触发的 prompt）、`recurring`（默认 true） | `{ action, id, humanSchedule, recurring }` |
| **list** | 列出当前 scope 的所有任务 | 无 | `{ action, jobs: [...] }` |
| **delete** | 按 ID 删除任务 | `id` | `{ action, id }` |

### cron 表达式

标准 5 字段 cron，使用进程本地时区：

```
minute hour day-of-month month day-of-week
```

- `"0 9 * * *"` → 每天 09:00
- `"*/5 * * * *"` → 每 5 分钟
- `recurring=false` → 单次提醒（仅触发一次，触发后任务自动结束，任务记录保留为 COMPLETED 状态）

> Cron 工具建议避免使用 `:00` 和 `:30` 分钟标记，以分散集群负载（`cron-tool.ts` L18）。

## 后端投影（已实现）

来源：`packages/agent-channel-common/src/projections/stream-envelope.ts` L400-401、L458-510。

后端在投影层**有**显式 `capabilityId` 检查：

```typescript
if (readString(source.capabilityId) === "Cron") {
  return projectCronSafeResult(result);
}
```

`projectCronSafeResult` 为三种 action 生成 `safeResult.kind = "cron"` 投影：

### create 投影

```json
{
  "safeSummary": "Cron task was created.",
  "detailText": "Task: cron-abc123\nSchedule: Every day at 09:00",
  "safeResult": {
    "kind": "cron",
    "action": "create",
    "id": "cron-abc123",
    "humanSchedule": "Every day at 09:00",
    "recurring": true
  }
}
```

### delete 投影

```json
{
  "safeSummary": "Cron task was deleted.",
  "detailText": "Task: cron-abc123",
  "safeResult": {
    "kind": "cron",
    "action": "delete",
    "id": "cron-abc123"
  }
}
```

### list 投影

```json
{
  "safeSummary": "Found 2 Cron tasks.",
  "detailText": "cron-abc123: Every day at 09:00 (0 9 * * *)\ncron-def456: Every 5 minutes (*/5 * * * *)",
  "safeResult": {
    "kind": "cron",
    "action": "list",
    "jobs": [
      { "id": "cron-abc123", "cron": "0 9 * * *", "humanSchedule": "Every day at 09:00", "recurring": true },
      { "id": "cron-def456", "cron": "*/5 * * * *", "humanSchedule": "Every 5 minutes", "recurring": true }
    ],
    "totalCount": 2,
    "truncated": false
  }
}
```

> list 投影最多 50 条（`resultListPreviewMaxItems`），超出时 `truncated: true`。

## 前端消费（已实现）

来源：`frontend/agent-web/src/features/chat/utils/safeCapabilityResult.ts`。

| 层 | 状态 | 说明 |
|---|---|---|
| 后端投影 | ✅ 已实现 | `projectCronSafeResult` 生成 `kind: "cron"` |
| 前端 `SafeCapabilityResult` 类型 | ✅ 包含 `cron` kind | create/delete/list 三种受限结构 |
| 前端 `readSafeCapabilityResult` | ✅ fail-closed 解析 | 只接受各 action 的精确安全字段和有界值 |
| 前端 `describeSafeCapabilityResult` | ✅ 专门渲染 | 使用当前界面语言的字段标签和状态文案 |
| ProcessPanel 呈现 | ✅ 结构详情 | create/delete/list 使用与 action 匹配的安全详情 |

**当前 UI**：ProcessPanel 标题行显示 `Cron` 的业务身份与终态；用户展开后，create 显示任务 ID、human schedule、recurring 和可选 delay，delete 显示任务 ID，list 显示有界任务清单、总数与截断事实。任务 prompt 不进入安全投影。

## Cron kind 当前渲染

### create 卡片

**recurring=true（循环任务）**：
```
┌─ 🔧 Cron · ✅ 已完成 ────────────────────────────┐
│  ⏰ 定时任务已创建                                │
│                                                   │
│  任务 ID：cron-abc123                             │
│  调度计划：Every day at 09:00                     │
│  循环：✅ 是                                      │
│  cron 表达式：0 9 * * *                           │
└───────────────────────────────────────────────────┘
```

**recurring=false（单次提醒，触发一次后任务自动结束，任务记录保留）**：
```
┌─ 🔧 Cron · ✅ 已完成 ────────────────────────────┐
│  ⏰ 单次提醒已创建                                │
│                                                   │
│  任务 ID：cron-xyz789                             │
│  调度计划：Tomorrow at 09:00                      │
│  循环：❌ 否（单次）                              │
│  cron 表达式：0 9 15 7 *                          │
│  （仅触发一次，触发后任务自动结束）                │
└───────────────────────────────────────────────────┘
```

### delete 卡片

```
┌─ 🔧 Cron · ✅ 已完成 ────────────────────────────┐
│  🗑️ 定时任务已删除                                │
│                                                   │
│  任务 ID：cron-abc123                             │
└───────────────────────────────────────────────────┘
```

### list 卡片

> ℹ️ Cron Tool 的 list 仍按 **session scope** 查询。独立 Dashboard 使用可信 Owner + Agent scope 的管理 API；这不改变 Tool list 的既有语义。

**有任务**：

```
┌─ 🔧 Cron · ✅ 已完成 ────────────────────────────┐
│  📋 当前会话有 2 个定时任务                       │
│                                                   │
│  ┌──────────────────────────────────────────┐    │
│  │ cron-abc123  Every day at 09:00  [循环]  │    │
│  │ 0 9 * * *                                │    │
│  ├──────────────────────────────────────────┤    │
│  │ cron-def456  Every 5 minutes             │    │
│  │ */5 * * * *                              │    │
│  └──────────────────────────────────────────┘    │
│  （最多显示 50 条，超出截断）                     │
│              [⏰ 查看所有会话的定时任务 →]         │
└───────────────────────────────────────────────────┘
```

**空列表（当前会话无任务）**：

```
┌─ 🔧 Cron · ✅ 已完成 ────────────────────────────┐
│  📋 当前会话无定时任务                            │
│                                                   │
│  其他会话可能有定时任务。                          │
│              [⏰ 查看所有会话的定时任务 →]         │
└───────────────────────────────────────────────────┘
```

**CTA 状态**：独立 Dashboard 已有侧边栏入口；从 Cron Tool list 卡片直接跳转 Dashboard 的 CTA 仍未实现，不应与 Dashboard 主路径混为一项。

## live 模式 vs history 模式

| 维度 | live 模式 | history 模式 |
|---|---|---|
| 能力卡片渲染 | ✅ CAPABILITY_* 事件实时渲染 | ✅ 由持久化消息重建 |
| safeResult 消费 | 终态到达后使用专门 formatter | 从持久化结果重建并使用同一 formatter |
| 独立任务管理 | Dashboard 使用稳定 management API | 同一独立 route；不依赖 conversation history 重建 |

> Cron 任务是**持久化的**。用户既可通过对话让 Agent 调用 Cron Tool 查看当前 session scope 的任务，也可从侧边栏进入独立 Dashboard 管理当前可信 Owner + Agent scope 下的任务。Dashboard 不通过 Tool、runtime command 或 stream event 读取数据。

## 与 capability-card 后台任务追踪区的区别

| 维度 | Cron 定时任务（本规范） | capability-card 后台任务追踪区（`capability-card.md`） |
|---|---|---|
| 工具 | Cron 工具 | Bash 工具（`run_in_background`） |
| 任务类型 | 定时触发 prompt（调度执行，周期性） | 后台 shell 进程（持续运行，单次执行） |
| 监控入口 | `[已实现-主干]` 侧边栏 Cron Dashboard | `[已实现-主干]` header `⚡` monitor；`[UCD目标]` capability-card 终态内联追踪区 |
| 状态追踪 | `[已实现-主干]` management API 按需查询任务和执行记录 | `[已实现-主干]` header monitor 使用一次 REST seed + session stream live update + Kill local override；目标内联区若实施必须复用同一 snapshot |
| 事件类型 | 走标准 CAPABILITY_* 事件 | `BACKGROUND_TASK_STARTED/COMPLETED/FAILED` canonical stream envelopes（不生成 ProcessPanel entry） |
| 前端呈现 | `[已实现-主干]` 独立 Dashboard + ProcessPanel Cron 专门结果详情 | `[已实现-主干]` header `⚡` monitor；`[UCD目标]` capability-card 终态内联追踪区 |

## 约束

- **5 字段 cron 表达式**：`minute hour day-of-month month day-of-week`，进程本地时区。
- **prompt 长度限制**：Tool 与 management API 的后端上限为 10,000 字符；当前 Dashboard 手动创建/修改表单的前端 `maxLength` 为 1,000 字符。测试时必须分别覆盖 UI 门禁和直接 API 门禁，不得把较窄的表单限制写成平台上限。
- **cron 表达式最大长度**：256 字符（`cronExpressionMaxLength`）。
- **recurring 默认 true**：未指定时为循环任务；`recurring=false` 为单次提醒。
- **scope 隔离**：Cron Tool `action=list` 当前按 session scope 查询；独立 management API 按 trusted Owner + active Agent scope 查询。两者不得互相覆盖语义。
- **NON_IDEMPOTENT**：创建和删除操作不可重放。
- **前端安全消费**：只读取 `cron` safeResult 白名单字段；非法 shape fail closed，不从 raw result 补建详情。
- **Dashboard 支持创建和修改**：手动表单与“通过会话创建”是两条受支持入口。
- **list 最多 50 条**：投影层截断，`truncated: true` 标记。
- **ACTIVE task 容量**：同一 trusted Owner + active Agent scope 最多 50 个 ACTIVE task；COMPLETED/DELETED 不占额度。第 51 个创建在 Tool 路径返回 `CRON_TASK_LIMIT_REACHED` safe error，在 management API 返回 HTTP 409；该行为已进入主干，对应 active change 待归档。

> ℹ️ 完整 Cron 限制见 `11-ux-limits-and-constraints.md` §4。

## Cron 管理面板

> **实现状态标注**：独立 Cron Dashboard 已实现，稳定契约见 `agent-web-cron-task-dashboard` 与 `cron-task-management-api`。以下以当前 route 页面为准；早期“600px Modal + 运行中/已结束 Tab”草案已废弃，不再作为实现目标。

### 职责

提供独立于对话的持久化任务管理入口。页面在可信 Owner + 当前 Agent scope 下查看和操作 Cron task，不接受客户端提供 owner/agent/session/run 坐标。

### 入口

local/immersive 左侧 Sidebar 在新建会话入口下方提供“定时任务”入口，点击导航到 `/cron-tasks`。导航只改变 browser route/view state，不创建或加载 chat session，也不修改 conversation truth。

与 `⚡` 后台任务监控入口的区别：

| 维度 | `⚡` 后台任务监控 | `⏰` Cron 管理面板 |
|---|---|---|
| 位置 | `RightPaneLayout` header（per-session） | 侧边栏独立 route `/cron-tasks` |
| Scope | 当前 session 的后台任务 | trusted Owner + active Agent scope |
| 生命周期 | 一次性任务（执行完结束） | 持久化任务（一直生效直到删除） |
| 实时性 | session stream 实时更新；mount 时一次 REST seed | 打开/操作/筛选时按需查询 management API |
| 实现状态 | ✅ 已实现（`BackgroundTaskMonitorPanel.tsx`） | ✅ 已实现（`CronTaskDashboardPage.tsx`） |

### 面板布局

页面使用与会话界面一致的最大内容宽度并居中。顶部 Header 显示“定时任务管理”，并提供“手动创建”和 primary 风格的“通过会话创建”。主体分为两个 Tab：

- **任务**：单列任务卡片，header 显示标题、即时执行、更多操作和启用 switch；content 显示任务描述；footer 显示时间、频率和创建人。
- **执行记录**：可按任务名称和起止日期筛选；指定任务时只加载该任务最多 50 条记录，未指定任务时对当前已加载的最多 50 个任务分别加载最多 50 条并在客户端合并。左侧时间线按执行记录逐项排列、每个日期仅首项显示日期与当日计数，并按 COMPLETED/FAILED/其他状态着色；右侧为执行记录卡片。详情默认收起，可查看 trigger/run/commit 状态、sessionId、requestRunId 和安全 terminal result。

**任务 Tab（当前实现）**：

```
┌─ 定时任务管理 ────────────────────────────────────┐
│                         [手动创建] [通过会话创建] │
├────────────────────────────────────────────────────┤
│  [任务] [执行记录]                                 │
├────────────────────────────────────────────────────┤
│  网络拓扑巡检                         [执行] [⋯] ● │
│  检查网络拓扑并报告异常                           │
│  每天 09:00 · 循环                    创建人：张三 │
└────────────────────────────────────────────────────┘
```

### 交互

| 操作 | 行为 |
|---|---|
| 点击侧边栏入口 | 导航到 `/cron-tasks`，保留会话和收藏持久化数据 |
| 手动创建/修改 | 表单校验非空 cron/prompt 后调用 management API；成功后刷新列表 |
| 执行 | 触发一次即时执行，选择该 task 并切换到执行记录 Tab |
| 更多操作 | 提供修改和删除；删除需确认，成功后刷新列表 |
| 开启 switch | 表示 task 是否开启；不得同时展示第二个“激活”按钮 |
| 筛选执行记录 | 输入任务名称可选择当前已加载任务；精确匹配时只请求该任务记录，任务名为空时并发请求当前已加载任务的记录，再按任务标题/ID及 `scheduledAt` 日期段在客户端筛选 |
| 查看详情 | 展开安全 execution DTO；不得自动打开对应 chat session |

**失败文案边界**：`CRON_INVALID_EXPRESSION`、`CRON_TASK_LIMIT_REACHED`、`CRON_TASKS_UNAVAILABLE` 等已登记 code 会映射到当前 locale；没有稳定 code 的普通 `Error` 当前直接显示其 message，再提供“重试”等恢复操作。测试不能假设所有无 code 错误都会替换为本地化 fallback。

### REST API（已实现）

| 端点 | 作用 |
|---|---|
| `GET /api/v1/cron-tasks` | 查询当前 trusted Owner + active Agent scope 的 task page |
| `POST /api/v1/cron-tasks` | 创建 task |
| `PUT /api/v1/cron-tasks/:taskId` | 修改 active task |
| `DELETE /api/v1/cron-tasks/:taskId` | 删除 task |
| `POST /api/v1/cron-tasks/:taskId/runs` | 触发一次即时执行 |
| `GET /api/v1/cron-tasks/:taskId/runs` | 查询安全 execution records |

请求体不得接受 owner、agent、session、run 或 prompt override 等越权坐标。响应使用 public DTO，不暴露 Gateway Record、SQLite row、idempotency key、version、raw provider error、credential 或 token。

### 与能力卡片的关系

| 维度 | Cron 管理面板 | 能力卡片（cron kind） |
|---|---|---|
| 定位 | 持续管理入口（查看全部任务、直接删除） | 操作历史记录（记录 Agent 调用 Cron 工具的 create/list/delete 操作） |
| 数据来源 | 已冻结 Cron management API | stream 事件（CAPABILITY_* 事件流） |
| 创建 | ✅ 手动创建或通过会话创建 | ✅ Agent 调用 `action=create` 时呈现本地化安全结构详情 |
| 删除 | ✅ 用户直接点击 [🗑] 删除 | ✅ Agent 调用 `action=delete` 时呈现删除卡片 |
| 持久性 | 面板关闭后重新打开仍可查看全部任务 | 能力卡片随 turn 持久化，history 模式重建 |

### live vs history

| 维度 | live 模式 | history 模式 |
|---|---|---|
| Dashboard 可用 | 独立 route 可用 | 独立 route 可用；不依赖当前 turn 是 live 或 history |
| 任务列表 | trusted Owner + active Agent scope | 同 live |
| 创建/修改/删除/执行 | 通过 management API | 同 live |
| 与能力卡片的关系 | 管理面板独立于对话；能力卡片记录 Agent 操作历史 | 同 live |

### 约束

- **查询 scope**：management API 同时校验 trusted Owner Scope 与 active Agent Scope；请求体和 query 不接受客户端自报 scope。
- **Task 与 execution 分离**：任务 Tab 管理定义，执行记录 Tab 只读呈现安全 execution DTO；不得从执行记录自动导航到 chat session。
- **筛选边界**：任务名称和日期段筛选在已加载数据上完成，不向 `/runs` API 发送未定义筛选字段。
- **安全详情**：只展示 stable spec 允许的 trigger/run/commit 状态、opaque ids 与 safe terminal result；不展示 raw provider error、stack、credential 或 token。
- **删除需确认**：删除前二次确认，成功后刷新 task 列表并清理当前选中 task 的执行详情。

## UCD 设计建议

- **下次触发时间**：`humanSchedule` 是人类可读的调度描述，UCD 设计人员可考虑额外显示"下次触发：2026-07-14 09:00"（需后端在投影中增加 `nextRunAt` 字段）。
- **prompt 不披露**：Cron Tool 的安全结果投影不包含任务 prompt；不得由前端从原始结果补建 prompt 预览。
- **时区显示**：cron 表达式使用进程本地时区，UCD 设计人员可在卡片中显示当前时区（如"UTC+8"）。
- **创建后的 confirmation**：Cron 创建是 NON_IDEMPOTENT 操作，UCD 设计人员可考虑在创建前通过 pending input 让用户确认调度计划。

## 动态行为与交互响应

> 跨组件的通用模式见 `02-dynamic-behavior-and-interaction.md`。本节补充 Cron 任务卡片特有行为。

### UCD 设计建议

| 行为 | 说明 |
|------|------|
| 创建成功反馈 | Cron 任务创建成功时卡片 fade-in + success 色高亮 1s |
| Dashboard route 切换 | 使用宿主既有 route/view transition，不创建会话副作用 |
| 任务卡 hover | hover 时背景色变化 120ms |
| 执行详情展开 | 点击“查看详情”展开安全 execution DTO |
| 删除动画 | 删除任务时 fade-out 150ms + height collapse 200ms |
| running state | Cron 能力执行时走标准 CAPABILITY_* 流，running 态动画见 `capability-card.md` |
| nextRunAt 倒计时 | 显示距下次执行的倒计时，每秒更新 |

> 上表中 Dashboard 基础交互已实现；创建成功高亮、删除动画和 nextRunAt 倒计时仍是可选 UCD 建议，不是稳定契约。
