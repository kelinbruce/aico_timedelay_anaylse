## 1. Gateway Contract 定义

- [x] 1.1 在 `agent-contracts/gateway` 新增 `ConversationShareRecord`（extends OwnerScoped，含 agentId、sessionId、runIds、originUrl、allowedOps、expiresAt、createdAt）、`ConversationShareStoreGateway`（createShare、loadShare、deleteSharesBySession）、`LoadShareRequest`、`DeleteSharesBySessionRequest` 等配套 DTO。验证：`npx tsc --noEmit -p tsconfig.json` 通过（exit code 0）。来源：spec "Conversation share persistence and scope isolation"、design "ConversationShareStoreGateway port 形态"。
- [x] 1.2 在 `agent-contracts/runtime` 新增 `RuntimeConversationSharePort`（createShare、loadSharedConversation）、`CreateShareCommand`、`LoadSharedConversationQuery`、`ShareResult`、`SharedConversationPage` 等配套 DTO。验证：`npx tsc --noEmit -p tsconfig.json` 通过（exit code 0）。来源：spec "Share creation Web API contract"、"Shared conversation view Web API contract"、design "RuntimeConversationSharePort port 形态"。

## 2. Gateway Local 实现

- [x] 2.1 在 `agent-platform-gateway-local/src/db/sqlite-gateway-stores.ts` 新增 `conversation_shares` 表 DDL（主键 `(tenant_id, subject_id, agent_id, share_id)`，含 `run_ids` TEXT JSON、`origin_url` TEXT、`allowed_ops` TEXT JSON nullable、`expires_at` INTEGER nullable、`created_at` INTEGER），并添加 `share_id` 全局查找索引。验证：`npx tsc --noEmit` 通过；DDL 在测试初始化时执行无报错。来源：spec "Conversation share persistence and scope isolation"。
- [x] 2.2 实现 `ConversationShareStoreGateway` 的 SQLite 版本（createShare 生成密码学安全 shareId、loadShare 按 shareId 全局查找、deleteSharesBySession 按 scope+sessionId 删除），注册到 `SqliteGatewayStores`。验证：`npx tsc --noEmit` 通过。来源：spec "Conversation share persistence and scope isolation"、design "shareId 作为唯一跨 scope 凭证"。
- [x] 2.3 编写 gateway unit test：createShare 生成不可预测的 shareId（长度≥22 字符）、runIds 冻结快照完整性、跨 scope 查询不可见、loadShare 按 shareId 全局查找成功、deleteSharesBySession 只清理指定 scope。验证：`npx vitest run packages/agent-platform-gateway-local/tests/sqlite-gateway-stores.test.ts` 23 passed。来源：spec "Conversation share persistence and scope isolation" scenarios。
- [x] 2.4 编写 gateway negative test：createShare 时传入的 `idempotencyKey` 重复写入返回首次锚点结果不重复 side effect；loadShare 不存在的 shareId 返回 undefined。验证：`npx vitest run packages/agent-platform-gateway-local/tests/sqlite-gateway-stores.test.ts` 23 passed。来源：spec "Share failure and safe error handling"。

## 3. Runtime Port 实现

- [x] 3.1 在 `agent-session` 实现 `RuntimeConversationSharePort`：createShare 注入 `ConversationShareStoreGateway` 生成记录并返回完整 shareUrl；loadSharedConversation 先 loadShare 拿冻结 scope，校验过期（`SHARE_EXPIRED`）、权限（`SHARE_FORBIDDEN`，allowedOps ⊆ viewerOps 子集校验）、内容存在性（`SHARE_CONTENT_DELETED`），然后用冻结 scope+agentId 通过 `SessionMessageStoreGateway.listMessages` 查 runIds 对应 messages。验证：`npx tsc --noEmit` 通过。来源：spec "Shared conversation view Web API contract"、"Owner scope controlled exception for share viewing"、"ops permission whitelist semantics"。
- [x] 3.2 编写 session port test：createShare 返回完整 URL（`{originUrl}/#/shared/{shareId}`）；loadSharedConversation 用创建者 scope 查 messages（跨 scope 读取）；只返回 runIds 快照中的 run 的 messages（不扩散到其他 run）；过期返回 SHARE_EXPIRED；权限不足返回 SHARE_FORBIDDEN；内容删除返回 SHARE_CONTENT_DELETED。验证：`npx vitest run packages/agent-session/tests/conversation-share.test.ts` 13 passed。来源：spec scenarios。
- [x] 3.3 编写 session port negative test：createShare 不阻塞 request terminal commit（创建分享前后 terminal commit 状态不变）；loadSharedConversation 的 runIds 快照中包含已删除 run 时返回 SHARE_CONTENT_DELETED；viewerOps 为 null 而 allowedOps 非 null 时返回 SHARE_FORBIDDEN。验证：`npx vitest run packages/agent-session/tests/conversation-share.test.ts` 13 passed。来源：spec "Share architecture boundaries"、"ops permission whitelist semantics"。

## 4. Web Channel 路由

- [x] 4.1 在 `agent-channel-web` 新增 `schemas/share-dto.ts`：`createShareBody`（runIds string[]、originUrl string、expiresIn enum、allowedOps string[]|null）schema。验证：`npx tsc --noEmit` 通过。来源：spec "Share creation Web API contract"。
- [x] 4.2 在 `agent-channel-web/src/routes/requests.ts` 新增 `POST /api/v1/sessions/:sessionId/shares` 路由：identityResolver 取 owner scope，requireSession 取 agentId，调用 `RuntimeConversationSharePort.createShare`，projectConversation 投影返回 DTO。`WebChannelDependencies.shares` 未注入时返回 503 `SHARES_UNAVAILABLE`。验证：`npx tsc --noEmit` 通过。来源：spec "Share creation Web API contract"。
- [x] 4.3 在 `agent-channel-web/src/routes/requests.ts` 新增 `GET /api/v1/shares/:shareId/conversation` 路由：从 `X-Viewer-Ops` header 解析 viewerOps（JSON string[]，缺失为 null），调用 `RuntimeConversationSharePort.loadSharedConversation`，按返回的 SafeError code 映射 HTTP 状态（404 SHARE_NOT_FOUND、410 SHARE_EXPIRED、403 SHARE_FORBIDDEN、404 SHARE_CONTENT_DELETED）。未注入 shares 时返回 503。验证：`npx tsc --noEmit` 通过。来源：spec "Shared conversation view Web API contract"。
- [x] 4.4 编写 web route integration test：创建分享正向（200 + shareUrl 格式正确）；创建分享 empty runIds 返回 400；查看公开分享无 ops（200）；查看 ops 匹配（200）；查看 ops 不足（403）；查看过期（410）；查看内容删除（404）；查看不存在（404）；未注入 shares 返回 503。验证：`npx vitest run packages/agent-channel-web/tests/share-routes.test.ts` 12 passed。来源：spec scenarios。
- [x] 4.5 编写 web route negative test：创建分享请求体携带 tenantId/subjectId/agentId 时被忽略（只使用 identity context）；`X-Viewer-Ops` header 为空数组且 allowedOps 非 null 时返回 403。验证：`npx vitest run packages/agent-channel-web/tests/share-routes.test.ts` 12 passed。来源：spec "Client-supplied scope is ignored"、"ops permission whitelist semantics"。

## 5. 架构边界测试

- [x] 5.1 编写架构 boundary test：`agent-channel-web` 不导入 `ConversationShareStoreGateway`；`agent-runtime`、`agent-context-engine`、`agent-capability` 不导入分享 gateway port 或 runtime port。验证：`npx vitest run tests/architecture/boundaries.test.ts` 6 passed。来源：spec "Share architecture boundaries"。

## 6. Composition Root 注入

- [x] 6.1 在 `agent-app` composition root 注入 `ConversationShareStoreGateway`（SQLite 实现）到 `agent-session`，注入 `RuntimeConversationSharePort` 到 `agent-channel-web` 的 `WebChannelDependencies.shares`。验证：`npx tsc --noEmit` 通过。来源：spec "Share architecture boundaries"、design 分层。

## 7. 前端 shareService 和 API 层

- [x] 7.1 在 `frontend/agent-web/src/services` 新增 `shareService.ts`：`createShare(params)` 调 `POST /api/v1/sessions/:sessionId/shares`；`loadSharedConversation(shareId, viewerOps?)` 调 `GET /api/v1/shares/:shareId/conversation`，remote 模式下通过 `X-Viewer-Ops` header 传 ops。验证：`npm run build`（前端 workspace）通过。来源：spec "Share creation Web API contract"、"Shared conversation view Web API contract"。
- [x] 7.2 在 `frontend/agent-web/src/state/contracts.ts` 新增 `SharedConversationResult`、`SharedConversationError`（EXPIRED/FORBIDDEN/CONTENT_DELETED/NOT_FOUND 联合类型）类型定义。验证：前端 `npm run build` 通过。来源：spec "Shared conversation view Web API contract"。

## 8. 前端分享按钮和勾选模式

- [x] 8.1 在 `TurnBlockComponent` 操作行新增分享按钮（与复制、点赞、点踩、收藏、重新生成同行），点击后触发 `onShare` 回调进入勾选模式。验证：前端 component test 中分享按钮存在且可点击。来源：spec "Frontend share interaction behavior"。
- [x] 8.2 实现勾选模式：进入后所有问答对左侧出现复选框，触发分享的问答对默认勾选，支持 toggle 其他问答对，底部全宽分享按钮，支持 ESC/取消退出。验证：前端 test 验证勾选模式 toggle、默认勾选、退出行为。来源：spec "Frontend share interaction behavior" scenarios。

## 9. 前端分享设置弹窗

- [x] 9.1 实现分享设置弹窗组件：有效期选项（24h/7d/30d/永久，始终展示）、权限选项（"保持同样权限"勾选框，仅 remote 模式从 `HostSiteContext.user.ops` 获取展示），local 模式不展示权限选项。验证：前端 test 验证 local 模式无权限勾选框、remote 模式有权限勾选框。来源：spec "Frontend share interaction behavior"、"ops permission whitelist semantics"。
- [x] 9.2 实现生成按钮逻辑：点击后调 `shareService.createShare`，传入勾选的 runIds、`window.location.origin` 作为 originUrl、expiresIn、allowedOps（remote 勾选时为 ops 数组，否则 null），成功后展示完整 shareUrl 供复制。验证：前端 test 验证请求参数正确、成功后展示 shareUrl。来源：spec "Frontend share interaction behavior"。

## 10. 前端只读分享展示页面

- [x] 10.1 新增 `SharedConversationPage` 组件：加载时调 `shareService.loadSharedConversation`，根据返回状态展示正常内容或全屏异常提示（EXPIRED/FORBIDDEN/CONTENT_DELETED/NOT_FOUND）。验证：前端 test 验证四种异常状态的全屏提示。来源：spec "Shared conversation page routing" scenarios。
- [x] 10.2 正常内容渲染：复用 `conversationMessagesToHistoryEnvelopes` + `buildHistoricalTurnBlocks` 纯函数链路，通过 `MessageList` 传入 `turnActionsDisabled` 和 `showAnnotations=false` 渲染问答对。验证：前端 test 验证问答对渲染、无 annotation 图标、无 retry/edit/cancel 按钮、保留复制按钮。来源：spec "Read-only display constraint"。
- [x] 10.3 新增 `/#/shared/:shareId` 哈希路由，在 `App` 和 `ImmersiveApp` 路由层 auth 守卫之前拦截此路由，直接渲染 `SharedConversationPage`。验证：前端 test 验证 `/#/shared/:shareId` 不触发 authChallenge、不要求登录。来源：spec "Shared conversation page routing"、design "分享查看页面独立路由"。
- [x] 10.4 前端 negative test：分享页面不发起 SSE/WebSocket 连接；分享页面不展示 composer 和 sidebar；分享页面的 TurnBlock 操作行不出现点赞/点踩/收藏图标。验证：前端 test 实际断言这些元素不存在。来源：spec "Read-only display constraint"。

## 11. 端到端验证

- [x] 11.1 端到端测试：创建分享 → 用返回的 shareUrl 打开 → 验证只读展示问答对内容（无标注组件、无写操作）。验证：前端 e2e test 通过。来源：spec "Read-only display constraint"、"Shared conversation page routing"。
- [x] 11.2 端到端 negative test：创建带 ops 的分享（remote 模式模拟）→ 用不匹配 ops 查看 → 验证返回 FORBIDDEN 全屏提示；创建带有效期的分享 → 等待过期 → 验证返回 EXPIRED 全屏提示。验证：前端 e2e test 实际触发并断言。来源：spec scenarios。
- [x] 11.3 全量验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict` 全部通过。验证：所有命令 exit code 0。来源：AGENTS.md 验证门禁。
