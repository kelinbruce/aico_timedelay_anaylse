# Design: Align Conversation Preview Validation Errors With API Documentation

## 设计范围

| Function | Canonical spec | 目标变化 | Delta Requirement |
| --- | --- | --- | --- |
| `FN-1.8 查看会话消息` | `session-conversation-preview` | preview query 校验返回确定字段级消息，并接受合法前导零正整数 | `会话预览查询校验返回确定字段级结果` |

## FN-1.8 查看会话消息

### 目标与规范依据

本 change 的目标是让 `GET /api/v1/sessions/{sessionId}/conversation/preview` 的 query 参数校验失败消息与权威 API 文档严格一致，使 API 调用方能据消息定位失败参数。

`session-conversation-preview` stable spec 的 "Preview validates paging parameters without imposing a total cap" scenario 已要求：无 `limit`、负 `offset`、零或负 `limit`、`limit` 大于 500 时 Web API SHALL return a validation error；"Preview route does not accept search parameters" scenario 已要求额外 query 参数返回 validation error。本 change 不改变这些契约（HTTP 400 不变），只让错误消息体对齐文档。

**本 Function 的目标 Requirements**：canonical spec 为 `session-conversation-preview`。

- `ADDED`：`会话预览查询校验返回确定字段级结果`

### 当前实现

preview 路由的 querystring schema（`conversationPreviewQuery`）对 `offset` 声明 `pattern: '^\d+$'` 与 `maxLength`，对 `limit` 声明必填 + `pattern: '^[1-9]\d*$'` 与 `maxLength`，对象为 `additionalProperties: false`。

路由 handler 先调用 `assertConversationPreviewQueryParameters`（在 handler 内部，检查 query 只含 `offset`/`limit`），再调用 `parseConversationPreviewQuery`（用 `parseStrictInteger` 解析 `offset`/`limit`，产出 `{name} is required.` / `{name} must be an integer.` / `{name} must be a finite safe integer.` 以及 preview 专属的 `conversation preview offset must be a non-negative integer.` 和 `conversation preview limit must be between 1 and 500.`）。

Fastify schema 校验失败经全局 `formatFastifyValidationError` 处理：它以 AJV error 的 `instancePath` 取字段名，querystring 根级缺失属性的 `instancePath` 为空时回退成 `body`；`pattern` 失败映射为 `{field} format is invalid.`；`additionalProperties` 失败映射为 `Field '{name}' is not allowed.`。

### GAP 分析

| 场景 | 权威文档要求 | 当前实现返回 | 差距根因 |
| --- | --- | --- | --- |
| `limit` 缺失 | `limit is required.` | `body is required.` | schema 必填失败，全局格式化以空 `instancePath` 回退 `body` |
| `offset`/`limit` 非数字或负数 | `{field} must be an integer.` / `offset must be a non-negative integer.` | `{field} format is invalid.` | schema `pattern` 在 AJV 层拦截，绕过 parser |
| `limit=0`/`501` | `limit must be between 1 and 500.` | `limit format is invalid.` | 同上，pattern 拦截 `0`，maxLength 拦截 `501` |
| 额外参数 `q` | `Conversation preview only supports offset and limit query parameters.` | `Field 'q' is not allowed.` | `additionalProperties: false` 先于 handler 内的 `assertConversationPreviewQueryParameters` 拦截，handler 校验为死代码 |
| 消息前缀 | 文档列出无前缀消息 | parser 消息带 `conversation preview ` 前缀 | parser 消息文案与文档不一致 |

### 修改方案

采用"校验下沉到 parser + 额外参数前置为 preValidation"方案，只作用于 preview 路由，不修改全局格式化函数（全局函数被所有路由共用，修改它超出本 change 范围）。

1. **schema 下沉**：`conversationPreviewQuery` 的 `offset`/`limit` 移除 `pattern`/`minLength`/`maxLength`，`limit` 改为 schema 可选。缺失、非数字、负数、越界值都到达 `parseConversationPreviewQuery`，由 `parseStrictInteger` 与 preview parser 产出文档约定的字段级消息。保留 `additionalProperties: false`（额外参数由 preValidation 拦截）。
2. **parser 消息去前缀**：`conversation preview offset must be a non-negative integer.` → `offset must be a non-negative integer.`；`conversation preview limit must be between 1 and 500.` → `limit must be between 1 and 500.`。`parseStrictInteger` 产出的 `{name} is required.` / `{name} must be an integer.` / `{name} must be a finite safe integer.` 已与文档一致，不变。
3. **额外参数前置**：`assertConversationPreviewQueryParameters` 从 handler 内部调用改为路由 `preValidation` 钩子（签名改为接收 `FastifyRequest`，读 `request.raw.url`），在 schema 校验之前执行；消息首字母大写为 `Conversation preview only supports offset and limit query parameters.`。此写法与 cron 路由的 `assertCronTaskPageQueryOnly` preValidation 钩子一致。
4. **`limit=01` 行为变更**：移除 `limit` 的 `pattern` 后，`limit=01` 不再被 schema 拒绝，经 `parseStrictInteger` 解析为整数 `1`（落在 1 到 500 内）返回 200。`"01"` 是合法正整数串，符合文档"1 到 500 的 integer string"语义；spec 只要求"zero or negative limit"返回校验错误，前导零正整数不在拒绝范围内。

**未选择方案**：修复全局 `formatFastifyValidationError` 的 `required` 分支（用 AJV `params.missingProperty` 取字段名）可一并解决所有路由的 `body is required.` 问题，但影响所有接口，超出本 change"只修 preview"的范围，留待后续 change。

**必须保留的现有路径**：`MAX_CONVERSATION_PREVIEW_LIMIT`（500）、成功响应 schema 与字段、`offset` 默认 0 语义、owner/agent scope 边界、HTTP 状态码映射、`REQUEST_VALIDATION_FAILED` code。

**明确不修改的边界**：`conversationQuery`（`/conversation` 接口）、`sessionListQuery`、`favoritesListQuery` 等其他接口的 schema 与 parser 不动；全局 `formatFastifyValidationError` 不动；`parseStrictInteger` 被 all 接口共用，不动。

### 质量属性影响

可维护性：preview 校验消息与权威文档一致，减少调用方与文档对照成本。可测试性：preview 路由测试可断言精确消息文案。无新增黑盒质量目标。

## 长期基线刷新计划

- stable spec：归档时把 `会话预览查询校验返回确定字段级结果` 合并到 `session-conversation-preview`。
- Function 文档：归档时同步 FN-1.8 的处理过程与结果，记录字段级校验结果和前导零整数语义。
- Feature 文档：无。
- overview：无。
- architecture：无。
- modules：无。
- ADR：无。
- spec-to-design-map：无。

## 验证策略

- spec 行为（无 `limit`、负 `offset`、零/负/超 500 `limit`、额外参数返回 validation error）：由 preview 路由单元测试覆盖，断言 HTTP 400 与精确消息文案。
- design 边界（`limit=01` 前导零正整数接受为 200、其他接口不受影响）：由 preview 路由测试与 schema-validation-boundary 测试覆盖。
- negative case（缺失、非数字、负数、越界、额外参数）：preview 路由测试逐项断言 400 与文档消息。
- 精确测试文件与命令见 tasks。

## 风险与取舍

- 精确错误消息成为调用方可依赖契约，后续文案调整必须同步 delta spec、API 文档和黑盒测试；本 change 以现有权威 API 文档为唯一消息来源，避免新增平行文案。

## 待确认问题

无。
