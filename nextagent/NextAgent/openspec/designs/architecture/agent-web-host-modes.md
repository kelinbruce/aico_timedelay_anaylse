# Agent Web Host Modes

## 核心结论

`frontend/agent-web` 的长期基线不再是假定“单一独立页面”，而是一个共享聊天业务核心加多个宿主 shell 的前端能力包。正式产品支持两种 host mode，并支持通过外部 `AICOConfig` 对三种宿主做增量 UI 定制：

- 沉浸式页面：由产品页面直接承载完整业务区，顶部菜单由 Prel/宿主拥有。
- 协作式 PIU：通过 `AIAgentPIU.js` 与 `AIAgentPIU.css` 嵌入到宿主页面，在单 active instance 下提供入口、浮层和内部会话导航。PIU 启动名称为 `AICOPIU`（构建产物文件名保持 `AIAgentPIU.js`/`AIAgentPIU.css` 不变）。

本设计不改变后端 API、stream、runtime lifecycle、terminal commit、gateway persistence、owner scope 或 agent scope。后端仍只托管 packaged frontend artifact。

## 分层

前端正式长期分层固定为：

```text
AppProviders
  -> HostModeShell
      -> ChatWorkspace
```

`AppProviders` 拥有 theme、locale、runtime bootstrap 和全局 UI provider。`HostModeShell` 只表达宿主差异：local、immersive、PIU。`ChatWorkspace` 是共享业务核心，统一承载 session/history、stream、composer、request control、attachment 和过程视图。不得为 PIU 复制第二套聊天业务核心，也不得把所有差异堆回单个 `App.tsx` 条件分支。

## Prel / PIU 生命周期

非本地模式统一信任 Prel 注入的 `session`、`user`、`locale` 和 `theme`。`immersive.html` 与协作式测试宿主都加载固定 `/febs/v1/assets/prelude-loader`；本地 dev 入口 `index.html` 不加载 Prel。

沉浸式页面通过 `Prel.start("AFWebsitePIU", version, ["session", "user", "locale", "theme"], ...)` 获取 host context，然后直接渲染 immersive shell；它不调用 `Prel.autoLoad({ AICOPIU })`，也不通过 `loadAIAgent` 事件挂载。沉浸式 PIU 名称 `AFWebsitePIU` 与协作式 `AICOPIU` 独立，避免同环境共存时的 Prel 注册名称冲突。

协作式集成的唯一正式入口是 `AICOPIU`：

- 宿主或测试宿主调用 `Prel.autoLoad({ AICOPIU: version })` 加载 `AIAgentPIU.js` 与同名 CSS。
- `AIAgentPIU.js` 在 `Prel.start("AICOPIU", ...)` 后只注册 `piu.attach(...)` handlers，不自动渲染完整面板。
- 宿主通过 `piu.emit("loadAIAgent", AICOConfig)` 启动入口渲染，其中 `containerId: string` 是协作式入口挂载位置，其他字段用于 UI 定制。

`loadAIAgent` 的正式 payload 是完整 `AICOConfig` 对象，不接受宿主提供的 `mode`。重复调用 `loadAIAgent` 时，新的 AICOConfig 完全替换旧配置，不做 merge；如果 custom PANEL 正在激活，必须先卸载并回到 `CONVERSATION_PANEL`。display state、session navigation 和非 `AICOConfig` 的内部 reducer state 仍属于 PIU 内部状态，不属于宿主 API。

## AICOConfig 边界

`AICOConfig` 是前端 UI 定制契约，只影响外观、布局、PIU 注入点和少量客户端行为开关，不影响后端 API、stream truth、owner scope、agent scope、runtime lifecycle、capability authority 或持久化事实。

注入路径固定为：

- local 与 immersive mode：页面加载时一次性读取 `sessionStorage["AICOConfig"]` JSON 字符串，解析并校验后应用；刷新页面会重新读取，同一页面生命周期不热更新。
- collaborative mode：`loadAIAgent` handler 接收完整 AICOConfig payload，解析并校验后应用；再次 emit 时完整替换旧配置。

三种宿主统一通过同一 loader、validator 和 AICOConfigStore 注入配置，loader 不监听 `storage` event，也不缓存第二份 snapshot。local 与 immersive 缺少配置或解析失败时使用全部默认值。

AICOConfig 使用手写 TypeScript 校验函数在入口边界处理，不引入 TypeBox/Ajv。无效顶层值回退所有默认值并输出一次 `console.warn`；未知字段忽略；空字符串按 absent；`operators` 数组元素逐项过滤并产生 console warning；枚举非法值回退该字段默认。配置缺失或 `{` 必须与当前硬编码默认行为完全一致。AICOConfig 只承载前端外观、行为、布局和 PIU 定制，不承载 Capability 业务名称；历史版本的 `capabilityBusinessNames` 字段已删除，unknown key 按 unknown field 静默忽略。

主要字段包括 `containerId`、`icon`、`entranceIcon`、`guideIcon`、`name`、`welcome`、`modalSize`、`clearStorage`、`declaration`、`showAskTime`、`showThinkingChain`、`operators`、`answerOperator`、`quickInfo`、`inputOperator`、`layoutConfig.operatorPosition`、`layoutConfig.expandPanelPosition` 和 `guideInfo`。`activeIcon` 与 `expandPanelPosition` 是受控预留字段：接受但当前不改变渲染行为。所有 icon 字段只作为 base64 image source 渲染；malformed image 必须回退默认图标并 warning，不执行配置中的代码。Capability 业务名称不再来自 AICOConfig：三宿主过程标题使用当前 Session 的受治理 Provider-backed presentation resources（Plugin Tool、Agent package、Workflow Recipe 的 optional stable 与本地化名称经统一 Capability descriptor 输出），按 current locale、`en-US`、stable `displayName`、id 顺序选择纯文本名称；资源不可用时保留 last-good 或按 id 降级。

## AICO PIU 注入

AICOConfig 的 PIU 注入点统一通过 `PiuRenderer` 执行：生成唯一 DOM `containerId`，调用 `window.Prel.autoLoad(piuName, piuVersion)`，随后 `piu.emit(renderFunc, payload)`。payload 固定包含 `PIUInfoItem.data`、当前 `theme` 和生成的 `containerId`，注入点可追加字段。`window.Prel` 不可用时渲染 fallback placeholder，不得 crash；组件卸载时清空容器 DOM。

注入点语义：

- `operators`：在 sidebar 或 top bar 渲染自定义按钮。`OUTER` 直接显示，`INNER` 放入 more menu；点击 `MODAL` 打开单一 modal，点击另一个 modal 替换当前；点击 `PANEL` 切换到 custom panel。
- `answerOperator`：替换 assistant answer 的默认 BubbleActions。emit payload 追加 `sessionId`、`runId` 和从文本 answer segment 拼接出的 `answer`，排除 PIU、DSL、FILE、ACTION、OPERATOR 等结构化段。
- `quickInfo`：控制输入框上方区域。`SKILL_LIST` 走默认 SkillSelector，`CATEGORY_RECOMMEND` 走默认分类推荐，`SELF_DEFINE` 渲染 PIU。
- `inputOperator`：替换 composer slash-hint 区域，默认 absent 时保留原 slash hint。
- `guideInfo`：控制欢迎页 guide 区域。`HIGH_FREQUENCY_RECOMMEND` 走默认高频问题，`SELF_DEFINE` 渲染 PIU。

## AICO Panel 和 Layout

AICO custom panel 状态只有两类：

```ts
type PanelType = "CONVERSATION_PANEL" | "CUSTOM_PANEL"
```

`PANEL` operator 激活时保存当前 `PIUInfoItem` 并切到 `CUSTOM_PANEL`。emit payload 必须追加 `backFunc`；PIU 调用 `backFunc` 后切回 `CONVERSATION_PANEL` 并卸载 PIU 容器。一次只能有一个 PANEL 激活；切换另一个 PANEL 时先卸载旧容器再加载新容器。

`layoutConfig.operatorPosition` 控制 local/immersive 的外壳布局。`LEFT` 是默认侧边栏布局，自定义 operators 插入 favorites 下方且溢出时垂直滚动；`RIGHT` 移除 sidebar，使用与 collaborative 同形的 top bar，operators 横向滚动。collaborative mode 始终使用 top bar，忽略 `operatorPosition`。`modalSize` 只影响 collaborative docked panel 尺寸，不影响 local/immersive 或 operator modal。

`CUSTOM_PANEL` 在 `LEFT` 布局下只替换 conversation area，sidebar 保留；在 `RIGHT` 和 collaborative 布局下替换 header、message list、input 和 disclaimer，返回路径只有 `backFunc`。

## 共享页面布局与宿主边界

local、immersive 和 collaborative/PIU 在展示会话、定时任务和收藏主内容时复用同一套 Agent Web 页面组件与布局契约。宿主 shell 只选择当前主内容、提供已有导航或扩展容器关闭入口，并为页面提供可用容器；不得在页面外再包装一层 Header、内容宽度容器或纵向滚动容器，也不得因 host mode 建立平行页面业务状态。

普通主内容页面通过 `PageLayout` 组合共享 Header、Content 和可选 docked Footer，并显式选择内容宽度与滚动归属。页面拥有标题之外的业务操作及其响应式呈现策略；共享布局只原样投影操作区域，不对操作分类、重排、隐藏或转换为菜单。会话继续通过 `RightPaneLayout` 复用共享 Header 与内容 frame，但保留 conversation viewport、overlay composer、footer safe area、浮动置底入口和免责声明等会话专用结构。

滚动策略按页面唯一归属：定时任务由普通布局的 Content viewport 滚动，收藏由收藏内容区在展开超高时滚动，会话的 following、用户滚动意图、历史分页和锚点恢复继续由 `useChatViewportController` 决定。共享布局不得根据 footer 高度或物理底部距离推导会话滚动意图，不得给会话增加第二个纵向滚动容器。

收藏页面不提供页内返回操作。local 与 immersive 通过既有主内容导航离开收藏，collaborative/PIU 通过既有扩展容器关闭入口离开收藏；宿主差异不得改变页面 Header、内容宽度或滚动边界，也不得新增收藏专用 URL、弹框或导航 authority。上述前端布局不改变后端 API、stream truth、runtime lifecycle、owner scope、agent scope 或持久化事实。

## Display State 与 Collaborative Layout

协作式 PIU 的显示控制只有一个 reducer-owned 状态源：

```ts
interface AIAgentDisplayState {
  showEntrance: boolean
  showPanel: boolean
}
```

`displayAIAgent(...)`、logo click 和 close button 都必须更新同一状态源。`false,true` 归一化为完全隐藏，close 只关闭 panel，不得强行重新显示 entrance。

panel layout 只允许三种内部状态：

- `docked`
- `floating`
- `maximized`

协作式 panel 必须避让产品顶部菜单 `63.2px` 顶部区域；docked 以容器所在左右半屏推断默认停靠方向；floating/maximized 的几何恢复权由 PIU 内部 reducer 拥有。首版固定为单 active instance：同一容器重复 load 复用 root，不同容器 load 时迁移旧实例。

## 导航与状态恢复

local 与 immersive 继续保留页面级路由语义：`/` 对应 welcome/new session，`/session/:id` 对应已选会话。collaborative mode 不得修改宿主页面 URL；它通过内部 navigation adapter 和 `sessionStorage["nextagent:AICOPIU:activeSessionId"]` 恢复当前标签页中的 active session。失败恢复必须清理该 key 并回到 welcome state。

`sendQuestionToLui` 只通过 composer controller 注入草稿或触发提交，默认 `isSend=false`。不得通过 DOM 查询直接操作 textarea，也不得让宿主绕过共享业务核心提交消息。

## 会话 Stream 与历史边界

ChatWorkspace 的 session bootstrap 固定为 conversation-first：打开、刷新、新 tab、换设备或切换已有会话时，先通过 conversation visible `SessionMessage` 建立历史视图，再根据 bootstrap 结果打开 stream。若 conversation 返回 non-terminal `activeRun`，前端使用显式 `lastSeenSequence=0 + requestId/runId` 做 bounded run recovery；若没有 `activeRun`，前端打开 session-level no-cursor live-tail，不发送 `lastSeenSequence`，不得把省略 cursor 表达成 `0`。

no-cursor live-tail 建立后，ChatWorkspace 必须做一次 opening conversation reconcile，用同会话 conversation refresh 覆盖初始 conversation snapshot 与 live-tail boundary 之间产生的 committed history 或 newly discovered active run，并与已接收的 live envelopes 去重合并。该 reconcile 只属于打开或切换会话 bootstrap，不是普通 terminal 后覆盖 live details 的路径。

同页面断线重连只使用当前页面生命周期内已经接受的 timeline-backed `StreamEnvelope.sequence` 作为 `lastSeenSequence=N`；该 cursor 不写入 sessionStorage、localStorage、URL 或 conversation DTO。submit/retry/edit 返回 accepted coordinates 时，只有在 session stream 未连接、断开、重连中、timeout/gap recovery 中，或 live-tail boundary 尚未可靠建立时，才使用 `lastSeenSequence=0 + requestId/runId` 做 bounded recovery；已 connected 的 no-cursor live-tail 已覆盖连接建立后的新 submit，不得仅因尚未收到 timeline cursor 而再开额外 run-scoped stream。普通 terminal envelope 到达后，UI 从 live stream state 收敛并保留 process details；conversation refresh 保留给 opening/switching、gap recovery、timeout recovery 和手动刷新。

### 页面内 History / Active / Settled 投影

local、immersive 和 collaborative 复用同一套 ChatWorkspace 页面投影。visible `SessionMessage` history 是用户内容、最终 assistant answer、最终 capability result、message order 和 visibility 的 canonical source；`activeLiveBySession` 只保存当前页面仍在执行的 attempt；`settledLiveBySession` 保存当前页面已经接受、但 committed history 不能安全重建的 thinking、capability lifecycle、process timeline、terminal detail 和 live-only structured detail。active/settled 都是 `conversationStore` 拥有的浏览器内存缓存，不是新的 stream truth、history truth 或 persistence owner；刷新页面后最终内容从 visible history 重建，上一页面生命周期的 settled process detail 不承诺恢复。

active 与 settled 按 `sessionId + rootMessageId + attemptId` 分桶。匹配 active attempt 的 terminal 到达时，conversation store 在一次状态提交中纳入 terminal、执行最终无损压缩、写入 settled 并删除 active，使组件不会观察到两层都缺失的中间状态。accepted identity 后到时，optimistic root 的 active/settled bucket 必须在同一 transition 中重键并保留首次展示顺序；重复 terminal 为 no-op，旧 attempt 的迟到事件不得替换较新 attempt。retry、edit、supersede 和 rollback 继续服从 canonical latest-attempt 与 visibility 规则。

投影顺序固定为 history base、settled process overlay、active overlay，最后才计算 `isLatest`。history 尚无 root 时，settled 可以提供当前页面已显示的完整临时 Turn；history 命中后，最终内容和可见性来自 history，settled 只补过程详情，禁止直接拼接两套最终 answer。settled overlay 必须应用到当前窗口中每个匹配 root，后续 Turn 成为 latest 不得移除前一已完成 Turn 的执行详情。canonical `visible=false` 始终抑制同 root 的 active/settled 投影。

anchored history window 只限制当前可见 segment，不阻断合法 stream 接受。窗口外 root 的 active/settled 数据继续按 session 缓存，但 anchored selector 只能给当前窗口已有 root 补 detail，不能把非连续新 Turn 插入 DOM；用户返回连续 recent window 后，缓存 Turn 才参与投影。普通 terminal、session list refresh 和后续提交不得清理 settled；显式 conversation clear、现有 10-session LRU eviction 和页面刷新是通用回收边界。

每个 active bucket 以 500 个 envelope 对象作为无损压缩 watermark，而不是保留上限。accumulated snapshot 只替换同一精确 lane 的旧 snapshot；连续文本 delta 只在相同 root、attempt、语义 lane、capability correlation identity 和 sequence segment 内合并；无法证明等价的 lifecycle、terminal、structured、attachment、background-task、degradation 和 context 事件必须保留，即使压缩后仍超过 500。下一 watermark 从压缩后的保留长度再增加 500，避免超阈值后每帧重复全量压缩。

后台任务 header monitor 不从 conversation history/active/settled envelope 派生。独立 `backgroundTaskStore` 以 session 和 `taskId` 保存页面投影：进入 session 时最多执行一次 list seed，随后只消费 `BACKGROUND_TASK_STARTED`、`BACKGROUND_TASK_COMPLETED` 和 `BACKGROUND_TASK_FAILED`；普通 stream envelope 是 no-op，retry/edit/terminal settlement 不删除仍存在的任务，seed 不得把较新的 live terminal 或本地 `KILLED` 回退为旧状态。

高频 stream 仍使用 animation-frame batching，但 active append 只能处理匹配 attempt bucket 和实际变化的 Turn；不得重扫全部 settled roots、重建 combined mirror，或让后台任务 monitor 扫描 conversation envelope。当前 active Turn 内的超长 Markdown、Mermaid、structured renderer、Process Panel/layout 成本，以及 DOM 虚拟化、历史 Turn 回收和完整过程持久化，不属于该页面投影生命周期边界。

## 会话搜索与 Preview

local 与 immersive 的 Sidebar 搜索入口打开同一个 search dialog；dialog 自己持有查询文本、创建时间范围、分页、加载状态和 latest-request guard，不改写普通 Sidebar 会话列表、收藏/最近视图、展开偏好、URL、localStorage 或 sessionStorage。普通 local/immersive Sidebar 最近窗口仍显示 10 条，普通展开态显示 20 条；search dialog 无搜索条件时显示最近 10 条，搜索态首屏显示 20 条并带同一过滤条件加载更多。

collaborative PIU 继续通过既有 History Popover 和共享 session history store/action path 使用同一 `/api/v1/sessions` 搜索能力；不得新增 PIU 专用搜索 store、query namespace、route、endpoint 或持久化搜索状态，且不得修改宿主 URL 或 layout state。

当前会话 conversation preview rail 只属于 local/immersive conversation surface。它在对话区域左侧提供当前会话 visible USER marker mini-map，通过 `conversation/preview` 分页 marker 和 `conversation?anchorMessageId/newerCursor` 做连续窗口导航；协作式 PIU 不提供 preview rail。preview rail 的具体高度、gap、宽度、动画和滚动条样式是前端组件常量，不进入后端/API contract。

## 构建与交付

正式前端构建是一条产品命令编排出的双 target 输出：

1. 页面 target：从 `immersive.html` 产出正式 `index.html` 和共享页面静态资源。
2. PIU target：产出 `piu/AIAgentPIU.js` 与 `piu/AIAgentPIU.css`。

正式 artifact 必须通过 allowlist/denylist 检查：存在 `index.html` 与 `piu/AIAgentPIU.*`，且不包含源 `immersive.html`、`collaborative.html`、mock prelude 或本地式 dev-only controls。

`dev:watch` 继续只有一个 Vite server，但必须同时暴露 `/`、`/immersive/` 与 `/collaborative/` 三个开发入口。开发态 mock `Prel.autoLoad({ AICOPIU })` 指向源码 PIU entry，不读取正式 `dist/piu` 产物。

## 用户操作权限控制

非本地模式通过 Prel 注入的 `HostSiteContext.user.ops`（`readonly string[]`）承载当前用户的操作权限，支持 `AICOService.View`（只读）和 `AICOService.Write`（读写）两种操作。

权限传播路径为：`AppProviders` -> `AppHostContext` -> `useUserOps()` hook -> `AuthGate`/`AuthWrapper`。

- `useUserOps()`（`frontend/agent-web/src/features/auth/useUserOps.ts`）：复用 `AppHostContext` 读取 `site.user.ops`，封装 local/remote 三值语义。返回 `null`（local 放行）、`[]`（remote 无权限）、`[...]`（remote 有 ops）。不新建独立 Context，与现有 `ChatPage` 和 `SharedConversationPage` 的 ops 读取统一。
- `AuthGate`（`frontend/agent-web/src/features/auth/AuthGate.tsx`）：对可见写操作入口做禁用 + Tooltip 提示。local 模式或权限满足时放行；权限不足时对 Antd Button 通过 `cloneElement` 注入 `disabled={true}`，对非 Button 元素用 `pointerEvents: none` + `opacity` 灰显包裹。
- `AuthWrapper`（`frontend/agent-web/src/features/auth/AuthWrapper.tsx`）：对无视觉表现的隐藏元素（如 file input）做条件渲染，无权限时不渲染。
- `PermissionUnavailable`（`frontend/agent-web/src/features/auth/PermissionUnavailable.tsx`）：全页无权限提示，在 shell 层（`ImmersiveApp`、`AIAgentPiuRuntime`、local `App`）当 `useUserOps()` 返回 `[]` 时渲染，覆盖所有路由。

权限控制是客户端 UI 层增强，不是安全边界。后端 API 已有独立的 auth/owner scope 校验。新增写操作 UI 入口应使用 `AuthGate` 或 `AuthWrapper` 做权限控制（L1 治理约束，通过 code review 落地）。

## Structured Tool Rendering and Expand Panel

Frontend stream handling must register `TOOL_STRUCTURED_DELTA` as a batchable event and keep it ordered with `LLM_CONTENT_DELTA` by stream sequence. Process panel rendering consumes `TITLE`、`DETAIL`、`SUB_TITLE`、`SUB_DETAIL` and `SUB_CONCLUSION`; `ANSWER` contributes to the answer content area. When a tool call has structured delta events, CAPABILITY started/completed process entries for the same `toolCallId` are suppressed so CLIP structured events control the visible process narrative.

Structured answer rendering dispatches `TEXT`、`FILE`、`ACTION`、`OPERATOR`、`DSL` and `PIU` message types to dedicated components. ACTION/OPERATOR content must parse bounded JSON strings and dispatch browser custom events only from declared keys; DSL uses the host package in production and a local stub in dev; PIU uses `PiuContext` plus `window.Prel.autoLoad(...)` and safe fallback placeholders when unavailable.

The expand panel is a frontend-only rendering surface. It provides a fixed container id inside a relative panel root, with an absolute close button above externally rendered content. `PiuMessage` injects `handleExpandPanelOpen`、`handleExpandPanelClose` and `expandPanelId` into the emitted PIU payload; external PIU content renders into that container. This does not change backend API, stream truth, owner scope, agent scope or runtime lifecycle.

Expand panel content ownership is tracked by `ExpandPanelState.contentSource`（`'react'` 结构化内容 / `'view'` 视图页 / `'dsl'` DSL 引擎接管 / `null` 关闭）。`ExpandPanelStore.registerDslClearHandler(handler)` 注册无参回调：当 `contentSource === 'dsl'` 时发生 `close()`、`setContent()` 或 `setView()`（外部关闭或来源切换）即调用回调，宿主（`ImmersiveApp` 与 `AIAgentPiuRuntime` 经 `PiuContext` 取 `piu`）以 `smart-canvas:clearExpandPanel` 事件通知 DSL 引擎清理；DSL 引擎正常关闭走 `closeDsl()`，不触发回调。ExpandPanel 容器 div 以 `contentSource` 作为 React key，来源切换时重新挂载容器并自动清空 DSL 注入的 DOM；DSL 打开时隐藏 header。与 TurnRunGraphPanel 的互斥逻辑保持不变，DSL 来源被 graph 关闭时同样触发清理回调。
## 与后端托管边界

`agent-app` 和 `agent-app-frontend-hosting` 继续只消费前端 artifact 与 hosting manifest。后端不 import `frontend/agent-web` 源码，不提供 mock prelude，不解释 PIU handler 语义，也不为 host mode 做 runtime route 分支。API 同源、auth challenge 跳转、owner scope 与 agent scope 的可信来源保持既有后端基线不变。
