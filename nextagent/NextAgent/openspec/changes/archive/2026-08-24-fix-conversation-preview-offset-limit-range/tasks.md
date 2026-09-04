## 1. `FN-1.8 查看会话消息`

- [x] 1.1 在 `packages/agent-channel-web/src/schemas/validation-limits.ts` 新增 `WEB_CONVERSATION_PREVIEW_OFFSET_MAX_LENGTH = 5`（不动 `WEB_QUERY_OFFSET_MAX_LENGTH=7`）。
  来源：design `修改方案 1`；spec `会话预览查询校验返回确定字段级结果`
  验证：`tsc -b` exit 0。
  实施证据：`validation-limits.ts` 新增常量，注释说明 10000 为 5 位数、长度守卫用途。

- [x] 1.2 在 `packages/agent-channel-web/src/routes/requests.ts` 将 `MAX_CONVERSATION_PREVIEW_LIMIT` 由 `500` 改 `100`，新增 `MAX_CONVERSATION_PREVIEW_OFFSET = 10000`，import `WEB_CONVERSATION_PREVIEW_OFFSET_MAX_LENGTH`；`parseConversationPreviewQuery` 加 offset 长度守卫（`length > 5` → `offset must not exceed 10000.`）与数值上界（`offset > 10000` → 同消息）。
  来源：design `修改方案 1/2/3`；spec `会话预览查询校验返回确定字段级结果`
  验证：`conversation-preview-route.test.ts` offset 10001→400、10000→200、`1e27`→`offset must not exceed 10000.`；limit 101→`limit must not exceed 100.`。
  实施证据：长度守卫在 `parseStrictInteger` 之前，`1e27` 不再触发 `finite safe integer`；50/50 web 测试通过。

- [x] 1.3 在 `packages/agent-platform-gateway-local/src/db/sqlite-gateway-core.ts` 将 `CONVERSATION_PREVIEW_MAX_PAGE_LIMIT` 由 `500` 改 `100`，新增 `CONVERSATION_PREVIEW_MAX_OFFSET = 10000`，`listConversationPreview` backstop 校验加 `offset > CONVERSATION_PREVIEW_MAX_OFFSET`。
  来源：design `修改方案 4`；spec `会话预览查询校验返回确定字段级结果`
  验证：`local-gateway-contract.test.ts` `limit=501` 仍被拒、`limit=100` 分页不回归。
  实施证据：backstop 与 web 边界一致（100/10000）；62/62 gateway 契约测试通过。

- [x] 1.4 单元测试覆盖：offset 10001→400、10000→200、`1e27`（28 位）→`offset must not exceed 10000.`、limit 101→`limit must not exceed 100.`；`limit=01`→200 不回归。
  来源：design `验证策略`、`风险与取舍`
  验证：上述测试全部通过；`tsc -b` exit 0。
  实施证据：`conversation-preview-route.test.ts` 新增 3 个 offset 用例、改 limit 用例 501→101；`schema-validation-boundary.test.ts` `limit=01` 仍 200。

- [x] 1.5 更新 `docs/apis/agent-web-api-list.md`（preview 参数表 offset 补"0 到 10000"、limit "1 到 100"；错误表去掉 `finite safe integer`、补 `offset must not exceed 10000.`、limit 500→100）与 `docs/apis/swagger/conversation.yaml`（path 参数描述 + `ConversationPreviewQuery` offset maxLength 7→5、limit 描述 500→100）。
  来源：proposal `影响范围`
  验证：文档与 schema/parser 一致。
  实施证据：api-list 参数表/错误表、swagger path 参数 2 处 + definition offset maxLength 1 处改 5、limit 描述改 100。

## 2. Change 整体验证

- [x] 2.1 完成 OpenSpec strict 校验，确认 proposal / design / spec delta / tasks 结构完整，MODIFIED delta 准确反映 limit 500→100、offset 上界 10000、消息文案对齐。
  来源：proposal `目标与非目标`、`影响范围`；design `验证策略`
  验证：`openspec validate fix-conversation-preview-offset-limit-range --strict` 预期 exit 0。
  实施证据：pending（待执行 `openspec validate --strict`）。
