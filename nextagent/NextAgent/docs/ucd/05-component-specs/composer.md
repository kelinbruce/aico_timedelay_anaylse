# 组件规范：输入区（Composer）

> 长期设计导航：`openspec/designs/architecture/conversation-ui-state.md` 第 1、3、6 节。附件/pending-input 当前事实以 stable/active OpenSpec、public contracts、当前代码和测试为准；本文档是 UCD 设计表达层，非 OpenSpec 基线，不定义契约。

## 职责

用户输入文本、添加附件、发送消息或停止运行的入口。同时缓存草稿与接收 pending input 应答（部分场景）。

## 组成

```
┌─────────────────────────────────────────────────────┐
│  [Skill 选择器 bar（可选）]                           │
│  ┌─ 输入区卡片 ──────────────────────────────────┐  │
│  │  [已选 skill chip（可选）]                     │  │
│  │  [slash 面板 / assoc 面板（浮动，可选）]        │  │
│  │  [编辑模式提示 pill（edit 模式）]              │  │
│  │  [ESC 取消提示 Alert（isExecuting 时）]        │  │
│  │  [附件队列（已添加附件的 uploading/uploaded/   │  │
│  │   error 状态）]                                │  │
│  │  [已选 skill chip 分隔线（可选）]              │  │
│  │  文本输入框（多行，自适应高度 40-90px）        │  │
│  │  [/ 提示]              [重试][更多][📎][发送]  │  │
│  └────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

## 发送与停止

- **发送按钮**：用户点击或按 Enter 发送消息。发送后触发 `REQUEST_ACCEPTED`，UI 新建回合。
- **停止按钮**：run 进行中显示停止按钮（替代发送按钮）。用户点击触发 `request-cancel`（`request-cancel` spec），runtime 投影 `REQUEST_CANCELED`。
- 发送后草稿 MUST 清除该 session 的 normal draft。来源：`ts-run-status-visibility` 的 `Frontend local view state MUST remain visually and navigationally stable` scenario "Composer draft is restored for the selected session"。

## 草稿缓存

- normal-mode 草稿 MUST 按 session 缓存（浏览器 tab 存活期内）。
- 用户切换 session 再返回时，composer MUST 恢复该 session 的未发送草稿。
- edit-mode replacement text 与 active pending-input 应答文本 MUST NOT 覆盖 normal per-session draft。
- 来源：`ts-run-status-visibility` 的 `Frontend local view state MUST remain visually and navigationally stable`。

## 附件上传

- 用户点击附件按钮添加附件（日志文件、配置截图等）。
- 附件上传后，runtime 校验，前端收到以下事件：
  - `ATTACHMENT_ACCEPTED`：附件指示区显示 accepted 状态（`attachmentId`、`status`、`mediaType`）。
  - `ATTACHMENT_REJECTED`：附件指示区显示 rejected 状态（`attachmentId`、`status`、`mediaType`、可选 `reasonCode`、`safeSummary`）。
- 用户可读原因从 `reasonCode`/`safeSummary` 派生。
- MUST NOT 暴露：attachment content bytes、local file path、credential、raw validation detail、policy internals。来源：本 change `Attachment Accepted/Rejected Stream Event Visibility` requirement。

## 附件指示区

- live 模式：实时显示 accepted/rejected 流事件驱动的指示。
- history 模式：附件流事件不重建，附件指示依赖持久化 attachment metadata（在 owning USER 消息内）。来源：本 change `Attachment Accepted/Rejected Stream Event Visibility` scenario "Historical conversation does not reconstruct attachment accepted/rejected event"。

## pending input 应答入口

- pending input active 时，`ChatPage` 当前以 `RespondInput` **替换**普通 `MessageInput`；question/human-handoff 使用表单，authorization/confirmation 使用按钮应答。
- 普通消息输入、附件和发送/停止入口此时不同时渲染，不存在“保留 composer 但只提示优先应答”的当前路径。
- 若产品希望 MessageInput 与“Agent 正在等待你的输入”提示并存，必须标为 `[UCD目标]` 并先定义同 session 新消息、取消和 pending resolution 的冲突语义。

## 停止与禁用

- run 进行中：发送按钮替换为停止按钮；文本输入仍可编辑（草稿缓存生效）。
- pending input active：普通 `MessageInput` 不渲染，由 `RespondInput` 占用 composer 区域；这不是 disabled 状态。
- 断线重连中（`reconnecting` 态）：composer 可禁用发送，显示"正在重连"。
- 历史对话浏览（无 active run）：composer 可用（用于发起新回合）。

## 长时任务执行中的 fork 引导

> ⚠️ **实现状态标注**：本引导为 UCD 设计建议。当前 composer 无 long-running 检测、无 fork 引导提示。依赖 long-running 扩展态（见 `capability-card.md`）落地后实现。

**场景**：长时任务执行中（long-running 态），用户聚焦 composer 想发新消息。同会话直接发送会触发 supersede 终止长时任务（旅程 17）。本引导在用户**意图时刻**提醒后果，并提供 fork 替代方案——保留长时任务 + 基于历史在新分支继续。

**位置**：composer 输入框上方，inline 提示条。

**时机**：long-running 态 + 用户 focus composer 或开始输入。长时任务进入终态或被取消后消失。

**样式**：warning-tertiary 浅色背景条，可关闭（[×]）。

```
┌─ Composer ──────────────────────────────────────────┐
│  💡 "configAudit" 仍在执行（已 45 秒）                │
│     直接发送会终止它。想保留任务并基于历史继续？       │
│     [在新分支继续 →]                          [×]    │
│                                                      │
│  [📎]  输入消息…                             [发送]   │
└──────────────────────────────────────────────────────┘
```

**文案规范**：
- 状态："configAudit 仍在执行（已 45 秒）"——具名 + 计时，让用户知道是哪个任务
- 后果："直接发送会终止它。"——明确 supersede 后果，用用户能懂的语言（不用"supersede"术语）
- 替代："想保留任务并基于历史继续？"——双重强调：不终止 + 带历史
- 动作："[在新分支继续 →]"
- 用"新分支"而非"新会话"

**行为**：
- 点击 [在新分支继续 →]：触发智能 fork（自动选最近 COMPLETED turn 为 anchor）→ 导航到子会话 → 聚焦 composer。用户当前在输入框已打的草稿带到子会话 composer。
- 点击 [×]：关闭提示。用户仍可直接点发送（supersede 正常进行）。
- 直接点发送：supersede 正常进行，引导**不阻断**。

**智能 fork anchor 选择**：与 `capability-card.md`"fork-to-continue 引导 CTA"共享同一规则——从当前 active run 往前找最近 `COMPLETED` ASSISTANT turn；无 COMPLETED turn 时不显示引导（首轮即长时，fork 无意义）。

**与能力卡片 CTA 的关系**：能力卡片 CTA 是**意图前**引导（用户尚未想发送，纯 discoverability）；composer 提示是**意图时刻**引导（用户已聚焦输入框，需提醒后果 + 替代方案）。两者文案不重复——卡片 CTA 用"想同时处理其他事？"，composer 提示用"直接发送会终止它"。若两者同时可见，composer 提示为主（更贴近用户当前意图）。

**不做的设计**：
- 不弹模态确认——模态打断流式体验，引导必须 inline。
- 不阻断发送——supersede 是合法操作，引导只提示替代方案。
- 不在短时 running（<10s 阈值）显示——短任务用户通常愿意等。
- 不自动 fork——fork 是会话分支操作，必须用户主动点击。

## 编辑模式（Edit Mode）

用户可编辑最近一条已发送的 USER 消息并重新发送。来源：`MessageInput.tsx` 的 `mode="edit"` 分支 + `commandCatalog.ts` 的 `/edit` 命令。

### 触发方式

- **Slash 命令**：输入 `/edit` → 匹配时面板高亮 → Enter/Tab 填充 → 再 Enter 发送。
- **编辑按钮**：父组件可通过 `onEditLatest` 触发（如 USER 消息上的编辑入口，见 `message-bubble.md`）。

### 启用条件

`/edit` 命令的 `isEnabled` 条件（`commandCatalog.ts`）：
- `hasWritePermission`——用户有 Write 权限。
- `hasEditTarget`——存在可编辑的最新 USER 消息。
- `!isExecuting`——当前无运行中的请求。

不满足时命令在 slash 面板中灰色显示，附 `disabledReason` 文案。

### 视觉差异

| 维度 | normal 模式 | edit 模式 |
|---|---|---|
| 卡片边框 | `1px solid var(--color-composer-border)` | `1px solid var(--color-primary)` |
| 卡片阴影 | `0 6px 18px composer-shadow` | `0 0 0 3px rgba(22,119,255,0.12)` + 同上 |
| 编辑标记 | 无 | pill 形"编辑模式"提示（`editModeHint`） |
| 按钮组 | 发送/停止 | 取消编辑（X 图标）+ 确认编辑（Send 图标） |
| 光标位置 | 默认 | 加载后聚焦到文本末尾 |

### 交互流程

1. 进入 edit 模式 → 加载原消息文本到 textarea → 聚焦 + 光标移至末尾。
2. 用户编辑文本 → `Escape` 取消编辑（调用 `onCancelEdit`）→ 回到 normal 模式。
3. 用户点击确认编辑或 `Enter` → 发送 → 创建 superseding request（旧 turn 被取代）。
4. edit-mode replacement text 与 normal per-session draft 独立缓存，不互相覆盖。

### 草稿隔离

edit-mode replacement text MUST NOT 覆盖 normal per-session draft。来源：`ts-run-status-visibility` 的 `Frontend local view state MUST remain visually and navigationally stable`。

### edit 模式视觉样例

```
┌─ Composer（edit 模式）──────────────────────────────┐
│  ┌──────────────────────────────────────────────┐  │
│  │  [📝 编辑模式]                                │  │  ← primary 边框 + pill 提示
│  │  ─────────────────────────────────             │  │
│  │  网络健康诊断（原消息，可编辑）               │  │  ← 加载原消息文本，光标末尾
│  │                                                │  │
│  │  [✕ 取消编辑]                    [✓ 确认编辑]  │  │  ← 按钮组变更
│  └──────────────────────────────────────────────┘  │
│  ← 阴影：0 0 0 3px rgba(22,119,255,0.12)            │
└──────────────────────────────────────────────────────┘
  ← Escape 取消，Enter/点击确认编辑
```

### edit 模式禁用原因样例

当 `/edit` 不满足启用条件时，slash 面板中灰色显示：

```
┌─ Slash 面板 ──────────────────────────────────────┐
│  ⠂ /help   打开帮助                                │
│  ↻ /retry  重试最新失败请求（灰色）                 │
│  ✎ /edit   编辑最新消息（灰色）                     │
│             ↑ 禁用原因：正在执行 / 无可编辑目标     │
└────────────────────────────────────────────────────┘
```

## Skill 选择器（Skill Selector）

用户可在发送前选择特定 skill/capability 来引导 Agent 执行。来源：`MessageInput.tsx` 的 `skillSelectorSlot`/`selectedSkillChip` props + `SkillSelector.tsx`。

### 组成

```
┌─────────────────────────────────────────────────────┐
│  [Skill 选择器 bar（skillSelectorSlot）]             │  ← 输入区上方
│  ┌─ 输入区卡片 ──────────────────────────────────┐  │
│  │  [已选 skill chip（selectedSkillChip）]        │  │  ← 输入区内顶部
│  │  ─────────────────────────────────             │  │
│  │  [附件按钮]  文本输入框  [发送/停止按钮]        │  │
│  └────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### Skill 选择器 bar

- 位置：输入区卡片**上方**，`marginBottom: 12px`。
- 功能：浏览 skill catalog，选择目标 skill。
- 实现：`SkillSelector.tsx`（通过 `skillSelectorSlot` prop 注入）。

### 已选 skill chip

- 位置：输入区卡片**内顶部**，仅当 `hasSelectedChip`（skill 或 category 已选）时显示。
- 下方有 1px 分隔线（`var(--color-border)`，`opacity: 0.5`）与文本输入区隔开。
- 显示已选 skill 的名称与图标，可移除（回到默认无 skill 状态）。

### Slash 面板中的 skill

- 输入 `/` 时，slash 面板除 quick actions 外还列出 skill catalog（`slashCategorySkills` 分组）。
- 每个 skill 项显示 `displayName` + `description`（省略号截断）。
- 选中 skill（Enter/Tab 或点击）→ 调用 `selectSkill` → 清空输入框 → skill chip 出现在输入区内。
- 支持分页加载（滚动到底部自动加载更多，`loadMoreSlashSkills`）。

## Slash 命令（Slash Commands）

用户输入 `/` 触发命令面板。来源：`commandCatalog.ts` + `MessageInput.tsx` 的 slash 面板。

### 命令清单

| 命令 | 描述 | 启用条件 | 禁用原因示例 |
|---|---|---|---|
| `/help` | 打开帮助 | 始终启用 | — |
| `/retry` | 重试最新失败请求 | `hasWritePermission` && `hasRetryTarget` && `!isExecuting` | 无 Write 权限 / 正在执行 / 无可重试目标 |
| `/edit` | 编辑最新 USER 消息 | `hasWritePermission` && `hasEditTarget` && `!isExecuting` | 同上 |

### 面板交互

- **触发**：输入文本以 `/` 开头时打开面板。
- **导航**：`ArrowUp`/`ArrowDown` 在命令 + skill 列表中移动高亮项，`scrollIntoView` 保持可见。
- **填充**：`Enter` 或 `Tab` 填充高亮命令到输入框（`fillCommand`）。
- **关闭**：`Escape` 关闭面板。
- **禁用命令**：灰色显示（`opacity: 0.6`），附 `disabledReason` 文案，不可选中。

### 面板结构

```
┌─────────────────────────────────────────────┐
│  快速操作（slashCategoryQuickActions）       │
│  ⠂ /help          打开帮助                   │
│  ↻ /retry         重试最新失败请求（灰色）    │
│  ✎ /edit          编辑最新消息                │
│  技能（slashCategorySkills）                 │
│  ✦ 网络诊断       网络健康诊断能力            │
│  ✦ 配置核查       设备配置核查能力            │
│  [加载更多 Spin（分页中）]                    │
└─────────────────────────────────────────────┘
```

### 未知命令处理

- 输入以 `/` 开头但无精确匹配且无部分匹配 → 显示 `unknownCommand` 警告，清空输入框。
- 有部分匹配但无精确匹配 → 打开 slash 面板显示匹配项，不发送。

## 问题关联推荐（Question Association）

用户输入非 slash 文本时，debounce 300ms 后查询关联问题并显示推荐面板。来源：`MessageInput.tsx` 的 assoc 面板 + `questionAssociationService.ts`。

### 面板结构

```
┌─────────────────────────────────────────────┐
│  网络健康诊断方法  [高频问题]                 │
│  设备告警如何排查  [已收藏]                   │
│  配置变更流程      [静态]                     │
└─────────────────────────────────────────────┘
```

- **触发**：非 `/` 开头的非空文本，debounce 300ms（`ASSOCIATION_DEBOUNCE_MS`）。
- **来源标签**：`pinned`（已收藏）、`high-frequency`（高频问题）、`static`（静态），每种不同背景色。
- **关键词高亮**：匹配的关键词在文本中加粗 + 高亮色。
- **交互**：`ArrowUp`/`ArrowDown` 导航，`Enter`/`Tab` 填充，`Escape` 关闭。
- **语言**：按 `siteLocale` 查询对应语言的关联问题。

## 提交历史导航

用户可用 `ArrowUp`/`ArrowDown` 在已提交消息历史中导航。来源：`MessageInput.tsx` 的 `handleSubmittedHistoryNavigation`。

- **ArrowUp**（输入框为空时）：加载最近一条提交消息，继续按向上遍历更早的消息。
- **ArrowDown**：向下遍历，超出底部时恢复导航前的草稿。
- **edit 模式**：禁用历史导航。
- **IME 组合中**（`isComposing`）：禁用导航。

## 附件边缘场景

来源：runtime bootstrap 的 `chatUploadFileConfig` 与 `attachmentRules.ts` 的校验逻辑。产品主路径必须消费 bootstrap 下发的 effective 配置。前端在缺失配置时仍保留 3 个 / 5 MiB / Markdown-only 的 compatibility fallback，后端 direct-intake 也保留同组兼容边界；两者都不能代表 staged composer 的主路径默认值。

| 约束 | 值 | 校验时机 | 错误文案 key |
|---|---|---|---|
| 最大数量 | `chatUploadMaxFileNumber`；主干默认 10 个，平台上限 200 个 | 选择时（`validateAttachmentSelection`） | `attachments.tooMany` |
| 最大大小 | `chatUploadMaxFileSize`；主干默认 10 MiB，平台上限 500 MiB | 选择时（`validateAttachmentFile`） | `attachments.tooLarge` |
| 允许类型 | `chatUploadFileType`；默认 `.md`、`.markdown`，可由可信配置替换 | 选择时（`validateAttachmentFile`） | `attachments.unsupportedType` |
| 重复检测 | fingerprint = `name::size::lastModified` | 选择时（`validateAttachmentSelection`） | `attachments.duplicate` |

- 校验失败时显示 `attachmentNotice`（warning Alert），附件不添加到队列。
- `<input type="file">` 的 `accept` 属性由 effective `chatUploadFileType` 构造；浏览器选择结果仍由 `validateAttachmentFile` 按同一配置二次校验。

> ℹ️ 完整附件限制见 `11-ux-limits-and-constraints.md` §1。

## 附件操作

来源：`MessageInput.tsx` 的附件队列渲染。

### 附件项视觉

**error 态**（附件大小超限）：
```
┌──────────────────────────────────────────────┐
│  alert-report.pdf          1.2 MB   失败 重试 │
│  附件大小超过限制（{maxFileSize}）             │  ← effective config 对应的 errorMessage
└──────────────────────────────────────────────┘
```

**uploading 态**（上传中）：
```
┌──────────────────────────────────────────────┐
│  topology.md               2.1 KB  上传中…    │  ← 旋转 loading 图标
│  正在上传                                    │
└──────────────────────────────────────────────┘
```

**uploaded 态**（已就绪）：
```
┌──────────────────────────────────────────────┐
│  topology.md               2.1 KB  ✅ 已就绪  │  ← 绿色"已就绪"
│                                              │  ← 无操作按钮（已成功）
└──────────────────────────────────────────────┘
```

- **状态**：`uploading`（上传中）→ `uploaded`（已就绪）/ `error`（失败）。
- **状态文案**：`uploaded` → "附件已就绪"（绿色），`error` → "附件失败"（红色）。
- **大小格式化**：`formatAttachmentSize`——≥1MB 显示 `X.X MB`，≥1KB 显示 `X KB`，否则 `X B`。

### 附件校验错误样例

3 种校验失败时显示 warning Alert（附件不添加到队列）：

**attachments.tooMany（超过 effective 最大数量；以下以默认 10 个为例）**：
```
┌─ Composer 附件区 ─────────────────────────────────┐
│  ⚠ 最多只能添加 10 个附件                         │
│                                                    │
│  topology.md      2.1 KB  ✅ 已就绪                │
│  config.md        1.5 KB  ✅ 已就绪                │
│  …其余 8 个已就绪附件                              │
│  （第 11 个文件被拒绝添加）                        │
└────────────────────────────────────────────────────┘
```

**attachments.unsupportedType（不允许的文件类型）**：
```
┌─ Composer 附件区 ─────────────────────────────────┐
│  ⚠ 仅支持当前配置允许的文件类型                    │
│                                                    │
│  screenshot.png 被拒绝（不支持 PNG 类型）          │
└────────────────────────────────────────────────────┘
```

**attachments.duplicate（重复文件）**：
```
┌─ Composer 附件区 ─────────────────────────────────┐
│  ⚠ 该文件已添加                                   │
│                                                    │
│  topology.md 已存在于队列中（fingerprint 重复）    │
└────────────────────────────────────────────────────┘
```

### 操作按钮

| 操作 | 条件 | 按钮 | 行为 |
|---|---|---|---|
| 重试 | `status === "error"` && `onRetryAttachment` 存在 | 文本按钮"重试" | 调用 `onRetryAttachment(localId)` |
| 移除 | `onRemoveAttachment` 存在 | danger 文本按钮（`CloseCircleOutlined`） | 调用 `onRemoveAttachment(localId)` |

### 拖拽上传

- **拖入**：`isDragActive=true`，输入区卡片边框变 primary 色，背景变 active 色，显示 `dropHint` 提示。
- **拖离/放下**：恢复原样式。
- **权限**：无 Write 权限时不响应拖拽。

### 粘贴处理

- 粘贴时只保留纯文本（`text/plain`），去除富文本格式。
- 光标定位到粘贴文本之后。

### 发送门控

- 有 `uploading` 状态的附件时，发送按钮禁用（`hasPendingAttachments`）。
- 所有附件 `uploaded` 后才可发送。

## ESC 取消运行

- **触发**：run 进行中（`isExecuting`）时按 `Escape`。
- **两步确认**：
  1. 第一次 Escape → `escCancelArmed=true`，显示 `escCancelHint` Alert（"再按一次取消运行"），1.8 秒窗口（`ESC_CANCEL_ARM_WINDOW_MS`）。
  2. 窗口内第二次 Escape → 调用 `onStop` 取消运行。
  3. 窗口超时 → 自动解除 armed 状态。
- **overlay 优先**：有可见的 dialog/modal/dropdown 时，Escape 先关闭 overlay，不触发取消。
- **面板优先**：slash/assoc 面板打开时，Escape 先关闭面板。

## live 模式 vs history 模式

| 维度 | live 模式 | history 模式 |
|---|---|---|
| 发送按钮 | run 进行中替换为停止 | 可用（发起新回合） |
| 附件指示 | 实时 accepted/rejected | 依赖持久化 attachment metadata |
| 草稿恢复 | 按 session 缓存 | 同 live |
| 停止按钮 | 可用 | 不适用（无 active run） |

**live 模式样例**（run 进行中，发送替换为停止）：
```
┌─ Composer ──────────────────────────────────────┐
│  [⚠ ESC 取消提示] 再按一次取消运行               │  ← isExecuting 时
│  ┌──────────────────────────────────────────┐  │
│  │  [📎]  输入消息…                    [⏹]  │  │  ← 停止按钮替代发送
│  └──────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

**history 模式样例**（浏览历史对话，无 active run）：
```
┌─ Composer ──────────────────────────────────────┐
│  ┌──────────────────────────────────────────┐  │
│  │  [📎]  输入消息…                    [发送] │  │  ← 发送按钮可用
│  └──────────────────────────────────────────┘  │
│  ← 无停止按钮，无 ESC 取消提示                   │
└──────────────────────────────────────────────────┘
```

**断线重连中样例**（`reconnecting` 态）：
```
┌─ Composer ──────────────────────────────────────┐
│  🔄 正在重连…                                    │  ← 连接状态提示
│  ┌──────────────────────────────────────────┐  │
│  │  [📎]  输入消息…               [发送 ⛔]  │  │  ← 发送按钮禁用
│  └──────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

**pending input active 样例**（`[已实现-主干]`，`RespondInput` 替换 `MessageInput`）：
```
┌─ Composer 区域 / RespondInput ─────────────────┐
│  需要确认是否执行该操作？              ⏱ 4:32   │
│  [拒绝]                              [确认]      │
│                                                  │
│  （普通消息输入、附件与发送按钮当前不渲染）       │
└──────────────────────────────────────────────────┘
```

## 视觉规范（UCD 设计人员决定）

- 输入框尺寸、圆角、内边距。
- 附件按钮、发送按钮、停止按钮的图标与样式。
- 附件指示区的 uploading/uploaded/error 视觉区分（图标/颜色）。
- 草稿恢复的过渡动画。
- edit 模式的视觉强调（当前代码用 primary 边框 + 3px 蓝色阴影，UCD 设计人员可调整）。
- slash 面板与 assoc 面板的视觉区分（位置、背景、高亮项样式）。
- ESC 两步取消的视觉反馈（armed 时的 Alert 样式）。
- 约束：不得通过视觉暗示非契约字段；rejected 附件 MUST NOT 显示 raw validation error text 或 local path。

## 动态行为与交互响应

> 跨组件的通用模式见 `02-dynamic-behavior-and-interaction.md`。本节补充 Composer 特有行为。

### 已实现

| 行为 | 说明 | 代码位置 |
|------|------|---------|
| 发送/停止按钮切换 | run 进行中显示停止按钮，否则显示发送按钮 | `MessageInput.tsx` L1684-1708 |
| 发送按钮 disabled | 空消息/上传中 disabled（`submitDisabled = disabled \|\| !message.trim() \|\| submitting \|\| hasPendingAttachments`）。⚠️ 重连中未禁用：`ChatPage.tsx` 传入 `disabled={false}`，重连状态仅显示顶部状态条，不影响 composer | L1029, L1701 |
| 发送按钮 loading | 提交中显示 Spin | L1678, L1705 |
| 编辑模式视觉 | `mode === "edit"` 时边框变蓝 + 阴影 + 背景色 | L1086-1110 |
| 边框过渡 | border-color + background + box-shadow 120ms transition | L1110 |
| 拖拽高亮 | `isDragActive` 时边框变蓝 + 背景变色 + 拖放提示 | L1097-1104, L1317-1333 |
| 附件状态指示 | error（红色）/ uploaded（绿色）三态 | L1392-1457 |
| 附件重试按钮 | error 态显示重试按钮 | L1429-1438 |
| slash 命令高亮 | 键盘选择时 `isHighlighted` 背景变色 | L1165-1166 |
| slash 命令 scrollIntoView | 高亮项滚动到视口 | L516 |
| ESC 取消提示 | `escCancelArmed && isExecuting` 时显示 Alert | L1335-1347 |
| inline notice | 有 `activeInlineNotice` 时显示 Alert | L1349-1361 |
| 按钮 hover | hover 时背景色变化 120ms | theme.css L545-546, L568-569 |

### UCD 设计建议

| 行为 | 说明 |
|------|------|
| 按钮 click 反馈 | active 态 scale(0.98)，100ms transition |
| slash 面板动画 | 面板打开/关闭 slide-down/up 200ms |
| 附件上传进度条 | 上传时显示百分比进度条（API 层已有 `onProgress`，UI 未消费） |
| 输入框 focus | `focus-visible` outline 2px primary + offset 2px |
| 关联问题面板动画 | 面板打开/关闭 slide-down/up 200ms |
| 重连中禁用发送 | `reconnecting` 态时 composer 应禁用发送按钮。当前 `ChatPage.tsx` 传入 `disabled={false}`，重连状态仅显示顶部状态条，**未禁用发送** |
