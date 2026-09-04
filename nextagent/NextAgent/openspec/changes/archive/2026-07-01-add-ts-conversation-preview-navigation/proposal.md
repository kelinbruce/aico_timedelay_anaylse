## 背景与问题（Why）

用户打开较长会话后，需要快速知道自己在该会话中提交过哪些问题，并能点击跳转到对应消息位置。当前 conversation 历史是分段加载的，直接从已加载消息生成 preview 会遗漏早期未加载的用户提交；一次性加载全会话又会带来数据和 DOM 压力。

本 change 只解决“当前已打开会话内的用户提交 mini-map preview 和点击导航”。会话列表搜索由独立 change `add-ts-session-history-search` 承载。

## 变更范围（What Changes）

- 新增当前会话 preview mini-map 接口：

```http
GET /api/v1/sessions/{sessionId}/conversation/preview
```

- preview route 不接收 `q`、日期、cursor、`positionRatio` 或搜索参数；它必须接收显式 `limit`，并可接收显式 `offset`。不传 `offset` 时读取 latest preview window，并在 response 中返回实际 `offset`；传 `offset` 时读取该绝对位置窗口。`limit` 是单次 preview marker 页大小，前端首版固定传 `100`，Web/API 单次最大允许 `500`。
- preview response 包含 `sessionId`、`totalMarkers`、`offset`、`limit` 和 `markers[]`。每个 marker 包含 `messageId`、`requestId?`、`createdAt`、服务端截断后的 `previewText`、`previewTruncated`，并可包含 `answerPreviewText?`、`answerPreviewTruncated?`。
- 服务端不设置当前会话 visible USER marker 总数上限，不再因超过 100 个 marker 返回空列表。`totalMarkers` 只表示当前会话可见 USER marker 总数，用于前端按固定行高绘制完整 preview 轨道；它不是搜索命中数、rank、highlight 或全局消息总数。
- 扩展现有 `GET /api/v1/sessions/{sessionId}/conversation`，新增 `anchorMessageId?` 和 `newerCursor?` 查询语义：
  - 无 anchor/cursor 时仍加载最新可见消息窗口。
  - `cursor` 继续作为 public older-record cursor。
  - `newerCursor` 用于从当前连续窗口向较新消息加载。
  - `anchorMessageId` 返回包含目标消息的连续 anchored 窗口。
  - `cursor`、`newerCursor`、`anchorMessageId` 不得组合。
- `GET /api/v1/sessions/{sessionId}/conversation` 保留既有 `includeCapabilityResults?` 查询语义，默认仍为 `false`；该参数可以与 latest、older、newer 或 anchor 读取一起使用，但不得改变 anchor 校验、scope 校验、窗口连续性或 cursor 语义。
- response 允许 `nextCursor?` 和 `newerCursor?`，禁止后端返回 `windowMode` 或 `anchor`。`recent | anchored` 是前端 conversation store 的 UI state。
- local 和 immersive 会话界面新增 preview rail；collaborative PIU conversation preview rail 不在本 change 内实现。
- preview marker 间距使用组件级固定策略，不随 marker 数量或 rail 高度动态压缩；当 marker 总高度超过 rail 可视高度时，preview rail 保持有界并可内部滚动，具体高度、gap 和滚动条样式属于前端组件常量。前端以 `totalMarkers` 撑开 rail 内容高度，只渲染当前可视阈值范围内的 marker DOM。
- 前端 preview 数据按固定窗口加载：`windowSize=100`、请求 `limit=100`、`preloadThreshold=80`、最多 2 个 in-flight preview 窗口请求；当前窗口由 preview rail 可视区中心 marker index 计算，预加载由可视区边界距离窗口头尾的距离触发。快速滚动只加载最新位置附近窗口，已加载/加载中窗口去重，失败窗口短冷却，不引入请求取消、优先级队列、滚动速度预测、动态窗口大小或 LRU 淘汰。
- 未加载窗口内的 marker 可以作为占位 tick 显示；hover 未加载 marker 不触发请求、不显示 card；点击未加载 marker 时加载对应 preview 窗口，成功后使用该 marker 的 target message 执行既有导航，失败不 toast。
- 用户提交新消息后，preview 只刷新尾部窗口和 `totalMarkers`；模型返回结束后再次刷新尾部窗口以补齐 `answerPreviewText`。刷新不得重置 preview rail 的 `scrollTop`、不得清空当前 hover/card 状态、不得重绘无关历史窗口；如果新 marker 落在当前 preview 可视阈值范围内，应自然加入显示。
- tick marker 和 preview card 点击触发同一目标消息导航：已加载目标本地平滑滚动，未加载目标请求 anchored window、替换当前连续 conversation segment，再平滑滚动到 anchor。
- anchored 状态下 live stream 或新 latest 消息不得直接 append 到当前可见 anchored segment，除非连续性已经由 loaded newer window 证明；前端只更新“有新消息/回到最新”状态，用户回到最新或提交新消息时再切回 recent。

## 非目标（Non-Goals）

- 不做会话列表搜索、跨会话搜索、`conversation/search` 或命中结果列表。
- 不新增 FTS 表、search document 表、sidecar 表、rebuild/index operation 或 public search-index endpoint。
- preview response 不返回 rank、highlight、position ratio、global ordinal、完整 conversation items、tool/Capability result 内容或 hidden content；assistant 内容只允许作为同 request 的 bounded `answerPreviewText?`。`totalMarkers` 仅用于 preview 分页和 rail 高度，不是搜索命中数。
- 不返回 `markersComplete`、`markerLimit`、`windowMode` 或 `anchor` 字段。
- 不实现 collaborative PIU conversation preview rail。

## Capability 影响（Capabilities）

### 新增 Capability

- `session-conversation-preview`：独立承载当前会话 preview mini-map、preview rail、anchored conversation window 和 older/newer cursor 行为契约。

### 修改的 Capability

- `ts-minimal-agent-kernel`：新增当前会话 `GET /api/v1/sessions/{sessionId}/conversation/preview`，并扩展 `GET /api/v1/sessions/{sessionId}/conversation` 的 `anchorMessageId?` 和 `newerCursor?` 查询语义。
- `agent-web-multi-host-modes`：local/immersive 会话界面新增会话内 preview rail；collaborative preview rail 延后到独立讨论。

## 影响范围（Impact）

- `agent-channel-web`
  - 新增 `/conversation/preview` route schema；扩展 `/conversation` anchor/newer query schema 与 response projection。
- `agent-contracts/runtime`
  - 扩展 conversation read/preview contract，保留既有 `beforeCursor` / `nextBeforeCursor` older-record 语义，新增 `anchorMessageId`、`newerCursor` 和 preview marker read model。
- `agent-contracts/session`
  - 扩展当前会话 preview marker 和 anchored conversation query 的领域 read model。
- `agent-contracts/gateway`
  - 扩展 message store query 支持当前会话 preview marker 查询、anchor 周边窗口和双向 cursor。
- `agent-session`
  - 把 conversation preview/anchor 请求映射到 gateway-owned query 并返回领域 read model，不拥有 Web DTO 或 UI state。
- `agent-platform-gateway-local`
  - 直接基于现有 `messages` 源事实执行 preview、recent、older、newer 和 anchor window 查询；不新增表。
- `frontend/agent-web`
  - 在 local/immersive 会话界面增加会话内 preview rail、marker/card hover 与点击导航、anchored state 和“回到最新”行为。

## 验证入口（Validation）

- Web route/schema tests for `/api/v1/sessions/{sessionId}/conversation/preview?limit`、`/conversation/preview?offset&limit` and `/api/v1/sessions/{sessionId}/conversation?anchorMessageId&newerCursor&cursor&limit&includeCapabilityResults`。
- Gateway-local contract tests for current-session preview marker pagination、`totalMarkers`、server-side preview truncation、offset/limit validation、more than 100 markers returned by pages、recent window、older cursor、newer cursor、anchor window around early/middle/latest messages、stale/hidden anchor failure、scope isolation。
- Frontend component/store tests for preview rail bounded layout、fixed marker spacing strategy、internal scroll behavior、windowed marker rendering、initial latest window loading、initial rail viewport bottom alignment、preload threshold、request dedupe/max in-flight、failed-window cooldown、theme-aware hover marker、neighbor visual falloff without layout shift、click loaded tick/card smooth scroll、click unloaded placeholder loads preview window then navigates、tail-window refresh after user submit/model completion、older/newer pagination continuity、return-latest button transient label、new live/latest messages not appended into anchored segment、send-message exits anchored state、only visible USER previews displayed。
- Browser QA for local/immersive preview rail, bounded layout, internal scroll behavior, hover transitions, neighbor visual falloff without layout shift, smooth scroll, long-session preview scrolling, narrow-width preview hiding, tail refresh after new user submit/model completion, and collaborative mode not showing preview rail.
- `openspec validate add-ts-conversation-preview-navigation --strict`。
