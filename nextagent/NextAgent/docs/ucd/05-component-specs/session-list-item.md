# 组件规范：会话列表项（Session List Item）

> 长期设计导航：`openspec/designs/architecture/conversation-ui-state.md` 第 6 节。当前列表事实以 `ts-run-status-visibility`、Web public DTO、当前前端代码和测试为准；本文档是 UCD 设计表达层，非 OpenSpec 基线，不定义契约。

## 职责

渲染会话列表中的单条会话项，支持用户切换会话、识别 live 与历史会话。

> **状态基线（2026-08-13）**：会话活动由 `cross-session-activity-awareness` 稳定规格和共享 `SessionActivityTrailingSlot` 承载；未标状态的视觉与行为按 `[UCD目标]` 理解。任务准入以 [`docs/roadmap/ucd-capability-delivery.md`](../../roadmap/ucd-capability-delivery.md) 为准。

## 内容

- 会话标题（`session-title-generation`、`session-title-update`）。
- 最后活动时间。
- `[UCD目标]` sidebar preview marker（`session-conversation-preview` 已有 API/当前会话 marker rail 消费，但 sidebar 未消费）。
- `[已实现-主干]` 会话注意力状态：等待输入、运行中、未读失败、未读结果或普通时间。

## 展开与折叠

- 会话列表整体可展开/折叠。
- 展开偏好存储在 sessionStorage，key 为 `nextagent.sidebar.sessionListExpanded`（来源：`sessionListPreference.ts` L3-19；spec 依据：`ts-run-status-visibility` 的 `Frontend local view state MUST remain visually and navigationally stable` scenario "Restored expanded session list requests the expanded page size"）。
- 刷新后若偏好为展开，mount-time session-list refresh MUST 请求 expanded page size，保留 expanded history data window。
- 折叠时更新偏好，下次 refresh 返回 recent-session page size。
- 来源：`ts-run-status-visibility` 的 `Frontend local view state MUST remain visually and navigationally stable`。

## 会话活动与历史会话

| 维度 | 需要注意的会话 | 普通历史会话 |
|---|---|---|
| 视觉标识 | `WAITING_FOR_INPUT` tag、`RUNNING` loading、`UNREAD_FAILURE` 红色感叹号或 `UNREAD_RESULT` 蓝点 | 显示最后活动时间 |
| 点击行为 | 加载历史 + 接入 live stream | 仅加载历史消息 |
| truth 来源 | 独立 Session Activity Projection Stream | session list/history data |
| 当前会话 | conversation surface 可见时本地抑制 marker，仍保留 store truth | 显示时间 |

### 会话列表项视觉样例

**当前会话 + run 活跃**（高亮 + 进行中动画）：
```
┌─ 会话列表 ──────────────────────────────────┐
│ ●● 网络诊断排障          14:30              │  ← 高亮 + 脉冲点 ●●
│    "排查 Edge-RTR-02 丢包…"  [⏳ 执行中]    │  ← live 会话 + 当前选中
├─────────────────────────────────────────────┤
│ ▸  OSS 配置咨询          昨天               │  ← 历史会话
│    "如何配置 Bucket 生命周期…"              │
├─────────────────────────────────────────────┤
│ ▸  VPC 网络规划          7/12               │  ← 历史会话
│    "新建 VPC 需要哪些参数…"                 │
└─────────────────────────────────────────────┘
```

**后台会话 + run 活跃**（非高亮 + 小型进行中指示）：
```
┌─ 会话列表 ──────────────────────────────────┐
│ ▸  OSS 配置咨询          14:28              │  ← 当前选中（历史会话）
│    "如何配置 Bucket 生命周期…"              │
├─────────────────────────────────────────────┤
│ ●  网络诊断排障          14:30              │  ← 后台会话 + run 活跃
│    "排查 Edge-RTR-02 丢包…"  [⏳ 后台执行]  │  ← 非高亮 + 小型指示
└─────────────────────────────────────────────┘
```

**后台会话 + run 已完成**（已实现的未读终态 Activity）：
```
┌─ 会话列表 ──────────────────────────────────┐
│ ▸  网络诊断排障          14:35              │  ← 短暂高亮
│    "排查 Edge-RTR-02 丢包…"  [✅ 已完成]    │  ← 终态角标
├─────────────────────────────────────────────┤
│ ▸  configAudit           14:32              │  ← 终态角标
│    "审计网络设备配置…"      [❌ 已失败]      │  ← 不同终态
└─────────────────────────────────────────────┘
  ← 未读结果为蓝点，未读失败为红色感叹号；匹配终态 presentation 可见后才消费
```

## 多会话后台 run 指示

用户可在多个会话间切换。切换会话时，前一会话的 run **继续在后台执行**，不被取消。会话列表需要指示"该会话有后台 run 正在执行"。

### 数据来源

`[已实现-主干]` 浏览器 app instance 建立一条 Owner + Agent scope 的 Session Activity Projection Stream，消费严格的 snapshot/delta 协议。该流独立于当前会话的 Request Execution Stream、session list 分页和当前打开的 session；不得包装为 `StreamEnvelope` 或要求每个后台会话建立 conversation transport。

### 后台 run 视觉指示

> **稳定交付边界**：五态优先级固定为 `WAITING_FOR_INPUT > RUNNING > UNREAD_FAILURE > UNREAD_RESULT > NONE`。四个用户可见会话入口复用同一个 activity store、selector、trailing slot 和 accessibility 文案。

会话列表项按五态优先级投影以下用户可见状态：

| 状态 | 触发条件 | 视觉指示建议 |
|---|---|---|
| **等待输入** | 当前有效 run 有 active pending input | locale-backed 紧凑 tag，按 QUESTION/CONFIRMATION/AUTHORIZATION/HUMAN_HANDOFF 区分文案 |
| **后台运行中** | 当前有效 run 非终态且无 active pending input | 小型 loading indicator |
| **未读失败/结果** | 当前有效 run 已提交失败/完成 terminal fact 且未匹配消费 | 红色感叹号/蓝点 |
| **普通状态** | 无需注意或当前 conversation surface 可见时本地抑制 | 最后活动时间 |

### 未读终态消费

只有 `UNREAD_FAILURE` 和 `UNREAD_RESULT` 可被消费。用户打开会话后，前端必须等匹配 terminal presentation 已成功进入共享 conversation projection 且前台可见，再携带 activityId 与实际呈现的 run id 提交消费。仅点击列表行、加载失败、打开搜索/收藏或切换 host view 都不得提前消费。

### 当前已连接会话的断线重连状态（非列表行）

`continuityPhase` 当前只存在于当前已连接会话的 `runtimeBySession` view state；`SessionHistoryEntry`/`SessionHistoryEntryRow` 不接收或渲染该字段。下表只用于对话区/stream status 的设计导航，**不属于 Session Activity，也不得据此给后台列表行建立平行 transport**。若未来需要列表连接状态，必须先定义独立 public projection 后再准入。

| continuityPhase | 视觉指示 |
|---|---|
| `reconnecting` | 🔄 小型旋转图标 |
| `resyncing` | 🔄 旋转图标 + "同步中" |
| `disconnected` | ⚫ 断开图标 |
| `idle` | 无指示（正常态，无连接活动） |
| `connected` | 无指示（正常态，连接已建立） |

来源：当前 conversation store 与 stream connection 实现；`conversation-ui-state.md` 第 4 节仅作长期导航。

> `idle` 和 `connected` 是正常态，无需视觉指示。仅当连接出现问题时（reconnecting/resyncing/disconnected）才显示图标。

### 5 种 continuityPhase 视觉样例（对话区目标，非列表行）

```
┌─ 当前会话连接状态 ────────────────────────────────┐
│                                                    │
│  idle:         （无指示）                            │  ← 正常态
│  connected:    （无指示）                            │  ← 正常态
│  reconnecting: 🔄 正在重连                           │
│  resyncing:    🔄 同步中                             │
│  disconnected: ⚫ 已断开                             │
│                                                    │
└────────────────────────────────────────────────────┘
```

## 滚动条一致性

- 会话列表的 scrollbar 处理 MUST 与对话区一致（themed scrollbar）。
- 暗色主题下，scrollbar gutter 与 track 使用 themed page background，不回退到浏览器默认浅色 track。
- 滚动条出现/消失不引起水平内容位移。
- 来源：`ts-run-status-visibility` 的 `Frontend local view state MUST remain visually and navigationally stable` scenario "Sidebar session list uses the same themed scrollbar as chat"。

## 搜索

会话列表支持搜索（`session-history-search`）。来源：`SessionHistorySearchDialog.tsx` + `SessionHistorySearchControls.tsx` + `sessionHistorySearch.ts`。

### 搜索入口

- 点击侧边栏导航中的搜索按钮 → 打开搜索 dialog 模态框（宽 540px）。
- dialog 包含搜索控件区 + 滚动结果列表。

### 搜索控件

```
┌─────────────────────────────────────────────────────┐
│  [关键词输入框]  [📅 日期范围 popover]               │
│  [⚠ 关键词太短（仅 2 字）]                          │  ← 校验提示
└─────────────────────────────────────────────────────┘
```

- **关键词输入**：文本输入框，debounce 180ms（`SEARCH_DEBOUNCE_MS`）后触发搜索。
- **IME 组合**：composition 期间抑制 debounce，组合结束后才触发。
- **最小长度校验**（`keywordState()`）：
  - ASCII 关键词：最少 3 字符。
  - 非 ASCII 关键词（如中文）：最少 2 字符。
  - 最大 50 字符。
  - 不满足时显示警告图标，不触发搜索。
- **日期范围**：`DatePicker.RangePicker`，可选，最大范围约 90 天（`MAX_CREATED_RANGE_MS`）。传递为 `createdFrom`/`createdTo` epoch 毫秒。

### 搜索结果

- **分页**：搜索时每页 20 条（`SESSION_HISTORY_PAGE_LIMIT`），底部"加载更多"按钮追加下一页。
- **请求版本化**：`requestVersionRef` 防止 stale response 覆盖新结果。
- **结果项**：复用 `SessionHistoryEntryRow` 组件渲染，支持点击打开、hover 显示操作菜单。
- **搜索结果中的操作**：搜索 dialog 内可独立触发重命名和删除（不关闭 dialog）。

## 重命名

来源：`SessionRenameModal.tsx` + `Sidebar.tsx` 的 rename handler。

### 触发方式

- `SessionHistoryEntryRow` hover 时显示"更多"dropdown → 选择"重命名"。
- 搜索 dialog 中同样有重命名入口。

### 重命名模态框

```
┌──────────────────────────────────────────┐
│  重命名会话                               │
│  ┌──────────────────────────────────────┐ │
│  │  原标题文本                           │ │
│  └──────────────────────────────────────┘ │
│                               12/100     │  ← 字符计数器
│              [取消]  [确定]               │
└──────────────────────────────────────────┘
```

- **输入框**：预填原标题，`maxLength=100`，显示字符计数器 `{length}/100`。
- **校验**：trimmed 标题非空才启用"确定"按钮。
- **交互**：`Enter` 提交，`Escape` 取消。提交中（pending 态）禁用取消按钮。
- **API**：`PUT /api/v1/sessions/{id}/title`，成功后刷新会话列表。

## 删除

来源：`SessionDeleteConfirmModal.tsx` + `Sidebar.tsx` 的 delete handler。

### 触发方式

- `SessionHistoryEntryRow` hover 时显示"更多"dropdown → 选择"删除"。
- 搜索 dialog 中同样有删除入口。

### 删除确认模态框

```
┌──────────────────────────────────────────┐
│  删除会话                                 │
│  确定要删除"会话标题"吗？此操作不可撤销。 │
│              [取消]  [删除]               │  ← danger 样式
└──────────────────────────────────────────┘
```

- **确认内容**：显示会话标题 + 不可撤销警告。
- **按钮**："删除"为 danger 样式。
- **API**：`DELETE /api/v1/sessions/{id}`，成功后刷新会话列表。

### 删除活跃会话的特殊处理

当删除的会话是当前活跃会话（`wasActive`）时：
1. 调用 `clearConversation(sessionId)` 清空对话区。
2. 导航到 `/`（`replace: true`），回到无会话选中状态。
3. store 设置 `activeSessionId = null`。

> 搜索 dialog 中删除活跃会话时，通过 `onDeletedSession` 回调通知 sidebar 执行相同的清理逻辑。

## 收藏夹（Favorites）

来源：`Sidebar.tsx` 的 favorites 逻辑 + `annotationService.ts`。

### 当前语义：收藏 turn，不是收藏 session

- `[已实现-主干]` 侧边栏 `StarOutlined` 按钮切换收藏视图，加载 `GET /api/v1/favorites` 并替换最近会话列表。
- 收藏锚点是 request-run/turn。`FavoriteTurnEntry` 包含 `sessionId`、`requestRunId`、`rootMessageId`、`questionPreview`、`questionTruncated`、可选 `sessionTitle`/`sessionUpdatedAt` 与 `favoritedAt`。
- 收藏视图按 turn 自定义渲染并导航到所属会话/turn；不复用 `SessionHistoryEntryRow`，也不存在 `FavoriteSessionEntry` 或 `favoriteCount` 当前 contract。
- `annotationService.upsertAnnotation()` 通过 session + run 坐标设置 `isFavorited`，随后派发 `FAVORITES_UPDATED_EVENT` 刷新收藏 turn 列表。

```
┌─────────────────────────────────────────────┐
│  ★ 收藏回合                                 │
│  网络诊断排障 · “排查 Edge-RTR-02 丢包…”   │
│  OSS 配置咨询 · “如何配置生命周期…”         │
│  [加载更多]                                 │
└─────────────────────────────────────────────┘
```

### Session-level favorite（UCD 目标）

若产品仍需要“收藏会话”或在普通会话列表行显示 session-level 星标，必须先定义 turn 收藏如何聚合、取消收藏影响哪些 turn、排序/分页锚点及 DTO；不得从现有 `isFavorited` 自动推导一个未定义的 session durable fact。

## Sidebar 会话摘要目标

> **边界澄清**：`[已实现-主干]` 的 `sessionService.loadConversationPreview` 由当前会话预览轨道消费，详见 `conversation-preview-rail.md`；它不属于 session list item。Sidebar 列表项目前没有摘要 contract 或 consumer。以下 A/B 仍只是互斥候选，实施前必须先定义批量数据与容量边界，不能形成逐会话 N+1 请求。

> 当前会话 preview rail 已交付，但它解决的是“一个长会话内部如何导航”，与本节“切换会话之前如何预览另一个会话”是两个不同问题。

### 候选 A：会话列表项内嵌预览

- 会话列表项可显示最新一条 USER 消息和 ASSISTANT 回复的预览文本（截断到 1 行）。
- 预览文本必须来自未来明确的 sidebar 批量摘要 contract，不能逐项调用当前会话 `ConversationPreviewPage`。
- 懒加载只能作为渲染策略；数据层必须支持有界批量获取，避免滚动列表产生 N+1 请求。

```
┌─ 会话列表 ──────────────────────────────────┐
│  网络诊断排障          14:30                │
│  └ 帮我检查华东区网络连通性…                │  ← 内嵌预览（1 行截断）
│                                             │
│  OSS 配置咨询          昨天                 │
│  └ OSS 配置已更新，bucket 权限…            │  ← 内嵌预览（1 行截断）
└─────────────────────────────────────────────┘
```

### 候选 B：hover card

- 鼠标悬停在会话项上时（延迟 500ms），显示 hover card 浮层。
- hover card 展示最近 2-3 条消息的摘要（USER/ASSISTANT 交替）。
- 点击 hover card 中的消息可滚动到该消息位置。

```
              ┌──────────────────────────────────┐
              │ 网络诊断排障                      │
              │                                  │
              │ 👤 帮我检查一下华东区的网络连通性  │
              │ 🤖 已检测到 3 条链路异常：        │
              │    1. 上海-杭州 链路延迟 320ms…   │
              │ 👤 那上海到南京的呢？              │
              │ 🤖 上海-南京链路正常，延迟 12ms…  │
              └──────────────────────────────────┘
```

### 设计建议：点击滚动

- 用户点击会话项进入对话区后，对话区滚动到最新消息。
- 如果从搜索结果进入，可滚动到匹配的消息位置（需搜索 API 返回 message offset）。

## 交互

- 点击：切换到该会话。
- hover 时显示 Dropdown 按钮（非右键菜单）：重命名、删除（`session-delete`）。
- hover：显示最后活动时间与更多操作入口。
- 键盘：`Enter`/`Space` 打开会话，`role="button"`，`tabIndex={0}`，`aria-current="page"`（活跃时）。
- 无 Write 权限：重命名和删除菜单项禁用。

## 时间格式化

`formatSessionListTime()`（`SessionHistoryEntryRow.tsx`）：

| 时间范围 | 显示格式 |
|---|---|
| 今天 | `HH:mm` |
| 昨天 | "昨天" |
| 今年 | `M/D` |
| 更早 | `Y/M/D` |

### 4 种时间格式样例

```
┌─ 会话列表 ──────────────────────────────────┐
│  网络诊断排障          14:30                │  ← 今天（HH:mm）
│  OSS 配置咨询          昨天                 │  ← 昨天
│  VPC 网络规划          7/12                 │  ← 今年（M/D）
│  历史故障复盘          2025/12/28           │  ← 更早（Y/M/D）
└─────────────────────────────────────────────┘
```

## live 模式 vs history 模式

会话列表项本身不消费 conversation live/history state；它消费独立 Session Activity Projection Stream。点击后对话区再按自身 bootstrap/stream/history 状态呈现；`conversation-ui-state.md` 第 6 节仅作长期导航。

## 视觉规范（UCD 设计人员决定）

- 列表项高度、内边距、圆角。
- 标题、时间、preview marker 的排版。
- live 会话进行中指示的动画（脉冲点/进度条）。
- 后台 run 指示的视觉处理（小于当前会话指示，不抢占注意力）。
- 未读结果蓝点与未读失败红色感叹号的视觉细节；出现/消费必须遵守 stable activity lifecycle。
- 选中态、hover 态、聚焦态的视觉反馈。
- 搜索 dialog 的布局与结果高亮。
- 重命名/删除模态框的视觉风格。
- 收藏列表与普通会话列表的视觉区分（如收藏图标）。
- 约束：不得通过视觉暗示非契约字段；run status 指示 MUST 从 `RunStatus` canonical vocabulary 派生。

## 动态行为与交互响应

> 跨组件的通用模式见 `02-dynamic-behavior-and-interaction.md`。本节补充会话列表项特有行为。

### 已实现

| 行为 | 说明 | 代码位置 |
|------|------|---------|
| hover 高亮 | 鼠标进入时背景变色 | `SessionHistoryEntryRow.tsx` L66, L80, L89-90 |
| 选中态视觉 | active 时背景变色 + 文字变 primary 色 + 加粗 | L102, L112-114 |
| hover 显示操作菜单 | hover 时显示 MoreOutlined 按钮（替代时间戳） | L127-163 |
| scrollIntoView | 选中会话时滚动到视口 | `Sidebar.tsx` L245-254 |
| 键盘可达 | `role=button, tabIndex=0, aria-current=page`，Enter/Space 打开 | L336 |
| 会话列表展开/折叠 | 偏好存储在 sessionStorage | L20-24 |

### UCD 设计建议

| 行为 | 说明 |
|------|------|
| 后台 run 指示动画 | UCD-P1 Ready 仅覆盖 in-flight 会话的脉冲点（● 呼吸动画 1.2s）；run 完成后的角标过渡（⚡→✅）是 `[UCD目标/未准入]`，须先定义 unread/viewed lifecycle |
| 新会话 appear | 新会话出现时 fade-in + slide-down 200ms |
| loading | 会话列表加载时显示 skeleton 占位 |
| 删除动画 | 删除会话时 fade-out 150ms + height collapse 200ms |
| hover 视觉细化 | hover 时背景色 + 可选阴影，120ms transition |
