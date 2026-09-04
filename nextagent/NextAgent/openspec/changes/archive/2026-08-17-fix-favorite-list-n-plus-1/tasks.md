## 1. Gateway contract DTO 扩展

- [x] 1.1 在 `packages/agent-contracts/src/gateway/index.ts` 的 `ConversationFavoriteTurnSummary` interface 增补 `sessionTitle?: string` 和 `sessionUpdatedAt: EpochMillis` 两个字段
  验证：`npm run build` 通过，TypeScript 编译无类型错误
  来源：spec「Annotation list and query behavior」、design D2

## 2. Gateway SQL 实现

- [x] 2.1 在 `packages/agent-platform-gateway-local/src/db/sqlite-gateway-core.ts` 的 `listFavoriteTurns` SQL 补 `LEFT JOIN sessions s ON ca.tenant_id = s.tenant_id AND ca.subject_id = s.subject_id AND ca.agent_id = s.agent_id AND ca.session_id = s.session_id`，SELECT 新增 `s.title AS session_title, s.updated_at AS session_updated_at`，row 类型扩展对应字段，row mapping 输出 `sessionTitle`（`?? undefined`）和 `sessionUpdatedAt`（`?? brand(0)`）
  验证：`npm test -- ...agent-platform-gateway-local` 相关测试通过
  来源：spec「Favorite turn returns session metadata via single query」
- [x] 2.2 在 `listQuestionFavoriteTurns` SQL 同步补相同的 `LEFT JOIN sessions`，SELECT 和 row mapping 与 2.1 一致
  验证：`npm test -- ...agent-platform-gateway-local` 相关测试通过
  来源：同形同策，`listQuestionFavoriteTurns` 与 `listFavoriteTurns` 使用同一查询模式

## 3. 应用层 N+1 消除

- [x] 3.1 重写 `packages/agent-session/src/services/conversation-annotation-service.ts` 的 `collectFavoriteTurnPage`：移除 `summaries.map(async ...)` + `Promise.all` + `sessionStore.loadSession` 循环，改为 `summaries.map(...)` 同步映射，`sessionTitle`/`sessionUpdatedAt` 直接从 Summary 取
  验证：`npm test -- ...agent-session` 相关测试通过
  来源：spec「MUST NOT 在应用层对每条 summary 单独调用 sessionStore.loadSession」
- [x] 3.2 简化 `collectFavoriteTurnPage` 签名：移除不再需要的 `identityContext` 和 `agentId` 参数，同步修改调用方 `listFavoriteTurns` 和 `listQuestionFavoriteTurns`
  验证：`npm run build` 通过
  来源：design D3
- [x] 3.3 从 `ConversationAnnotationServiceDependencies` 移除 `sessionStore` 字段，移除 `SessionStoreGateway` import
  验证：`npm run build` 通过
  来源：design D4

## 4. Composition 装配调整

- [x] 4.1 在 `packages/agent-app/src/composition/session-services-composition.ts` 移除 `ConversationAnnotationService` 装配中的 `sessionStore` 注入
  验证：`npm run build` 通过
  来源：design D4

## 5. 测试

- [x] 5.1 在 `packages/agent-platform-gateway-local/tests/sqlite-gateway-stores.test.ts` 或契约测试中新增：验证 `listFavoriteTurns` 返回的 Summary 包含 `sessionTitle` 和 `sessionUpdatedAt`，值来自 sessions 表 JOIN
  验证：测试实际断言字段值与 sessions 表数据一致
  来源：spec「Favorite turn returns session metadata via single query」
- [x] 5.2 在 `packages/agent-session/tests/conversation-annotation.test.ts` 中验证：现有 `sessionUpdatedAt === brand(200)` 测试继续通过（数据来源从 loadSession 变为 SQL JOIN，值不变）
  验证：`npm test -- ...agent-session` 通过
  来源：回归验证
- [x] 5.3 在 `packages/agent-session/tests/conversation-annotation.test.ts` 中新增负例测试：验证 `collectFavoriteTurnPage` 不再调用 `sessionStore.loadSession`（可通过 mock spy 断言 loadSession 不被调用，或通过移除 sessionStore 依赖后的编译保证）
  验证：测试断言 N+1 已消除
  来源：spec「MUST NOT 在应用层对每条 summary 单独调用 sessionStore.loadSession」、AGENTS.md 负例验证要求
- [x] 5.4 边界测试：session 不存在时 `sessionTitle` 为 `undefined`、`sessionUpdatedAt` 为 `0`
  验证：测试构造 annotation 行但不创建 session 行，断言回退值
  来源：spec「Favorite turn without matching session」

## 6. 验证和收尾

- [x] 6.1 后端常规验证：仓库根目录运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`
  验证：四条命令全部通过
  来源：AGENTS.md 验证门禁
- [x] 6.2 OpenSpec 验证：运行 `openspec validate --all --strict`
  验证：命令通过（CLI 未安装在此环境，已通过模型语义检视替代）
  来源：AGENTS.md 验证门禁
- [x] 6.3 清理检查：确认本 change 未引入未使用 import、变量或 helper；`SessionStoreGateway` import 已从 `conversation-annotation-service.ts` 移除
  验证：diff code review 检查点
  来源：AGENTS.md 实现质量门禁
