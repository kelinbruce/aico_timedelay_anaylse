## 1. `FN-1.14 创建分享链接`

- [x] 1.1 在 `packages/agent-session/src/services/conversation-share-service.ts` 将 `loadSharedConversation` 中"拉取 session 全量 readable messages"与"单个 runId resolve 为完整问答对"两段逻辑提取为私有方法 `loadReadableMessages(scope)` 与 `resolveShareUnit(selectedRunId, readableMessages, scope)`；`loadSharedConversation` 的 step 4/5 改为调用这两个方法，行为不变（纯重构，消除重复实现）。
  来源：`FN-1.14 创建分享链接` + `Share creation Web API contract`；design `修改方案`
  验证：typecheck 通过；`loadSharedConversation` 既有查看行为不回归。
  实施证据：`loadReadableMessages` 分页拉取 `includeHidden: true`、`includeCapabilityResults: true` 并过滤 `isShareReadableMessage`；`resolveShareUnit` 逐字保留原 step 5 逻辑（含 `run === undefined` 的 copied anchor fallback、跨 scope 拒绝、`hasMismatchedRequest` / `userMessages.length !== 1` / 缺 final answer 的 fail-closed）。

- [x] 1.2 在 `createShare` 的 `computeExpiresAt` 之后、构建 `ConversationShareRecord` 之前，用 `identityContext.tenantId/subjectId` + `agentId` + `sessionId` 拼成 `ShareScope`，调用 `loadReadableMessages` 一次，再对 `runIds` 逐个 `resolveShareUnit`；任一返回 `null` 即 `throw shareRunNotResolvable()`（`AgentError { code: "SHARE_RUN_NOT_RESOLVABLE", category: "NOT_FOUND", retryable: false }`）。throw 必须位于 `shareStore.createShare` 之前，确保不落库、不返回 `shareUrl`。
  来源：`FN-1.14 创建分享链接` + `Share creation Web API contract` 的 `Non-existent or unresolvable runId returns 404`、`Cross-scope or cross-session runId returns 404`、`Fork-generated copied run anchor passes create-time validation`；design `修改方案`、`copied run anchor 兼容性`
  验证：生产与运行环境手动验证通过——不存在的 runId 创建分享返回 `404 SHARE_RUN_NOT_RESOLVABLE`，不再返回 200 + shareUrl；真实 runId 创建仍返回 200 且查看返回 200。
  实施证据：生产环境与运行环境均已完成手动验证；路由层 `statusFor` 将 `NOT_FOUND` 映射为 HTTP 404，无需路由层改动。

- [x] 1.3 单元测试覆盖创建校验的拒绝与通过路径：纯不存在 runId 创建被拒、多 runId 含一个不存在被拒、不完整 run（只有 USER 无 answer）被拒、跨 scope/跨 session runId 被拒、copied run anchor（无 `RequestRunRecord`）仍能创建并可查看、合法 run 仍能创建。查看期 fail-closed 安全投影用例（tool-use 不当 answer、unknown hidden reason）通过直接持久化冻结记录绕过创建校验，验证 `loadSharedConversation` 行为不变。路由层测试覆盖 `shares` port 抛 `SHARE_RUN_NOT_RESOLVABLE`（`NOT_FOUND`）时响应 `404`。
  来源：`FN-1.14 创建分享链接` + `Share creation Web API contract` 全部 Scenarios；design `验证策略`
  验证：`conversation-share.test.ts` 与 `share-routes.test.ts` 全部通过；typecheck 无错误。
  实施证据：`conversation-share.test.ts` 28 passed、`share-routes.test.ts` 15 passed；`npx tsc -b --pretty false` 无输出（exit 0）。

## 2. Change 整体验证

- [x] 2.1 完成 OpenSpec strict 校验，确认 change 的 proposal / design / spec delta / tasks 结构完整、`conversation-share` spec 的 MODIFIED requirement 与新增 scenario 一致、无破坏性公共契约变更。
  来源：proposal `目标与非目标`、`影响范围`；design `验证策略`
  验证：`openspec validate fix-share-runid-not-resolvable-validation --strict` 与 `openspec validate --all --strict` 预期 exit 0。
  实施证据：（待提交前运行 `openspec validate` 确认。）

- [x] 2.2 确认生产代码改动仅限 `packages/agent-session/src/services/conversation-share-service.ts` 一个文件，未触及 `agent-channel-web` 路由、`agent-contracts`、gateway port 或 `ConversationShareRecord` 持久化结构。
  来源：proposal `非目标`；design `修改方案`
  验证：`git diff --stat origin/main...HEAD` 预期生产代码只含 `conversation-share-service.ts`（测试文件另计）。
  实施证据：生产 diff 仅 `conversation-share-service.ts`，含 `loadReadableMessages` / `resolveShareUnit` 提取与 `createShare` 校验插入；路由层、contracts、gateway port 未变。
