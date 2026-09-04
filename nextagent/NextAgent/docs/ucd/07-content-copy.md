# 内容文案

> 长期设计导航：`openspec/designs/architecture/conversation-ui-state.md` 第 1、5、6 节。当前事实必须与 stable/active OpenSpec、public contracts、当前代码和测试交叉核对；本文档是 UCD 设计表达层，非 OpenSpec 基线，不定义契约。

本文档定义对话界面各场景的用户可读文案。文案从契约层 safe field 派生，不暴露 raw error、raw payload、local path、policy internals。

## 通用原则

- 默认中文（`telecom-bilingual-output`）。
- 文案从 `safeSummary`、`safeErrorCode`、`safeErrorCategory`、`reasonCode`、`message` 等 safe field 派生。
- MUST NOT 展示：raw prompt、raw model output 全文、tool args、raw tool result、attachment content bytes、local file path、credential、raw validation error、policy internals、internal context-engine state。
- safe failure placeholder（`Request failed`、`Request failed: ...`、`Request failed safely: CODE`）MUST NOT 作为 assistant answer content 展示。

### i18n 翻译链路

后端 `stream-envelope.ts` 投影的 `safeSummary` 等 safe field 通常使用英文（如 `"Command completed."`）。前端只会对已被 parser 识别且有专门 formatter 的结果通过 i18next `t()` 生成本地化文案；parser 未识别或没有专门 formatter 的结果走 generic fallback，`safeSummary` 当前可能原样显示，不会被自动翻译。

本文档给出的中文文案是专门 presentation path 的**目标用户可见效果**。开发人员需维护 i18n translation files，并明确 generic safe-summary fallback 是否保留后端原文；不得据此宣称所有 `safeSummary` 已自动本地化。

## 消息气泡文案

### USER 消息

- 直接展示用户输入文本。
- 附件指示：见下文"附件"。

### ASSISTANT 消息

- 直接展示 `content` 字段（markdown）。
- 终态指示：
  - `COMPLETED`：✓ 已完成（或无显式文案，视觉指示即可）。
  - `CANCELED`：已取消。
  - `SUPERSEDED`：已被新请求取代。
  - `FAILED`：见"请求失败"文案。

## 能力卡片文案

### running 态

- `capabilityId` + "执行中..."
- 例：`read` 执行中...、`rag` 执行中...

### 结果态（按当前前端呈现层级）

| 层级 / kind | 文案模板与当前状态 |
|---|---|
| 专门 formatter：`commandOutput` | 默认 `DETAIL`；展开时直接显示退出码、stdout/stderr preview、timeout 与截断事实，不重复显示“命令执行完成”等占位摘要 |
| 专门 formatter：`fileRead` | "已读取 {filePath}" + 行范围说明（如"从第 3 行开始，最多 50 行"）+ "，内容已返回" |
| 专门 formatter：`fileList` | "找到 {totalCount} 个匹配文件" |
| 专门 formatter：`fileWrite` | "已创建文件。"（operation=create）/ "已更新文件。"（operation=update） |
| 专门 formatter：`skillLoaded` | "已加载 {name} 技能" |
| 专门 formatter：`workflowResult` | 按 `succeeded` / `interrupted` / `waiting` / `failed` 映射工作流摘要；可展开显示 bounded `answerPreviews` |
| 专门 formatter：`todoList` | “待办列表已清空”（0 项）/“待办列表有 {n} 项”；状态、空态和系统摘要使用当前界面语言 |
| parser 已识别但无专门 formatter：`httpResponse` | 当前走安全 `safeSummary` / 通用结果文案；不能把专门 HTTP 卡片描述为已实现 |
| 专门 formatter：`cron`、`toolSearch` | 按当前界面语言显示经过白名单和容量限制的结构详情 |
| 后端可投影但 parser 未识别：`clipStreamEvent`、`clipStreamCompletion`、`clipStreamResult` | 只显示有效安全摘要；专门文案属于后续 contract/presentation 工作 |
| 其余或未知 shape | 无有效受信摘要时只保留业务标题和状态；不得展示 raw result / raw JSON，也不得显示“结果已返回”等占位摘要 |

### generic fallback 中的 `safeSummary` 优先

- 已识别且有专门 formatter 的结果先按结构化字段生成 presentation-owned/i18n 文案；只有进入 generic fallback 或失败通用映射时，才优先使用 payload 中可信、非 generic 的 `safeSummary`。
- generic placeholder（`Capability result is available.`、`Tool output is ready`）MUST NOT 作为有效 `safeSummary` 展示。来源：`ts-run-status-visibility` 的 `Capability result stream payload MUST expose only safe result projections`。

## 失败文案（按 safeErrorCode / safeErrorCategory）

来源：`conversation-ui-state.md` 第 5 节映射表、`stream-envelope.ts` 的 `summarizeSafeCapabilityFailure`。

### safeErrorCode

| code | 用户可读文案 |
|---|---|
| `CAPABILITY_PATH_REJECTED` | "路径访问被策略阻止" |
| `COMMAND_NOT_ALLOWED` | "命令被安全策略阻止，未执行" |
| `CAPABILITY_INPUT_INVALID` / `INVALID_INPUT` | "工具输入无效，能力未执行" |
| `CAPABILITY_RESULT_LIMIT_EXCEEDED` / `RESOURCE_TOO_LARGE` | "能力结果过大，无法安全展示" |

### safeErrorCategory

| category | 用户可读文案 |
|---|---|
| `AUTHORIZATION` / `POLICY_DENIED` | "能力执行被策略阻止" |
| `VALIDATION` | "能力输入无法被安全接受" |
| `TIMEOUT` | "能力执行超时" |
| `UNAVAILABLE` | "能力执行不可用" |
| fallback | "能力执行安全失败" |

### 渲染约束

- 用户可读 reason MUST 只从 `safeErrorCode`/`safeErrorCategory`/`safeSummary` 派生。
- MUST NOT 显示 raw validation error text、rejected path、file system detail、policy internals。
- `CAPABILITY_PATH_REJECTED` 不升级为 run failure，run 可继续。

## 降级提示文案

- 主文案：`message` 或 `safeSummary` 字段。
- projection failure（投影失败，`STREAM_PROJECTION_PAYLOAD_UNSAFE` 等）："该事件无法安全转换为前端可显示内容"。
- history 模式：降级提示由持久化消息重建，内容与 live 完成后完全相同。

## 附件文案

| 场景 | 文案 |
|---|---|
| `ATTACHMENT_ACCEPTED` | "附件 {fileName} 已接收" ⚠️ 前端 mock server 生成 "附件 {fileName} 已接收"（使用 `fileName`，非 `mediaType`；措辞为"已接收"非"已接受"） |
| `ATTACHMENT_REJECTED` | "附件被拒绝" + 从 `reasonCode`/`safeSummary` 派生的原因 |
| 附件过大 | "附件过大，无法上传"（若 `reasonCode` 指示容量） |
| 附件格式不支持 | "附件格式不支持"（若 `reasonCode` 指示格式） |

MUST NOT 暴露 attachment content bytes、local file path、credential、raw validation detail、policy internals。

## Pending input 文案

| kind | `USER_INPUT_REQUIRED` 文案 |
|---|---|
| `question` | 每个 question 的 `prompt`（直接展示） |
| `authorization` | "需要授权：{操作描述}"（从 `questions[].prompt` 派生） |
| `confirmation` | "需要确认：{操作描述}" |
| `human-handoff` | "请选择人工接管模式并填写交接内容"（模式：最终答案 / 恢复指令） |
| `[UCD目标/Clarify] workflow-interrupt` | "工作流已暂停，需要你的输入"；当前 Web payload 不能可靠区分，不得直接作为已实现文案 |

### 终态文案

| event | 文案 |
|---|---|
| `USER_INPUT_RECEIVED` | "已应答"（+ `safeSummary` 若有） |
| `USER_INPUT_TIMEOUT` | "已超时"（+ `safeSummary` 若有） |
| `USER_INPUT_CANCELED` | "已取消"（+ `safeSummary` 若有） |

## 上下文压缩文案

- `CONTEXT_COMPACTED`："上下文已压缩"（可选附 `contextVersion` 或 `safeSummary` 用于用户定位）。
- MUST NOT 暴露 compacted prompt content、model output、raw message bodies、internal context-engine state。
- history 模式：压缩通知由持久化消息重建，内容与 live 完成后完全相同（`SUMMARY` 消息被过滤，但压缩通知独立重建）。

## 断线重连文案

> ⚠️ 以下文案基于前端实际 `StreamConnectionPhase`（5 种：`idle`/`connected`/`reconnecting`/`resyncing`/`disconnected`）。前端无 `degraded` 和 `replayed` phase。UCD 设计人员可将 `degraded`/`replayed` 视为设计目标（当前前端实现简化为 5 个 phase）。

| 状态 | 文案 | 说明 |
|---|---|---|
| `idle` | （无指示） | 会话未接入 stream |
| `connected` | （无指示） | 正常连接 |
| `reconnecting` | "正在重连..." | 连接中断，尝试恢复 |
| `resyncing` | "同步中..." | 重连成功，正在补齐缺失事件 |
| `disconnected` | "已断开，请刷新当前会话" | 重连失败，需用户手动刷新 |

> 设计目标（当前前端未实现）：`degraded`（"连接不稳定"）和 `replayed`（"已恢复连接"，短暂提示后消失）。

## 多会话后台 run 文案

来源：`session-list-item.md` 的"多会话后台 run 指示"。

### 会话 Activity（会话列表项）

| Activity status | 文案语义 | 说明 |
|---|---|---|
| `WAITING_FOR_INPUT` | 按 QUESTION/CONFIRMATION/AUTHORIZATION/HUMAN_HANDOFF 显示 locale-backed 等待输入提示 | 优先级最高 |
| `RUNNING` | "执行中" | 小型 loading indicator |
| `UNREAD_FAILURE` | "有失败结果" | 红色感叹号与无障碍文案 |
| `UNREAD_RESULT` | "有新结果" | 蓝点与无障碍文案 |
| `NONE` | 最后活动时间 | 无需注意的普通状态 |

### 后台 run 已完成（会话列表项未读状态，`[已实现-主干]`）

> 当前稳定实现使用 `UNREAD_RESULT` 与 `UNREAD_FAILURE`，而不是直接把所有 terminal `RunStatus` 暴露为长期角标；匹配 presentation 可见后才消费。

Activity 不直接显示 `COMPLETED` / `CANCELED` / `SUPERSEDED` 等完整 RunStatus 枚举；是否形成未读结果或未读失败由稳定投影规则决定。

### 当前已连接会话断线重连（非会话列表项）

`continuityPhase` 存在于当前 conversation runtime state，不在 session-list DTO/`SessionHistoryEntryRow` 中。以下文案用于当前对话区或 stream status；若未来要在列表中呈现，必须先建立独立 public projection，不属于本轮 Ready change。

| continuityPhase | 文案 |
|---|---|
| `reconnecting` | "正在重连..." |
| `resyncing` | "同步中..." |
| `disconnected` | "已断开" |

## 长时运行文案

来源：`capability-card.md` 的"长时运行扩展"。

| 场景 | 文案 |
|---|---|
| 能力执行超过阈值 | "已 N 秒"（计时器，N 从 `CAPABILITY_STARTED.createdAt` 计算） |
| 长时运行提示 | "此能力可能需要较长时间完成" |
| 取消入口 | "取消执行" |

> MUST NOT 显示预估剩余时间（后端不提供）。MUST NOT 显示工作流内部节点进度（`NODE_OUTPUT_DELTA` 非 stream-visible）。MUST NOT 显示进度百分比（工作流轮询/批量不发射中间事件）。

## 空状态文案

| 场景 | 文案 |
|---|---|
| 无会话 | "开始你的第一个对话" + CTA |
| 新会话 | "向 Agent 提问，开始排查网络问题" |
| 高频问题 | "常见问题" + 问题列表 |

## 历史对话浏览提示文案

- 进入历史对话时，可选提示："你正在浏览历史对话。"（内容与实时对话完成后完全相同，仅无打字机效果和过程动画。）
- 历史失败 terminal 若有 partial answer："此回答为部分答案，完整执行已失败。"
- 历史失败 terminal 若为 safe failure placeholder：不展示为答案，仅展示失败卡片。

## 欢迎状态文案

来源：`WelcomeState.tsx` + `HighFrequencyQuestions.tsx`。

| 场景 | 文案 |
|---|---|
| 品牌标题 | "NextAgent" |
| 欢迎副标题 | `welcome.subtitle`（如"智能网络运维助手"） |
| 高频问题 fallback 1 | "分析网络延迟" |
| 高频问题 fallback 2 | "检查配置合规性" |
| 高频问题 fallback 3 | "生成流量报表" |
| 高频问题 fallback 4 | "诊断网络问题" |
| 侧边栏无会话 | "暂无历史"（`emptySessionsTitle`） |
| 侧边栏无会话描述 | `emptySessionsDescription` |

## 推荐后续问题文案

来源：`SuggestedQuestions.tsx`。

| 场景 | 文案 |
|---|---|
| 加载中 | 3 点加载动画（无文字） |
| 有结果 | 直接展示推荐问题文本 |
| 无结果 | 不渲染（无文案） |
| 加载失败 | 不渲染（静默失败） |

## 分类问题文案

来源：`CategoryQuestions.tsx` + `CategoryQuestionModal.tsx`。

| 场景 | 文案 |
|---|---|
| 标题 | "分类问题推荐" |
| 全部标签 | "全部" |
| L1 标签 | 从 API 获取的分类名称 |
| L2 标签 | 从 API 获取的子分类名称 |
| 问题块 | 从 API 获取的问题文本 |

## 编辑模式文案

来源：`MessageInput.tsx` 的 `composer.editModeHint` + `commandCatalog.ts`。

| 场景 | 文案 |
|---|---|
| 编辑模式提示 pill | `composer.editModeHint`（如"编辑模式"） |
| 取消编辑按钮 | 取消编辑（X 图标） |
| 确认编辑按钮 | 发送编辑（Send 图标） |
| `/edit` 命令描述 | `composer.commands.edit`（如"编辑最新消息"） |
| `/edit` 禁用原因 - 执行中 | `composer.disabledReasons.editExecuting`（如"正在执行中，无法编辑"） |
| `/edit` 禁用原因 - 无目标 | `composer.disabledReasons.editUnavailable`（如"没有可编辑的消息"） |

## 取消运行文案

来源：`MessageInput.tsx` 的 ESC 取消逻辑。

| 场景 | 文案 |
|---|---|
| ESC 首次按下（armed） | `composer.escCancelHint`（如"再按一次取消运行"） |
| 停止按钮 | `composer.stopResponse`（如"停止响应"） |
| 取消终态（有部分内容） | `turn.canceledWithPartialContent`（如"已取消（含部分内容）"） |
| 取消终态（无内容） | `turn.canceledWithoutAnswer`（如"已取消"） |

## 重试文案

来源：`MessageInput.tsx` + `commandCatalog.ts`。

| 场景 | 文案 |
|---|---|
| 重试按钮（TurnBlock） | `common.retry`（如"重试"） |
| 重试按钮（Composer） | `common.retry` |
| `/retry` 命令描述 | `composer.commands.retry`（如"重试最新失败请求"） |
| `/retry` 禁用原因 - 执行中 | `composer.disabledReasons.retryExecuting`（如"正在执行中，无法重试"） |
| `/retry` 禁用原因 - 无目标 | `composer.disabledReasons.retryUnavailable`（如"没有可重试的请求"） |

## 派生文案

来源：`ChatPage.tsx` 的 fork notice banner、`TurnBlock.tsx` 的 fork 按钮。i18n 资源：`zh-CN.ts` L261-262、L555、L558-562。

| 场景 | 文案 key | zh-CN 实际值 |
|---|---|---|
| 派生按钮 tooltip | `turn.fork` | "从此回复派生会话" |
| 派生中 busy tooltip | `turn.forking` | "正在派生..." |
| Fork notice banner prefix | `forkNotice.derivedFromPrefix` | "由 " |
| Fork notice banner suffix | `forkNotice.derivedFromSuffix` | " 派生" |
| Fork notice 打开来源 aria-label | `forkNotice.openSource` | "打开源会话 {{title}}" |
| 派生失败 toast | `requestNotices.forkFailed` | "派生会话失败，请稍后重试。" |

> ℹ️ banner 结构为 `[prefix] [title link] [suffix]`，即"由 [来源会话标题] 派生"。来源标题为可点击按钮（`navigation.openSession`），是派生时刻的快照（非动态绑定）。

## 标注反馈文案

来源：`TurnBlock.tsx` 的 annotation 按钮。

| 场景 | 文案 |
|---|---|
| 点赞按钮 tooltip | `turn.annotation.like`（如"赞"） |
| 踩按钮 tooltip | `turn.annotation.dislike`（如"踩"） |
| 收藏按钮 tooltip | `turn.annotation.favorite`（如"收藏"） |
| Pin 按钮 tooltip | `turn.pinQuestion`（如"收藏问题"） |
| Pin 成功 toast | "问题已收藏到题库" |
| Pin 失败 toast | "收藏失败，请稍后重试" |

## 搜索文案

来源：`SessionHistorySearchDialog.tsx` + `SessionHistorySearchControls.tsx`。

| 场景 | 文案 |
|---|---|
| 搜索 dialog 标题 | "搜索会话" |
| 关键词 placeholder | "输入关键词搜索..." |
| 关键词太短（ASCII） | "关键词至少 3 个字符" |
| 关键词太短（非 ASCII） | "关键词至少 2 个字符" |
| 日期范围标签 | "时间范围" |
| 加载更多 | "加载更多" |
| 无结果 | "未找到匹配的会话" |

## 重命名/删除文案

来源：`SessionRenameModal.tsx` + `SessionDeleteConfirmModal.tsx`。

| 场景 | 文案 |
|---|---|
| 重命名 modal 标题 | "重命名会话" |
| 重命名确认按钮 | "确定" |
| 重命名取消按钮 | "取消" |
| 删除 modal 标题 | "删除会话" |
| 删除确认内容 | "确定要删除'{sessionTitle}'吗？此操作不可撤销。" |
| 删除确认按钮 | "删除" |
| 删除取消按钮 | "取消" |

## 收藏夹文案

来源：`Sidebar.tsx` 的 favorites 逻辑。

| 场景 | 文案 |
|---|---|
| 收藏视图标题 | "收藏会话" |
| 收藏切换按钮 tooltip | "查看收藏会话" |
| 无收藏 | "暂无收藏会话" |

> ⚠️ 上述“收藏会话”是当前 legacy UI 文案；`/api/v1/favorites` 的现有数据语义是 favorite turn/request-run 条目，不代表已存在 session-level favorite truth。文案刷新可以改为“收藏内容/收藏回合”，但若产品需要真正的会话收藏，必须另行定义聚合或持久化契约。

## 分享设置文案

来源：`ShareSettingsModal.tsx`。

| 场景 | 文案 |
|---|---|
| 分享按钮 tooltip | "分享" |
| 分享设置 modal 标题 | "分享对话" |
| 生成 URL | "点击生成分享链接" |
| 链接已生成 | "分享链接已生成，可复制使用" |
| 复制链接 | "复制链接" |
| 取消分享 | "取消分享" |

## 权限门控文案

来源：`AuthGate.tsx` + `PermissionUnavailable.tsx`。

| 场景 | 文案 |
|---|---|
| Write 权限缺失 tooltip | `auth.noWritePermission`（如"无操作权限"） |
| 无任何权限 - 标题 | `auth.noPermissionTitle`（如"无访问权限"） |
| 无任何权限 - 描述 | `auth.noPermissionDescription`（如"您没有访问此应用的权限"） |
| Slash 命令无 Write 权限 | `auth.slashNoWritePermission`（如"无操作权限，命令不可用"） |

## 键盘快捷键帮助文案

来源：`CommandHelpModal.tsx`。

| 分组 | 快捷键 | 文案 |
|---|---|---|
| 全局 | `Cmd+K` | "聚焦输入框" |
| 全局 | `Cmd+/` | "打开快捷键帮助" |
| 全局 | `Cmd+[` | "上一会话" |
| 全局 | `Cmd+]` | "下一会话" |
| 输入 | `Enter` | "发送" |
| 输入 | `Shift+Enter` | "换行" |
| 输入 | `Tab` | "确认补全" |
| 输入 | `Escape` | "关闭/取消" |
| Slash | `/help` | "打开帮助" |
| Slash | `/retry` | "重试最新失败请求" |
| Slash | `/edit` | "编辑最新消息" |

## Slash 命令面板文案

来源：`MessageInput.tsx` 的 slash 面板。

| 场景 | 文案 |
|---|---|
| 快速操作分组标题 | `composer.slashCategoryQuickActions`（如"快速操作"） |
| 技能分组标题 | `composer.slashCategorySkills`（如"技能"） |
| 未知命令警告 | `composer.unknownCommand`（如"未知命令：{command}"） |
| slash 提示前缀 | `composer.slashHintPrefix` |
| slash 提示后缀 | `composer.slashHintSuffix` |
| 命令不可用 | `composer.commandUnavailable`（如"命令当前不可用"） |

## 问题关联推荐文案

来源：`MessageInput.tsx` 的 assoc 面板。

| source | 标签文案 |
|---|---|
| `pinned` | `composer.associationSource.pinned`（如"已收藏"） |
| `high-frequency` | `composer.associationSource.high-frequency`（如"高频问题"） |
| `static` | `composer.associationSource.static`（如"推荐"） |

## 历史分页加载文案

来源：`MessageList.tsx` 的 historyBoundary。

| 场景 | 文案 |
|---|---|
| 可加载 | "加载更早消息" |
| 加载中 | "加载中..." |
| 加载失败 | "加载失败，点击重试" |
| 无更多 | （不显示分隔符） |

## Stream resume 文案

来源：`streamResumeRecovery.ts` + `useStreamConnection.ts`。

| 场景 | 文案 |
|---|---|
| gap（可重试） | "连接需要刷新，正在恢复..." |
| gap 恢复中 | "正在同步缺失的事件..." |
| failure（可重试） | "连接中断，正在重试..." |
| failure（不可重试） | "连接失败，请刷新对话" |
| 刷新按钮 | "刷新对话" |

## 文案审阅原则（UCD 设计人员）

- 文案简洁、专业、面向电信网络运维场景。
- 避免技术黑话泄漏（如不展示 `safeErrorCode` 原值给普通用户，只在 second-level details 提供）。
- 错误文案给出可行动建议（如"请缩小查询范围后重试"对应 `RESOURCE_TOO_LARGE`）。
- 双语支持：中文为主，关键术语保留英文（如 `RAG`、`CLIP`、`Skill`）。
