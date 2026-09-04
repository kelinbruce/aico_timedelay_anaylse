# 工具 UI 接口总览（Tool UI Interface Overview）

> 本文档是跨组件的**接口总览**，将工具与 UI 交互的 8 类接口 consolidated 为统一视图。各接口的详细视觉规范见对应组件规范文档。本文件不重复视觉 mockup，只提供**接口清单 + 工具映射 + 适配点**。

## 职责

帮助 UCD 设计人员和前端开发者一页看清：

- 每个工具走哪些 UI 接口路径
- 每类接口的前端消费位置和适配点
- 新增工具或新增接口类型时需要改哪些前端代码

## 8 类 UI 接口总览

| # | 接口类别 | 核心机制 | 覆盖工具 | 详细文档 |
|---|---|---|---|---|
| 1 | Stream 事件接口 | `CAPABILITY_*` / `USER_INPUT_REQUIRED` / `TOOL_STRUCTURED_DELTA` / `BACKGROUND_TASK_*` | 所有工具 | `process-panel.md`、`pending-input-card.md`、`expand-panel.md` |
| 2 | safeResult 投影接口 | 后端投影 → 前端 parser → 专用 formatter / generic fallback | 有结构化安全投影的 capability；其余走 `safeSummary` | `capability-card.md` |
| 3 | TOOL_STRUCTURED_DELTA payload | `toolEventType` × `toolMessageType` 二维分发 | 任何工具推送结构化内容时 | `process-panel.md`、`expand-panel.md`、`message-bubble.md` |
| 4 | Pending Input 接口 | `USER_INPUT_REQUIRED` + `inputKind` | AskUserQuestion | `pending-input-card.md` |
| 5 | PIU 宿主回调接口 | `piu.emit(method, { callbacks })` | PIU 类型的 TOOL_STRUCTURED_DELTA | `expand-panel.md` |
| 6 | 后台任务 REST API | `GET/POST /api/v1/sessions/:sessionId/background-tasks` | 后台分离执行模式（当前实例：Bash `run_in_background`） | `capability-card.md` |
| 7 | OPERATOR CustomEvent | `document.dispatchEvent(new CustomEvent(key, { detail }))` | 集成方监听并打开外部页签 | `sub-window.md` |
| 8 | 工具定义 UI 字段 | `name` / `disclosurePolicy` / `replayPolicy` → 图标/标题/行为 | 所有工具 | `capability-card.md`、`process-panel.md` |

> 📋 **呈现策略**：工具输出的截断阈值、详情级别、安全脱敏由呈现策略控制，当前为硬编码。`tool-output-presentation-policy.md` 定义了 4 种呈现策略（完整/仅摘要/自适应截断/安全脱敏）和可配置的策略框架，供产品团队按业务场景配置扩充。

---

## 1. Stream 事件接口

工具执行产生的事件流，前端通过 `useChatSessionStream.ts` 消费。来源：`state/contracts.ts` L41-65。

### 事件清单

| 事件类型 | 前端消费位置 | 触发工具 | UI 作用 |
|---|---|---|---|
| `CAPABILITY_STARTED` | ProcessPanel（running 态条目） | **所有工具** | 显示工具开始执行 |
| `CAPABILITY_RESULT_DELTA` | ProcessPanel（增量更新） | **所有工具** | 流式更新工具结果 |
| `CAPABILITY_COMPLETED` | ProcessPanel（终态条目） | **所有工具** | 显示工具执行完成/失败 |
| `USER_INPUT_REQUIRED` | RespondInput（4 种 durable kind；前端接受 7 个 identifier） | pending-input producers（AskUserQuestion 产生 `QUESTION`） | 触发交互式输入面板；workflow 专用呈现仍为 Clarify |
| `TOOL_STRUCTURED_DELTA` | AnswerSegments / ProcessPanel / ExpandPanel | 任何工具（按 toolEventType 分流） | 推送结构化富内容 |
| `BACKGROUND_TASK_STARTED` | `BackgroundTaskHeaderMonitor`（session stream） | 后台分离执行（当前实例：Bash `run_in_background`） | 后台任务启动；更新 header monitor，不生成 ProcessPanel message entry |
| `BACKGROUND_TASK_COMPLETED` | `BackgroundTaskHeaderMonitor`（session stream） | 后台分离执行（当前实例：Bash `run_in_background`） | 后台任务完成 |
| `BACKGROUND_TASK_FAILED` | `BackgroundTaskHeaderMonitor`（session stream） | 后台分离执行（当前实例：Bash `run_in_background`） | 后台任务失败 |
| `DEGRADATION_NOTICE` | 降级提示组件 | 任何工具（降级时） | 工具降级提示 |
| `CONTEXT_COMPACTED` | 压缩通知 | 间接（上下文超限时） | 上下文压缩通知 |

> `[已实现-主干]` `BACKGROUND_TASK_*` 三个事件已进入 22 项 canonical stream projection，并由 `BackgroundTaskHeaderMonitor` 从既有 session SSE/WebSocket envelopes 消费。它们不生成 ProcessPanel message entry；“stream-visible”不等于“作为消息卡片渲染”。REST `listTasks` 只在 session mount 时做一次 seed/recovery 并补充 `commandLine`，不是轮询。

### 消费链路

```
后端 stream → useChatSessionStream.ts
  ├─ CAPABILITY_* → processDetails.ts buildProcessEntries → ProcessPanel
  ├─ USER_INPUT_REQUIRED → userInputStore activateInputRequest → RespondInput
  ├─ TOOL_STRUCTURED_DELTA
  │   ├─ toolEventType=ANSWER → answerContent.ts buildAnswerSegments → AnswerSegments
  │   ├─ toolEventType=TITLE/DETAIL/... → processDetails.ts → ProcessPanel
  │   └─ toolEventType=EXPAND_PANEL → useExpandPanelStreamWatcher → ExpandPanel
  ├─ BACKGROUND_TASK_* → BackgroundTaskHeaderMonitor（stream live update，不进入 ProcessPanel entry）
  ├─ DEGRADATION_NOTICE → 降级提示组件
  └─ CONTEXT_COMPACTED → 压缩通知
```

详细文档：`process-panel.md`（CAPABILITY_* 条目模板）、`pending-input-card.md`（USER_INPUT_REQUIRED）、`expand-panel.md`（EXPAND_PANEL）。

---

## 2. safeResult 投影接口

工具结果可以由后端投影为 `safeResult.kind`，但 `kind` 本身不等于最终视觉模板。当前链路必须分四层理解：后端是否产生结构化投影、前端 parser 是否识别、`processDetails.ts` 是否有专用 formatter，以及不满足前三层时是否退回 `safeSummary` 通用呈现。来源：`stream-envelope.ts`、`clip-result-safe-projection.ts`、`safeCapabilityResult.ts`、`processDetails.ts`。

### 投影入口

```
projectSafeCapabilityResultProjection(source)
  ├─ 已有上游 safeResult → 原样保留（CLIP server 在 agent-core 先生成）
  ├─ 显式 capabilityId / 工具语义投影
  │   ├─ TodoWrite  → todoList
  │   ├─ Cron       → cron
  │   ├─ Workflow   → workflowResult
  │   ├─ ToolSearch → toolSearch
  │   └─ Skill      → skillLoaded
  ├─ 结果形状推断（其他工具）
  │   ├─ 含 exitCode/stdout       → commandOutput
  │   ├─ 含 file_path/content     → fileRead
  │   ├─ 含 filenames             → fileList
  │   ├─ Grep canonical result    → grepResult
  │   ├─ Rag canonical result     → ragRetrieval
  │   ├─ 含 type/file_path        → fileWrite
  │   └─ 均不匹配                 → undefined
  └─ safeSummary / detailText → 前端通用降级输入
```

### kind 的分层消费矩阵

| safeResult.kind | 主要投影来源 | frontend parser | 专用 formatter | 当前可见结果 |
|---|---|---|---|---|
| `todoList` | channel：TodoWrite 显式投影 | ✅ | ✅ | 待办列表 |
| `commandOutput` | channel：命令结果形状投影 | ✅ | ✅ | 退出码 + stdout/stderr 预览 |
| `fileRead` | channel：文件读取结果形状投影 | ✅ | ✅ | 文件路径 + 内容预览 |
| `fileList` | channel：文件列表结果形状投影 | ✅ | ✅ | 文件名列表 |
| `grepResult` | channel：Grep 显式安全投影 | ✅ | ✅ | 文件命中列表或有界位置摘要 |
| `fileWrite` | channel：文件写入结果形状投影 | ✅ | ✅ | 写入/编辑结果 |
| `skillLoaded` | channel：Skill 显式投影 | ✅ | ✅ | Skill 加载结果 |
| `workflowResult` | channel：Workflow 显式投影 | ✅ | ✅ | workflow 状态 + answer previews |
| `ragRetrieval` | channel：Rag 显式安全投影 | ✅ | ✅ | 召回来源与有界内容预览 |
| `pendingInputAnswer` | AskUserQuestion durable answer / conversation adapter | ✅ | 补充信息专用关联路径 | matching QUESTION 的 waiting/final 状态，不作为普通结果 formatter |
| `httpResponse` | frontend history/result adapter 可构建；也可读取同 kind 的上游投影 | ✅ | ❌ | parser 成功后专用 formatter 返回空，继续按 `safeSummary` 通用呈现 |
| `toolSearch` | channel：`projectToolSearchSafeResult` 显式投影 | ✅ | ✅ | 工具名称、类型、Capability ID、描述预览与截断状态 |
| `cron` | channel：Cron 显式投影 | ✅ | ✅ | create/delete/list 对应的本地化结构详情 |
| `clipStreamEvent` / `clipStreamCompletion` / `clipStreamResult` | agent-core：CLIP server 安全投影；channel 保留上游 `safeResult` | ❌ | ❌ | 按投影生成的 `safeSummary` 和安全详情通用呈现 |
| 未产生或未识别 `kind` | 无结构化结果或新增 kind 尚未适配 | ❌ | ❌ | 仅显示有效 `safeSummary`；无有效摘要时只保留标题与状态，不从 raw detail/JSON 生成占位文案 |

> `[已实现-主干]` 前端 `SafeCapabilityResult` union 当前还识别 `toolSearch` 与 `cron`。`httpResponse` 无专用 formatter；`pendingInputAnswer` 走补充信息关联路径；三种 `clipStream*` 尚未进入前端 parser。这里刻意不维护“模板总数”：后端投影、前端 parser 和专用 formatter 是不同集合，新增能力时必须分别核对。

### 前端消费接口

| 接口 | 路径 | 作用 |
|---|---|---|
| `SafeCapabilityResult` 类型 | `safeCapabilityResult.ts` | union 类型，定义前端 parser 可识别的 kind；不代表每个 kind 都有专用 formatter |
| `readSafeCapabilityResult()` | `safeCapabilityResult.ts` | 从 stream payload 解析 `safeResult`，无匹配 kind 返回 null |
| `buildSafeCapabilityResult()` / `build*SafeResult()` | `safeCapabilityResult.ts` | 从历史 capability payload 构建前端结构化结果；包括 `http_request` 的 `httpResponse` |
| `describeSafeCapabilityResult()` | `processDetails.ts` | 按已支持 kind 生成 ProcessPanel 专用摘要；`httpResponse` 当前无分支，`pendingInputAnswer` 由独立 supplemental-input reader 消费 |
| `describeGenericToolResult()` | `processDetails.ts` | 专用 formatter 不可用时优先使用 `safeSummary` / 安全文本，再走通用工具文案 |

详细文档：`capability-card.md`（完整映射表 + 每种 kind 的样例 payload + 期望视觉渲染）。

---

## 3. TOOL_STRUCTURED_DELTA payload 接口

工具通过推送结构化事件呈现富内容。来源：`contracts.ts` L457-458、`processDetails.ts` L987-1041。

### toolEventType（决定消费通道）

| toolEventType | 前端消费通道 | UI 位置 | 典型用途 |
|---|---|---|---|
| `ANSWER` | `AnswerSegments.tsx` L21-36 | 对话气泡内联 | 工具输出结构化答案（PIU/FILE/ACTION 等） |
| `TITLE` | `processDetails.ts` L987 | ProcessPanel 时间线条目 | 工具输出过程标题 |
| `DETAIL` | `processDetails.ts` L1000 | ProcessPanel 条目详情 | 工具输出过程详情 |
| `SUB_TITLE` | `processDetails.ts` L1010 | ProcessPanel 子条目 | 工具输出子结构标题 |
| `SUB_DETAIL` | `processDetails.ts` L1015 | ProcessPanel 子条目详情 | 工具输出子结构详情 |
| `SUB_CONCLUSION` | `processDetails.ts` L1020 | ProcessPanel 子条目结论 | 工具输出子结构结论 |
| `EXPAND_PANEL` | `useExpandPanelStreamWatcher.ts` | 右侧展开面板 | 工具输出 PIU 富内容 |

### toolMessageType（ANSWER 类型下的渲染分发）

| toolMessageType | 渲染组件 | content 结构 | 用途 | 详细文档 |
|---|---|---|---|---|
| `TEXT` | `MarkdownContent` | string | markdown 文本 | `message-bubble.md` |
| `FILE` | `FileCard` | string（当前）/ object（UCD 建议） | 文件卡片 | `file-download.md` |
| `ACTION` | `ActionCard` | action 文本 | 动作卡片 | `message-bubble.md` |
| `OPERATOR` | `OperatorButtons` | `{ text?, type?, align?, operators?: Record<eventName, { text, title?, type?, data: string }> }` | 操作按钮组 / `[UCD目标]` 导航卡片 | `sub-window.md` |
| `DSL` | `DslRenderer` | DSL 内容 | DSL 图表 | `message-bubble.md` |
| `PIU` | `PiuMessage` | `{ piuName, piuVersion, data, method }` | 外部组件宿主 | `expand-panel.md` |

> **PIU 是可扩展类型**——地图、图表、仪表盘等所有富交互组件都是注册一个 `piuName` 的 PIU，不需要新增 ToolMessageType。

### 前端适配点

| 适配场景 | 需改的前端位置 |
|---|---|
| 新增 `toolMessageType` | `AnswerSegments.tsx` L21-36 switch + `contracts.ts` L458 `TOOL_MESSAGE_TYPES` + `VALID_TOOL_MESSAGE_TYPES` 校验 |
| 新增 `toolEventType` | `processDetails.ts` L987-1041 消费逻辑 + `contracts.ts` L457 `TOOL_EVENT_TYPES` |

详细文档：`process-panel.md`（TITLE/DETAIL/SUB_*）、`expand-panel.md`（EXPAND_PANEL + 6 种 ToolMessageType）、`message-bubble.md`（AnswerSegments 分发）。

---

## 4. Pending Input 接口

由 pending-input producers 共用；AskUserQuestion 是 `QUESTION` producer 之一。来源：channel safe projection、`useChatSessionStream.ts` 与 `RespondInput.tsx`。

### 事件 payload 字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `pendingInputId` / `id` | string | pending fact 的安全标识；前端归一为 `inputRequestId` |
| `kind` | 4-kind durable enum | `QUESTION` / `CONFIRMATION` / `AUTHORIZATION` / `HUMAN_HANDOFF`；前端归一为 `inputKind` |
| `timeoutAt` | timestamp | 前端归一为本地 `expiresAt` |
| `status` | string | 安全状态字段 |
| `questions` | array | 每项只含 `prompt`、`options[label,value]`、`multiple?`、`custom?`；前端从首题派生局部 `prompt/options` |

canonical `USER_INPUT_REQUIRED` safe projection 不包含 `producerRef`、`origin`、`riskLevel` 或独立 `inputKind/prompt/options/expiresAt` 字段。前端 contract 里的 7 个 identifier 是 4 个 durable 名称加 3 个 compatibility alias，并非 7 种 backend contract。

### 前端 7 个 accepted identifier 的渲染组件

| inputKind | 渲染组件 | UI 形态 | 行号 |
|---|---|---|---|
| `CLARIFICATION` | `ClarificationInput` | 文本域 + 提交 | L117 |
| `CONFIRMATION` | `ConfirmationInput` | 确认/拒绝按钮 | L207 |
| `APPROVAL` | `ApprovalInput` | 风险等级标签 + 批准/拒绝 | L268 |
| `SELECTION` | `SelectionInput` | 单选 Radio + 提交 | L364 |
| `QUESTION` | `QuestionInput` | 多问题列表，选项 + 自定义输入 | L505 |
| `AUTHORIZATION` | `AuthorizationInput` | 授权提示 + 批准/拒绝 | L435 |
| `HUMAN_HANDOFF` | `HumanHandoffInput` | 模式选择 + 内容文本域 | L850 |

### 前端适配点

| 适配场景 | 需改的前端位置 |
|---|---|
| 消费已冻结的新 presentation/durable kind | 先完成 owning contract/safe projection，再更新 `RespondInput.tsx` 的 exhaustive mapping 与子组件；不得只加 frontend fallback |
| inputKind 状态流 | `userInputStore.ts` `activateInputRequest` / `resolveInputRequest` |

详细文档：`pending-input-card.md`（4 种 durable kind、7 个 frontend identifier、workflow 复用 `QUESTION` 与状态流）。

---

## 5. PIU 宿主回调接口

PIU 组件通过 `piu.emit()` 回调与前端交互。来源：`PiuMessage.tsx` L28-41。

### 当前已实现的回调

| 回调 | 传递方式 | 作用 | 状态 |
|---|---|---|---|
| `handleExpandPanelOpen` | `piu.emit(method, {...})` 参数 | PIU 组件请求打开扩展面板 | ✅ 已实现 |
| `handleExpandPanelClose` | `piu.emit(method, {...})` 参数 | PIU 组件请求关闭扩展面板 | ✅ 已实现 |
| `expandPanelId` | `piu.emit(method, {...})` 参数 | 渲染容器 ID | ✅ 已实现 |

### UCD 建议新增的回调

| 回调 | 传递方式 | 作用 | 状态 |
|---|---|---|---|
| `onPiuSubmit(data)`（暂定名称） | 待定义 | nested PIU→shared composer/request owner 的受控反馈 | ❌ `[UCD目标/Clarify]`；payload、草稿/立即发送、校验与失败恢复未冻结 |

### 其他 PIU 交互接口

| 接口 | 路径 | 作用 | 可用范围 |
|---|---|---|---|
| `sendQuestionToLui` | `registerAIAgentPIU.tsx` L76-85 | PIU 向对话注入问题 | 仅 AIAgent PIU host（协作式宿主） |
| `injectQuestion` | `useChatComposerController.ts` L390-404 | 当前前端私有 composer helper | 内部实现证据；不是可直接提升的 public PIU contract |
| `window.Prel.autoLoad(piuName, piuVersion)` | `PiuMessage.tsx` | 加载 PIU 组件包 | 扩展面板内 PIU |

### 约束

- **PIU 提交不直接修改后端状态**：目标动作必须复用 shared composer/request lifecycle，由 Agent 处理后决定是否执行。
- **owner 不互换**：`sendQuestionToLui` 是 collaborative host→LUI 的既有宿主接口；nested PIU submit 是 LUI 内部 PIU→对话的待澄清动作。两者方向不同，不能直接复用 host-only handler 或把 `injectQuestion` 私有 helper 冻结为新契约。
- **本地不可预览**：若 `window.Prel` 不可用，显示占位符。

详细文档：`expand-panel.md`（PIU 宿主机制 + 交互式 PIU 保存→对话反馈章节）。

---

## 6. 后台任务 REST API 接口

后台分离执行模式（结果不参与上下文的长时任务）专用 REST API。当前实例：Bash 工具（`run_in_background`）。来源：`backgroundTaskService.ts` L10-38。

### REST 端点

| 端点 | 方法 | UI 消费 | 作用 |
|---|---|---|---|
| `/api/v1/sessions/:sessionId/background-tasks` | GET | `⚡` header monitor 在 session mount 时一次性 seed；候选 inline card 可复用同一 session snapshot | 恢复连接前已启动任务并补充 stream event 不携带的 `commandLine`；不是 live polling |
| `/api/v1/sessions/:sessionId/background-tasks/:taskId/output?stream=stdout\|stderr&limitBytes=` | GET | capability-card 追踪区展开时加载 + `⚡` header 监控展开时加载 | 读取 stdout/stderr（限 65536 字节） |
| `/api/v1/sessions/:sessionId/background-tasks/:taskId/kill` | POST | capability-card 追踪区 Kill 按钮 + `⚡` header 监控 Kill 按钮 | 发送 SIGTERM 终止 |

> ¹ `backgroundHandle` 是 UCD 文档使用的概念术语，非 `bashBackgroundOutputSchema` 中的字面字段。实际 schema 字段为 `taskId` + `backgroundReason`。详见 `capability-card.md`。

### 任务数据模型（`BackgroundTaskView`）

来源：`contracts.ts` L465-489。

| 字段 | UI 用途 |
|---|---|
| `taskId` | 任务行 key |
| `commandName` | 任务行标题 |
| `commandLine` | 任务行副标题 |
| `status` | 状态图标 + Tag（RUNNING/COMPLETED/FAILED/KILLED） |
| `exitCode` | 退出码显示 |
| `startedAt` / `finishedAt` | 运行时长计算 |
| `stdoutRef` / `stderrRef` | 输出读取引用 |

### 约束

- **当前仅 Bash 工具支持后台分离执行**：`run_in_background: true` 或前台超时自动转后台。后台分离是通用模式（结果不参与上下文），未来其他长时能力可复用此 API。
- **输出限制 65536 字节**：stdout/stderr 各最多 65536 字节，超出截断显示 `…`。
- **列表同步**：一次性 REST seed + `BACKGROUND_TASK_*` session stream live updates；Kill 后使用 local override，因为 kill 当前不发 stream event。
- **Kill 仅 RUNNING**：只有 RUNNING 状态显示 Kill 按钮。
- **SIGTERM 终止**：Kill 发送 SIGTERM，非 SIGKILL。

详细文档：`capability-card.md`（commandOutput + backgroundHandle 扩展：内联追踪区，含视觉 mockup + 约束 + live/history）、`background-task-monitor.md`（⚡ header 监控：下拉面板 + 状态矩阵 + Kill 交互 + live/history）。

### Cron 管理 REST API（`[已实现-主干]`）

Dashboard 使用 Web channel 的 public REST API，只操作当前 trusted owner 与 active Agent scope 下的 Cron task；前端不得发送 owner/agent/session/run 等可信范围字段：

| 端点 | 方法 | UI 消费 | 作用 |
|---|---|---|---|
| `GET /api/v1/cron-tasks` | GET | Dashboard 任务 Tab | 列出受信 owner + active Agent scope 下的任务页 |
| `POST /api/v1/cron-tasks` | POST | 手动创建 | 创建任务，可选绑定 Skill/Workflow target |
| `PUT /api/v1/cron-tasks/:taskId` | PUT | 修改/启停 | 更新当前 scope 下的任务 |
| `DELETE /api/v1/cron-tasks/:taskId` | DELETE | 更多操作 → 删除 | 删除当前 scope 下的任务 |
| `POST /api/v1/cron-tasks/:taskId/runs` | POST | 执行 | 复用 scheduler/trigger delivery 立即执行一次 |
| `GET /api/v1/cron-tasks/:taskId/runs` | GET | 执行记录 Tab | 返回安全 execution page 与可展开详情 |

管理 API 使用独立 public DTO，不复用 gateway Record 或 Cron Tool session-scoped list 投影。执行详情可显示安全 terminal result 与只读定位字段，但当前不定义结果会话跳转策略。

详细文档：`cron-task.md`（Cron 管理面板章节，含入口/布局/mockup/交互/约束）。

---

## 7. OPERATOR CustomEvent 接口

OPERATOR 类型的 TOOL_STRUCTURED_DELTA 专用。来源：`OperatorButtons.tsx` L57-65。

### 派发机制

```
用户点击操作按钮
  → OperatorButtons.handleClick()
  → document.dispatchEvent(new CustomEvent(key, { detail: data }))
```

### OPERATOR content 结构

根对象与嵌套按钮的当前 shape 不同，event name 是 `operators` map 的 key：

| 层级 | 字段 | 类型 | 说明 |
|---|---|---|---|
| 根对象 | `text?` | string | 按钮组上方说明文字 |
| 根对象 | `type?` | `"BUTTON" \| "LINK"` | 声明整组类型；当前 renderer 不区分，全部按 button 呈现 |
| 根对象 | `align?` | `"left" \| "center" \| "right"` | 按钮组对齐 |
| 根对象 | `operators?` | `Record<string, OperatorButton>` | map key 是点击时派发的 `CustomEvent` event name |
| 嵌套按钮 | `text` | string | 按钮文本 |
| 嵌套按钮 | `title?` | string | 原生按钮 tooltip/title |
| 嵌套按钮 | `type?` | `"primary" \| "default" \| "risk"` | 按钮视觉类型 |
| 嵌套按钮 | `data` | string | 点击时先 `JSON.parse(data)`；解析失败则以 `detail=undefined` 派发，并非 contract 输入 object |

### 约束

- **NextAgent 不消费**：CustomEvent 设计为集成方 hook，NextAgent 前端自身不监听、不管理页签。
- **`type: "LINK"` 未实现**：`OperatorButtons.tsx` 全部按 button 渲染，不区分 LINK 类型。`sub-window.md` 定义导航卡片渲染建议 + 集成方集成契约。
- **安全边界未冻结**：当前 `operators` map key 可受模型产出的结构化内容影响，前端会直接 dispatch；`data` 也只做 JSON parse，没有可信 payload schema。可信 host action catalog/allowlist、scope、payload schema 与必要的用户确认仍由 `harden-action-operator-event-dispatch` Clarify；不能把现有投影路径描述为已完成可信校验。

### ACTION 自动派发差异

`ActionCard` 不是用户点击后派发，而是 effect 自动 dispatch；当前 render 会重新解析出新的 `entries` 对象，live re-render/remount 可能重复触发，history reconstruction/replay 也可能再次 mount 并触发。该路径必须与 OPERATOR 一起进入安全 Clarify：冻结 history 禁派发或 live-only at-most-once/idempotency、可信 action catalog、schema/scope 与副作用确认。未完成前，不得把 ACTION 自动派发作为可安全扩展的宿主接口。

详细文档：`sub-window.md`（导航卡片 + 集成方页面跳转契约）。

---

## 8. 工具定义 UI 字段

工具定义中影响 UI 呈现的字段。来源：`tool-spi.ts` `defineTool()`。

| 字段 | UI 影响 | 消费位置 |
|---|---|---|
| `name`（capabilityId） | ProcessPanel 标题显示 | `processDetails.ts` `displayToolName` L113（如 `Skill`→`SKILL`） |
| `disclosurePolicy: EAGER/LAZY` | EAGER 工具在 system prompt 中对模型可见；影响工具何时被调用 | 后端 tool disclosure 逻辑 |
| `replayPolicy: IDEMPOTENT/NON_IDEMPOTENT` | 影响历史重放行为 | 后端 replay 逻辑 |
| 工具名含 `"skill"` | ProcessPanel 使用闪电图标 | `ProcessPanel.tsx` L36 `resolveProcessIconType` |
| 工具名含 `"agent"` | ProcessPanel 使用闪电图标 | `ProcessPanel.tsx` L36 `resolveProcessIconType` |

### 图标分派逻辑

来源：`ProcessPanel.tsx` L36 `resolveProcessIconType`。

| 条件 | 图标 |
|---|---|
| title 含 `"skill"` 或 `"agent"` | 闪电图标（`skill`） |
| 其他 | `think` / `process-complete` / `final-complete` / `circle` |

详细文档：`capability-card.md`（映射表 + displayToolName）、`process-panel.md`（图标分派 + 条目模板）。

---

## 按工具查看其 UI 接口

| 工具 | 1 事件 | 2 safeResult | 3 STRUCTURED_DELTA | 4 Pending Input | 5 PIU 回调 | 6 后台任务 API | 7 OPERATOR Event | 8 定义字段 |
|---|---|---|---|---|---|---|---|---|
| **Read** | ✅ CAPABILITY_* | ✅ fileRead | — | — | — | — | — | ✅ name |
| **Write** | ✅ CAPABILITY_* | ✅ fileWrite | — | — | — | — | — | ✅ name |
| **Edit** | ✅ CAPABILITY_* | ✅ fileWrite | — | — | — | — | — | ✅ name |
| **Glob** | ✅ CAPABILITY_* | ✅ fileList | — | — | — | — | — | ✅ name |
| **Grep** | ✅ CAPABILITY_* | ✅ `grepResult`；前端识别并专门呈现 | — | — | — | — | — | ✅ name |
| **Bash** | ✅ CAPABILITY_* + BACKGROUND_TASK_* | ✅ commandOutput | — | — | — | ✅ REST API | — | ✅ name |
| **Python** | ✅ CAPABILITY_* | ✅ commandOutput | — | — | — | — | — | ✅ name |
| **Rag** | ✅ CAPABILITY_* | ✅ `ragRetrieval`；`SUMMARY` 仅数量，`DETAIL` 显示来源和有界预览 | — | — | — | — | — | ✅ name |
| **Skill** | ✅ CAPABILITY_* | ✅ skillLoaded | — | — | — | — | — | ✅ name + 闪电图标 |
| **TodoWrite** | ✅ CAPABILITY_* | ✅ todoList | — | — | — | — | — | ✅ name |
| **AskUserQuestion** | ✅ USER_INPUT_REQUIRED | —（走 pending input） | — | ✅ `QUESTION`；前端共用 pending renderer | — | — | — | ✅ name |
| **Agent** | ✅ CAPABILITY_* | generic `safeSummary`（无 `unknown` kind） | — | — | — | — | — | ✅ name + 闪电图标 |
| **ToolSearch** | ✅ CAPABILITY_* | ✅ `toolSearch`；前端识别并专门呈现 | — | — | — | — | — | ✅ name |
| **Workflow** | ✅ CAPABILITY_* | ✅ `workflowResult`；前端识别并专门呈现 | — | — | — | — | — | ✅ name + long-running |
| **Cron** | ✅ CAPABILITY_* | ✅ `cron`；前端识别并专门呈现 create/delete/list | — | — | — | — | — | ✅ name |
| **CLIP server capability** | ✅ CAPABILITY_* | ⚠️ 后端 `clipStreamEvent` / `clipStreamCompletion` / `clipStreamResult`；前端未识别，generic fallback | — | — | — | — | — | ✅ capability descriptor |
| **http_request（历史/上游结果）** | ✅ CAPABILITY_* | ⚠️ 前端可解析/构建 `httpResponse`，但无专用 formatter，generic fallback | — | — | — | — | — | ✅ name |
| **search_memory** | ✅ CAPABILITY_* | generic `safeSummary` | — | — | — | — | — | ✅ name |
| **get_memory_detail** | ✅ CAPABILITY_* | generic `safeSummary` | — | — | — | — | — | ✅ name |
| **add_memory** | ✅ CAPABILITY_* | generic `safeSummary` | — | — | — | — | — | ✅ name |
| **acquire_skill** | ✅ CAPABILITY_* | generic `safeSummary` | — | — | — | — | — | ✅ name |
| **任何工具推送 PIU** | ✅ TOOL_STRUCTURED_DELTA | — | ✅ EXPAND_PANEL + PIU | — | ✅ piu.emit 回调 | — | — | — |
| **任何工具推送 FILE** | ✅ TOOL_STRUCTURED_DELTA | — | ✅ ANSWER + FILE | — | — | — | — | — |
| **任何工具推送 OPERATOR** | ✅ TOOL_STRUCTURED_DELTA | — | ✅ ANSWER + OPERATOR | — | — | — | ✅ CustomEvent | — |
| **任何工具推送 ACTION/DSL/TEXT** | ✅ TOOL_STRUCTURED_DELTA | — | ✅ ANSWER + 对应 type | — | — | — | — | — |

> **解读**：内置工具主要走“事件 + 安全结果投影”两条路径，但不能把所有投影都视为前端结构化模板。ToolSearch、Cron 与 Workflow 已完成 parser 和专用 formatter；CLIP server 的三种 kind 仍由前端 generic fallback 呈现；`httpResponse` 已进入前端 parser，但尚无专用 formatter。PIU/FILE/OPERATOR/ACTION/DSL/TEXT 是**跨工具的内容类型**——任何工具都可以推送 TOOL_STRUCTURED_DELTA 来触发这些 UI 路径。

---

## 新增工具/接口的适配清单

### 新增内置工具

| 步骤 | 修改位置 | 说明 |
|---|---|---|
| 1 | 后端 `builtins/index.ts` | 注册工具定义 |
| 2 | 后端 `stream-envelope.ts` | 若需显式 kind 投影，增加 `capabilityId` 检查 |
| 3 | 前端 `safeCapabilityResult.ts` | 若新增 kind，扩展 `SafeCapabilityResult` 类型 + `readSafeCapabilityResult` |
| 4 | 前端 `processDetails.ts` | 若新增 kind，增加 `describeSafeCapabilityResult` 分支；增加 `displayToolName` 映射 |
| 5 | 前端 `ProcessPanel.tsx` | 若需专属图标，扩展 `resolveProcessIconType` |
| 6 | `capability-card.md` | 更新映射表 |

### 新增 toolMessageType

| 步骤 | 修改位置 | 说明 |
|---|---|---|
| 1 | `contracts.ts` L458 | `TOOL_MESSAGE_TYPES` 增加类型 |
| 2 | `AnswerSegments.tsx` L21-36 | switch 增加分支 + 新建渲染组件 |
| 3 | `VALID_TOOL_MESSAGE_TYPES` | 校验白名单增加类型 |
| 4 | `expand-panel.md` | 更新 6 种 ToolMessageType 表格 |

### 新增 toolEventType

| 步骤 | 修改位置 | 说明 |
|---|---|---|
| 1 | `contracts.ts` L457 | `TOOL_EVENT_TYPES` 增加类型 |
| 2 | `processDetails.ts` L987-1041 | 消费逻辑增加分支 |
| 3 | `process-panel.md` | 更新条目模板 |

### 新增 pending-input presentation/durable kind

| 步骤 | 修改位置 | 说明 |
|---|---|---|
| 1 | OpenSpec + owning public contract | 先确认是 durable kind 还是可信 producerRef-derived presentation；不得从文案猜测 |
| 2 | runtime/channel/frontend | 同步 producer validation、safe projection、exhaustive handling 与 fail-closed fallback |
| 3 | `RespondInput.tsx` + UCD | 新建子组件并更新 durable/frontend 两层词汇说明 |

### 新增 PIU 组件

| 步骤 | 修改位置 | 说明 |
|---|---|---|
| 1 | PIU 组件库 | 注册 `piuName` 到 `window.Prel.autoLoad` |
| 2 | `PiuMessage.tsx` | 若需新回调，扩展 `piu.emit()` 参数 |
| 3 | `expand-panel.md` | 更新 PIU 宿主机制文档 |

---

## 与各组件规范的交叉引用

| 本文档章节 | 对应组件规范 | 查阅目的 |
|---|---|---|
| §1 Stream 事件接口 | `process-panel.md` | CAPABILITY_* 条目模板、图标分派 |
| §1 Stream 事件接口 | `pending-input-card.md` | USER_INPUT_REQUIRED 的 4 种 durable kind、7 个 frontend identifier 与 workflow `QUESTION` 复用 |
| §1 Stream 事件接口 | `expand-panel.md` | EXPAND_PANEL 事件触发 |
| §2 safeResult 投影 | `capability-card.md` | 完整映射表 + kind 样例 + 视觉 mockup |
| §2 safeResult 投影 | `cron-task.md` | Cron 工具 cron kind 投影与前端专门呈现 |
| §3 TOOL_STRUCTURED_DELTA | `process-panel.md` | TITLE/DETAIL/SUB_* 条目 |
| §3 TOOL_STRUCTURED_DELTA | `expand-panel.md` | EXPAND_PANEL + 6 种 ToolMessageType |
| §3 TOOL_STRUCTURED_DELTA | `message-bubble.md` | AnswerSegments 分发 |
| §4 Pending Input | `pending-input-card.md` | durable/frontend 两层词汇、目标专用呈现与状态流 |
| §5 PIU 回调 | `expand-panel.md` | PIU 宿主机制 + onPiuSubmit UCD 建议 |
| §6 后台任务 API | `capability-card.md` | commandOutput + backgroundHandle 扩展（后台任务追踪区） |
| §6 Cron 管理 API（设计建议） | `cron-task.md` | Cron 管理面板章节（入口/布局/mockup/交互/REST） |
| §7 OPERATOR CustomEvent | `sub-window.md` | 导航卡片 + 集成方页面跳转契约 |
| §8 工具定义字段 | `capability-card.md` | displayToolName / 映射表 |
| §8 工具定义字段 | `process-panel.md` | 图标分派逻辑 |
