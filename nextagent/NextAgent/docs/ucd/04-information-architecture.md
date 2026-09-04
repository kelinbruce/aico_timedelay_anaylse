# 信息架构

> 长期设计导航：通用界面状态见 `openspec/designs/architecture/conversation-ui-state.md`；Message/Event ownership 与历史 hydration 见 `openspec/designs/architecture/conversation-process-history.md`。当前事实必须与 stable OpenSpec、public contracts、当前代码和测试交叉核对；本文档是 UCD 设计表达层，非 OpenSpec 基线，不定义契约。

> **状态基线（2026-08-13，`origin/main@4f27c4a9f`）**：当前事实由 owning stable/active OpenSpec、代码和测试交叉确认；active change 尚待归档时会明确标注。任务准入以 owning spec 与 roadmap 为准。

## 整体布局

```
┌──────────────┬────────────────────────────────────┐
│ 侧边栏 header │  对话区（主区域） / 欢迎状态          │
│ 产品标识      │  ┌──────────────────────────────────┐ │
├──────────────┤  │ 消息流（USER / ASSISTANT 气泡）   │ │
│ [💬 新会话]   │  │ ┌─ 过程面板（思考/能力卡片）      │ │
│ [🔍 搜索]     │  │ ├─ Pending input 卡片            │ │
│ [⭐ 收藏]     │  │ ├─ 降级提示卡片                  │ │
│ [⚙️ 操作]     │  │ ├─ 推荐后续问题                  │ │
│              │  │ └─ 附件指示                      │ │
│  会话列表    │  └──────────────────────────────────┘ │
│  （左侧栏）  │  ┌──────────────────────────────────┐ │
│  会话项 A    │  │ Composer（输入区 + skill 选择器  │ │
│  会话项 B    │  │  + 附件 + 发送/停止 + slash 命令）│ │
│  会话项 C    │  └──────────────────────────────────┘ │
│  [加载更多]  │                                    │
├──────────────┴────────────────────────────────────┤
│  可选：run-graph drawer（"完整过程"按钮触发，覆盖主区域）       │
│  可选：快捷键帮助模态框（Cmd+/ 触发）                          │
│  可选：搜索/重命名/删除/分类问题 模态框                        │
└─────────────────────────────────────────────────────────────┘
```

> ℹ️ **布局模式差异**：上图展示的是 local/left 布局（侧边栏含品牌 header）。实际实现有三种宿主模式（`HostMode = "local" | "immersive" | "piu"`）：
> - **本地 / 沉浸式左侧（local / immersive-left）**：侧边栏 54px header 含品牌标识，导航功能在侧边栏内（默认）。
> - **沉浸式右侧（immersive-right）**：全宽 54px 顶部栏（品牌标识 + 导航按钮 + 操作区）替代侧边栏，会话列表通过顶部栏按钮以面板覆盖形式打开。详见 `03-full-ui-layout.md` §2.2。
> - **协作式（PIU，collaborative）**：NextAgent 作为面板嵌入宿主产品页面，支持 docked/floating/maximized 三种面板形态。代码中 `HostMode` 值为 `"piu"`，HTML/CSS data 属性为 `"collaborative"`。

## 区域职责

### 会话列表（左侧栏）

- `[已实现-主干]` 列出当前 owner scope 下的会话，支持标题/日期搜索、重命名、删除、分页与展开偏好。
- `[已实现-主干]` 会话列表行在标题/时间/基础操作之外消费独立 Session Activity Stream，并通过共享 trailing slot 显示等待输入、运行中、未读失败或未读结果。
- `[UCD目标]` 列表行消费 run facts、sidebar preview 与 live/历史视觉区分。
- **搜索入口**：搜索按钮打开搜索 dialog 模态框（关键词 + 日期范围）。
- **收藏夹切换**：`[已实现-主干]` 收藏按钮切换**收藏 turn**列表与最近会话列表；当前没有 session-level favorite fact。
- **新会话按钮**：创建新会话（门控 Write 权限）。
- **加载更多**：底部分页按钮追加更多会话。
- 组件规范见 `05-component-specs/session-list-item.md`。

### 当前会话预览轨道

- `[已实现-主干]` `loadConversationPreview` 由当前会话对话区消费，用于会话列表与主对话区之间的 preview marker rail。
- 预览轨道属于当前会话导航，不属于 session list item；marker hover 显示有界摘要卡，marker click 加载目标页并定位相应回合。
- 轨道采用窗口化数据与虚拟化渲染，快速滚动时不得为每一个中间窗口触发请求。
- 组件规范见 `05-component-specs/conversation-preview-rail.md`。

### Sidebar 会话摘要（未交付目标）

- Sidebar 当前没有独立 conversation preview consumer。
- 若未来在 session list item 内新增摘要，必须单独定义批量数据契约和容量边界，不能复用当前会话预览轨道并触发逐会话请求。

### 对话区（主区域）

- 自上而下按时间序渲染消息流。
- 每个回合（turn）由 USER 消息气泡 → 过程面板 → ASSISTANT 消息气泡（含终态）构成。
- `[已实现-主干]` live Pending Input 的 `RespondInput` 位于 composer 上方；对应 `USER_INPUT_*` 在 turn/process 中只形成独立 system 条目。`[UCD目标]` 才是把 pending lifecycle/终态卡嵌入对应 turn。降级提示、附件指示和推荐后续问题按各自当前组件位置呈现。
- **历史分页加载**：顶部"加载更早消息"分隔符，向前加载历史消息。
- 组件规范见 `05-component-specs/message-bubble.md`、`05-component-specs/capability-card.md`、`05-component-specs/pending-input-card.md`、`05-component-specs/degradation-notice.md`。

### Message 与 Event 查询边界

| 查询 | 负责内容 | UCD 使用方式 |
|---|---|---|
| `GET /api/v1/sessions/{sessionId}/conversation` | USER/ASSISTANT/结果 Message、终态答案和回合结构 | 会话打开时优先加载，不能等待 Event history |
| `GET /api/v1/sessions/{sessionId}/runs/{runId}/events?afterSequence={n}&limit={1..1000}` | 选定 run 的 canonical process facts，包括 completed thinking 与 capability lifecycle | 由有界 scheduler 为可视区、预加载和显式目标渐进查询 |

前端将两类查询结果投影为同一 `StreamEnvelope` 消费模型，但不得把 Event 伪装成 Message，也不得把 Message 内容复制为 timeline truth。能力结果正文来自同一 run 的 CAPABILITY_RESULT Message，能力生命周期来自 Event；最终答案和用户内容始终由 Message owner 提供。

### 欢迎状态（无活跃会话时替代对话区）

- 品牌 logo + wordmark + 副标题。
- 高频问题推荐区（API 获取 + fallback）。
- Composer 仍可用。
- 组件规范见 `06-empty-loading-error-states.md` 的"欢迎状态"章节。

### Composer（输入区）

- 文本输入框 + 附件添加按钮 + 发送/停止按钮。
- **Skill 选择器 bar**（可选）：输入区上方，浏览并选择 skill。
- **已选 skill chip**（可选）：输入区内顶部，显示已选 skill。
- **Slash 命令**：输入 `/` 触发命令面板（`/help`、`/retry`、`/edit` + skill 列表）。
- **问题关联推荐**：输入非 slash 文本时 debounce 300ms 显示关联问题面板。
- **编辑模式**：加载原消息 → 编辑标记 → 发送创建 superseding request。
- 缓存 normal-mode 草稿（per session，tab 存活期内）；edit-mode 文本与 pending input 应答文本不覆盖 normal 草稿。
- 组件规范见 `05-component-specs/composer.md`。

### run-graph drawer（可选）

- 由过程面板 summary row 右侧的"完整过程"按钮触发。
- 两种布局：side-split（分栏）或 drawer（抽屉），视口宽度决定。
- 展示 X6 流程图（7 种节点类型）+ 节点详情面板。
- live 模式实时更新；history 模式基于持久化 timeline event 引用重建（无 `timelineEventRef` 的历史能力结果不视为完整 timeline）。
- 组件规范见 `05-component-specs/process-panel.md` 的"Run Graph 抽屉"章节。

### 模态框层（可选覆盖层）

| 模态框 | 触发方式 | 功能 |
|---|---|---|
| 搜索 dialog | 侧边栏搜索按钮 | 关键词 + 日期范围搜索会话 |
| 重命名模态框 | 会话项"更多"菜单 → 重命名 | 编辑会话标题（100 字符限制） |
| 删除确认模态框 | 会话项"更多"菜单 → 删除 | 确认删除会话（活跃会话删除后导航离开） |
| 分类问题模态框 | CategoryQuestionBar 选中 L1 分类 | L2 标签 + 2 列问题网格 |
| 快捷键帮助模态框 | `Cmd+/` | 全局快捷键 + 输入快捷键 + slash 命令列表 |
| 分享设置模态框 | ASSISTANT 气泡分享按钮 | 生成分享 URL |

## 导航关系

- 会话列表 → 对话区：选择会话加载历史消息或接入 live stream。
- 对话区 → run-graph drawer：点击"完整过程"按钮展开完整 timeline。
- Composer → 对话区：发送消息后，新回合出现在对话区底部。
- Pending input 卡片 → Composer：部分 pending input（如 question）可通过卡片内联应答，不经过 Composer。
- 搜索 dialog → 对话区：点击搜索结果中的会话 → 加载该会话。
- 收藏夹 → 对话区：点击收藏 turn → 加载所属会话并定位相应回合（定位能力以实际返回坐标为准）。
- 高频问题/分类问题 → Composer：点击问题 → 填充到输入框。
- 推荐后续问题 → Composer：点击问题 → 填充到输入框。
- ASSISTANT 气泡派生按钮 → 新会话：创建派生会话并导航到新会话。
- `Cmd+K` → Composer：聚焦输入框。
- `Cmd+[` / `Cmd+]` → 会话列表：切换到上一/下一会话。
- 宿主页面 → PIU 面板（仅协作式）：宿主页面调用 `sendQuestionToLui` → PIU 面板自动打开 + 问题注入对话。

## live 模式与 history 模式的 IA 差异

核心原则（`[已实现-主干]`）：**完成后呈现相同的持久化过程事实**，仅实时过程效果不同。

| IA 元素 | live 模式 | history 模式 |
|---|---|---|
| 思考过程条目 | 累计 snapshot 流式可见；模型调用完成后保留终态 snapshot | Event history 恢复每次模型调用的完成 snapshot；不恢复未完成 delta |
| 能力卡片 running 态 | 可见 | 不可见（transient streaming 状态，终态由 CAPABILITY_RESULT_DELTA 承载） |
| 能力卡片结果 | 增量投递 | 持久化 lifecycle Event 与同一 run 的结果 Message 合并呈现 |
| 降级提示卡片 | 可见 | 可见（由持久化消息重建） |
| 附件流指示 | accepted/rejected 实时 | 依赖持久化 attachment metadata 呈现附件状态 |
| 压缩通知 | 可见 | 可见（由持久化消息重建） |
| 流式内容追加 | 实时打字机效果 | 直接呈现终态完整内容 |
| 推荐后续问题 | 仅最新 COMPLETED turn 显示 | 不显示 |
| 过程面板默认状态 | 流式过程中 auto-expanded，完成后 auto-collapsed | 默认 collapsed（可展开查看相同内容） |
| 过程动画 | running/settling/settled 动画 | 无动画 |
| 重连状态指示 | 可见 | 不适用（无 active stream） |

来源：`conversation-ui-state.md` 第 6 节。

## 滚动条与视觉一致性

- 对话区与会话列表使用相同的 themed scrollbar 处理（`ts-run-status-visibility` 的 `Frontend local view state MUST remain visually and navigationally stable`）。
- 暗色主题下，scrollbar gutter 与 track 使用 themed page background，不回退到浏览器默认浅色 track。
- 滚动条出现/消失不引起水平内容位移。

## 空间分配原则

- 对话区是主区域，占大部分宽度；会话列表折叠时对话区扩展。
- Composer 固定在对话区底部，不随消息流滚动。
- 过程面板在对话区内按需展开，不挤压消息气泡可读宽度。
- Run Graph drawer 优先使用 side-split（不覆盖对话区），视口不足时降级为 drawer（覆盖）。
- 模态框层覆盖全屏，不改变底层布局。
