# Tasks

## FN-1.14 创建分享链接

- [x] 1. 测试先行：在 `packages/agent-channel-web/tests/share-routes.test.ts` 中为 share 路由补充校验失败的消息断言，覆盖 `runIds` 缺失（`runIds is required.`）、空数组（`runIds must contain at least 1 item(s).`）、>100 项（`runIds must not exceed 100 items.`）、单项 >256 字符（`runIds must not exceed 256 characters.`），断言 `error.code === 'REQUEST_VALIDATION_FAILED'` 与 `error.message`。实施前运行确认缺失/超长/超量用例失败以复现缺陷。
  Validation: `npx vitest run --config vitest.config.channel-web.ts packages/agent-channel-web/tests/share-routes.test.ts`（实施前 negative 消息用例失败，实施后全部通过）
  Source: design [GAP 分析](#gap-分析)；spec Requirement `分享创建校验返回确定字段级结果`

- [x] 2. 在 `packages/agent-channel-web/src/routes/requests.ts` 的 `formatFastifyValidationError` 中三处定点修改：(a) `field` 由 `first.instancePath?.replace(/^\//, '').replace(/\//g, '.')` 改为 `first.instancePath?.split('/')[1] || 'body'`，取首段去数组下标；(b) `required` 分支由 `${field} is required.` 改为 `${first.params?.missingProperty ?? field} is required.`；(c) `minItems`/`maxItems` 分支由 `params?.minItems`/`params?.maxItems` 改为 `params?.limit`。`maxLength` 与 `additionalProperties` 分支不动。
  Validation: `npx tsc -b --pretty false`
  Source: design [FN-1.14 创建分享链接](#fn-114-创建分享链接) 步骤 1、2、3

- [x] 3. 把 `docs/apis/validation-checklist.md:277` 的 `runIds[]` 行消息由 `runIds.0 must not be empty. / runIds.0 must not exceed 256 characters.` 改为 `runIds must not be empty. / runIds must not exceed 256 characters.`，去掉数组下标 `.0`。
  Validation: 人工核对与修复后实现消息一致
  Source: design [FN-1.14 创建分享链接](#fn-114-创建分享链接) 步骤 1

- [x] 4. 整体验证：运行 channel-web 测试套件确认 share 改动未影响其他路由（特别是 `conversation-preview-route.test.ts` 的 `limit is required.` 与 `memory-routes.test.ts` 的 `queryText must not exceed 128 characters.` 仍绿，二者不走 `formatFastifyValidationError`），并确认 typecheck 干净。
  Validation: `npx vitest run --config vitest.config.channel-web.ts` 与 `npx tsc -b --pretty false`
  Source: design [验证策略](#验证策略)

- [x] 5. 补齐 `conversation-share` delta spec，固化四种 `runIds` 字段级校验消息，并移除 `skip_specs` 例外。
  Validation: `openspec validate fix-share-validation-error-messages --strict`
  Source: spec Requirement `分享创建校验返回确定字段级结果`
