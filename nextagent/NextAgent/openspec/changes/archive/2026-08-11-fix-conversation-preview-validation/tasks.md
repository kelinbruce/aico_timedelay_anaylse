# Tasks

## FN-1.8 查看会话消息

- [x] 1. 测试先行：在 `packages/agent-channel-web/tests/conversation-preview-route.test.ts` 中为 preview 路由补充校验失败的消息断言与新增 negative 用例，覆盖 `limit` 缺失（`limit is required.`）、`limit=501`/`limit=0`（`limit must be between 1 and 500.`）、`limit=abc`（`limit must be an integer.`）、`offset=-1111`（`offset must be a non-negative integer.`）、`offset=abc`（`offset must be an integer.`）、额外参数 `q`（`Conversation preview only supports offset and limit query parameters.`），并新增 `limit=01` 期望 200 的用例。实施前运行确认缺失/前缀消息用例失败以复现缺陷。
  Validation: `npx vitest run --config vitest.config.channel-web.ts packages/agent-channel-web/tests/conversation-preview-route.test.ts`（实施前 negative 消息用例失败，实施后全部通过）
  Source: design [GAP 分析](#gap-分析)；spec Requirement `会话预览查询校验返回确定字段级结果`

- [x] 2. 把 `packages/agent-channel-web/src/schemas/conversation-query.ts` 的 `conversationPreviewQuery` 中 `offset`/`limit` 的 `pattern`/`minLength`/`maxLength` 移除，`limit` 由 schema 必填改为 `Type.Optional`，保留 `additionalProperties: false`；移除因此未使用的 `WEB_QUERY_OFFSET_MAX_LENGTH` import。不动 `conversationQuery`。
  Validation: `npx tsc -b --pretty false`
  Source: design [FN-1.8 查看会话消息](#fn-18-查看会话消息) 步骤 1

- [x] 3. 在 `packages/agent-channel-web/src/routes/requests.ts` 中将 `parseConversationPreviewQuery` 的两条消息去掉 `conversation preview ` 前缀（`offset must be a non-negative integer.`、`limit must be between 1 and 500.`）；将 `assertConversationPreviewQueryParameters` 改为 `preValidation` 钩子签名（接收 `FastifyRequest`、读 `request.raw.url`）、消息首字母大写；路由声明加 `preValidation: assertConversationPreviewQueryParameters` 并删除 handler 内的 inline 调用。
  Validation: `npx vitest run --config vitest.config.channel-web.ts packages/agent-channel-web/tests/conversation-preview-route.test.ts`
  Source: design [FN-1.8 查看会话消息](#fn-18-查看会话消息) 步骤 2、3

- [x] 4. 把 `packages/agent-channel-web/tests/schema-validation-boundary.test.ts` 中 `rejects zero-leading limit on conversation preview`（`limit=01` 期望 400）改为 `accepts zero-leading limit on conversation preview as a positive integer`（期望 200）。
  Validation: `npx vitest run --config vitest.config.channel-web.ts packages/agent-channel-web/tests/schema-validation-boundary.test.ts`
  Source: design [FN-1.8 查看会话消息](#fn-18-查看会话消息) 步骤 4

- [x] 5. 把 `docs/apis/openapi/paths/conversation.yaml` 的 preview 路径 `offset`/`limit` 参数 schema 去掉 `pattern`/`minLength`/`maxLength`，`limit` 保持 `required: true`，description 注明校验由路由 parser 强制。
  Validation: 人工核对 yaml 与 `docs/apis/agent-web-api-list.md` preview 条目一致
  Source: design [FN-1.8 查看会话消息](#fn-18-查看会话消息)

- [x] 6. 整体验证：运行 channel-web 测试套件确认 preview 改动未影响其他路由，并确认 typecheck 干净。
  Validation: `npx vitest run --config vitest.config.channel-web.ts packages/agent-channel-web/tests/conversation-preview-route.test.ts packages/agent-channel-web/tests/schema-validation-boundary.test.ts` 与 `npx tsc -b --pretty false`
  Source: design [验证策略](#验证策略)

- [x] 7. 补齐 `session-conversation-preview` delta spec，固化精确字段级消息和 `limit=01` 接受语义，并移除 `skip_specs` 例外。
  Validation: `openspec validate fix-conversation-preview-validation --strict`
  Source: spec Requirement `会话预览查询校验返回确定字段级结果`
