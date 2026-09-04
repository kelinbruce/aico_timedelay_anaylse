## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-1.14 创建分享链接` | 创建分享前校验每个 runId 能 resolve 为完整问答对，不可 resolve 时返回 `SHARE_RUN_NOT_RESOLVABLE`（404）且不落库 | `conversation-share` | `FN-1.14 创建分享链接` |

## `FN-1.14 创建分享链接`

### 目标与规范依据

本设计落实 proposal 中"能创建就能读、不生成死链"的目标。校验只在 `ConversationShareService` 内部执行，复用 `loadSharedConversation` 已有的 resolve 路径，不新增 gateway port、不扩大读取范围、不改变公共契约。

#### 本 Function 的目标 Requirements

canonical spec：`conversation-share`

- `MODIFIED`：`Share creation Web API contract`

### 当前实现

- `packages/agent-channel-web/src/routes/requests.ts` 的 `POST sessions/:sessionId/shares` 处理器只调用 `requireSession` 验证 session 存在，随后把请求体的 `runIds` 直接 `brand` 为 `RequestRunId` 传给 `shares.createShare`，不校验 run 存在性。
- `packages/agent-session/src/services/conversation-share-service.ts` 的 `createShare` 只计算 `expiresAt`、组装 `ConversationShareRecord`、调用 `shareStore.createShare` 落库并拼接 `shareUrl` 返回，全程不读取 `messageStore` 或 `runStore` 验证 `runIds`。
- 同文件的 `loadSharedConversation` 已具备完整的 run resolve 逻辑：拉取 session 全量 readable messages（含 `RETRY_REPLACED` / `EDIT_REPLACED` 的隐藏消息），对每个 `runId` 调用 `runStore.loadRun`，并在 `run === undefined` 时尝试用唯一 `requestId` 补齐 canonical USER；resolve 失败返回 `SHARE_CONTENT_DELETED`。
- 因此 `createShare` 与 `loadSharedConversation` 对"runId 是否可读"的判定路径相互独立，创建期不做任何 resolve，导致不可读的 runId 也能创建成功，只在查看期暴露为死链。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 不可 resolve 的 runId 不应生成分享 | `createShare` 不校验 runId 可读性 | 缺少创建期的 runId resolve 校验步骤 |
| 创建期与查看期 resolve 判定一致 | resolve 逻辑只存在于 `loadSharedConversation` 内联实现 | 需把 resolve 逻辑提取为共用方法，避免两套判定漂移 |
| copied run anchor 不被误杀 | `load === undefined` 分支已支持无 `RequestRunRecord` 的 copied anchor | 创建期校验必须复用同一分支，不得退化为"runStore 存在"这种更严格判定 |
| 不落库、不返回 shareUrl | 校验失败时 throw 在 `shareStore.createShare` 之前 | 校验必须位于持久化调用之前，throw 即中止 |

### 修改方案

唯一实现路径是把 `loadSharedConversation` 中已有的两段逻辑提取为 `ConversationShareService` 的私有方法，并在 `createShare` 落库前调用：

1. `loadReadableMessages(scope)`：按 `(tenantId, subjectId, agentId, sessionId)` 分页拉取 session 全量 messages（`includeHidden: true`、`includeCapabilityResults: true`），过滤出 `isShareReadableMessage` 的集合。与查看期拉取完全一致，保证创建期与查看期看到同一消息集。
2. `resolveShareUnit(selectedRunId, readableMessages, scope)`：单个 runId 的 resolve，返回 `[canonicalUSER, ...runMessages]` 或 `null`。逻辑与原 `loadSharedConversation` step 5 逐字一致——包括 `run === undefined` 时对 copied run anchor 的 fallback 补齐、跨 scope run 的拒绝、`hasMismatchedRequest` / `userMessages.length !== 1` / 缺 final assistant answer 的 fail-closed 判定。
3. `createShare` 在 `computeExpiresAt` 之后、构建 `record` 之前，用 `identityContext` + `agentId` + `sessionId` 拼成 `ShareScope`，调用 `loadReadableMessages` 一次，再对 `runIds` 逐个 `resolveShareUnit`；任一返回 `null` 即 `throw shareRunNotResolvable()`（`AgentError { code: "SHARE_RUN_NOT_RESOLVABLE", category: "NOT_FOUND", retryable: false }`）。
4. `loadSharedConversation` 的 step 4/5 改为调用上述两个私有方法（`shareRecord` 的字段满足 `ShareScope`），行为不变，仅消除重复实现。

校验失败 throw 发生在 `shareStore.createShare` 之前，因此不会落库、不会返回 `shareUrl`。路由层 error handler 已有的 `statusFor` 将 `NOT_FOUND` 类别映射为 HTTP `404`，无需路由层改动。

### copied run anchor 兼容性

`resolveShareUnit` 在 `run === undefined`（无 `RequestRunRecord`）时走 fallback：要求该 runId 的 messages 恰好归属唯一 `requestId`、有 final assistant answer，且该 `requestId` 下能唯一补齐 canonical USER。这正是 fork 复制 copied run anchor 的合法形态（见 `Requirement: Copied retry answer 的冻结分享保持完整`）。复用同一逻辑保证创建期判定与查看期一致，copied anchor 既能创建也能查看。

### 质量属性影响

- **可靠性**：消除死链，创建与查看语义一致。
- **可维护性**：resolve 逻辑单一来源，创建与查看共用，避免漂移。
- **性能**：创建分享多一次 session 全量 message 拉取（与查看期同等开销，分页上限 200）；`runIds` 数量受 `WEB_SHARE_RUN_IDS_MAX_ITEMS` 限制，`loadRun` 调用次数有界。
- **安全**：校验失败返回显式 `SafeError`，不暴露 raw 异常、SQL 或对话内容；跨 scope runId 被拒绝，不回源其他 session/parent。

### 验证策略

- `ConversationShareService` 单元测试覆盖：纯不存在 runId 创建被拒、多 runId 含一个不存在被拒、不完整 run（只有 USER 无 answer）被拒、跨 scope/跨 session runId 被拒、copied run anchor（无 `RequestRunRecord`）仍能创建、合法 run 仍能创建并可查看。
- 路由层测试覆盖：`shares` port 抛 `SHARE_RUN_NOT_RESOLVABLE`（`NOT_FOUND`）时响应 `404`，不返回 200 + shareUrl。
- 查看期 fail-closed 安全投影用例（tool-use 不当 answer、unknown hidden reason）保留，通过直接持久化冻结记录绕过创建校验，验证 `loadSharedConversation` 行为不变。
- typecheck 通过；既有合法分享创建与查看用例不回归。
