# Tasks

## FN-1.6 查询会话列表

- [x] 1. 测试先行：在 `packages/agent-channel-web/tests/session-list-search-route.test.ts` 中为 session list 路由补充校验失败的消息断言，覆盖 `createdFrom=2&createdTo=1`（`createdFrom must be less than or equal to createdTo.`）、`createdFrom=0&createdTo=7776000000`（`created time range must not exceed 90 days.`）、`createdFrom=1000&createdTo=abc`（`createdTo must be an integer.`）、`createdFrom=abc&createdTo=2000`（`createdFrom must be an integer.`）、`offset=-1`（`offset must be a non-negative integer.`）、`offset=abc`（`offset must be an integer.`）、`limit=0`（`limit must be a positive integer.`）、`q=abc&limit=51`（`search limit must not exceed 50.`），逐项断言 HTTP 400 与 `REQUEST_VALIDATION_FAILED` + 精确 message。
  Validation: `npx vitest run --config vitest.config.channel-web.ts packages/agent-channel-web/tests/session-list-search-route.test.ts`（实施前 message 断言失败，实施后通过）
  Source: design [GAP 分析](#gap-分析)；spec Requirement `会话列表查询校验返回确定字段级结果`

- [x] 2. 把 `packages/agent-channel-web/src/schemas/session-dto.ts` 的 `sessionListQuery` 中 `createdFrom`/`createdTo`/`offset`/`limit` 的 `pattern`/`minLength`/`maxLength` 移除，改为 `Type.Optional(Type.String())`；保留 `q` 的 `maxLength: WEB_QUERY_SEARCH_MAX_LENGTH` 与 `additionalProperties: false`；移除因此未使用的 `WEB_QUERY_TIMESTAMP_MAX_LENGTH`/`WEB_QUERY_OFFSET_MAX_LENGTH`/`WEB_QUERY_LIMIT_MAX_LENGTH` import（export 保留，仍被 memory-dto/conversation-query/annotation-dto 使用）。
  Validation: `npx tsc -b --pretty false`
  Source: design [FN-1.6 查询会话列表](#fn-16-查询会话列表) 步骤 1

- [x] 3. 在 `packages/agent-channel-web/src/routes/requests.ts` 中将 `parseSessionListQuery` 与 `parseCreatedRange` 的消息去掉 `session list ` 前缀（`offset must be a non-negative integer.`、`limit must be a positive integer.`、`search limit must not exceed 50.`、`limit must not exceed ${SESSION_LIST_MAX_LIMIT}.`、`createdFrom must be less than or equal to createdTo.`），并将 90 天消息改为 `created time range must not exceed 90 days.`。不动 `parseStrictInteger` 与 `parseQuestionSearchText`（`q`）。
  Validation: `npx vitest run --config vitest.config.channel-web.ts packages/agent-channel-web/tests/session-list-search-route.test.ts`
  Source: design [FN-1.6 查询会话列表](#fn-16-查询会话列表) 步骤 2

- [x] 4. 把 `packages/agent-channel-web/tests/schema-validation-boundary.test.ts` 中 `rejects createdFrom exceeding 16 chars`（`createdFrom=${OVER_13}` 期望 400）改为 `accepts over-length numeric createdFrom as a valid integer when paired with createdTo`（`createdFrom=${OVER_13}&createdTo=${OVER_13}` 期望 200），反映 `maxLength` 已移除。
  Validation: `npx vitest run --config vitest.config.channel-web.ts packages/agent-channel-web/tests/schema-validation-boundary.test.ts`
  Source: design [FN-1.6 查询会话列表](#fn-16-查询会话列表) 步骤 4

- [x] 5. 把 `docs/apis/openapi/paths/session.yaml` 的 `createdFrom`/`createdTo`/`offset`/`limit` 参数 schema 去掉 `pattern`/`minLength`/`maxLength`，description 注明 "Validation is enforced by the route parser."；`limit` description 的 normal list 上限由 `100` 修正为 `200`。保留 `q` 的 `maxLength: 50`。
  Validation: 人工核对 yaml 与 `docs/apis/agent-web-api-list.md` GET /api/v1/sessions 条目一致
  Source: design [FN-1.6 查询会话列表](#fn-16-查询会话列表) 步骤 3

- [x] 6. 整体验证：运行 channel-web 测试套件确认 session list 改动未影响其他路由，typecheck 干净，openspec 校验通过。
  Validation: `npx vitest run --config vitest.config.channel-web.ts packages/agent-channel-web/tests/session-list-search-route.test.ts packages/agent-channel-web/tests/schema-validation-boundary.test.ts packages/agent-channel-web/tests/schema-validation-constraints.test.ts`、`npx tsc -b --pretty false` 与 `openspec validate --all --strict`
  Source: design [验证策略](#验证策略)

- [x] 7. 补齐 `session-history-search` delta spec，固化精确字段级消息和合法整数串接受语义，并移除 `skip_specs` 例外。
  Validation: `openspec validate fix-session-list-validation --strict`
  Source: spec Requirement `会话列表查询校验返回确定字段级结果`
