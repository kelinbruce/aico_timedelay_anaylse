# 前端用户工作流

本文按用户可观察流程说明 `agent-web` 当前如何工作，不重新定义 API、stream 或 runtime contract。

状态标记：

- **Stable**：已有 `openspec/specs/` 稳定规格。
- **Active change**：当前实现已存在或正在推进，但长期行为仍由未归档 change 承载。
- **Implementation-only**：当前代码可观察到该行为，但没有完整稳定规格。
- **Known divergence（已知偏差）**：当前代码实现与 Stable Spec 或 Active change 不一致；本文同时记录两者，不将实现现状提升为稳定契约。

同一工作流可能同时包含稳定契约和实现细节，不能用局部实现替代 OpenSpec。

## 1. 新建和打开会话

### 新建会话

1. 用户点击“新建会话”，页面回到未选择会话的欢迎状态。
2. 用户输入问题并可选择 Skill；如果先添加合法附件，前端会先创建并切换到 session，附件仍保留在当前 composer 中，随之后的 request 一起提交。
3. 如果尚未创建 session，首次合法普通提交时前端先成功创建并激活 session，再把当前输入作为该 session 的首个 request 提交；创建失败时不提交 request，并保留 Composer 输入供重试。

合法附件在根路由先创建并绑定 session、再进入本地附件队列的顺序，以及首次合法普通提交才建立持久化 session 的顺序，均已进入 **Stable** 基线。不要理解成点击“新建会话”就已经保存了一个空会话；已有 active session 的普通提交也不会为该输入重复建立会话。

### 打开已有会话

1. 用户从历史列表或搜索结果选择会话。
2. Local / Immersive 导航到 `/#/session/:sessionId`；Collaborative PIU 通过内部导航切换，不修改宿主 URL。
3. 页面先加载已持久化 conversation snapshot，再建立 live stream。
4. 如果 snapshot 包含非终态 `activeRun`，页面继续恢复该运行中的 request。

会话打开、conversation-first bootstrap 与 active-run recovery 属于 **Stable** 主流程。

### 会话标题

- **Stable — 自动标题**：ordinary submit 已持久化并发出 `REQUEST_ACCEPTED` 后，runtime 会从该次输入异步尝试生成标题；该尝试不等待 request terminal，也不阻塞调度、stream 或 terminal commit。Retry 和 Edit 不触发这条路径。
- **Stable — 手工标题**：会话 owner 对输入 trim 后接受 1–100 字符的安全标题，空字符串或仅空白输入会被拒绝；成功更新后 `titleSource` 为 `manual`，后续自动标题不得覆盖。

## 2. 搜索、预览和管理历史会话

- **Stable — 搜索能力**：Local、Immersive 和 Collaborative / PIU 共享会话搜索能力。搜索支持关键词、活动时间范围和加载更多；日期参数名为 `createdFrom` / `createdTo`，实际按会话最后活动时间过滤。
- **Implementation-only — Local / Immersive LEFT 入口**：从 Sidebar 打开搜索对话框。
- **Stable layout / Implementation-only entry — Immersive RIGHT**：AICO `operatorPosition: RIGHT` 使用顶部工具栏替代 Sidebar 的布局由 `aico-layout-mode` 与 `aico-config-contract` 稳定承载；当前从该顶部工具栏打开搜索对话框的具体入口仍按实现记录。
- **Implementation-only — Collaborative / PIU 入口**：从 History Popover 使用搜索控件。
- **Stable — 预览**：Local / Immersive 在空间足够时显示当前会话的 preview rail。用户可以查看问题/回答摘要并定位到相应 turn；Collaborative 不在该稳定能力的承诺范围内。
- **Stable — 删除**：用户确认后删除会话。运行中的会话不能直接删除，删除也不是“自动取消当前 request”。
- **Stable — 派生**：用户可以从已经持久化且可见的 assistant 回复派生独立子会话，之后的对话不写回来源会话。
- **Stable — 重命名能力**：会话历史和搜索结果支持重命名，并受 Write 权限控制。
- **Implementation-only — 重命名入口布局**：当前 Sidebar 和搜索结果中的菜单、弹窗及具体位置由前端实现负责。
- **Stable — 收藏列表数据**：收藏列表按 turn 返回问题摘要、`rootMessageId` 等定位坐标，由 `conversation-annotation` 承载。
- **Implementation-only — 收藏定位交互**：当前点击收藏项会打开会话并尝试定位目标消息；Stable Spec 只要求与历史会话点击相同的还原效果，尚未明确精确滚动到目标 turn 的 UI 契约。

### 加载连续会话窗口

- **Stable — 最新窗口**：直接打开会话时默认读取最新的可见消息窗口；继续加载更早消息时，旧页追加到当前窗口前方。
- **Stable — 锚点窗口**：从尚未加载的 preview marker 定位消息时，前端用包含目标消息的连续窗口替换当前窗口。该状态可以向前加载更早消息，也可以通过 `newerCursor` 向后加载更新消息；合并后仍按 `createdAt`、`messageId` 升序展示，且页面只保留一个连续消息片段。
- **Stable — 与最新消息保持连续**：锚点窗口之外的新消息或 live stream delta 不会直接拼到当前片段。只有通过 `newerCursor` 补齐连续内容，或用户返回最新位置、提交新问题后退出锚点状态，最新内容才进入当前视图。
- **Known divergence — 锚点状态提交**：当前实现从锚点窗口提交新问题后仍保留 `anchored` 状态和原 `activeAnchorMessageId`，新提交也不会立即进入当前锚点片段；这与 Stable Spec 要求提交后切换到 `recent` 并显示最新片段不一致。本节只记录偏差，不把当前实现提升为稳定行为。

这里描述的是通用 conversation 连续窗口。收藏列表的 turn 粒度数据已进入 Stable；点击后的精确 turn 定位和宿主入口布局仍按当前实现处理，不在本节固化为稳定交互。

不要把 fork 描述成“任意消息都可以派生”。流式中、未持久化、没有有效 assistant 回复或没有写权限时，入口可能不可用。

## 3. 提交问题与控制当前请求

主流程如下：

```text
输入问题
→ 可选 Skill 和附件
→ 提交
→ 查看流式回答与执行过程
→ 根据当前状态停止、重试或编辑重提
```

### 提交和停止

- **Stable**：提交成功后，前端按 accepted coordinates 关联 request/run，并通过 SSE 或 WebSocket 接收 stream。
- **Stable**：执行中的最新 request 提供停止入口。停止针对当前 owning/latest request，不删除已经持久化的历史内容。
- **Stable**：输入区支持连续两次 `Esc` 停止；第一次进入待确认状态，第二次才触发停止。

### 输入键盘操作

- **Stable**：普通问题输入时，`Enter` 触发提交，`Shift+Enter` 保留换行；IME composition 中的 `Enter` 不提交。
- **Stable**：输入框为空且未处于编辑重提时，`ArrowUp` 从当前已加载会话窗口中最近一次已提交问题开始回看；继续使用 `ArrowUp` / `ArrowDown` 可在当前已加载的已提交问题间移动，并最终回到进入历史浏览前的草稿。已回填的问题一旦被编辑，就按普通草稿处理，不再继续替换为更早历史。

### 重试和编辑

- **Stable — Retry**：对可重试的最新 request 使用原问题发起新的 attempt。
- **Stable — Edit**：当前 UI 只允许编辑最新问题。进入编辑时原问题回填到输入框；确认后执行 text-only JSON edit-resubmit，取消编辑会恢复此前草稿。当前 browser/Web edit 不支持附件：非空附件队列会在请求发出前阻止编辑重提并保留现场；internal runtime command 仍会对直接携带的 attachment ids 做权威校验。
- Retry 和 Edit 都不是修改任意历史 turn；被替代 run 的可见性和标注清理由后端 contract 决定。

### Slash command

- **Stable**：命令目录为 `/help`、`/retry` 和 `/edit`；未知的 `/...` 不作为普通问题提交。

### Composer 草稿

- **Stable**：普通输入草稿按 session 隔离，并在当前浏览器标签页内恢复。
- **Stable**：根路由独立草稿、切换隔离、存储不可用时继续编辑，以及成功提交清除/失败提交保留；edit 和 Pending Input 不得覆盖普通草稿。
- **Implementation-only**：当前使用 `sessionStorage`，存储 key 为 `draft-${sessionId}`；这不是跨标签页、跨浏览器或跨设备的持久化能力。

## 4. 使用 Skill、附件和问题推荐

### Skill

- **Stable**：用户可以从快捷 Skill 区或全部 Skill 弹窗选择一个 Skill。当前只保持一个选中项；新选择会替换旧选择，关闭 chip 会取消选择，选中项随 request 提交。
- **Implementation-only**：成功提交后，当前实现继续保留已选 Skill，直到用户主动移除或替换。

### 附件

**Stable** 的首版附件边界是：

- 只支持 `.md` 和 `.markdown`。
- 每个 request 最多 3 个附件。
- 单个附件最大 5 MiB。
- 不支持的类型、数量或大小超限必须拒绝；任一附件不合法时，整个 request intake fail closed，不会静默丢弃该文件后继续提交。

- **Stable**：当前通过文件选择器或拖放进入同一本地队列，整批执行数量、类型、大小和重复校验，显示提交前状态，并按 submit/edit 成败与 route 切换清理或保留。该浏览器侧行为归 `agent-web-attachment-composer`；服务端 intake 仍由既有 attachment specs 拥有。

Word、Excel、PDF 不在当前支持范围内。

### 问题入口

当前三个问题入口的点击效果不同：

- **Stable** — 欢迎页高频问题：点击只回填并聚焦普通 Composer，不创建 session、不自动发送。
- **Stable** — 分类问题和输入联想：填入输入框，由用户确认发送。
- **Stable** — 成功完成后的 Suggested Questions：点击后直接发起新 request。

### 添加到常问

- **Stable**：有 Write 权限的用户可在用户问题的操作区点击“添加到常问”；assistant 消息不显示该入口。
- **Stable**：点击后调用 `POST /api/v1/user-questions/pin`。成功时提示“已添加至常用问题”，失败时显示操作失败；重复添加同一问题由后端幂等处理，前端仍显示成功提示。
- **Stable**：超过 2000 字符的问题先提示截断，再把 trim 后截断至 2000 字符的文本提交。该入口没有取消添加操作，图标也不表示已添加/未添加状态。

失败、取消、历史加载或推荐服务降级时，不保证显示回答后推荐问题。AICO 自定义欢迎区和快捷区已由 `aico-config-contract`、`aico-display-control` 与 `aico-piu-injection` 纳入 **Stable**；具体未被这些规格定义的视觉细节仍按当前实现处理。

## 5. 响应 Pending Input

执行过程中，普通输入框可能被等待用户响应的面板替换。Pending Input lifecycle、canonical kind、响应面板与普通 Composer 的互斥切换，以及成功回答或 canonical resolved outcome 后恢复 Composer 均为 **Stable**。canonical kind 包括：

- `QUESTION`：文本、单选、多选或允许自定义答案的问题。
- `CONFIRMATION`：对当前操作明确确认或拒绝。
- `AUTHORIZATION`：展示授权提示，并允许对当前受保护操作授权或拒绝；canonical Authorization 控件当前不显示 `riskLevel`。
- `HUMAN_HANDOFF`：由人工给出最终答案或继续执行指令。

有投影过期坐标时，页面显示随本地时间变化的剩余/过期状态；本地显示到期只改变展示，不会自动回答、授权、发起取消或恢复普通 Composer，UI 仍等待 canonical resolved outcome。提交合法响应后，原 request/run 继续执行；canonical `QUESTION` 和 `HUMAN_HANDOFF` 当前提供的取消入口委托其 owning request，cancel request 成功本身不会伪造 `USER_INPUT_CANCELED` 或提前清除面板。

Pending Input 生命周期、上述 canonical kind、Composer 切换/恢复、展示型过期状态和 owning-request 取消委托是 **Stable**；`RespondInput` 的具体视觉布局、倒计时格式/刷新频率和兼容 kind 是 **Implementation-only**。前端还兼容 `CLARIFICATION`、`APPROVAL`、`SELECTION` 等旧或扩展 vocabulary，但本文不把它们定义为稳定 `PendingInputKind`，也不由本说明规定其他 kind 是否提供取消入口。

## 6. 点赞、收藏、分享和派生会话

### 标注与收藏

- **Stable**：有有效回答的终态 run 可以点赞、点踩、取消 sentiment 或收藏；刷新会话后从持久化标注恢复状态。
- **Stable**：点赞/点踩和收藏是同一 run 标注上的独立字段，可以共存。
- **Stable**：收藏列表按 turn 返回问题摘要和目标坐标；该粒度由 `conversation-annotation` 承载。
- **Implementation-only**：当前点击列表项后会尝试定位到目标消息；精确滚动和聚焦语义尚未进入 Stable Spec。

### 分享

**Stable** 的分享流程是：

1. 用户进入分享选择模式。
2. 选择一个或多个包含有效回答的 run；失败或没有回答内容的 turn 不可选。
3. 选择 24 小时、7 天、30 天或永久有效期并生成链接。
4. 访问生成的 share URL 打开只读分享页。

**Current implementation**：前端传入创建分享时的完整页面 URL，后端移除原 hash 后，在同一 origin 和 pathname 后追加 `#/shared/:shareId`。根路径页面可能生成 `/#/shared/:shareId`，子路径页面则可能生成 `/AFWebsite/immersive.html#/shared/:shareId`。

**Known divergence**：Stable Spec 仍要求前端传入 `window.location.origin`，并将分享地址描述为 `{originUrl}/#/shared/{shareId}`；这与当前实现保留 pathname 的规则不一致。

Remote 模式可根据宿主权限附加允许访问的 ops。分享页没有 Sidebar、composer、标注或 live stream，不是第二套可写聊天页面；复制可见回答仍可使用。

### 派生会话

**Stable**：从持久化 assistant 回复 fork 后进入新的 child session。刚进入 child session 时显示来源提示；child 首次提交新消息后，该提示不再显示。后续 request 写入子会话，不改变原会话历史。

## 7. 阅读回答、执行过程和扩展内容

- **Stable**：每个 turn 可显示回答以及 `ProcessPanel` 过程摘要；历史结果来自 conversation snapshot，当前执行细节来自 live stream。
- **Stable**：状态为 `COMPLETED` 的普通 assistant 正文采用 Markdown 语义展示，并支持已验证的 GFM 风格表格、行内代码和普通代码围栏。
- **Stable**：完整 standalone triple-backtick Mermaid fence 检测、lazy render、stale result 隔离、通用失败降级和 viewport 通知由 `agent-web-mermaid-rendering` 承载。
- **Implementation-only / Known divergence**：Mermaid 完整 sanitization、危险 URI/CSS 清理、容量限制、raw error 日志安全和精确视觉细节仍未形成完整契约；当前有限 cleanup 不能被解释为安全保证。
- **Stable**：“完整过程”打开 Turn Run Graph，展示活动摘要、按 canonical 顺序构造的过程图和节点详情，并提供窄屏、键盘与文本等价形态。
- **Stable**：TEXT、FILE、ACTION、OPERATOR、DSL、PIU 等结构化工具结果由 `tool-structured-delta` 与 `agent-web-structured-message-rendering` 承载。
- **Stable**：某些结构化工具结果可打开独立扩展详情区域，由 `agent-web-expand-panel` 承载。

扩展详情区域的位置、尺寸、互斥、历史恢复和宿主差异以其 Stable Spec 为准，本文不重复这些布局规则。

## 8. 查看和控制后台任务

后台任务控制是 **Stable**，但只适用于 local deployment：

- 当前 session 存在后台任务时，页面头部显示入口；没有任务时不显示。
- Badge 显示运行中的任务数量。
- 展开后可以查看运行中和终态任务的状态、耗时与 exit code。
- 展开单个任务可以读取 stdout / stderr；输出可能被截断。
- 只有 `RUNNING` 任务显示终止操作，并要求二次确认。
- Remote deployment 不开放后台任务控制端点。

当前没有 active session 时，前端不轮询且不显示任务入口；这是 **Implementation-only** 的页面行为。

本文不承诺展示 raw command line；安全投影和可见字段以稳定 API 规格为准。

## 9. 刷新、断线恢复、权限和异常提示

### 刷新和 stream 恢复

**Stable** 的用户可观察流程是：

1. 打开或刷新会话时先加载已持久化 conversation。
2. 若存在 active run，再以 run coordinates 恢复当前执行内容。
3. 同一页面断线重连使用内存中的最后已展示 sequence，不把 cursor 持久化到 URL 或浏览器存储。
4. 检测到 resume gap，或收到明确要求刷新 conversation 的 degradation notice 时，页面先刷新 conversation，再继续恢复。
5. 重连、重新同步、降级或恢复失败时，页面显示状态提示，不能静默伪装成已同步。

这不承诺保留所有浏览器瞬时状态；稳定保证是从持久化历史和可恢复 stream 边界重新建立视图。

### 权限

**Stable**：

- Local 模式按本地认证和权限语义工作。
- 非本地模式缺少 Write 时，已有内容仍可查看，但发送、附件、新建、重命名、删除、重试、编辑和标注等写操作被禁用，并给出权限提示。
- 非本地模式同时缺少 View 和 Write 时，显示不可用页面。
- 前端禁用只是用户体验增强；后端 auth、owner scope 和 agent scope 校验才是安全边界。

**Known divergence — Immersive RIGHT**：当前 RIGHT 布局顶部的新建会话按钮没有经过与 Sidebar 相同的 `AuthGate`，搜索弹窗也固定按具有 Write 权限渲染。因此 Stable 权限要求尚未在该 Active layout 中完整落实；本文记录这一差异，不将其描述为当前已实现行为。

### 失败、取消和降级

- request 失败或用户取消时，对应 turn 显示终态提示。
- upload、submit、edit、retry、cancel 错误显示在输入区附近。
- `DEGRADATION_NOTICE` 可能触发 conversation refresh 和重新同步提示。

## 相关稳定规格

稳定规格：

- [会话搜索](../../openspec/specs/session-history-search/spec.md)
- [会话预览](../../openspec/specs/session-conversation-preview/spec.md)
- [会话删除](../../openspec/specs/session-delete/spec.md)
- [从消息派生会话](../../openspec/specs/session-fork-from-message/spec.md)
- [附件接入](../../openspec/specs/ts-attachment-intake/spec.md)
- [Pending Input 生命周期](../../openspec/specs/human-pending-input-core/spec.md)
- [Pending Input 前端响应面](../../openspec/specs/agent-web-pending-input-ui/spec.md)
- [普通 assistant Markdown 渲染](../../openspec/specs/agent-web-assistant-markdown-rendering/spec.md)
- [Composer 交互](../../openspec/specs/agent-web-composer-interaction/spec.md)
- [浏览器附件队列](../../openspec/specs/agent-web-attachment-composer/spec.md)
- [Mermaid 渲染](../../openspec/specs/agent-web-mermaid-rendering/spec.md)
- [Turn Run Graph](../../openspec/specs/agent-web-turn-run-graph/spec.md)
- [会话标题自动生成](../../openspec/specs/session-title-generation/spec.md)
- [会话标题手工更新](../../openspec/specs/session-title-update/spec.md)
- [最新问题编辑重提](../../openspec/specs/request-edit-resubmit/spec.md)
- [对话标注](../../openspec/specs/conversation-annotation/spec.md)
- [对话分享](../../openspec/specs/conversation-share/spec.md)
- [后台任务控制](../../openspec/specs/agent-web-background-task-control/spec.md)
- [前端权限控制](../../openspec/specs/agent-web-auth-control/spec.md)
- [高频问题 UI](../../openspec/specs/high-frequency-question-ui/spec.md)
- [高频问题与 Pin API](../../openspec/specs/frequent-question-api/spec.md)
- [用户问题活动](../../openspec/specs/user-question-activity/spec.md)
- [Stream 历史一致性](../../openspec/specs/ts-stream-history-consistency/spec.md)
- [Stream 续传与重放](../../openspec/specs/ts-stream-resume-replay/spec.md)
- [AICOConfig contract](../../openspec/specs/aico-config-contract/spec.md)
- [AICO 布局模式](../../openspec/specs/aico-layout-mode/spec.md)
- [AICO PIU 注入](../../openspec/specs/aico-piu-injection/spec.md)
- [工具结构化增量](../../openspec/specs/tool-structured-delta/spec.md)
- [结构化消息渲染](../../openspec/specs/agent-web-structured-message-rendering/spec.md)
- [扩展详情区域](../../openspec/specs/agent-web-expand-panel/spec.md)
