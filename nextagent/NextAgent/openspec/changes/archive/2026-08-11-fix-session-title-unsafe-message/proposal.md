# Distinguish session title unsafe-content messages by category and fix title validation error formatting

## Background

`PUT /api/v1/sessions/:sessionId/title`（修改会话标题）链路存在四个用户可感知的错误消息缺陷，实测与权威 API 文档 `docs/apis/agent-web-api-list.md` 不符：

1. **`SESSION_TITLE_UNSAFE_CONTENT` 消息笼统**：`packages/agent-session/src/services/session-preparation.ts` 的 `validateTitle`（约 440-447 行）用单个 `if (containsXssPattern(title) || containsSecretPattern(title))` 抛一条 `Session title contains unsafe content.`，把 XSS（`<script>`、`javascript:`、`onerror=`）和 secret（`api_key=`、`password:`、`sk-`）两类完全不同的安全风险混成同一条 message，调用方与用户分不清是哪类问题。两个 pattern helper（`containsXssPattern`/`containsSecretPattern`，478-488 行）已能区分两类，但抛出点把它们合并了。

2. **空 sessionId 路径段返回非契约 404 格式**：`PUT /api/v1/sessions//title`（sessionId 段为空）时，Fastify 将 `//` 折叠为 `/`，请求不匹配任何已注册路由，Fastify 默认 404 handler 返回 `{message, error, statusCode}`（如 `{"message":"Route PUT:/api/v1/sessions/title not found","error":"Not Found","statusCode":404}`），不符合接口 `{error:{code, message}}` 契约，且泄露内部路由名。`sessionParams`（`packages/agent-channel-web/src/schemas/api-contract.ts:21`，`minLength: 1`）因路由不匹配而走不到。web channel 未注册 `setNotFoundHandler`。

3. **缺失 title 字段返回 `body is required.`**：全局 `formatFastifyValidationError`（`packages/agent-channel-web/src/routes/requests.ts` 约 1959 行）`required` 分支只用 AJV error 的 `instancePath`，而 AJV 对缺失顶层 body 属性给 `instancePath: ''`，回退成笼统 `body is required.`，无法指明缺失字段是 `title`。文档要求 `title is required.`。同函数的 `minItems`/`maxItems` 分支读错 params 键名（`params.minItems`/`params.maxItems`，AJV 实际给 `params.limit`）导致 `undefined items`，`field` 取完整 `instancePath` 导致数组项错误泄露下标（`runIds.0`）。

4. **API 文档表 `safe message` 占位**：`docs/apis/agent-web-api-list.md:546/547` 的 `SESSION_TITLE_TOO_SHORT`/`SESSION_TITLE_UNSAFE_CONTENT` 行写 `safe message` 占位，未写实际 message 文本；545 行 `REQUEST_VALIDATION_FAILED` 未显式列 `must not be empty.`。

**前端关键约束**：`frontend/agent-web/src/features/sidebar/components/Sidebar.tsx` 与 `SessionHistorySearchDialog.tsx` 的 `resolveRenameError` 靠 `error.code` 映射到单个 i18n key `renameErrorUnsafe`（`会话标题包含不安全的内容。`），不读后端 message。所以只拆后端 message，前端用户看到的仍是笼统文案。本 change 一并让前端 unsafe 分支改读后端 `error.message`。

## Goals / Non-Goals

**目标：**

- `SESSION_TITLE_UNSAFE_CONTENT` 保持单 code，按命中类别（XSS / secret）返回不同具体 message，不含被拒绝的标题内容/子串。
- 全局 `formatFastifyValidationError` 三处修复：`required` 读 `params.missingProperty`；`minItems`/`maxItems` 读 `params.limit`；`field` 取 `instancePath` 首段去数组下标。使缺失 `title` 返回 `title is required.`。
- web channel 注册标准 `setNotFoundHandler`（WeakSet 守卫只注册一次），未匹配路由返回 `{error:{code:'NOT_FOUND', message:'Route not found.'}}` 404。
- 前端 `resolveRenameError` unsafe 分支改读后端 `error.message`，TOO_SHORT/TOO_LONG 保留 i18n。
- API 文档表补具体 message、补 404 `NOT_FOUND` 行、补 `must not be empty.`。
- 在 `session-title-update` stable spec 新增 ADDED Requirement 要求 unsafe 按类别给 message 且不含 unsafe 内容。

**非目标：**

- 不拆 `SESSION_TITLE_UNSAFE_CONTENT` 为两个 code（保持单 code，只拆 message）。
- 不改 `share-dto.ts`/share 路由/`api-contract.ts` schema/`containsXssPattern`/`containsSecretPattern` 正则。
- 不改 `formatMemoryErrors`、conversation-preview 手动 parser、其他路由 parser。
- 不并入 active change `refine-session-title-and-search-validation`，不 touch 其 `## MODIFIED Requirements` → "Title Content Validation"，不 touch stable spec 既有 "Manual title validation SHALL match current session-owner rules" Requirement。
- 不为路由级 not-found 加 spec delta（Fastify 路由折叠是传输层边界，非核心业务契约；仅 impl + 文档覆盖）。
- 不改变 HTTP 状态码、不引入新 SafeError code、不改变成功响应 schema。

## What Changes

- `packages/agent-session/src/services/session-preparation.ts` `validateTitle`：单个合并 `if` 拆成两个顺序检查，XSS 先（双匹配时 XSS 优先），各抛同 code 不同 message。
- `packages/agent-channel-web/src/routes/requests.ts` `formatFastifyValidationError`：三处定点修（`field` 取首段 / `required` 读 `missingProperty` / `minItems`+`maxItems` 读 `limit`）。
- `packages/agent-app/src/composition/create-app.ts`：加 `ensureBackendOnlyNotFoundHandler` helper，仅在 backend-only（`DEFAULT_WEB + NONE`）profile 注册 root `setNotFoundHandler` 返回标准 `{error:{code, message}}` 404；在 `runProductCompositionSync`/`runProductCompositionAsync` 调用。
- `packages/agent-channel-web-auth-local/src/index.ts`：已有 not-found handler 的 `{error:'Not Found'}` 标准化为 `{error:{code:'NOT_FOUND', message:'Route not found.'}}`（LOCAL profile 对齐契约）。
- `frontend/agent-web/src/features/sidebar/components/Sidebar.tsx` 与 `SessionHistorySearchDialog.tsx` `resolveRenameError`：unsafe 分支优先返回 `error.error`（后端 message）。
- `docs/apis/agent-web-api-list.md`：Error responses 表补具体 message、加 404 `NOT_FOUND` 行、补 `must not be empty.`、规则说明点明按类别区分。
- `docs/apis/validation-error-message-analysis.md`：1.3 节 title 两行去掉 `session update ` 前缀对齐实现。
- `docs/apis/validation-checklist.md`：1.3 节加空 sessionId 路径段返回 404 的注。
- `openspec/changes/fix-session-title-unsafe-message/specs/session-title-update/spec.md`：ADDED Requirement "Unsafe title content SHALL report a category-specific safe message"。

本 change 不包含破坏性公共契约变更；HTTP 状态码与 `SESSION_TITLE_UNSAFE_CONTENT` code 不变，仅 message 文本细化与错误格式对齐契约。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-1.10 修改会话标题` → `specs/session-title-update/spec.md`
  - 功能边界：unsafe title 校验失败消息按类别（XSS/secret）区分且不含被拒绝内容；title 缺失返回字段级 `title is required.`；空 sessionId 路径段返回契约 404。
  - 系统质量属性：可维护性、可测试性、安全（不泄露 unsafe 内容）。
  - 映射说明：`session-title-update` 是 canonical spec；本 change 新增 ADDED Requirement 细化 unsafe message 契约，不 touch 既有 Requirement。

## 影响范围（Impact）

- API 调用方：unsafe title 失败时收到按类别区分的具体 message，可直接定位是 XSS 还是 secret 类问题；缺失字段返回字段级 `<field> is required.`；未匹配路由返回契约 404 格式。
- 前端用户：重命名弹窗传 unsafe title 时显示后端具体类别 message，而非笼统 i18n 文案。
- 所有走全局 `formatFastifyValidationError` 的路由：缺失顶层 body 字段返回 `<field> is required.`；`minItems`/`maxItems` 消息数值正确；数组项校验消息不再泄露下标。HTTP 状态码与 `REQUEST_VALIDATION_FAILED` code 不变。
- 主要受影响范围为 `agent-session`（title 校验）、`agent-channel-web`（全局 formatter + not-found handler）、`frontend/agent-web`（rename 错误展示）、API 文档与 `session-title-update` spec。不触及 runtime、gateway、stream、context。
