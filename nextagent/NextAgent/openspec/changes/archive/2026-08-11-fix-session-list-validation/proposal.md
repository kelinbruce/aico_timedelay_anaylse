# Align Session List Validation Errors With API Documentation

## Background

`GET /api/v1/sessions` 的权威接口契约由 `docs/apis/agent-web-api-list.md` 维护，该文档是 agent-web channel 对外接口的权威文档。该文档对 session list 的 query 参数校验失败消息有明确约定：

- `createdFrom`/`createdTo` 配对与范围：`createdFrom and createdTo must be provided together.` / `createdFrom must be an integer.` / `createdTo must be an integer.` / `createdFrom must be less than or equal to createdTo.` / `created time range must not exceed 90 days.`
- `offset`：`offset must be an integer.` / `offset must be a finite safe integer.` / `offset must be a non-negative integer.`
- `limit`：`limit must be an integer.` / `limit must be a finite safe integer.` / `limit must be a positive integer.` / `search limit must not exceed 50.`

当前实现返回的消息与上述权威文档不一致，API 调用方无法据消息定位失败参数：

1. **`createTo < createFrom` 时返回带前缀消息**：`session list createdFrom must be less than or equal to createdTo.`，文档为 `createdFrom must be less than or equal to createdTo.`。
2. **`createTo - createdFrom` 达到 90 天时返回错误文案**：`to - from = 7,776,000,000` ms（90 整天，超过 `7,775,999,999` ms 即 90 天减 1 ms 上限）时返回 `session list createdFrom/createdTo range must not exceed 90 days.`，文档为 `created time range must not exceed 90 days.`。
3. **`createTo` 为非法值时返回 schema 级消息**：非整数串（如 `abc`）被 `sessionListQuery` 的 `pattern: '^-?\d+$'` 在 AJV 层拦截，返回 `createdTo format is invalid.`，文档为 `createdTo must be an integer.`。
4. **`offset = -1` 时返回 schema 级消息**：负号被 `offset` 的 `pattern: '^\d+$'` 拒绝，返回 `offset format is invalid.`，文档为 `offset must be a non-negative integer.`。

根因与 conversation preview 路由（`fix-conversation-preview-validation` 已在独立分支修复）同类：`sessionListQuery` 的 `createdFrom`/`createdTo`/`offset`/`limit` 声明了 `pattern`/`minLength`/`maxLength`，使非数字、负数、越界值在 AJV 层被拦截并产出文档未定义的 `format is invalid.` / `must not exceed N characters.` 消息，绕过了路由 parser；parser 消息又带 `session list ` 前缀，与文档列出的无前缀消息不一致。

`session-list` 相关 stable spec 已要求非法 query 参数返回 validation error（HTTP 400），HTTP 状态码现状已满足；本 change 不改变状态码契约，只让错误消息体对齐权威文档。

## Goals / Non-Goals

**目标：**

- 让 session list 路由所有校验失败场景返回的错误消息严格匹配 `docs/apis/agent-web-api-list.md` 的约定消息，使 API 调用方能据消息定位失败参数。
- `createdFrom`/`createdTo`/`offset`/`limit` 的 `pattern`/`minLength`/`maxLength` 移除，使缺失、非数字、负数、越界值都到达 `parseSessionListQuery`/`parseCreatedRange`/`parseStrictInteger` 并产出文档约定的字段级消息。
- parser 消息去掉 `session list ` 前缀；90 天消息改为 `created time range must not exceed 90 days.`。

**非目标：**

- 不改写既有 stable Requirement；本 change 以新增 delta Requirement 固化精确校验消息和整数串接受语义。
- 不修复其他接口的同类消息问题（conversation、conversation preview、favorites/annotations 等接口的 pattern 拦截或前缀消息）。其中 conversation preview 已由 `fix-conversation-preview-validation` 在独立分支修复；其余接口的报错对齐留待后续 change。
- 不修改全局 `formatFastifyValidationError`（全局函数被所有路由共用，修改它超出本 change 范围）。
- 不改变 session list 接口的成功响应 schema、字段、分页语义、owner/agent scope 边界、`SESSION_LIST_MAX_LIMIT`(200)/`SESSION_SEARCH_MAX_LIMIT`(50)/`MAX_SESSION_CREATED_RANGE_MS`(90 天减 1 ms) 上限。
- 不引入新的 SafeError code、不改变 HTTP 状态码映射、不改变 stream/timeline/runtime 行为。
- 不修改 `q` 的校验：`q` 的 `maxLength: 50` 保留（文档列出 schema 级 `q must not exceed 50 characters.`）；`q` 的 parser 消息 `session list q must not exceed 50 Unicode code points.` 与文档 `q length is invalid.` 的对齐涉及 `q` 校验结构重设计，超出本 change 范围，留待后续 change。

## What Changes

- `sessionListQuery` 的 `createdFrom`/`createdTo`/`offset`/`limit` 移除 `pattern`/`minLength`/`maxLength`，改为 `Type.Optional(Type.String())`；`q` 保持 `maxLength: WEB_QUERY_SEARCH_MAX_LENGTH`(50)。所有数字与必填校验下沉到路由 parser。
- `parseSessionListQuery` 与 `parseCreatedRange` 的消息去掉 `session list ` 前缀：`offset must be a non-negative integer.`、`limit must be a positive integer.`、`search limit must not exceed 50.`、`limit must not exceed 200.`、`createdFrom must be less than or equal to createdTo.`；90 天消息改为 `created time range must not exceed 90 days.`。`parseStrictInteger` 产出的 `{name} is required.` / `{name} must be an integer.` / `{name} must be a finite safe integer.` 已与文档一致，不变。`parseQuestionSearchText`（`q`）不动。
- 移除因此未使用的 `WEB_QUERY_TIMESTAMP_MAX_LENGTH`/`WEB_QUERY_OFFSET_MAX_LENGTH`/`WEB_QUERY_LIMIT_MAX_LENGTH` import（其 export 仍被 `memory-dto`/`conversation-query`/`annotation-dto` 使用，保留 export）。
- `docs/apis/openapi/paths/session.yaml` 的 `createdFrom`/`createdTo`/`offset`/`limit` 参数去掉 `pattern`/`minLength`/`maxLength`，description 注明校验由路由 parser 强制；`limit` description 的 normal list 上限由错误的 `100` 修正为 `200`（与 `SESSION_LIST_MAX_LIMIT` 及 API 文档一致）。
- 行为变更：移除 `pattern` 后，前导零正整数（如 `limit=01`）与超长数字串（如 14 位 `createdFrom`，配对 `createdTo` 且范围合法时）不再被 schema 拒绝，经 parser 解析为合法整数返回 200；这些值是合法 integer string，符合文档语义，spec 只要求非法值返回校验错误，前导零正整数与超长合法整数不在拒绝范围内。

本 change 不包含破坏性公共契约变更。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-1.6 查询会话列表` → `specs/session-history-search/spec.md`
  - 功能边界：session list 路由 query 参数校验失败消息对齐权威 API 文档；`limit=01` 与较长但安全的时间整数串按整数语义接受。
  - 系统质量属性：可维护性、可测试性。
  - 映射说明：delta Requirement 固化调用方可观察的精确消息及合法整数串接受语义。

## 影响范围（Impact）

- API 调用方：session list 校验失败时收到与 `docs/apis/agent-web-api-list.md` 一致的字段级消息，可直接定位缺失或非法的 `createdFrom`/`createdTo`/`offset`/`limit` 参数；`limit=01` 等前导零正整数请求返回 200 而非 400。
- Agent 开发者与平台集成方：无需修改公共 API 调用代码；HTTP 状态码与成功响应 schema 不变。
- 运维人员：校验失败仍为 HTTP 400 + `REQUEST_VALIDATION_FAILED`，不暴露内部 stack 或额外诊断字段。
- 主要受影响范围为 `agent-channel-web` 的 session list 路由、其 querystring schema、session list 路由测试与 `session.yaml` OpenAPI；不触及 runtime、session、gateway、stream、context 或前端。
