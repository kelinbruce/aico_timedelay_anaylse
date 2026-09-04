# 校验错误信息分析

> 生成时间: 2026-07-28 (已更新: 2026-08-03)

## 问题总览

当前校验失败返回的错误信息存在三类问题：

1. **Fastify/Ajv schema 校验失败** (已修复): `setErrorHandler` 通过 `formatFastifyValidationError` 提取字段名和约束，生成字段级消息。default 分支不再暴露 Ajv 内部 keyword。
2. **requireJsonBody 校验失败** (已修复): `formatTypeBoxErrors` 提取 Value.Errors() 生成字段级消息。
3. **Memory invalidInput() 校验失败** (已修复): `formatMemoryErrors` 提取 Value.Errors() 并加操作前缀，生成字段级消息。

## 错误处理流程

### 主路由 (requests.ts) setErrorHandler

```
message: error instanceof AgentError
  ? error.message                                    // 业务层: 已有详细信息
  : isExpected ? "Request validation failed."        // Fastify schema: 丢失细节
  : "Request failed safely."                         // 内部错误: 安全隐藏
```

### Memory 路由 (memory.ts) invalidInput

```
function invalidInput(reply, message = "Request contains unsupported fields.") {
  return reply.status(400).send({ code: "LTM_QUERY_INVALID", message, retryable: false });
}
```

---

## 一、Fastify Schema 层校验失败 — 逐参数分析

Fastify Ajv 原始错误包含 error.validation 数组,每项有 instancePath/schemaPath/keyword/params/message 等信息。
但当前 setErrorHandler 全部替换为 "Request validation failed."。

每个参数校验失败时,应指明: 接口名 + 字段名 + 什么约束失败

| 接口 | 参数 | 校验失败场景 | 当前返回 | 应返回 |
|------|------|-------------|---------|--------|
| 1.1 GET /sessions | q | maxLength>50 | Request validation failed. | session list q must not exceed 50 characters. |
| 1.1 GET /sessions | createdFrom | 非整数格式 | 同上 | session list createdFrom must be an integer string. |
| 1.1 GET /sessions | createdFrom | maxLength>13 | 同上 | session list createdFrom must not exceed 13 characters. |
| 1.1 GET /sessions | createdTo | 非整数格式 | 同上 | session list createdTo must be an integer string. |
| 1.1 GET /sessions | createdTo | maxLength>13 | 同上 | session list createdTo must not exceed 13 characters. |
| 1.1 GET /sessions | createdFrom | 负数(<0) | 同上 | session list createdFrom must be a non-negative epoch millisecond. |
| 1.1 GET /sessions | createdTo | 负数(<0) | 同上 | session list createdTo must be a non-negative epoch millisecond. |
| 1.1 GET /sessions | offset | 非数字格式 | 同上 | session list offset must be a non-negative integer string. |
| 1.1 GET /sessions | offset | maxLength>7 | 同上 | session list offset must not exceed 7 characters. |
| 1.1 GET /sessions | limit | 非正整数格式 | 同上 | session list limit must be a positive integer string. |
| 1.1 GET /sessions | limit | maxLength>3 | 同上 | session list limit must not exceed 3 characters. |
| 1.1 GET /sessions | 额外字段 | additionalProperties | 同上 | session list query contains unsupported field: {fieldName}. |
| 1.2 POST /sessions | locale | 非枚举值 | 同上 | session create locale must be zh-CN or en-US. |
| 1.2 POST /sessions | 额外字段 | additionalProperties | 同上 | session create body contains unsupported field: {fieldName}. |
| 1.3 PUT /sessions/:id/title | sessionId | minLength<1或maxLength>256 | 同上 | session sessionId must be 1-256 characters. |
| 1.3 PUT /sessions/:id/title | title | 缺失 | 同上 | title is required. |
| 1.3 PUT /sessions/:id/title | title | maxLength>100 | 同上 | title must not exceed 100 characters. |
| 1.3 PUT /sessions/:id/title | 额外字段 | additionalProperties | 同上 | session update body contains unsupported field: {fieldName}. |
| 1.4 DELETE /sessions/:id | sessionId | 1~256违反 | 同上 | session sessionId must be 1-256 characters. |
| 2.1 GET /conversation | sessionId | 1~256 | 同上 | conversation sessionId must be 1-256 characters. |
| 2.1 GET /conversation | cursor | 1~256 | 同上 | conversation cursor must be 1-256 characters. |
| 2.1 GET /conversation | newerCursor | 1~256 | 同上 | conversation newerCursor must be 1-256 characters. |
| 2.1 GET /conversation | anchorMessageId | 1~256 | 同上 | conversation anchorMessageId must be 1-256 characters. |
| 2.1 GET /conversation | includeCapabilityResults | 1~32 | 同上 | conversation includeCapabilityResults must be 1-32 characters. |
| 2.1 GET /conversation | limit | 非正整数 | 同上 | conversation limit must be a positive integer string. |
| 2.1 GET /conversation | limit | maxLength>3 | 同上 | conversation limit must not exceed 3 characters. |
| 2.1 GET /conversation | 额外字段 | additionalProperties | 同上 | conversation query contains unsupported field: {fieldName}. |
| 2.2 GET /conversation/preview | offset | 非数字 | 同上 | conversation preview offset must be a non-negative integer string. |
| 2.2 GET /conversation/preview | limit | 非正整数 | 同上 | conversation preview limit must be a positive integer string. |
| 2.2 GET /conversation/preview | 额外字段 | additionalProperties | 同上 | conversation preview query contains unsupported field: {fieldName}. |
| 3.3 POST /cancel | expectedLatestRequestId | 1~256 | 同上 | cancel expectedLatestRequestId must be 1-256 characters. |
| 3.3 POST /cancel | action | 非枚举 | 同上 | cancel action must be CANCEL or CANCEL_LATEST. |
| 3.3 POST /cancel | idempotencyKey | 1~256 | 同上 | cancel idempotencyKey must be 1-256 characters. |
| 3.3 POST /cancel | 额外字段 | additionalProperties | 同上 | cancel body contains unsupported field: {fieldName}. |
| 3.4 POST /retry | expectedLatestRequestId | 1~256 | 同上 | retry expectedLatestRequestId must be 1-256 characters. |
| 3.4 POST /retry | idempotencyKey | 1~256 | 同上 | retry idempotencyKey must be 1-256 characters. |
| 3.4 POST /retry | 额外字段 | additionalProperties | 同上 | retry body contains unsupported field: {fieldName}. |
| 5.1 GET /stream | lastSeenSequence | 非数字 | 同上 | stream lastSeenSequence must be a non-negative integer string. |
| 5.1 GET /stream | lastSeenSequence | maxLength>7 | 同上 | stream lastSeenSequence must not exceed 7 characters. |
| 5.1 GET /stream | requestId | 1~256 | 同上 | stream requestId must be 1-256 characters. |
| 5.1 GET /stream | runId | 1~256 | 同上 | stream runId must be 1-256 characters. |
| 5.1 GET /stream | 额外字段 | additionalProperties | 同上 | stream query contains unsupported field: {fieldName}. |
| 6.1 GET /events | afterSequence | 非整数或<0 | 同上 | events afterSequence must be a non-negative integer. |
| 6.1 GET /events | limit | 非整数或<1或>1000 | 同上 | events limit must be between 1 and 1000. |
| 6.1 GET /events | 额外字段 | additionalProperties | 同上 | events query contains unsupported field: {fieldName}. |
| 7.1 POST /pending-input/answer | answers | 非数组 | 同上 | pending input answers must be a non-empty array. |
| 7.1 POST /pending-input/answer | answers[].item | 非数组 | 同上 | pending input answers entry must be a non-empty string array. |
| 7.1 POST /pending-input/answer | answers[] | 空字符串 | 同上 | pending input answer must be 1-4096 characters. |
| 7.1 POST /pending-input/answer | answers | maxItems>100 | 同上 | pending input answers must not exceed 100 entries. |
| 7.1 POST /pending-input/answer | answers[] | maxItems>100 | 同上 | pending input answers entry must not exceed 100 items. |
| 7.1 POST /pending-input/answer | 额外字段 | additionalProperties | 同上 | pending input answer body contains unsupported field: {fieldName}. |
| 8.1 POST /annotations | sentiment | 非枚举 | 同上 | annotation sentiment must be UP, DOWN, or null. |
| 8.1 POST /annotations | isFavorited | 非boolean | 同上 | annotation isFavorited must be a boolean. |
| 8.1 POST /annotations | isQuestionFavorited | 非boolean | 同上 | annotation isQuestionFavorited must be a boolean. |
| 8.1 POST /annotations | comment | maxLength>1000 | 同上 | annotation comment must not exceed 1000 characters. |
| 8.1 POST /annotations | 额外字段 | additionalProperties | 同上 | annotation body contains unsupported field: {fieldName}. |
| 8.2 GET /annotations | sessionId | 1~256 | 同上 | annotations sessionId must be 1-256 characters. |
| 8.3 GET /favorites | offset | 非数字 | 同上 | favorites offset must be a non-negative integer string. |
| 8.3 GET /favorites | limit | 非正整数 | 同上 | favorites limit must be a positive integer string. |
| 8.3 GET /favorites | 额外字段 | additionalProperties | 同上 | favorites query contains unsupported field: {fieldName}. |
| 9.1 POST /shares | runIds | 非数组/空/>100 | 同上 | share runIds must be an array of 1-100 items. |
| 9.1 POST /shares | runIds[] | 1~256 | 同上 | share runId must be 1-256 characters. |
| 9.1 POST /shares | originUrl | 1~2048 | 同上 | share originUrl must be 1-2048 characters. |
| 9.1 POST /shares | expiresIn | 非枚举 | 同上 | share expiresIn must be 24h, 7d, 30d, or permanent. |
| 9.1 POST /shares | allowedOps | 非null/数组或>100项 | 同上 | share allowedOps must be null or an array of up to 100 items. |
| 9.1 POST /shares | 额外字段 | additionalProperties | 同上 | share body contains unsupported field: {fieldName}. |
| 9.2 GET /shares/:id | shareId | 1~256 | 同上 | share shareId must be 1-256 characters. |
| 10.1 GET /background-tasks | sessionId | 1~256 | 同上 | background tasks sessionId must be 1-256 characters. |
| 10.2 GET /background-tasks/:id/output | stream | 非枚举 | 同上 | background task output stream must be stdout or stderr. |
| 10.2 GET /background-tasks/:id/output | limitBytes | 非数字或>6位 | 同上 | background task output limitBytes must be a non-negative integer string. |
| 10.2 GET /background-tasks/:id/output | 额外字段 | additionalProperties | 同上 | background task output query contains unsupported field: {fieldName}. |
| 10.3 POST /background-tasks/:id/kill | sessionId/taskId | 1~256 | 同上 | background task sessionId/taskId must be 1-256 characters. |
| 11.1 POST /files/upload | sessionId | 1~256 | 同上 | file upload sessionId must be 1-256 characters. |
| 11.2 DELETE /files/tmp/:id | fileName | 1~255 | 同上 | file delete fileName must be 1-255 characters. |
| 11.2 DELETE /files/tmp/:id | 额外字段 | additionalProperties | 同上 | file delete query contains unsupported field: {fieldName}. |
| 12.1 GET /skills | pageNum | 非正整数或>3位 | 同上 | skills pageNum must be a positive integer string. |
| 12.1 GET /skills | pageSize | 非正整数或>3位 | 同上 | skills pageSize must be a positive integer string. |
| 12.1 GET /skills | keyword | maxLength>512 | 同上 | skills keyword must not exceed 512 characters. |
| 12.1 GET /skills | 额外字段 | additionalProperties | 同上 | skills query contains unsupported field: {fieldName}. |
| 13.1 GET /category-questions | locale | 非枚举 | 同上 | category questions locale must be zh-CN or en-US. |
| 13.1 GET /category-questions | 额外字段 | additionalProperties | 同上 | category questions query contains unsupported field: {fieldName}. |
| 13.2 GET /frequent-questions | locale | 非枚举 | 同上 | frequent questions locale must be zh-CN or en-US. |
| 13.2 GET /frequent-questions | 额外字段 | additionalProperties | 同上 | frequent questions query contains unsupported field: {fieldName}. |
| 13.3 GET /question-association | keyword | 缺失 | 同上 | question association keyword is required. |
| 13.3 GET /question-association | keyword | 1~512 | 同上 | question association keyword must be 1-512 characters. |
| 13.3 GET /question-association | locale | 非枚举 | 同上 | question association locale must be zh-CN or en-US. |
| 13.3 GET /question-association | 额外字段 | additionalProperties | 同上 | question association query contains unsupported field: {fieldName}. |
| 13.4 POST /user-questions/pin | sessionId | 1~256 | 同上 | user question pin sessionId must be 1-256 characters. |
| 13.4 POST /user-questions/pin | runId | 1~256 | 同上 | user question pin runId must be 1-256 characters. |
| 13.4 POST /user-questions/pin | 额外字段 | additionalProperties | 同上 | user question pin body contains unsupported field: {fieldName}. |
| 13.5 POST /suggested-questions | sessionId/requestId | 1~256 | 同上 | suggested questions sessionId/requestId must be 1-256 characters. |

---

## 二、requireJsonBody 校验失败 — 逐参数分析

以下接口使用 requireJsonBody() 校验 body,失败统一返回 "Request validation failed."。

| 接口 | 参数 | 校验失败场景 | 当前返回 | 应返回 |
|------|------|-------------|---------|--------|
| 3.1 POST /sessions/:id/requests | inputText | 缺失 | Request validation failed. | request submit inputText is required. |
| 3.1 POST /sessions/:id/requests | inputText | 空字符串 | 同上 | request submit inputText must be 1-32768 characters. |
| 3.1 POST /sessions/:id/requests | inputText | >32768 | 同上 | request submit inputText must not exceed 32768 characters. |
| 3.1 POST /sessions/:id/requests | idempotencyKey | 缺失 | 同上 | request submit idempotencyKey is required. |
| 3.1 POST /sessions/:id/requests | idempotencyKey | 1~256 | 同上 | request submit idempotencyKey must be 1-256 characters. |
| 3.1 POST /sessions/:id/requests | locale | 非枚举 | 同上 | request submit locale must be zh-CN or en-US. |
| 3.1 POST /sessions/:id/requests | routingConstraints | schema不匹配 | 同上 | request submit routingConstraints format is invalid. |
| 3.1 POST /sessions/:id/requests | modelOptions | schema不匹配 | 同上 | request submit modelOptions format is invalid. |
| 3.1 POST /sessions/:id/requests | attachments | 非数组 | 同上 | request submit attachments must be an array. |
| 3.1 POST /sessions/:id/requests | attachments | maxItems>10 | 同上 | request submit attachments must not exceed 10 items. |
| 3.1 POST /sessions/:id/requests | attachments[].tempRunId | 1~256 | 同上 | request submit attachment tempRunId must be 1-256 characters. |
| 3.1 POST /sessions/:id/requests | attachments[].fileName | 1~255 | 同上 | request submit attachment fileName must be 1-255 characters. |
| 3.1 POST /sessions/:id/requests | 额外字段 | additionalProperties | 同上 | request submit body contains unsupported field: {fieldName}. |
| 3.2 POST /requests | inputText | 缺失/空/过长 | 同上 | request submit inputText is required. / must be 1-32768 characters. / must not exceed 32768 characters. |
| 3.2 POST /requests | idempotencyKey | 缺失/1~256 | 同上 | request submit idempotencyKey is required. / must be 1-256 characters. |
| 3.2 POST /requests | locale | 非枚举 | 同上 | request submit locale must be zh-CN or en-US. |
| 3.2 POST /requests | sessionId | 1~256 | 同上 | request submit sessionId must be 1-256 characters. |
| 3.2 POST /requests | 其他字段 | 同3.1 | 同上 | 同3.1 |
| 3.5 POST /sessions/:id/requests/latest/edit | expectedLatestRequestId | 缺失/1~256 | 同上 | request edit expectedLatestRequestId is required. / must be 1-256 characters. |
| 3.5 POST /sessions/:id/requests/latest/edit | editedInputText | 缺失/1~32768 | 同上 | request edit editedInputText is required. / must be 1-32768 characters. |
| 3.5 POST /sessions/:id/requests/latest/edit | idempotencyKey | 缺失/1~256 | 同上 | request edit idempotencyKey is required. / must be 1-256 characters. |
| 3.5 POST /sessions/:id/requests/latest/edit | locale | 非枚举 | 同上 | request edit locale must be zh-CN or en-US. |
| 3.5 POST /sessions/:id/requests/latest/edit | attachments | 非空数组 | 同上 | request edit attachments must be an empty array. |
| 3.5 POST /sessions/:id/requests/latest/edit | 额外字段 | additionalProperties | 同上 | request edit body contains unsupported field: {fieldName}. |
| 4.1 POST /sessions/:id/messages/:id/fork | idempotencyKey | 缺失/1~128 | 同上 | fork idempotencyKey is required. / must be 1-128 characters. |
| 4.1 POST /sessions/:id/messages/:id/fork | 额外字段 | additionalProperties | 同上 | fork body contains unsupported field: {fieldName}. |
| 4.2 POST /sessions/:id/requests/:id/fork | idempotencyKey | 缺失/1~128 | 同上 | fork idempotencyKey is required. / must be 1-128 characters. |
| 4.2 POST /sessions/:id/requests/:id/fork | 额外字段 | additionalProperties | 同上 | fork body contains unsupported field: {fieldName}. |

---

## 三、Memory invalidInput() 校验失败 — 逐参数分析

| 接口 | 参数 | 校验失败场景 | 当前返回 | 应返回 |
|------|------|-------------|---------|--------|
| 17.1 GET /memory/long-term-mem | memoryInstance | 1~256违反 | Request contains unsupported fields. | memory list memoryInstance must be 1-256 characters. |
| 17.1 GET /memory/long-term-mem | queryText | 1~2048违反 | 同上 | memory list queryText must be 1-2048 characters. |
| 17.1 GET /memory/long-term-mem | memoryType | 非枚举 | 同上 | memory list memoryType must be FACTUAL, CONCEPTUAL, PROCEDURAL, or USER_CHARACTERISTICS. |
| 17.1 GET /memory/long-term-mem | knowledgeSourceType | 非枚举 | 同上 | memory list knowledgeSourceType must be LEARNED, CONFIGURED, or SYSTEM_DEFAULT. |
| 17.1 GET /memory/long-term-mem | state | 非枚举 | 同上 | memory list state must be ACTIVE or ARCHIVED. |
| 17.1 GET /memory/long-term-mem | isPinned | 非boolean/"true"/"false" | 同上 | memory list isPinned must be a boolean, "true", or "false". |
| 17.1 GET /memory/long-term-mem | minConfidence | 非数字或超0-1 | 同上 | memory list minConfidence must be a number between 0 and 1. |
| 17.1 GET /memory/long-term-mem | sinceTime | 非非负数字 | 同上 | memory list sinceTime must be a non-negative number. |
| 17.1 GET /memory/long-term-mem | untilTime | 非非负数字 | 同上 | memory list untilTime must be a non-negative number. |
| 17.1 GET /memory/long-term-mem | maxLastAccessedAt | 非非负数字 | 同上 | memory list maxLastAccessedAt must be a non-negative number. |
| 17.1 GET /memory/long-term-mem | labels | >256字符 | 同上 | memory list labels must not exceed 256 characters. |
| 17.1 GET /memory/long-term-mem | limit | 非正整数或>10000 | 同上 | memory list limit must be a positive integer up to 10000. |
| 17.1 GET /memory/long-term-mem | offset | 非非负整数 | 同上 | memory list offset must be a non-negative integer. |
| 17.1 GET /memory/long-term-mem | 额外字段 | additionalProperties | 同上 | memory list query contains unsupported field: {fieldName}. |
| 17.2 POST /memory/long-term-mem | memoryId | 1~256 | 同上 | memory save memoryId must be 1-256 characters. |
| 17.2 POST /memory/long-term-mem | memoryInstance | 1~256 | 同上 | memory save memoryInstance must be 1-256 characters. |
| 17.2 POST /memory/long-term-mem | memoryType | 非枚举 | 同上 | memory save memoryType must be FACTUAL, CONCEPTUAL, PROCEDURAL, or USER_CHARACTERISTICS. |
| 17.2 POST /memory/long-term-mem | knowledgeSourceType | 非枚举 | 同上 | memory save knowledgeSourceType must be LEARNED, CONFIGURED, or SYSTEM_DEFAULT. |
| 17.2 POST /memory/long-term-mem | briefIndex | 1~2048 | 同上 | memory save briefIndex must be 1-2048 characters. |
| 17.2 POST /memory/long-term-mem | content | 1~4000 | 同上 | memory save content must be 1-4000 characters. |
| 17.2 POST /memory/long-term-mem | labels | 非数组或>10项 | 同上 | memory save labels must be an array with at most 10 items. |
| 17.2 POST /memory/long-term-mem | labels[] | 1~256 | 同上 | memory save label must be 1-256 characters. |
| 17.2 POST /memory/long-term-mem | confidence | 0~1 | 同上 | memory save confidence must be between 0 and 1. |
| 17.2 POST /memory/long-term-mem | source | >256 | 同上 | memory save source must not exceed 256 characters. |
| 17.3 POST /manual | (各参数) | 同17.2模式 | 已有详细消息(部分) | (已有,可改进) |
| 17.4 POST /search | (各参数) | 同17.1模式 | Request contains unsupported fields. | 同17.1模式,前缀改为 memory search |
| 17.5 GET /shared | (各参数) | 同17.1模式 | 同上 | 同17.1模式,前缀改为 memory shared |
| 17.6 POST /shared/copy | memoryIds | 非数组/空/>100 | 同上 | memory copy memoryIds must be an array of 1-100 items. |
| 17.6 POST /shared/copy | memoryIds[] | 1~64 | 同上 | memory copy memoryId must be 1-64 characters. |
| 17.6 POST /shared/copy | memoryInstance | 1~256 | 同上 | memory copy memoryInstance must be 1-256 characters. |
| 17.6 POST /shared/copy | reasonCode | 1~256 | 同上 | memory copy reasonCode must be 1-256 characters. |
| 17.7~17.9 GET/GET/DELETE :memoryId | memoryInstance | 1~256 | 同上 | memory get/delete memoryInstance must be 1-256 characters. |
| 17.9 DELETE :memoryId | reasonCode | 1~256 | 同上 | memory delete reasonCode must be 1-256 characters. |
| 17.10 PATCH :memoryId | targetState | 非枚举 | 同上 | memory mutate targetState must be ACTIVE or ARCHIVED. |
| 17.10 PATCH :memoryId | archiveReason | 1~256 | 同上 | memory mutate archiveReason must be 1-256 characters. |
| 17.10 PATCH :memoryId | delta | <0 | 同上 | memory mutate delta must be a non-negative number. |
| 17.10 PATCH :memoryId | lastAccessTime | <0 | 同上 | memory mutate lastAccessTime must be a non-negative number. |
| 17.10 PATCH :memoryId | expectedVersion | <1 | 同上 | memory mutate expectedVersion must be a positive integer. |
| 17.10 PATCH :memoryId | memoryInstance | 1~256 | 同上 | memory mutate memoryInstance must be 1-256 characters. |
| 17.11 POST :memoryId/publish | memoryInstance | 1~256 | 同上 | memory publish memoryInstance must be 1-256 characters. |
| 17.11 POST :memoryId/publish | reasonCode | 1~256 | 同上 | memory publish reasonCode must be 1-256 characters. |
| 17.12 POST :memoryId/unpublish | memoryInstance | 1~256 | 同上 | memory unpublish memoryInstance must be 1-256 characters. |
| 17.12 POST :memoryId/unpublish | reasonCode | 1~256 | 同上 | memory unpublish reasonCode must be 1-256 characters. |

---

## 四、CronTask 模块校验

### CronTask schema 校验失败

CronTask 路由使用 Fastify schema 校验，错误信息通过 setErrorHandler 统一处理：

- cron (create/update): cron must not be empty. / cron must not exceed 256 characters.
- prompt (create/update): prompt must not be empty. / prompt must not exceed 10000 characters.
- target.kind: target.kind value is not allowed. (枚举 SKILL/WORKFLOW)
- target.name: target.name must not be empty. / target.name must not exceed 128 characters.
- recurring: recurring format is invalid.
- taskId (path): taskId must not be empty. (minLength:1)
- update body minProperties:1: must have at least 1 property.

### CronTask query 参数 (offset/limit)

offset/limit 使用 String(minLength:1) schema，非空校验由 schema 层处理，数值范围由 route parser 处理。

## 五、SessionActivity 模块校验

### consume body 校验失败

SessionActivity consume 路由使用 Fastify schema 校验：

- activityId: activityId must not be empty. / activityId must not exceed 256 characters.
- observedRunId: observedRunId must not be empty. / observedRunId must not exceed 256 characters.
- sessionId (path): sessionId must not be empty. / sessionId must not exceed 256 characters.
- 额外字段: Field 'xxx' is not allowed.

### stream 端点

GET /api/v1/session-activities/stream 无入参，无需 schema 校验。

## 六、Memory Batch 模块校验

### batchCreateLongTermMemoryBody 校验失败

Memory batch 路由使用 strictObject (additionalProperties:false) + 嵌套 schema：

- memoryInstance: memoryInstance must not be empty. / memoryInstance must not exceed 256 characters.
- items: items must not have fewer than 1 items. / items must not have more than 100 items.
- items[].memoryType: items[].memoryType value is not allowed.
- items[].knowledgeSourceType: items[].knowledgeSourceType value is not allowed.
- items[].briefIndex: items[].briefIndex must not be empty. / must not exceed 2048 characters.
- items[].content: items[].content must not be empty. / must not exceed 4000 characters.
- 额外字段: Field 'xxx' is not allowed.

## 七、Attachment Download 校验

### download path 参数校验

GET /api/v1/sessions/:sessionId/files/download 的 path query 参数使用两层校验：

- Schema 层: String(minLength:1)，空值返回 path query parameter is required.
- 业务层: validateDownloadObjectName() 检查路径合法性，禁止 \0、/开头、\\开头、盘符(C:)、.. 路径穿越，失败返回 Invalid file path.

## 修复方案

### 方案一：修改 setErrorHandler 提取 Ajv 错误详情（推荐）

在 setErrorHandler 中,当 isFastifyValidationError(error) 时,从 error.validation 提取第一个错误的字段路径和约束,构造可读消息:

```typescript
function formatValidationError(error: FastifyError): string {
  const validation = error.validation?.[0];
  if (!validation) return "Request validation failed.";
  const fieldPath = validation.instancePath?.replace(/^\//, "") || "unknown";
  const keyword = validation.keyword;
  switch (keyword) {
    case "required": return `${fieldPath} is required.`;
    case "minLength": return `${fieldPath} must not be empty.`;
    case "maxLength": return `${fieldPath} must not exceed ${validation.params?.limit} characters.`;
    case "pattern": return `${fieldPath} format is invalid.`;
    case "enum": return `${fieldPath} value is not allowed.`;
    case "minimum": return `${fieldPath} must be at least ${validation.params?.minimum}.`;
    case "maximum": return `${fieldPath} must not exceed ${validation.params?.maximum}.`;
    case "additionalProperties": return `Field '${validation.params?.additionalProperty}' is not allowed.`;
    case "minItems": return `${fieldPath} must contain at least ${validation.params?.minItems} item(s).`;
    case "maxItems": return `${fieldPath} must not exceed ${validation.params?.maxItems} items.`;
    default: return `${fieldPath} validation failed.`;
  }
}
```

然后在 setErrorHandler 中使用:

```typescript
message: error instanceof AgentError
  ? error.message
  : isFastifyValidationError(error)
    ? formatValidationError(error)
    : isExpected ? "Request validation failed."
    : "Request failed safely."
```

### 方案二：修改 requireJsonBody 提取 Ajv 错误

```typescript
function requireJsonBody(body: unknown, schema: TSchema): unknown {
  if (!Value.Check(schema, body)) {
    const errors = [...Value.Errors(schema, body)];
    const first = errors[0];
    const msg = first
      ? formatTypeBoxError(first)
      : "Request validation failed.";
    throw new AgentError({ code: "REQUEST_VALIDATION_FAILED", message: msg, category: "VALIDATION", retryable: false });
  }
  return body;
}
```

### 方案三：Memory 路由 Value.Check 失败时提取字段信息

```typescript
function formatMemoryValidationError(errors: readonly ValueError[], prefix: string): string {
  const first = errors[0];
  if (!first) return "Request contains unsupported fields.";
  const field = first.path?.replace(/^\//, "") || "unknown";
  return `memory ${prefix} ${field} validation failed.`;
}
```

### 实施优先级

1. **方案一（最高优先）**: 影响面最大,修复后所有 Fastify schema 校验接口的错误信息立即改善
2. **方案二（高优先）**: 修复 requireJsonBody 的笼统消息
3. **方案三（中优先）**: Memory 路由错误信息改善
