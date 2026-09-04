## 背景与问题（Why）

收藏功能当前以"会话"为粒度展示：后端 `GET /api/v1/favorites` 返回 `GROUP BY session_id` 聚合后的会话列表，每条只含 `sessionId` 和 `favoriteCount`。前端侧边栏收藏列表显示会话标题，点击后只跳转到会话，无法定位到被收藏的具体对话。

用户实际诉求：收藏列表以收藏的对话为粒度展示，title 显示用户问题文本（长则截断），单击后跳转到对应会话并将该对话滚动到可视区域。点击收藏项后左侧保持收藏列表，直到用户主动新建会话才切回历史会话列表。收藏项高亮只由鼠标 hover 决定，不因当前会话匹配而高亮。

## 变更范围（What Changes）

- gateway contract：`ConversationFavoriteSessionSummary` → `ConversationFavoriteTurnSummary`，字段从 `{ sessionId, favoriteCount }` 变为 `{ sessionId, requestRunId, rootMessageId, questionPreview, questionTruncated, favoritedAt }`。`ListFavoriteSessionsQuery` → `ListFavoriteTurnsQuery`。
- runtime contract：`ConversationFavoriteSessionEntry` → `ConversationFavoriteTurnEntry`，`ConversationFavoriteSessionPage` → `ConversationFavoriteTurnPage`，字段同步变更。`RuntimeListFavoriteSessionsQuery` → `RuntimeListFavoriteTurnsQuery`。
- gateway port 方法名：`listFavoriteSessions` → `listFavoriteTurns`。
- runtime port 方法名：`listFavoriteSessions` → `listFavoriteTurns`。
- gateway-local SQL：从 `GROUP BY session_id` 聚合改为逐行返回 `is_favorited=1` 的标注记录，LEFT JOIN `messages` 表获取用户问题文本和 root message id。
- agent-session service：透传 per-turn 字段，不再聚合。
- agent-channel-web route：projection 输出 per-turn 字段。
- agent-web 前端 service：`FavoriteSessionEntry` → `FavoriteTurnEntry`，`listFavoriteSessions` → `listFavoriteTurns`。
- agent-web Sidebar：列表显示 `questionPreview`；点击导航到 `/session/:id?messageId=:rootMessageId` 且不关闭收藏列表；移除基于 `activeSessionId` 的高亮，只保留 hover 高亮；移除路由变化自动关闭收藏列表的 effect。
- agent-web ChatPage：读取 URL `?messageId=` 参数，会话加载后复用已有 `scrollToRootMessage` / `loadAnchoredConversation` 机制滚动到目标对话。

## Capability 影响（Capabilities）

### 修改的 Capability
- `conversation-annotation`：收藏列表查询从会话聚合粒度变为对话粒度，查询方法重命名，返回字段变更，前端展示和导航行为变更。

## 影响范围（Impact）

- `agent-contracts/gateway`：重命名 `ConversationFavoriteSessionSummary` → `ConversationFavoriteTurnSummary`，`ListFavoriteSessionsQuery` → `ListFavoriteTurnsQuery`，gateway port 方法重命名。
- `agent-contracts/runtime`：重命名 `ConversationFavoriteSessionEntry` → `ConversationFavoriteTurnEntry`，`ConversationFavoriteSessionPage` → `ConversationFavoriteTurnPage`，`RuntimeListFavoriteSessionsQuery` → `RuntimeListFavoriteTurnsQuery`，runtime port 方法重命名。
- `agent-platform-gateway-local`：SQL 改为 per-turn 查询 + JOIN messages，row mapping 更新。
- `agent-session`：service 方法重命名，返回 per-turn entry。
- `agent-channel-web`：route projection 更新。
- `agent-web`：service、Sidebar、ChatPage、chatNavigation 变更。
- 测试：跨 4 个 package 的测试适配新结构和新方法名。

## 归档前更新基线（Baseline Promotion Plan）

**行为契约：**
- `openspec/specs/conversation-annotation/spec.md`：修改 "Annotation list and query behavior" requirement，收藏列表从会话聚合变为对话粒度。

**设计视图：**
- `openspec/designs/modules/agent-contracts.md`：补充重命名后的 contract 归属。
- `openspec/designs/modules/agent-channel-web.md`：补充 projection 变更说明。

**验证入口：**
- `agent-platform-gateway-local` unit test：per-turn 查询、JOIN messages、question preview 截断。
- `agent-channel-web` route integration test：per-turn 响应字段。
- `agent-session` port test：per-turn entry 结构。
- `agent-web` 前端 test：questionPreview 显示、点击导航含 messageId、收藏列表保持、hover 高亮。
