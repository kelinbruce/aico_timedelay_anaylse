## Tasks

- [x] 1. 重命名 gateway contract：`ConversationFavoriteSessionSummary` → `ConversationFavoriteTurnSummary`，`ListFavoriteSessionsQuery` → `ListFavoriteTurnsQuery`，port 方法 `listFavoriteSessions` → `listFavoriteTurns` -> 验证: `npm run build`
- [x] 2. 重命名 runtime contract：`ConversationFavoriteSessionEntry` → `ConversationFavoriteTurnEntry`，`ConversationFavoriteSessionPage` → `ConversationFavoriteTurnPage`，`RuntimeListFavoriteSessionsQuery` → `RuntimeListFavoriteTurnsQuery`，port 方法重命名 -> 验证: `npm run build`
- [x] 3. gateway-local SQL 改为 per-turn 查询 + LEFT JOIN messages -> 验证: `npm test` sqlite-gateway-stores
- [x] 4. agent-session service 透传 per-turn 字段 -> 验证: `npm test` conversation-annotation
- [x] 5. agent-channel-web route projection 更新 -> 验证: `npm test` annotation-routes
- [x] 6. agent-web service 类型和方法重命名 -> 验证: `tsc --noEmit`
- [x] 7. agent-web Sidebar：显示 questionPreview，点击导航含 messageId，移除 activeSession 高亮，保留 hover 高亮，移除路由 effect 关闭收藏列表 -> 验证: `vitest run favorite-sidebar`
- [x] 8. agent-web ChatPage：读取 `?messageId=` 并滚动到目标对话 -> 验证: `tsc --noEmit`
- [x] 9. agent-web chatNavigation：添加 `messageId` 字段 -> 验证: `tsc --noEmit`
- [x] 10. 修复 aria-current={undefined} 为移除该 prop -> 验证: `tsc --noEmit`
- [x] 11. 跨 package 测试适配 -> 验证: `npm test` + frontend `vitest run`
- [x] 12. 架构 lint -> 验证: `npm run lint:architecture`
