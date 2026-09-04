# Design: Align Session List Validation Errors With API Documentation

## 设计范围

| Function | Canonical spec | 目标变化 | Delta Requirement |
| --- | --- | --- | --- |
| `FN-1.6 查询会话列表` | `session-history-search` | query 校验返回确定字段级消息，并按整数语义接受合法数字串 | `会话列表查询校验返回确定字段级结果` |

## FN-1.6 查询会话列表

### 目标与规范依据

本 change 的目标是让 `GET /api/v1/sessions` 的 query 参数校验失败消息与权威 API 文档严格一致，使 API 调用方能据消息定位失败参数。

session list 相关 stable spec 已要求非法 query 参数返回 validation error（HTTP 400）。

**本 Function 的目标 Requirements**：canonical spec 为 `session-history-search`。

- `ADDED`：`会话列表查询校验返回确定字段级结果`

### 当前实现

session list 路由的 querystring schema（`sessionListQuery`）对 `createdFrom`/`createdTo` 声明 `pattern: '^-?\d+$'` + `minLength: 1` + `maxLength: 13`，对 `offset` 声明 `pattern: '^\d+$'` + `minLength: 1` + `maxLength: 7`，对 `limit` 声明 `pattern: '^[1-9]\d*$'` + `minLength: 1` + `maxLength: 3`，对 `q` 声明 `maxLength: 50`，对象为 `additionalProperties: false`。

路由 handler 调用 `parseSessionListQuery`：用 `parseStrictInteger` 解析 `offset`/`limit`（产出 `{name} is required.` / `{name} must be an integer.` / `{name} must be a finite safe integer.`），再产出 `session list offset must be a non-negative integer.`、`session list limit must be a positive integer.`、`session list search limit must not exceed 50.`、`session list limit must not exceed 200.`；`createdFrom`/`createdTo` 仅在两者同时提供时交给 `parseCreatedRange`，产出 `session list createdFrom must be less than or equal to createdTo.` 与 `session list createdFrom/createdTo range must not exceed 90 days.`。`q` 由 `parseQuestionSearchText` 处理，产出 `session list q must not exceed 50 Unicode code points.`。

Fastify schema 校验失败经全局 `formatFastifyValidationError` 处理：`pattern` 失败映射为 `{field} format is invalid.`；`maxLength` 失败映射为 `{field} must not exceed {n} characters.`；`additionalProperties` 失败映射为 `Field '{name}' is not allowed.`。

### GAP 分析

| 场景 | 权威文档要求 | 当前实现返回 | 差距根因 |
| --- | --- | --- | --- |
| `createdTo < createdFrom` | `createdFrom must be less than or equal to createdTo.` | `session list createdFrom must be less than or equal to createdTo.` | parser 消息带 `session list ` 前缀 |
| `createdTo - createdFrom = 90 天`（7,776,000,000 ms） | `created time range must not exceed 90 days.` | `session list createdFrom/createdTo range must not exceed 90 days.` | parser 消息文案与文档不一致（前缀 + 文案） |
| `createdTo` 非整数串 | `createdTo must be an integer.` | `createdTo format is invalid.` | schema `pattern` 在 AJV 层拦截，绕过 parser |
| `offset = -1` | `offset must be a non-negative integer.` | `offset format is invalid.` | schema `pattern: '^\d+$'` 拒绝负号，AJV 层拦截 |
| `offset`/`limit` 非数字 | `{field} must be an integer.` | `{field} format is invalid.` | 同上，pattern 拦截 |
| 超长数字串（如 14 位 `createdFrom`） | 文档无长度上限，合法 safe integer 应通过 | `createdFrom must not exceed 13 characters.` | schema `maxLength` 拦截 |
| `limit` 消息前缀 | 文档列出无前缀消息 | parser 消息带 `session list ` 前缀 | parser 消息文案与文档不一致 |

### 修改方案

采用"校验下沉到 parser"方案，只作用于 session list 路由，不修改全局格式化函数（全局函数被所有路由共用，修改它超出本 change 范围），与 `fix-conversation-preview-validation` 同形同策。

1. **schema 下沉**：`sessionListQuery` 的 `createdFrom`/`createdTo`/`offset`/`limit` 移除 `pattern`/`minLength`/`maxLength`，改为 `Type.Optional(Type.String())`。缺失、非数字、负数、越界值都到达 `parseSessionListQuery`/`parseCreatedRange`/`parseStrictInteger`，产出文档约定的字段级消息。`q` 保留 `maxLength: 50`（文档列出 schema 级 `q must not exceed 50 characters.`）。保留 `additionalProperties: false`（额外参数返回 `Field '{name}' is not allowed.`，与文档一致）。
2. **parser 消息去前缀与改文案**：
   - `session list offset must be a non-negative integer.` → `offset must be a non-negative integer.`
   - `session list limit must be a positive integer.` → `limit must be a positive integer.`
   - `session list search limit must not exceed 50.` → `search limit must not exceed 50.`
   - `session list limit must not exceed ${SESSION_LIST_MAX_LIMIT}.` → `limit must not exceed ${SESSION_LIST_MAX_LIMIT}.`
   - `session list createdFrom must be less than or equal to createdTo.` → `createdFrom must be less than or equal to createdTo.`
   - `session list createdFrom/createdTo range must not exceed 90 days.` → `created time range must not exceed 90 days.`
   - `parseStrictInteger` 产出的 `{name} is required.` / `{name} must be an integer.` / `{name} must be a finite safe integer.` 已与文档一致，不变。`parseQuestionSearchText`（`q`）不动（见非目标）。
3. **OpenAPI 同步**：`docs/apis/openapi/paths/session.yaml` 的 `createdFrom`/`createdTo`/`offset`/`limit` 参数去掉 `pattern`/`minLength`/`maxLength`，description 注明 "Validation is enforced by the route parser."；`limit` description 的 normal list 上限由错误的 `100` 修正为 `200`（与 `SESSION_LIST_MAX_LIMIT` 及 API 文档一致）。
4. **行为变更**：移除 `pattern` 后，`limit=01`（前导零正整数）不再被 schema 拒绝，经 `parseStrictInteger` 解析为整数 `1` 返回 200；14 位 `createdFrom`（配对 `createdTo` 且范围合法时）不再被 `maxLength` 拒绝，作为合法 safe integer 返回 200。这些值是合法 integer string，符合文档语义；spec 只要求非法值返回校验错误，前导零正整数与超长合法整数不在拒绝范围内。

**未选择方案**：修复全局 `formatFastifyValidationError` 的 `required`/`pattern` 分支可一并解决所有路由的 `body is required.` / `format is invalid.` 问题，但影响所有接口，超出本 change"只修 session list"的范围，留待后续 change。

**必须保留的现有路径**：`MAX_SESSION_CREATED_RANGE_MS`（90 天减 1 ms = 7,775,999,999）、`SESSION_LIST_MAX_LIMIT`(200)、`SESSION_SEARCH_MAX_LIMIT`(50)、`SESSION_LIST_DEFAULT_LIMIT`(50)、`SESSION_SEARCH_DEFAULT_LIMIT`(20)、成功响应 schema 与字段、`offset` 默认 0 语义、owner/agent scope 边界、HTTP 状态码映射、`REQUEST_VALIDATION_FAILED` code、`additionalProperties: false`。

**明确不修改的边界**：`conversationQuery`/`conversationPreviewQuery`（`/conversation`、`/conversation/preview` 接口）、`annotation-dto`/`memory-dto` 等其他接口的 schema 与 parser 不动；全局 `formatFastifyValidationError` 不动；`parseStrictInteger` 被 all 接口共用，不动；`parseQuestionSearchText`（`q`）不动。

### 质量属性影响

可维护性：session list 校验消息与权威文档一致，减少调用方与文档对照成本；与 `fix-conversation-preview-validation` 同形同策，保持同类接口同一校验下沉原则。可测试性：session list 路由测试可断言精确消息文案。无新增黑盒质量目标。

## 长期基线刷新计划

- stable spec：归档时把 `会话列表查询校验返回确定字段级结果` 合并到 `session-history-search`。
- Function 文档：归档时同步 FN-1.6 的处理过程与结果，记录字段级校验结果和整数串接受语义。
- Feature 文档：无。
- overview：无。
- architecture：无。
- modules：无。
- ADR：无。
- spec-to-design-map：无。

## 验证策略

- spec 行为（`createdTo < createdFrom`、90 天范围、`createdTo` 非整数、`offset = -1`/非数字、`limit = 0`/非数字、search `limit > 50` 返回 validation error）：由 session list 路由单元测试覆盖，断言 HTTP 400 与精确消息文案。
- design 边界（`limit=01` 前导零正整数接受为 200、超长 `createdFrom` 配对接受为 200、其他接口不受影响）：由 session list 路由测试与 schema-validation-boundary 测试覆盖。
- negative case（缺失配对、非数字、负数、越界、额外参数）：session list 路由测试逐项断言 400 与文档消息。
- 精确测试文件与命令见 tasks。

## 风险与取舍

- 移除字符长度约束后，是否接受数字串只由有限安全整数和业务范围决定；该选择与 API 文档的 integer 语义一致，并由前导零及较长安全整数黑盒用例锁定。

## 待确认问题

无。
