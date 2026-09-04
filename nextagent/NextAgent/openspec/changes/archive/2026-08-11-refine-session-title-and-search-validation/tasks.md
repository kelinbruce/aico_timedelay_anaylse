# 任务：优化 session 标题与历史搜索校验

## 1. Session 标题校验（后端）

- [x] 1.1 `packages/agent-session/src/services/session-preparation.ts`：在 `updateTitle` 中 trim 标题，校验 trim 后的值（trim 后为空以 `SESSION_TITLE_TOO_SHORT` 拒绝、超过 100 以 `SESSION_TITLE_TOO_LONG` 拒绝、保留不安全内容检查），持久化 trim 后的标题，移除空字符串清除分支。
- [x] 1.2 `tests/agent-kernel/local-gateway-contract.test.ts`：用 trim 后为空拒绝、纯空白拒绝、单字符接受和持久化前 trim 覆盖，替换 "shorter than 4 characters" 和 "allows clearing title with empty string" 两个用例。
- [x] 1.3 `frontend/agent-web/src/i18n/resources/zh-CN.ts` 和 `en-US.ts`：把 `sidebar.renameErrorTooShort` 文案更新为 1-100 / 非空白规则。

## 2. 历史搜索关键词校验

- [x] 2.1 `packages/agent-channel-web/src/routes/requests.ts`：`parseQuestionSearchText` 只拒绝 `q.trim()` 超过 50 个 Unicode code point；移除 ASCII/非 ASCII 最小长度规则。
- [x] 2.2 `packages/agent-channel-web/tests/session-list-search-route.test.ts`：断言单字符和 2 字符关键词以 `questionSearchText` 透传，并保留超 50 拒绝覆盖。
- [x] 2.3 `frontend/agent-web/src/features/sidebar/components/sessionHistorySearch.ts`：仅当 trim 后关键词超过 50 个 Unicode code point 时 `keywordState` 为非法。
- [x] 2.4 `frontend/agent-web/src/features/sidebar/components/SessionHistorySearchControls.tsx` + i18n 资源：用通俗的超长提示替换 `sessionHistory.shortKeywordHint`（重命名 key，更新 zh-CN/en-US）。
- [x] 2.5 `frontend/agent-web-mock-server/routes/sessions.js`：同步更新后的 `q` 校验规则。

## 3. Session 级 composer 停止状态

- [x] 3.1 `frontend/agent-web/src/state/requestStore.ts`：新增 `activeRequestSessionId`，在 submit/accept/reconcile/retry/edit/hydrate 路径上设置，在 settle 时清除，将 `hydrateFromActiveRun(sessionId, requestId)` 改为跨 session 重新 hydrate，新增 `settleStaleSessionRequest(sessionId)`。
- [x] 3.2 `frontend/agent-web/src/pages/ChatPage.tsx`：`isExecuting`/`isRequestControlPending`/`canStopRequest` 以被跟踪 session 匹配当前路由 session 为门槛；更新 hydrate effect；在 entry snapshot 解析且无 `activeRun` 后协调过期的被跟踪状态。
- [x] 3.3 `frontend/agent-web/src/features/chat/hooks/useChatSessionStream.ts`：在 session entry snapshot / 开场 reconcile 解析后通知，使 ChatPage 可以协调过期的被跟踪状态。
- [x] 3.4 测试：`frontend/agent-web/tests/requestStore.test.ts`（session 跟踪、重新 hydrate、过期 settle）、`frontend/agent-web/tests/chat-page.route-state.test.tsx`（其他 session 下隐藏停止按钮、切回时按实际状态恢复）、`frontend/agent-web/tests/useChatSessionStream.test.tsx`（entry snapshot 通知）。

## 4. 验证

- [x] 4.1 `npx vitest run --config vitest.config.release.ts tests/agent-kernel/local-gateway-contract.test.ts packages/agent-channel-web/tests/session-list-search-route.test.ts` - 63/63 通过。
- [x] 4.2 `cd frontend/agent-web && npm run build` - 通过；定向 `npx vitest run tests/requestStore.test.ts tests/useChatSessionStream.test.tsx tests/mock-server-session-search.test.ts tests/i18n.test.ts` - 76/76 通过；`tests/chat-page.route-state.test.tsx` - 79/84 通过，5 个失败在未修改基线上可完全复现；`tests/sidebar.component.test.tsx` - 33/33 通过。
- [x] 4.3 根目录 `npm run build` - 通过；`npm test` - 807 通过；`npm run test:contract` - 286 通过；`npm run lint:architecture` - 未触碰的 `packages/agent-workflow` 中存在 1 个既有违规。
- [x] 4.4 对 dev backend 的真实 HTTP 验证：纯空白标题被拒绝、1 字符标题被接受、标题在持久化前被 trim、单字符 `q` 被接受、51 code point 的 `q` 被拒绝。
- [x] 4.5 `openspec validate --all --strict` - 212 项通过。
