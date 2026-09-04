# Tasks

## FN-1.10 修改会话标题

- [x] 1. 测试先行：在 `tests/agent-kernel/local-gateway-contract.test.ts` 中把 "rejects title containing HTML tags" 的断言由 `.rejects.toThrow('unsafe content')` 改为 `.rejects.toMatchObject({ code: 'SESSION_TITLE_UNSAFE_CONTENT', message: expect.stringContaining('HTML tags') })`；新增 secret 模式用例（`api_key=abc123` → message 含 `credentials`）与"不泄露被拒绝内容"用例（XSS/secret 两条 message 均不含 `alert(1)`/`abc123`）。实施前运行确认旧 `'unsafe content'` 断言失败以复现缺陷。
  Validation: `npx vitest run --config vitest.config.ts tests/agent-kernel/local-gateway-contract.test.ts`
  Source: design [GAP 分析](#gap-分析)；spec `session-title-update` 新增 Requirement "Unsafe title content SHALL report a category-specific safe message"

- [x] 2. 在 `packages/agent-session/src/services/session-preparation.ts` 的 `validateTitle` 中把 `if (containsXssPattern(title) || containsSecretPattern(title))` 拆成两个顺序 if（XSS 先），各抛 `SESSION_TITLE_UNSAFE_CONTENT` 不同 message：XSS → `Session title must not contain HTML tags, javascript: URLs, or event handlers.`；secret → `Session title must not contain credentials, API keys, or secrets.`。pattern helper（478-488 行）不动。
  Validation: `npx vitest run --config vitest.config.ts tests/agent-kernel/local-gateway-contract.test.ts`
  Source: design [修改方案](#fn-110-修改方案) 步骤 1

- [x] 3. 在 `packages/agent-channel-web/src/routes/requests.ts` 的 `formatFastifyValidationError` 三处定点改：(a) `field` 取 `first.instancePath?.split('/')[1] || 'body'`；(b) `required` 分支读 `first.params?.missingProperty ?? field`；(c) `minItems`/`maxItems` 读 `first.params?.limit`。`maxLength`/`additionalProperties` 不动。
  Validation: `npx tsc -b --pretty false`
  Source: design [修改方案](#fn-110-修改方案) 步骤 2

- [x] 4. not-found 契约：在 `packages/agent-app/src/composition/create-app.ts` 加 `ensureBackendOnlyNotFoundHandler(app, selection)` helper，仅在 `DEFAULT_WEB + NONE` profile 注册 root `setNotFoundHandler` 返回 `{error:{code:'NOT_FOUND', message:'Route not found.'}}`，在 `runProductCompositionSync`/`runProductCompositionAsync` 调用；并标准化 `packages/agent-channel-web-auth-local/src/index.ts:128-141` 已有 handler 的两条 `{error:'Not Found'}` 为标准格式。Fastify 5.10 root + 无 prefix 子作用域 handler 不能共存，故只在 backend-only profile 注册 root handler，LOCAL/WITH_FRONTEND 走各自插件 handler。
  Validation: `npx vitest run --config vitest.config.release.ts tests/agent-kernel/web-not-found-contract.test.ts tests/agent-kernel/local-configured-auth.test.ts tests/fullstack-packaging-boundary.test.ts`
  Source: design [修改方案](#fn-110-修改方案) 步骤 3

- [x] 5. 在 `packages/agent-channel-web/tests/schema-validation-constraints.test.ts` 的 5.B.1 块扩展 empty title 用例（加 `error.message === 'title must not be empty.'`），新增"缺失 title 字段 → `title is required.`"与"空 sessionId 路径段 → 404 `NOT_FOUND` / `Route not found.`"用例。
  Validation: `npx vitest run --config vitest.config.channel-web.ts packages/agent-channel-web/tests/schema-validation-constraints.test.ts`
  Source: design [GAP 分析](#gap-分析)

- [x] 6. 在 `frontend/agent-web/src/features/sidebar/components/Sidebar.tsx` 与 `SessionHistorySearchDialog.tsx` 的 `resolveRenameError` 中，unsafe 分支优先返回 `error.error`（后端 message），TOO_SHORT/TOO_LONG 保留 i18n。
  Validation: `npx vitest run`（agent-web 前端测试）+ 手动验证重命名弹窗传 unsafe title 显示后端具体 message
  Source: design [修改方案](#fn-110-修改方案) 步骤 4

- [x] 7. 改 `docs/apis/agent-web-api-list.md` PUT /title 的 Error responses 表：`SESSION_TITLE_TOO_SHORT`/`SESSION_TITLE_UNSAFE_CONTENT` 行 `safe message` 替换为具体 message（unsafe 列两条类别 message）；545 行补 `{field} must not be empty.`；新增 404 `NOT_FOUND` / `Route not found.` 行；`SESSION_NOT_FOUND` 行补 `Session was not found.`；规则说明点明按类别区分。改 `docs/apis/validation-error-message-analysis.md` 1.3 节 title 两行去掉 `session update ` 前缀。改 `docs/apis/validation-checklist.md` 1.3 节加空 sessionId 路径段返回 404 的注。
  Validation: 人工核对与实现消息一致
  Source: design [修改方案](#fn-110-修改方案)

- [x] 8. 新建 `openspec/changes/fix-session-title-unsafe-message/`（proposal/design/tasks/.openspec.yaml + `specs/session-title-update/spec.md` ADDED Requirement），不 touch 既有 Requirement 与 active change 的 MODIFIED Requirement。
  Validation: `npx openspec validate --all --strict`
  Source: design [与 refine-session-title-and-search-validation 的重叠分析](#与-refine-session-title-and-search-validation-的重叠分析)

- [x] 9. 整体验证：channel-web 全量 + agent-kernel + typecheck + openspec，确认无回归。
  Validation: `npx vitest run --config vitest.config.channel-web.ts`、`npx vitest run --config vitest.config.ts tests/agent-kernel/local-gateway-contract.test.ts`、`npx tsc -b --pretty false`、`npx openspec validate --all --strict`
  Source: design [验证策略](#验证策略)
