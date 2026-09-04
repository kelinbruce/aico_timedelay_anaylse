## 背景和现状（Context）

当前 conversation 历史读取链路以最新窗口和 older cursor 为主。前端 conversation store 可以加载最新窗口、向上加载更早消息并保持一个连续历史段；它还没有“跳到某个历史用户提交附近”的 anchored window 状态。

当前会话 preview 的目标不是搜索，而是给已打开会话提供一个用户提交 mini-map。长会话下 preview 不能再因超过 100 个 marker 直接消失；它需要通过分页 marker 数据和前端窗口化渲染维持完整导航感，同时避免一次性加载全量数据或创建全量 DOM。

## 目标和非目标（Goals / Non-Goals）

目标：
- 为当前会话提供由 visible USER message 生成的分页 preview marker 列表，并在同 request 存在 visible ASSISTANT 正文时附带 bounded answer preview。
- 返回 `totalMarkers`、`offset`、`limit` 和当前页 `markers[]`，支持无业务总量上限的 preview rail。
- 前端按固定窗口加载和渲染 preview marker，避免一次性请求全量 marker 或渲染全量 marker DOM。
- 支持 tick marker 和 preview card 点击导航。
- 支持未加载目标消息的 anchored continuous conversation window。
- 前端维护 `recent | anchored` state，后端不返回 UI state。
- 不新增任何搜索表或 sidecar 表。

非目标：
- 不做会话列表搜索或 conversation keyword search。
- 不做 tool/Capability result 内容 preview；普通 conversation read 继续保留既有 `includeCapabilityResults?` 查询语义。
- 不实现 collaborative PIU conversation preview rail。
- 不提供 position ratio、global ordinal、搜索命中数或全量 conversation items。

## 设计决策（Decisions）

### D1：preview response 使用 offset/limit 分页和 totalMarkers

preview API：

```http
GET /api/v1/sessions/{sessionId}/conversation/preview?limit=100
GET /api/v1/sessions/{sessionId}/conversation/preview?offset=200&limit=100
```

response：

```ts
interface ConversationPreviewResponse {
  readonly sessionId: string;
  readonly totalMarkers: number;
  readonly offset: number;
  readonly limit: number;
  readonly markers: readonly ConversationPreviewMarker[];
}

interface ConversationPreviewMarker {
  readonly messageId: string;
  readonly requestId?: string;
  readonly createdAt: number;
  readonly previewText: string;
  readonly previewTruncated: boolean;
  readonly answerPreviewText?: string;
  readonly answerPreviewTruncated?: boolean;
}
```

`limit` 是必填查询参数，`offset` 是可选查询参数。Web/API 校验规则：
- 未传 `offset` 时读取 latest preview window；传 `offset` 时读取该绝对位置窗口。
- `offset >= 0`。
- `limit > 0`。
- 单次 `limit <= 500`。
- 首版前端固定使用 `limit=100`，该值是前端窗口大小，不是后端业务上限。

服务端按 same owner scope、same Agent scope、same session、`role=USER`、`visible=true` 的消息生成 marker，按 `createdAt ASC, messageId ASC` 稳定排序。`totalMarkers` 是同一过滤条件下的 visible USER marker 总数。传入 `offset` 时，`markers` 返回 `[offset, offset + limit)` 页内 marker；末页 `markers.length` 可以小于 `limit`，`offset` 超过总数时返回空 `markers[]`。未传 `offset` 时，服务端使用 `effectiveOffset = max(0, totalMarkers - limit)` 返回 latest preview window。response 的 `offset` 始终是实际读取的 `effectiveOffset`。服务端不设置 `totalMarkers` 上限，也不再因为超过 100 个 marker 返回空列表。

`totalMarkers` 只服务于当前会话 preview 分页和前端 rail 内容高度。它不是搜索命中数、rank、highlight 或全局 conversation message count；response 仍不返回 `markersComplete`、`markerLimit`、`positionRatio`、`globalOrdinal`、`windowMode` 或 `anchor`。

前端加载策略固定：
- `windowSize=100`，请求 `limit=100`。
- `preloadThreshold=80`。
- 当前窗口由 preview rail 可视区中心 marker index 计算；预加载前/后一窗由可视区边界距离当前窗口头/尾是否小于等于 80 触发。
- 初始 recent 会话加载 latest preview window，不传 `offset`；rail 首次渲染时可视区对齐到底部，使不滚动时最下面的 marker 是最新用户提交。后续 preview rail 滚动和预加载使用显式 `offset`。
- 只渲染当前 preview 可视区上下阈值范围内的 marker DOM，总内容高度由 `totalMarkers * markerRowHeight` 撑开。
- 未加载 marker 可以渲染为普通占位 tick；hover 未加载 marker 不请求、不显示 card；点击未加载 marker 时加载对应 preview 窗口，成功后再使用该 marker 的 `messageId` 执行既有导航。
- 使用 `loadedWindows`/`loadingWindows` 去重，同一时刻最多 2 个 preview window 请求；失败窗口短冷却，避免快速滚动或异常返回导致重复请求。
- 快速滚动只加载最新位置附近窗口，不补加载滚动途中经过但未停留的窗口。
- 不做请求取消、优先级队列、滚动速度预测、动态窗口大小、批量窗口接口或 LRU 缓存淘汰。

新提交处理固定：
- 用户消息提交成功后刷新尾部窗口和 `totalMarkers`。
- 模型返回结束后再次刷新尾部窗口，补齐最新 marker 的 `answerPreviewText`。
- 刷新尾部窗口时按 global index 合并/替换该窗口数据，其他已加载窗口不清空。
- 不主动修改 preview rail `scrollTop`，不清空当前 hover/card 状态，不重绘无关历史窗口。
- 如果新增 marker 落在当前 preview 可视阈值范围内，应自然加入显示。

### D2：conversation anchor 使用连续窗口和双向 cursor

扩展现有 conversation read：

```http
GET /api/v1/sessions/{sessionId}/conversation?limit=50
GET /api/v1/sessions/{sessionId}/conversation?cursor=<beforeCursor>&limit=50
GET /api/v1/sessions/{sessionId}/conversation?newerCursor=<newerCursor>&limit=50
GET /api/v1/sessions/{sessionId}/conversation?anchorMessageId=<messageId>&limit=50
```

`cursor` 继续作为 public older-record cursor，并映射到 internal `beforeCursor`；store 返回 `nextBeforeCursor`，由 channel 投影为 public `nextCursor`。`newerCursor` 只用于在当前连续 segment 内向较新消息延展。`anchorMessageId` 用于加载包含目标消息的连续窗口。三者不得组合。

现有 `includeCapabilityResults?` 查询参数继续由 conversation read route 支持，默认仍为 `false`。它可以和 latest、older、newer 或 anchor 读取一起使用，只影响返回 conversation items 是否包含 visible Capability result 消息；不得改变 anchor message 校验、scope 校验、窗口连续性、cursor 边界或 preview route 行为。`GET /conversation/preview` 不接受 `includeCapabilityResults`。

后端 response 只需要 `items`、public `nextCursor?`、`newerCursor?` 和既有 `activeRun?`。后端不返回 `windowMode` 或 `anchor` 字段。

anchor 窗口算法固定：
- `limit` 包含 anchor。
- `before = floor((limit - 1) / 2)`。
- `after = limit - 1 - before`。
- 先校验 anchor 是同 scope、同 session、visible 的消息。
- 读取 anchor 前 `before` 条、anchor、anchor 后 `after` 条。
- 若一侧不足，另一侧可填充剩余额度，但总数不得超过 `limit`。
- 返回项按 `createdAt ASC, messageId ASC` 排序。
- 第一条返回项之前仍有记录时返回 `nextBeforeCursor`，由 channel 投影为 public `nextCursor`；最后一条返回项之后仍有记录时返回 `newerCursor`。

### D3：gateway-local 直接读现有 messages 源事实

`agent-platform-gateway-local` 对 preview 和 conversation window 读取使用现有 `messages` 表，不新增表。查询必须带 trusted owner scope、Agent scope、`sessionId`、`visible=true` 和必要角色条件。

推荐查询形态：
- preview：`role=USER`、`visible=true`，按 `created_at ASC, message_id ASC` 计算同 scope/session 的 `totalMarkers`；显式 `offset/limit` 读取当前 marker 页，无 `offset` 时使用 `max(0, totalMarkers - limit)` 读取 latest marker 页；对页内 marker 的 `requestId` 查询同 request 的 latest visible `ASSISTANT` 正文用于可选 `answerPreviewText`，不得查询 tool/Capability result/hidden 内容。单次 `limit` 最大 500；不得按 JS 全量读取后内存切片。
- recent：按 `created_at DESC, message_id DESC` 读取 `limit+1` 条 visible 消息，再反转为 ASC 返回。
- older：根据 `beforeCursor` 查询边界之前消息，按 DESC 读取 `limit+1`，再反转返回。
- newer：根据 `newerCursor` 查询边界之后消息，按 ASC 读取 `limit+1` 返回。
- anchor：按 D2 固定算法读取目标周边连续窗口。

允许按现有 migration 规则补普通 B-tree index 改善 `(tenant, subject, agent, session, visible, created_at, message_id)`、`role` 和排序路径，但不得新增 FTS/search document/sidecar 表、回填任务或 public rebuild endpoint。

### D4：preview rail 是 local/immersive 的鼠标 mini-map

local/immersive 会话界面在对话区域左侧中间显示 preview rail，靠近 Sidebar 边界并保持间距；rail 必须被限制在 conversation viewport 内，不得遮挡 Sidebar、conversation list 或 composer。marker 间距使用组件级固定策略，不随 marker 数量或 rail 高度动态压缩；当 marker 总高度超过 rail 可视高度时，rail 内部可滚动。具体高度上限、gap 数值和滚动条样式属于前端组件常量，不进入 Web/API、runtime、session 或 gateway contract。rail 不参与 collaborative PIU。

rail 使用分页 marker 数据和 DOM 窗口化渲染：
- 使用 `totalMarkers * markerRowHeight` 撑开内部内容高度。
- 仅渲染当前可视区上下 `preloadThreshold` 范围内的 marker DOM；未加载数据的 index 渲染为不可 hover 展示 card 的占位 tick。
- 当前数据窗口由可视区中心 marker index 推导；可视区边界接近窗口头/尾 80 个 marker 时预加载相邻窗口。
- 新提交只刷新尾部窗口；如果用户正悬停历史 marker，尾部刷新不得关闭 card 或改变 rail scroll。

非 hover 状态：
- 每个 marker 显示为短 tick。
- marker 间距不得随 marker 数量或 rail 高度重新计算、压缩。
- inactive marker 使用次级/border token。

hover 状态：
- hover marker 显示 bounded preview card，标题来自 `previewText` 且单行省略；正文来自可选 `answerPreviewText`，最多展示三行；没有 `answerPreviewText` 时不渲染正文区域。
- tick marker 和 card 都触发同一目标消息导航。
- pointer 位于 tick-card 组合区域内时 card 保持可见，离开组合区域时关闭。
- 鼠标在 preview rail 内移动时，hover card 与邻近 marker 的宽度、颜色和阴影可以使用组件级固定常量过渡，但这些数值只属于前端实现，不进入 Web/API、runtime、session 或 gateway contract。
- 高亮只存在于当前鼠标焦点所在的 loaded marker；非 hover marker 不根据 conversation 可视区或 anchored selection 额外高亮。
- hovered、邻近 marker 和 inactive marker 必须可区分，具体宽度等级由前端组件常量定义。
- 宽度递减效果不得推动 conversation list、Sidebar 或 composer。

点击导航：
- 目标消息已在当前连续 segment 内：前端平滑滚动到目标消息，不请求 anchor window。
- 目标消息未加载：前端请求 `conversation?anchorMessageId=...`，用 returned anchored segment 替换当前 conversation segment，再平滑滚动到 anchor。

### D5：anchored state 归前端 conversation store

conversation store 维护当前 session 的 UI state：

```ts
type ConversationViewMode = "recent" | "anchored";
```

并维护 active anchor selection。后端不返回 `windowMode` 或 `anchor`。

行为：
- 点击已加载 marker：不改变 segment，仅滚动到目标消息。
- 点击未加载 marker：加载 anchored window，替换当前 segment，设置 `mode="anchored"`。
- anchored 状态下向上滚动使用 `beforeCursor` / public `nextCursor` prepend，向下滚动使用 `newerCursor` append。
- anchored 状态下底部按钮语义为“回到最新”：点击后重新加载 latest window，清空 anchor，设置 `mode="recent"`，滚动到最新可见消息。
- anchored 状态下提交新用户消息：清空 anchor，设置 `mode="recent"`，切回 bottom-following 并展示新用户消息。
- 新消息或 live stream delta 到达而用户仍 anchored 时，UI 可以短暂提示“有新消息，回到最新”，但不得把不连续的新消息 append 到当前可见 anchored segment；只有通过 `newerCursor` 加载证明 segment 连续，或用户执行“回到最新”/提交新消息切回 recent 后，latest/live 内容才可进入当前可见 conversation segment。

## 风险与取舍（Risks / Trade-offs）

- preview 引入 `totalMarkers` 和分页后，会增加一次 scoped count 查询。该 count 只限当前会话 visible USER marker，不跨会话、不做搜索、不计算 rank/highlight；这是无上限 preview 轨道位置稳定的必要输入。
- 不设置 marker 总量上限意味着极端大数量会依赖浏览器滚动高度能力。首版只避免业务 cap 和全量 DOM，不引入更复杂的分段滚动坐标系统。
- anchor window 不加载从 anchor 到 latest 的全量消息，避免长会话数据和 DOM 压力。
- anchored 与 latest segment 不拼接，避免用户误以为中间消息已经连续加载。

## 迁移计划（Migration Plan）

不新增私有搜索表、FTS 表、search document 表或索引回填。若实现需要改善查询路径，可按现有 gateway-local migration 规则补普通 B-tree index。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/session-conversation-preview/spec.md`：归档当前会话 preview mini-map、preview rail、anchored conversation 和双向 cursor 行为契约。
- `openspec/specs/ts-minimal-agent-kernel/spec.md`：归档 conversation preview route 和 conversation anchor/newer cursor 白名单。
- `openspec/specs/agent-web-multi-host-modes/spec.md`：补充 local/immersive conversation preview rail 的 host-mode 边界，并明确 collaborative preview rail 不在本 change 内。
- `openspec/designs/architecture/core-contracts.md`：补充 conversation preview/anchor query 的 cursor direction 语义和 owner+agent scope 约束。
- `openspec/designs/modules/agent-channel-web.md`、`openspec/designs/modules/agent-session.md`、`openspec/designs/modules/agent-platform-gateway-local.md`：补充 conversation preview/anchor read model 和 SQLite window 查询职责。
- `openspec/designs/spec-to-design-map.md`：新增 `session-conversation-preview` 导航。

## 待确认问题（Open Questions）

无。
