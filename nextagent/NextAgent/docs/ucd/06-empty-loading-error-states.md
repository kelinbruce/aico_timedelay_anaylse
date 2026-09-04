# 空状态、加载状态、错误状态与其他界面状态

> 长期设计导航：`openspec/designs/architecture/conversation-ui-state.md` 第 1、4、5、6 节。当前事实必须与 stable/active OpenSpec、public contracts、当前代码和测试交叉核对；本文档是 UCD 设计表达层，非 OpenSpec 基线，不定义契约。

## 空状态

### 无会话空状态

- 场景：用户首次进入，会话列表为空。
- 呈现：欢迎语 + 引导用户开始新对话的 CTA。
- 高频问题推荐区（`agent-web-high-frequency-questions`、`high-frequency-question-ui`）：展示常见问题，点击后直接发起对话。

### 新会话空状态

- 场景：用户新建会话，尚未发送任何消息。
- 呈现：欢迎块（`agent-web-welcome-block-styles`）+ 输入提示。
- 高频问题推荐区可继续展示。

### 欢迎状态（WelcomeState）

来源：`features/welcome/components/WelcomeState.tsx` + `features/high-frequency-questions/components/HighFrequencyQuestions.tsx`。

当无活跃会话时（`shouldShowWelcome` 为 true），主内容区显示欢迎状态，替代对话时间线。

#### 全屏布局

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│                                                     │
│                   [品牌 logo]                        │
│                  NextAgent                           │
│              副标题/欢迎语                            │
│                                                     │
│  ┌─ 高频问题推荐区 ──────────────────────────────┐  │
│  │  [分析网络延迟]  [检查配置合规性]              │  │
│  │  [生成流量报表]  [诊断网络问题]                │  │
│  └────────────────────────────────────────────────┘  │
│                                                     │
│  ┌─ 输入区 ──────────────────────────────────────┐  │
│  │  [输入消息...]                          [发送] │  │
│  └────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

- **品牌 logo**：`logo.svg` + "NextAgent" wordmark。
- **副标题**：`welcome.subtitle` i18n 文案。
- **高频问题推荐区**（`GuideArea`）：
  - 数据来源：`queryFrequentQuestions` API 获取高频问题。
  - fallback：API 失败时使用 4 个硬编码 i18n 建议问题（分析网络延迟、检查配置合规性、生成流量报表、诊断网络问题）。
  - 交互：点击问题 → 填充到输入框（`onQuestionClick`）→ 用户可直接发送。

### 侧边栏空状态

来源：`Sidebar.tsx` L796。

- 会话列表为空时显示 `emptySessionsTitle`（如"暂无历史"）+ `emptySessionsDescription`。
- 区别于主内容区的欢迎状态，侧边栏空状态仅影响会话列表区域。

## 加载状态

### 会话列表加载

- 场景：mount-time session-list refresh。
- 呈现：骨架屏或 loading spinner。
- 若 sessionStorage 偏好为展开，MUST 请求 expanded page size。来源：`ts-run-status-visibility` 的 `Frontend local view state MUST remain visually and navigationally stable`。

### 历史对话加载

- 场景：用户点击会话列表项，加载 `SessionMessageRecord` 并重建 envelopes。
- 呈现：对话区骨架屏；重建完成后渲染消息流。
- 重建 envelopes 携带 `transportHints: ["history-load"]`。

### 历史分页加载（Load Older Messages）

来源：`features/chat/components/MessageList.tsx` L95-129。

#### 触发方式

当 `historyBoundary.hasMore` 为 true 时，消息列表顶部显示"加载更早消息"分隔符。用户点击触发 `historyBoundary.onLoadMore`。

#### 三态呈现

```
┌─ loading 态 ────────────────────┐
│  ────── [加载中...] ──────       │  ← pill 禁用，cursor 变化
└──────────────────────────────────┘

┌─ 正常态（可加载更多）────────────┐
│  ────── [加载更早消息] ──────     │  ← 可点击
└──────────────────────────────────┘

┌─ error 态 ──────────────────────┐
│  ────── [加载失败，点击重试] ── │  ← 可点击重试
└──────────────────────────────────┘

┌─ 无更多（hasMore=false）────────┐
│  （无分隔符，不显示）            │
└──────────────────────────────────┘
```

| 状态 | 条件 | 视觉 |
|---|---|---|
| 可加载 | `hasMore && !isLoading` | 可点击 pill，两侧水平分隔线 |
| 加载中 | `isLoading` | pill 禁用（cursor 变化，onClick 移除） |
| 加载失败 | 加载出错 | "加载失败，点击重试" pill |
| 无更多 | `!hasMore` | 不显示分隔符 |

- **机制**：按钮触发（非无限滚动）。
- **加载方向**：向前加载更早的历史消息（从当前最早消息向前翻页）。

### Live stream 连接中

- 场景：首次订阅 stream，等待 `REQUEST_ACCEPTED`。
- 呈现：对话区显示"正在连接..."。

### 能力执行中

- 场景：`CAPABILITY_STARTED` 已投影，`CAPABILITY_RESULT_DELTA` 未到达。
- 呈现：能力卡片 running 态（running/settling/settled 动画）。
- 来源：`conversation-ui-state.md` 第 1 节、`capability-card.md`。

## 错误状态

### 请求失败（`REQUEST_FAILED`）

- 场景：runtime 投影 `REQUEST_FAILED` terminal。
- 呈现：助手消息气泡失败终态卡片。
- 用户可读原因从 `code`/`message`/`category`/`retryable` safe field 派生。
- 历史失败 terminal：若 content 是 safe failure placeholder（`Request failed`、`Request failed: ...`、`Request failed safely: CODE`），MUST NOT 渲染为 assistant answer content。来源：`ts-run-status-visibility` scenario "Failed terminal history keeps only real partial answer content"。

### 能力失败（`safeErrorCode` 驱动）

- 场景：`CAPABILITY_RESULT_DELTA`/`CAPABILITY_COMPLETED` 携带 `safeErrorCode`。
- 呈现：能力失败卡片（见 `capability-card.md`、`conversation-ui-state.md` 第 5 节）。
- 常见 `safeErrorCode`：
  - `CAPABILITY_PATH_REJECTED`：路径被策略拒绝（不暴露路径）。
  - `COMMAND_NOT_ALLOWED`：命令被安全策略阻止。
  - `CAPABILITY_INPUT_INVALID`/`INVALID_INPUT`：输入无效。
  - `CAPABILITY_RESULT_LIMIT_EXCEEDED`/`RESOURCE_TOO_LARGE`：结果过大。
- 常见 `safeErrorCategory`：`AUTHORIZATION`/`POLICY_DENIED`、`VALIDATION`、`TIMEOUT`、`UNAVAILABLE`。
- `CAPABILITY_PATH_REJECTED` 不升级为 run failure。来源：本 change `Capability Path Rejected Failure Visibility` requirement。

### 降级提示（`DEGRADATION_NOTICE`）

- 场景：系统降级（模型/能力/context/transport/投影失败）。
- 呈现：降级提示卡片（见 `degradation-notice.md`）。
- history 模式由持久化消息重建降级提示，内容与 live 完成后完全相同。

### 断线（disconnected）

- 场景：transport close，UI 进入 `disconnected` 态。
- 呈现：对话区顶部或底部显示"已断开"指示 + 手动重连按钮。
- 已收到的对话内容保持可见。
- MUST NOT 触发伪造 terminal（`REQUEST_COMPLETED`/`FAILED`/`CANCELED`）。来源：`conversation-ui-state.md` 第 4 节。

### 重连中（reconnecting）

- 场景：前端自动重连或用户手动重连。
- 呈现："正在重连"指示（spinner）。
- 重连成功：进入 `replayed` 态，断线期间遗漏的事件按序插入。
- 重连失败：显示"重连失败" + 手动刷新入口。

### 重连失败 / cursor 失效

- 场景：cursor 无法被 backend 接受，或重连次数超限。
- 呈现：错误提示 + "刷新对话"按钮（重新加载历史 + 重新订阅）。

### Projection failure（投影失败）

- 场景：`STREAM_PROJECTION_PAYLOAD_UNSAFE`、`DEPRECATED_STREAM_EVENT_NAME` 等投影失败（后端在将事件内容安全过滤为前端可显示数据时失败）。
- 呈现：转换为 `DEGRADATION_NOTICE`，显示"该事件无法安全呈现"提示（不暴露原始数据）。
- 来源：`stream-envelope.ts` 的 `projectProjectionFailure`、`conversation-ui-state.md` 第 5 节。

### 推荐后续问题（Suggested Questions）

来源：`features/suggested-questions/components/SuggestedQuestions.tsx`。

#### 触发条件

- turn 完成（terminal status）后，自动请求推荐问题。
- API：`POST /api/v1/sessions/{sessionId}/requests/{requestId}/suggested-questions`。
- 仅最新 COMPLETED turn 显示推荐问题，历史 turn 不显示。

#### 呈现

```
┌─ ASSISTANT 气泡 ──────────────────────────┐
│  [答案内容...]                            │
│  [点赞][踩][收藏][派生][重试]             │
└────────────────────────────────────────────┘
  ┌─ 推荐后续问题 ────────────────────────┐
  │  ○ 如何查看设备告警详情？              │  ← 可点击按钮
  │  ○ 怎样优化网络配置？                  │
  │  ○ 生成完整的诊断报告                  │
  └────────────────────────────────────────┘
```

#### 状态

| 状态 | 条件 | 视觉 |
|---|---|---|
| 加载中 | API 请求中 | 3 点加载动画 |
| 有结果 | API 返回非空数组 | 可点击问题按钮列表 |
| 无结果 | API 返回空数组 | 不渲染（`SuggestedQuestions` 返回 null） |
| 加载失败 | API 出错 | 不渲染（静默失败） |

- **权限**：每个问题按钮通过 `AuthGate` 门控 `AICOServiceOperation.Write`，无 Write 权限禁用。
- **交互**：点击问题 → 填充到输入框 → 用户可直接发送。

### 分类问题浏览（Category Questions）

来源：`features/category-questions/components/CategoryQuestions.tsx` + `CategoryQuestionModal.tsx`。

#### L1/L2 分类结构

- **数据来源**：`GET /api/v1/category-questions?locale=...`，返回 L1 分类列表。
- **L1 分类**：顶级分类（如"网络诊断"、"配置管理"、"故障排查"）。
- **L2 子分类**：每个 L1 分类包含 `subCategories`，每个子分类有自己的 `questions`。

#### 呈现

```
┌─ CategoryQuestionBar（L1 标签栏）──────────────────┐
│  [全部] [网络诊断] [配置管理] [故障排查] [更多 ▼]   │  ← 水平 tab 栏
└──────────────────────────────────────────────────────┘
         │ 选中 L1 分类
         ▼
┌─ CategoryQuestionModal（模态框）────────────────────┐
│  [全部] [子分类A] [子分类B] [子分类C]               │  ← L2 标签
│  ┌──────────┐  ┌──────────┐                         │
│  │ 🔧 问题1  │  │ 📊 问题2  │                        │  ← 2 列网格
│  │ 子分类A   │  │ 子分类B   │                        │
│  └──────────┘  └──────────┘                         │
│  ┌──────────┐  ┌──────────┐                         │
│  │ 📈 问题3  │  │ 🔍 问题4  │                        │
│  │ 子分类A   │  │ 子分类C   │                        │
│  └──────────┘  └──────────┘                         │
└──────────────────────────────────────────────────────┘
```

- **CategoryQuestionBar**：水平 tab 栏，包含"全部" + L1 分类。选中后打开 modal。
- **CategoryQuestionModal**：浮动模态框，标题"分类问题推荐"。
  - L2 标签筛选（含"全部"）。
  - 2 列网格布局的问题块，每块显示图标 + L2 子分类名 + 问题文本。
  - 点击问题 → `onQuestionClick` → 填充到输入框。
- **位置**：在 composer 区域的 `QuickOperatorArea` 中使用。

## 设置

来源：`Sidebar.tsx` L942-1013（local 模式 `showLocalControls=true` 时显示设置入口）。

> ℹ️ **布局差异**：local 布局下设置入口在侧边栏底部本地控件区；immersive-left/immersive-right 布局下 `showLocalControls=false`，无侧边栏本地控件，设置由宿主环境控制。

### 设置面板

local 模式下，侧边栏底部"设置"按钮打开设置模态框，提供主题与语言切换：

```
┌─ 设置 ──────────────────────────────────────┐
│                                              │
│  主题                                        │
│  ○ 浅色   ● 深色   ○ 跟随系统               │
│                                              │
│  语言                                        │
│  ○ 跟随系统   ● 简体中文   ○ English        │
│                                              │
│                                      [关闭]  │
└──────────────────────────────────────────────┘
```

### 主题切换

- **基础设施**：`styles/theme.css` 通过 `:root` 的 `data-theme` 属性支持浅色/深色/evening/lightday 主题。
- **CSS 变量**：每个主题定义独立的 CSS 变量集（颜色、背景、边框等）。
- **切换方式**：设置面板内三选一（浅色 / 深色 / 跟随系统）；"跟随系统"监听 `prefers-color-scheme` 媒体查询。
- **持久化**：选择写入 localStorage，页面重载后恢复。

### 语言切换

- **基础设施**：`react-i18next` 支持 `zh-CN` 和 `en-US` 两种语言。
- **资源文件**：`i18n/resources/zh-CN.ts`、`i18n/resources/en-US.ts`。
- **切换方式**：设置面板内三选一（跟随系统 / 简体中文 / English）；"跟随系统"读取浏览器 `navigator.language`。
- **持久化**：选择写入 localStorage，页面重载后恢复。

## 键盘快捷键

来源：`shortcuts/shortcutRegistry.ts` + `features/composer/components/CommandHelpModal.tsx`。

### 快捷键清单

| 快捷键 | 作用域 | 行为 |
|---|---|---|
| `Cmd/Ctrl+K` | 全局 | 聚焦输入框 |
| `Cmd/Ctrl+/` | 全局 | 打开快捷键帮助模态框 |
| `Cmd/Ctrl+[` | 全局 | 切换到上一会话 |
| `Cmd/Ctrl+]` | 全局 | 切换到下一会话 |
| `Enter` | 输入框 | 发送消息 |
| `Shift+Enter` | 输入框 | 换行 |
| `Tab` | 输入框 | 确认 slash 命令/关联推荐 |
| `Escape` | 输入框 | 关闭面板/取消编辑/取消运行（两步） |
| `ArrowUp` | 输入框（空内容时） | 遍历提交历史 |
| `ArrowDown` | 输入框 | 遍历提交历史（向下） |
| `ArrowUp`/`ArrowDown`/`Enter` | 会话列表 | 导航会话 |

### 快捷键帮助模态框

来源：`CommandHelpModal.tsx`，由 `Cmd/Ctrl+/` 触发。

```
┌─ 快捷键帮助 ────────────────────────────────┐
│                                              │
│  全局快捷键                                  │
│  ⌘K  聚焦输入框                              │
│  ⌘/  打开快捷键帮助                          │
│  ⌘[  上一会话                                │
│  ⌘]  下一会话                                │
│                                              │
│  输入快捷键                                  │
│  Enter          发送                         │
│  Shift+Enter    换行                         │
│  Tab            确认补全                      │
│  Escape         关闭/取消                     │
│                                              │
│  Slash 命令                                  │
│  /help          打开帮助                      │
│  /retry         重试最新失败请求              │
│  /edit          编辑最新消息                  │
│                                              │
└──────────────────────────────────────────────┘
```

- **分组**：全局快捷键、输入快捷键、slash 命令。
- **快捷键注册**：`shortcutRegistry.ts` 提供冲突检测和保留组合键验证。

### 冲突检测

- `shortcutRegistry.ts` 在注册时检查组合键冲突，防止重复绑定。
- 保留组合键（如浏览器原生快捷键）不会被覆盖。

## Stream resume gap/failure

来源：`state/contracts.ts` L250-284、`features/chat/streaming/streamResumeRecovery.ts`、`features/chat/transport/streamTransport.ts`、`features/chat/hooks/useStreamConnection.ts`。

### gap vs failure 区分

stream resume 有两种恢复场景，由后端响应决定：

| 类型 | 含义 | 可重试 | 需要刷新 | `resumeAfterSequence` |
|---|---|---|---|---|
| **gap（间隙）** | cursor 在可恢复窗口外，但 timeline 仍可重建 | ✅ 总是 `retryable: true` | ✅ 总是 `refreshConversation: true` | 非 null |
| **failure（失败）** | resume 请求本身失败 | 视原因而定 | 视原因而定 | 可能为 null |

### gap 原因（3 种，均可重试）

| reason | 含义 |
|---|---|
| `ANCHOR_BEFORE_RECOVERABLE_WINDOW` | cursor 在可恢复窗口之前 |
| `DELTA_STATE_NOT_RECOVERABLE` | delta 状态不可恢复 |
| `TIMELINE_CONTINUITY_LOST` | timeline 连续性丢失 |

**处理**：客户端刷新对话（重新加载历史）+ 从 `resumeAfterSequence` 恢复 stream。

### failure 原因（7 种，可重试性不定）

| reason | 含义 | 典型可重试 |
|---|---|---|
| `VALIDATION_FAILED` | resume 请求校验失败 | ❌ 通常不可重试 |
| `UNAUTHORIZED` | 未授权 | ❌ 不可重试 |
| `TIMELINE_READ_FAILED` | timeline 读取失败 | ✅ 可重试 |
| `TIMELINE_READ_TIMEOUT` | timeline 读取超时 | ✅ 可重试 |
| `PROJECTION_FAILED` | 投影失败 | ❌ 不可重试 |
| `BACKPRESSURE_TIMEOUT` | 背压超时 | ✅ 可重试 |
| `TRANSPORT_CLOSED` | 传输关闭 | ✅ 可重试 |

**处理**：
- `retryable: true` → 自动重试 resume。
- `retryable: false` → 显示错误提示 + "刷新对话"按钮（需用户手动刷新）。

### 与断线重连的区别

| 维度 | 断线重连 | stream resume gap/failure |
|---|---|---|
| 触发原因 | transport 层断开（网络问题） | resume 协议层问题（cursor 失效、timeline 不可恢复） |
| 恢复方式 | 自动重连 + replay | 刷新对话 + 从 `resumeAfterSequence` 恢复 |
| 用户感知 | "正在重连"指示 | "需要刷新"提示（failure 不可重试时） |
| 数据完整性 | 断线期间遗漏的事件按序插入 | 可能需要重新加载完整历史 |

来源：`useStreamConnection.ts` L574——检查 `getStreamResumeFailureDetails(error)`，有 failure details 则路由到 `handleResumeRecovery`，否则视为 disconnect。

## 权限/鉴权门控

来源：`features/auth/authEnums.ts`、`useUserOps.ts`、`AuthGate.tsx`、`AuthWrapper.tsx`、`PermissionUnavailable.tsx`。

### 权限模型

两种操作权限：

| 权限 | 说明 |
|---|---|
| `View` | 只读——可查看会话、消息、过程面板 |
| `Write` | 读写——可发送消息、编辑、重试、派生、标注、管理会话 |

### 权限来源

`useUserOps()` 返回：

| 返回值 | 场景 | 权限 |
|---|---|---|
| `null` | 本地模式 | 完全访问 |
| `[]` | 远程模式，无权限 | 只读（仅 View） |
| `[...ops]` | 远程模式，有权限 | 按 ops 列表 |

### 只读用户（无 Write 权限）的禁用控件

通过 `AuthGate` 门控 `requiredOps={[AICOServiceOperation.Write]}` 的控件：

| 控件 | 位置 | 禁用表现 |
|---|---|---|
| 新建会话按钮 | 侧边栏 | 禁用 + tooltip |
| 发送按钮 | 输入区 | 禁用 + tooltip |
| 停止按钮 | 输入区 | 禁用 + tooltip |
| 附件按钮 | 输入区 | 禁用 + tooltip |
| 文件输入 | 输入区（hidden） | 不渲染（`AuthWrapper`） |
| 重试按钮 | ASSISTANT 气泡 + 输入区 | 禁用 + tooltip |
| 编辑按钮 | USER 气泡 + 输入区 | 禁用 + tooltip |
| 派生按钮 | ASSISTANT 气泡 | 禁用 + tooltip |
| 标注按钮（点赞/踩/收藏） | ASSISTANT 气泡 | 禁用 + tooltip |
| Pin 按钮 | USER 气泡 | 禁用 + tooltip |
| 推荐问题按钮 | ASSISTANT 气泡下方 | 禁用 + tooltip |
| 重命名/删除菜单项 | 会话列表项 | 禁用 |

### `AuthGate` 视觉处理

- **Button 类型**：`disabled: true` + tooltip（`auth.noWritePermission`）。
- **非 Button 类型**：`pointerEvents: none` + `opacity: 0.45` + `cursor: not-allowed`。

### `PermissionUnavailable` 全页降级

当用户无任何权限（`[]` 且远程模式）时，显示全页"无权限"降级页面：

- 标题：`auth.noPermissionTitle`。
- 描述：`auth.noPermissionDescription`。
- 不渲染任何交互控件。

### `AuthWrapper` 条件渲染

用于需要完全隐藏的元素（如 `<input type="file">`），无权限时不渲染 DOM 节点。

## live 模式 vs history 模式的状态差异

核心原则：**完成后呈现相同的持久化事实**，仅实时过程效果不同。

| 状态 | live 模式 | history 模式 |
|---|---|---|
| 能力执行中 | running 态可见 | 不可见（transient streaming 状态，仅终态） |
| 思考过程（think） | 累计 snapshot 实时可见 | 完成 snapshot 通过 Event history 渐进恢复；安全过滤仍见 B17 |
| 降级提示 | 实时可见 | ✅ 可见（由持久化消息重建） |
| 断线/重连 | 可见 | 不适用 |
| Projection failure | 实时降级提示 | ✅ 可见（由持久化消息重建） |
| 请求失败 terminal | 实时 | 重建（同渲染规则） |
| 能力失败 | 实时 | 重建（同渲染路径） |

### Process history 加载与失败

- Message history 已显示而 Event history 尚未完成时，执行详情标题保持不变。
- 等待不足 300ms 不显示 loading-only 行；超过 300ms 后仅在展开内容区显示非文本 spinner。
- Event 加载失败不隐藏 Message、最终答案或已经恢复的过程条目；展开内容区提供安全重试。
- 旧版本没有 Event history 时显示终态“历史过程不可用”，不循环自动重试。
- 切换会话时清理旧会话加载状态，禁止旧请求完成后回填到新会话。

来源：`conversation-ui-state.md` 第 6 节。

## 视觉规范（UCD 设计人员决定）

- 空状态插画与文案。
- 欢迎状态的 logo 排版、高频问题按钮样式。
- 加载状态骨架屏/spinner 样式。
- 历史分页加载的分隔符与 pill 按钮样式（正常/加载中/失败三态）。
- 推荐后续问题与分类问题浏览的按钮/模态框样式。
- 快捷键帮助模态框的排版与分组样式。
- 错误状态卡片视觉权重（区别于正常消息）。
- 断线/重连指示的位置与动画。
- stream resume gap/failure 的提示样式（可重试 vs 不可重试的视觉区分）。
- 只读用户禁用控件的视觉处理（当前 `opacity: 0.45` + tooltip，UCD 设计人员可调整）。
- `PermissionUnavailable` 全页降级页面的视觉设计。
- 约束：错误状态 MUST NOT 暴露 raw error、raw payload、local path、policy internals；失败 terminal 的 safe failure placeholder MUST NOT 渲染为 answer content。
