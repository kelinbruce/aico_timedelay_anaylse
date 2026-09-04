# add-ts-local-session-store — 任务

## 1. hideMessage 实现

- [x] 1.1 实现 `hideMessage(request: HideMessageRequest)` — 接受 `HideMessageRequest` 参数（tenantId, subjectId, agentId, messageId, reason, hiddenByContextId, idempotencyKey），不再是无参 stub
- [x] 1.2 hideMessage 逻辑：UPDATE messages SET visible=0 WHERE PK + scope → 影响行数 0 返回 undefined，1 返回 updated record
- [x] 1.3 hideMessage 幂等：状态自幂等 — 读 record 后检查 `visible` 是否为 `false`，已是 false 则直接返回已隐藏 record，不重复 UPDATE
- [x] 1.4 验证：`npm run build` + `npm test` 通过

## 2. SessionStoreGateway contract tests

- [x] 2.1 loadSession scope isolation — 正确 scope 返回 record，错误 tenantId/subjectId/agentId 返回 undefined
- [x] 2.2 listSessions scope isolation — 只返回匹配 agentId 的 sessions，hasMore 分页正确
- [x] 2.3 saveSession — 按 PK upsert（INSERT OR REPLACE），sessionId 天然幂等
- [x] 2.4 验证：`npm run build` + `npm test` 通过

## 3. SessionMessageStoreGateway contract tests

- [x] 3.1 appendSessionMessage idempotency — 新 idempotencyKey INSERT，重复 idempotencyKey 返回已有 record
- [x] 3.2 loadMessage scope isolation — 正确 scope 返回 record，错误 scope 返回 undefined
- [x] 3.3 listMessages visible 过滤 — includeHidden=false 排除隐藏消息，includeHidden=true 包含所有
- [x] 3.4 listCurrentRequestMessages run isolation — 只返回匹配 requestId + runId 的消息
- [x] 3.5 Sequence monotonic — 跨 request/run 验证 sequence 严格递增
- [x] 3.6 hideMessage 测试 — 隐藏后 listMessages 排除、loadMessage 返回 visible=false、不存在返回 undefined、scope 不匹配返回 undefined、幂等重复返回已有
- [x] 3.7 验证：`npm run build` + `npm test` 通过

## 4. sessions 表 schema 迁移（json → 独立列）

- [x] 4.1 DDL：`initialize()` 中 sessions 表 CREATE TABLE 删除 `json TEXT NOT NULL`，新增 `title TEXT`
- [x] 4.2 读路径：`loadSession`、`listSessions`、`getSessionRow` — `SELECT json FROM` 改为逐列 `SELECT`，`toSessionRecord` 组装
- [x] 4.3 写路径：`putSession` — `INSERT OR REPLACE INTO sessions(..., json) VALUES(..., ?)` 改为独立列绑定，去掉 `JSON.stringify`
- [x] 4.4 `touchSession` 优化：从读 json→解析→修改→写回 json 改为单条 `UPDATE sessions SET updated_at = ? WHERE ...`
- [x] 4.5 `getSessionByIdempotencyKey` — `SELECT json FROM` 改为 `SELECT` 独立列，`toSessionRecord` 组装
- [x] 4.6 验证：`npm run build` + `npm test` 通过

## 5. messages 表 schema 迁移（json → 独立列）

- [x] 5.1 DDL：`initialize()` 中 messages 表 CREATE TABLE 删除 `json TEXT NOT NULL`，新增 `content TEXT NOT NULL`、`content_type TEXT NOT NULL`、`metadata TEXT NOT NULL`
- [x] 5.2 读路径：`loadMessage`、`listMessages`、`listCurrentRequestMessages`、`getMessageByIdempotencyKey` — `SELECT json FROM` 改为逐列 `SELECT`，`toSessionMessageRecord` 组装（`metadata` 经 `JSON.parse`）
- [x] 5.3 写路径：`saveMessageSync` — `INSERT INTO messages(..., json) VALUES(..., ?)` 改为独立列绑定（`content`、`content_type`、`metadata` 独立绑定），去掉 `JSON.stringify`
- [x] 5.4 `hideMessage`：UPDATE 直接改 `visible = 0` 和 `metadata` 列，不再 `JSON.stringify(hidden)` 写入 `json` 列
- [x] 5.5 验证：`npm run build` + `npm test` 通过

## 6. attachments 表 schema 迁移（json → 独立列）

- [x] 6.1 DDL：`initialize()` 中 attachments 表 CREATE TABLE 删除 `json TEXT NOT NULL`，新增 `file_name TEXT NOT NULL`、`media_type TEXT NOT NULL`、`storage_ref TEXT NOT NULL`
- [x] 6.2 读路径：`loadAttachment`、`listAttachmentsByRequestId`、`updateAttachmentStatus` — `SELECT json FROM` 改为逐列 `SELECT`，`toAttachmentRecord` 组装
- [x] 6.3 写路径：`putAttachment` — `INSERT OR REPLACE INTO attachments(..., json) VALUES(..., ?)` 改为所有 13 列独立绑定
- [x] 6.4 验证：`npm run build` + `npm test` 通过

## 7. pending_inputs 表 schema 迁移（json → 独立列）

- [x] 7.1 DDL：`initialize()` 中 pending_inputs 表 CREATE TABLE 删除 `json TEXT NOT NULL`，新增 `request_context_id TEXT NOT NULL`、`checkpoint_id TEXT NOT NULL`、`kind TEXT NOT NULL`、`created_at INTEGER NOT NULL`、`request TEXT NOT NULL`、`response_answers TEXT`
- [x] 7.2 读路径：`loadPendingInput`、`resolvePendingInput` — `SELECT json FROM` 改为逐列 `SELECT`，`toPendingInputRecord` 组装（`request` 和 `response_answers` 经 `JSON.parse`）
- [x] 7.3 写路径：`putPendingInput` — `INSERT OR REPLACE INTO pending_inputs(..., json) VALUES(..., ?)` 改为所有 15 列独立绑定（`request` 和 `response_answers` 经 `JSON.stringify`）
- [x] 7.4 验证：`npm run build` + `npm test` 通过

## 8. 架构测试更新

- [x] 8.1 `workspace.test.ts` — 验证 `sessions` 表无 `json TEXT NOT NULL` 列，有 `title TEXT` 列
- [x] 8.2 `workspace.test.ts` — 验证 `messages` 表无 `json TEXT NOT NULL` 列，有 `content TEXT`、`content_type TEXT`、`metadata TEXT` 列
- [x] 8.3 `workspace.test.ts` — 验证 `attachments` 表无 `json TEXT NOT NULL` 列，有 `file_name TEXT`、`media_type TEXT`、`storage_ref TEXT` 列
- [x] 8.4 `workspace.test.ts` — 验证 `pending_inputs` 表无 `json TEXT NOT NULL` 列，有 `request_context_id TEXT`、`kind TEXT`、`request TEXT` 列
- [x] 8.5 验证：`npm run build` + `npm test` 通过

## 9. 整体验证

- [x] 9.1 `npm run build` 通过
- [x] 9.2 `npm test` 通过
- [x] 9.3 `npm run lint:architecture` 通过
- [x] 9.4 确认 session/message/attachment/pending_input contract tests 在独立列模式下全部通过
