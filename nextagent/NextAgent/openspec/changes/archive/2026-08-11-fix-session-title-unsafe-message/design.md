# Design: Distinguish session title unsafe-content messages by category and fix title validation error formatting

## 设计范围

- **FN-1.10 修改会话标题**（canonical spec: `session-title-update`）
  - 目标变化：unsafe title 校验失败消息按类别区分；title 缺失返回字段级消息；空 sessionId 路径段返回契约 404；前端 unsafe 错误展示改读后端 message。
  - 涉及 delta specs：`specs/session-title-update/spec.md`（ADDED Requirement，不 touch 既有 Requirement）。
  - 对应设计章节：[FN-1.10 修改方案](#fn-110-修改方案)。

## FN-1.10 修改方案

### 目标与规范依据

本 change 的目标有四：(1) 让 `SESSION_TITLE_UNSAFE_CONTENT` 按 XSS / secret 类别返回不同具体 message；(2) 让缺失 `title` 返回 `title is required.`；(3) 让空 sessionId 路径段返回契约 `{error:{code, message}}` 404；(4) 让前端 unsafe 错误展示后端具体 message。

`session-title-update` stable spec 的 "Manual title validation SHALL match current session-owner rules" Requirement（line 19-21）与 "Unsafe title is rejected after trimming" Scenario（line 40-42）要求：trimmed title 匹配 secret/XSS 模式即拒、不改标题。spec 只要求"拒绝"，未要求按类别给不同 message。本 change 新增 ADDED Requirement 细化该契约，不修改既有 Requirement。

### 当前实现

`validateTitle`（`packages/agent-session/src/services/session-preparation.ts:423-448`）在 trim 后检查：length>100 抛 `SESSION_TITLE_TOO_LONG`；length===0 抛 `SESSION_TITLE_TOO_SHORT`（`Session title must be 1-100 characters.`）；`containsXssPattern(title) || containsSecretPattern(title)` 抛 `SESSION_TITLE_UNSAFE_CONTENT`（`Session title contains unsafe content.`）。两个 helper（478-488 行）：`secretPattern=/(?:sk-|key-|token-|api[-_]?key|secret|password|credential)[=:]\s*\S/iu`、`xssPattern=/<[a-zA-Z/!]|javascript:|on\w+\s*=/iu`，模块私有未导出。

`PUT /sessions/:sessionId/title` 路由（`packages/agent-channel-web/src/routes/requests.ts:506-528`）无 preValidation、无手动 parser，body 校验完全依赖 Fastify `schema.body`，失败经全局 `formatFastifyValidationError`（约 1959 行）格式化。web channel 未注册 `setNotFoundHandler`。

前端 `Sidebar.tsx:110-123` 与 `SessionHistorySearchDialog.tsx:31-44` 的 `resolveRenameError` 靠 `error.code` 映射 i18n key，unsafe 映射到单 key `renameErrorUnsafe`，不读后端 message。

### GAP 分析

| 场景 | 期望 | 当前实现 | 差距根因 |
| --- | --- | --- | --- |
| title 含 XSS 模式 | 类别明确 message（HTML tags/javascript:/event handlers） | `Session title contains unsafe content.` | 抛出点把 XSS 与 secret 合并成一条 |
| title 含 secret 模式 | 类别明确 message（credentials/API keys/secrets） | 同上 | 同上 |
| sessionId 路径段为空 | `{error:{code:'NOT_FOUND', message:'Route not found.'}}` 404 | `{message,error,statusCode}` Fastify 默认 404 | web channel 无 `setNotFoundHandler`，`//` 折叠致路由不匹配 |
| title 字段缺失 | `title is required.` | `body is required.` | `required` 分支未读 `params.missingProperty`，`instancePath:''` 回退 `body` |
| （顺带）数组 minItems/maxItems | `... N items.` | `... undefined items.` | 分支读 `params.minItems`/`params.maxItems`，AJV 给 `params.limit` |
| （顺带）数组项超长 | `runIds must not exceed ...` | `runIds.0 must not exceed ...` | `field` 取完整 `instancePath` 泄露下标 |
| 前端 unsafe 展示 | 后端具体类别 message | 笼统 i18n `renameErrorUnsafe` | `resolveRenameError` 只认 code 映射 i18n，不读 `error.error` |

### 修改方案

1. **拆 unsafe message**（`session-preparation.ts:440-447`）：把 `if (containsXssPattern(title) || containsSecretPattern(title))` 拆成两个顺序 if，XSS 先（保留既有 `||` 短路顺序，双匹配时 XSS 优先确定）：
   - `containsXssPattern(title)` → `SESSION_TITLE_UNSAFE_CONTENT` + `Session title must not contain HTML tags, javascript: URLs, or event handlers.`
   - `containsSecretPattern(title)` → 同 code + `Session title must not contain credentials, API keys, or secrets.`
   两条均为静态文案，不含被拒绝 title 内容/子串（满足 spec "error SHALL NOT include the unsafe title content"）。保持单 code。pattern helper 不动。

2. **全局 formatter 三修**（`requests.ts` `formatFastifyValidationError`）：
   - `field`：`first.instancePath?.replace(/^\//,'').replace(/\//g,'.')` → `first.instancePath?.split('/')[1] || 'body'`（取首段去下标；`''` 回退 `body`）。
   - `required`：`${field} is required.` → `${first.params?.missingProperty ?? field} is required.`。
   - `minItems`/`maxItems`：`params?.minItems`/`params?.maxItems` → `params?.limit`。
   `maxLength`/`additionalProperties` 分支不动（前者已读 `params.limit`，后者用 `params.additionalProperty` 不依赖 `field`）。

3. **标准 not-found handler**（composition 层 + auth-local 格式标准化）：Fastify 5.10 的 root + 无 prefix 子作用域 not-found handler 不能共存（`four-oh-four.js` 的 `kCanSetNotFoundHandler` 机制：同 prefix `/` 下谁先注册谁占，第二个抛 `Not found handler already set`）。三个 profile 各靠不同插件注册 not-found handler，互斥：`LOCAL_CONFIGURED_AUTH` 走 auth-local、`WITH_FRONTEND` 走 frontend-hosting、`DEFAULT_WEB + NONE`（backend-only，dev:watch 默认 `localAuth.enabled=false`）原本无任何 handler → Fastify 默认 `{message,error,statusCode}`。

   修法两处：
   - `packages/agent-app/src/composition/create-app.ts` 加 `ensureBackendOnlyNotFoundHandler(app, selection)` helper，仅在 `channelAuthProfile === 'DEFAULT_WEB' && frontendHostingProfile === 'NONE'` 时注册 root `setNotFoundHandler` 返回 `{error:{code:'NOT_FOUND', message:'Route not found.'}}`；在 `runProductCompositionSync`/`runProductCompositionAsync` 的 `composeNextAgentApp` 之后（async 版在 `completeWithFrontendProductComposition` 之后）调用。backend-only 无其他 handler 不冲突；LOCAL/WITH_FRONTEND 跳过（走各自插件 handler）。
   - `packages/agent-channel-web-auth-local/src/index.ts:128-141` 已有 not-found handler 的两条 `{error:'Not Found'}` 标准化为 `{error:{code:'NOT_FOUND', message:'Route not found.'}}`（LOCAL profile 对齐契约；保护路径 auth challenge 逻辑不变）。

   code 用 `NOT_FOUND`，与 `agent-app-frontend-hosting/src/index.ts:47` 及 `requests.ts:975` 的 `safeError('NOT_FOUND', ...)` 一致；不用 `SESSION_NOT_FOUND`（路由没匹配，未做 session 查找）。`api-contract.ts` 不动。

4. **前端改读后端 message**（`Sidebar.tsx` 与 `SessionHistorySearchDialog.tsx` `resolveRenameError`）：`isApiError(error) && error.code === 'SESSION_TITLE_UNSAFE_CONTENT' && error.error` 时返回 `error.error`（后端 message，`ApiError.error` 字段即后端 message，见 `apiClient.ts:155`）；TOO_SHORT/TOO_LONG 保留 i18n 映射（其 i18n 文案比后端 message 更本地化）；`renameErrorUnsafe` i18n key 保留作兜底。两个组件的 `resolveRenameError` 同步改（同一技术债，两入口一致）。

**必须保留的现有路径**：`updateTitleBody` schema（`minLength:1`/`maxLength:100`）、`sessionParams`（`minLength:1`）、`SESSION_TITLE_TOO_SHORT`/`SESSION_TITLE_TOO_LONG` message 与 code、`titleSource="manual"` 语义、owner-scope 校验、`pattern` helper 正则、HTTP 400/404 状态码、`REQUEST_VALIDATION_FAILED`/`SESSION_TITLE_UNSAFE_CONTENT` code。

**明确不修改的边界**：`formatMemoryErrors`、conversation-preview 手动 parser、其他路由 parser；`docs/apis/validation-error-message-analysis.md` 的 feature 前缀风格其他行（既有 aspirational 目标，不扩范围）；active change `refine-session-title-and-search-validation`。

### 与 refine-session-title-and-search-validation 的重叠分析

active change `refine-session-title-and-search-validation` 处于 active 且 archive-blocked（其 design.md:79-83：阻塞原因是 stable `session-title-update` 中找不到其 `## MODIFIED Requirements` → "Title Content Validation"）。其 delta 的 "Title contains prohibited content patterns" Scenario 已要求 "error SHALL NOT include the unsafe title content"，但未要求按类别给不同 message。

本 change 用 **`## ADDED Requirements`** 新增 "Unsafe title content SHALL report a category-specific safe message"，Requirement 标题唯一，不 touch 既有 "Manual title validation SHALL match current session-owner rules"，也不 touch active change 的 "Title Content Validation"（MODIFIED）。`openspec validate --all --strict` 对两 change 独立通过。本 change 的 "SHALL NOT include the unsafe title content" Scenario 与 active change 的等价条款相互强化，不冲突。两 change 未来归档时，stable spec 同时获得（a）active change 的 "Title Content Validation"（其修好 MODIFIED→ADDED/REMOVED 后）与（b）本 change 的 "category-specific safe message"，两个独立 Requirement 共存。

### 质量属性影响

可维护性：unsafe 消息按类别区分，调用方可据 message 定位问题类型；错误格式对齐契约。安全：unsafe message 不含被拒绝内容（spec 要求，并由测试钉死）。可测试性：业务层与 web 层测试可断言精确 message 文案与 404 契约格式。无新增黑盒质量目标。

## 长期基线刷新计划

- stable spec：归档时将 ADDED Requirement "Unsafe title content SHALL report a category-specific safe message" 合并至 `openspec/specs/session-title-update/spec.md`。
- Function 文档：无（FN-1.10 规格表未列 message 文案）。
- Feature 文档：无。
- overview / architecture / modules / ADR / spec-to-design-map：无。

## 验证策略

- spec 行为（unsafe 按类别拒、缺失字段拒、空 sessionId 404）：由 `tests/agent-kernel/local-gateway-contract.test.ts`（业务层 unsafe）与 `packages/agent-channel-web/tests/schema-validation-constraints.test.ts`（web 层缺失/空 sessionId/empty title）覆盖，断言 code 与精确 message。
- 不泄露断言：unsafe message 不含被拒绝 title 子串（`alert(1)`/`abc123`）。
- 全局回归：channel-web 全量测试确认 formatter 修复不破坏其他路由（`conversation-preview-route.test.ts` 的 `limit is required.`、`memory-routes.test.ts` 的 `queryText...` 不走本函数）。
- 精确测试文件与命令见 tasks。
