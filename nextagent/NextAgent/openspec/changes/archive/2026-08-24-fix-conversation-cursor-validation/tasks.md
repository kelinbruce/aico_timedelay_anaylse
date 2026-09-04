## 1. `FN-1.8 查看会话消息`

- [x] 1.1 在 `packages/agent-session/src/services/session-preparation.ts` 的 `listMessages` 内、`messageStore.listMessages` 之前增加私有方法 `assertCursorResolves(query)`：取 `anchorMessageId ?? beforeCursor ?? afterCursor`，为空则跳过；调 `messageStore.loadMessage({tenantId, subjectId, agentId, messageId})`，未解析或 `resolved.sessionId !== query.sessionId` 时 `throw new AgentError({ code: 'SESSION_MESSAGE_ANCHOR_NOT_FOUND', message: 'Conversation anchor message was not found.', category: 'NOT_FOUND', retryable: false })`。
  来源：design `修改方案 1`；spec `Conversation cursor/anchor existence and length`
  验证：`session-preparation-cursor-validation.test.ts` 三字段不存在/跨会话用例通过；typecheck 无错误。
  实施证据：`assertCursorResolves` 用 `brand<string, 'MessageId'>(cursorMessageId)` 适配 `loadMessage` 入参；9/9 服务层用例通过；`npx tsc -b --pretty false` exit 0。

- [x] 1.2 在 `listMessages` 内 `messageStore.listMessages` 返回后，`anchorMessageId !== undefined && page.items.length === 0` 时抛 `SESSION_MESSAGE_ANCHOR_NOT_FOUND`，覆盖 memory 路径下 hidden anchor 返回空集的缺口；`cursor`/`newerCursor` 模式不判定，边界空集透传。
  来源：design `修改方案 2`；spec Scenario `Non-existent anchor returns 404 even when the store returns an empty page`
  验证：`session-preparation-cursor-validation.test.ts` anchor 空集→NOT_FOUND、cursor/newerCursor 边界→空集透传用例通过。
  实施证据：anchor hidden（visible:false）+ store 返空集 → NOT_FOUND；beforeCursor/afterCursor 边界 → `{items:[], hasMore:false}` 透传。

- [x] 1.3 在 `packages/agent-channel-web/src/schemas/validation-limits.ts` 新增 `WEB_CONVERSATION_CURSOR_MAX_LENGTH = 64`（不动 `WEB_ID_MAX_LENGTH`）；`conversation-query.ts` 三字段 `maxLength` 改用之；`requests.ts` `parseConversationQuery` 加三字段 `length > 64` 校验，`throwValidation("<field> must not exceed 64 characters.")`。
  来源：design `修改方案 3`；spec `Conversation cursor/anchor existence and length`
  验证：`schema-validation-boundary.test.ts` 三字段 65→400 字段级消息用例通过。
  实施证据：`OVER_64 = 'm'.repeat(65)`；三用例断言 400 + 精确消息文案；48/48 通过。

- [x] 1.4 单元测试覆盖：三字段不存在→NOT_FOUND、跨会话→NOT_FOUND、anchor 空集→NOT_FOUND、anchor 解析且 store 返回 items→返回页、cursor/newerCursor 边界→空集透传、首屏不预检。`schema-validation-boundary.test.ts` 三字段 64 边界用例由 256 改为 64。确认 `local-gateway-contract.test.ts`（gateway 层 cursor 空集语义不变）与 `session-fork-web.test.ts`（绕过服务层）不回归。
  来源：design `验证策略`、`风险与取舍`
  验证：上述测试全部通过；`tsc -b --pretty false` exit 0。
  实施证据：`session-preparation-cursor-validation.test.ts` 9 passed、`local-gateway-contract.test.ts` + `session-fork-web.test.ts` 100 passed 无回归；`conversation-route.test.ts` 5 passed。

- [x] 1.5 更新 `docs/apis/agent-web-api-list.md`（参数表补长度 1–64、错误响应表 256→64 并补 `newerCursor`/`anchorMessageId` 文案、补 `SESSION_MESSAGE_ANCHOR_NOT_FOUND` 404 行）与 `docs/apis/swagger/conversation.yaml`（六处 `maxLength: 256`→`64`）。
  来源：proposal `影响范围`
  验证：文档与 schema/parser 一致。
  实施证据：swagger path 参数 3 处 + ConversationQuery definition 3 处共 6 处改 64；api-list 错误响应表补三字段文案与 `SESSION_MESSAGE_ANCHOR_NOT_FOUND` 404 行。

## 2. Change 整体验证

- [x] 2.1 完成 OpenSpec strict 校验，确认 proposal / design / spec delta / tasks 结构完整、无破坏性公共契约变更。
  来源：proposal `目标与非目标`、`影响范围`；design `验证策略`
  验证：`openspec validate fix-conversation-cursor-validation --strict` 与 `openspec validate --all --strict` 预期 exit 0。
  实施证据：`openspec validate fix-conversation-cursor-validation --strict` → "Change is valid" exit 0。
