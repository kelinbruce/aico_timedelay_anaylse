# NextAgent Web Channel API 校验测试清单

> 更新时间: 2026-08-03

## 说明

- **Schema 层**: Fastify/Ajv 或 Value.Check() 的 JSON Schema 校验，失败返回 400 + 具体字段校验消息
- **业务层**: throwValidation() / RangeError / invalidInput() 等代码校验，失败返回 400 + { code, message }
- **错误码**: Schema 层失败时 Fastify 默认返回 FST_ERR_VALIDATION，setErrorHandler 统一为 REQUEST_VALIDATION_FAILED + 字段级消息；业务层统一使用 REQUEST_VALIDATION_FAILED；Memory 使用 LTM_QUERY_INVALID
- 标记 WARNING 的项表示存在已知缺陷或待改进
- 源码参考: packages/agent-channel-web/src/schemas/ 和 routes/

## 错误消息格式

### Fastify/Ajv schema 校验 (formatFastifyValidationError)

从 error.validation[0] 提取 instancePath + keyword + params，生成字段级消息:
- required: {field} is required.
- minLength: {field} must not be empty.
- maxLength: {field} must not exceed {n} characters.
- pattern: {field} format is invalid.
- enum: {field} value is not allowed.
- const / anyOf / oneOf: {field} value is not allowed.
- type: {field} format is invalid.
- minimum: {field} must be at least {n}.
- maximum: {field} must not exceed {n}.
- additionalProperties: Field '{name}' is not allowed.
- minItems: {field} must contain at least {n} item(s).
- maxItems: {field} must not exceed {n} items.
- default (unmatched keyword): {field} validation failed.

> 安全约束: 错误消息 MUST NOT 暴露 Ajv 内部 keyword 名称（如 const、anyOf）。
> TypeBox Union 编译为 anyOf+const 子 schema，未匹配时统一返回 "value is not allowed"。

### requireJsonBody 校验 (formatTypeBoxErrors)

从 Value.Errors() 提取第一个错误，生成字段级消息，格式同上。Union 类型映射为 {field} value is not allowed.，default 映射为 {field} validation failed.，同样不暴露内部 keyword。

### Memory invalidInput() 校验 (formatMemoryErrors)

从 Value.Errors() 提取第一个错误，加操作前缀:
- memory list {field} value is not allowed.
- memory save {field} must not exceed {n} characters.
- memory search {field} value is not allowed.
- default: {prefix} {field} validation failed.

---

## 1. Session 模块

### 1.1 GET /api/v1/sessions

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| q | query | 可选; maxLength=50 | String(maxLength:50) | Unicode code points<=50 | Schema:400 q must not exceed 50 characters.; 业务:400 session list q must not exceed 50 Unicode code points. |
 | createdFrom | query | 可选; 整数; maxLength=13 | String(pattern,maxLength:13) | 必须与createdTo成对; 非负整数(epoch 0为合法下界) | Schema:400 createdFrom format is invalid. / createdFrom must not exceed 13 characters.; 业务:400 createdFrom and createdTo must be provided together. / createdFrom must be a non-negative epoch millisecond. |
 | createdTo | query | 可选; 整数; maxLength=13 | String(pattern,maxLength:13) | from<=to; 范围<=90天; 非负整数 | Schema:400 createdTo format is invalid.; 业务:400 createdFrom must be less than or equal to createdTo. / range must not exceed 90 days. / createdTo must be a non-negative epoch millisecond. |
| offset | query | 可选; 非负整数; maxLength=7 | String(pattern,maxLength:7) | >=0 | Schema:400 offset format is invalid. / offset must not exceed 7 characters.; 业务:400 session list offset must be a non-negative integer. |
| limit | query | 可选; 正整数; maxLength=3 | String(pattern,maxLength:3) | 1-200(列表)/1-50(搜索) | Schema:400 limit format is invalid. / limit must not exceed 3 characters.; 业务:400 limit must be positive. / must not exceed 200. / search must not exceed 50. |
| 额外字段 | query | 不允许 | additionalProperties:false | - | Schema:400 Field 'xxx' is not allowed. |

### 1.2 POST /api/v1/sessions

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| locale | body | 可选; 枚举 zh-CN/en-US | Union([Literal(zh-CN),Literal(en-US)]) | - | Schema:400 locale value is not allowed. |
| 额外字段 | body | 不允许 | additionalProperties:false | - | Schema:400 Field 'xxx' is not allowed. |

### 1.3 PUT /api/v1/sessions/:sessionId/title

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| sessionId | params | 必填; 1-256字符 | String(1-256) | - | Schema:400 sessionId must not be empty. / sessionId must not exceed 256 characters. |
| title | body | 必填; 1-100字符 | String(1-100) | - | Schema:400 title is required. / title must not be empty. / title must not exceed 100 characters. |
| 额外字段 | body | 不允许 | additionalProperties:false | - | Schema:400 Field 'xxx' is not allowed. |

> 注：当 `sessionId` 路径段为空（如 `PUT /api/v1/sessions//title`）时，Fastify 将 `//` 折叠为 `/`，请求不匹配任何已注册路由，返回 `404 NOT_FOUND Route not found.`（统一 not-found handler），不进入 params schema 校验。

### 1.4 DELETE /api/v1/sessions/:sessionId

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| sessionId | params | 必填; 1-256字符 | String(1-256) | - | Schema:400 sessionId must not be empty. / sessionId must not exceed 256 characters. |

---

## 2. Conversation 模块

### 2.1 GET /api/v1/sessions/:sessionId/conversation

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| sessionId | params | 必填; 1-256字符 | String(1-256) | - | Schema:400 sessionId must not be empty. / must not exceed 256 characters. |
| cursor | query | 可选; 1-256字符 | String(1-256) | - | Schema:400 cursor must not be empty. / must not exceed 256 characters. |
| newerCursor | query | 可选; 1-256字符 | String(1-256) | - | Schema:400 newerCursor must not be empty. / must not exceed 256 characters. |
| anchorMessageId | query | 可选; 1-256字符 | String(1-256) | - | Schema:400 anchorMessageId must not be empty. / must not exceed 256 characters. |
| includeCapabilityResults | query | 可选; 1-32字符 | WARNING:String(1-32)任意字符串通过 | 仅true为true,其余视为false | 无报错(按规格设计) WARNING |
| limit | query | 可选; 正整数; maxLength=3 | String(pattern,maxLength:3) | 1-200 | Schema:400 limit format is invalid. / must not exceed 3 characters.; 业务:400 conversation limit must be positive. / must not exceed 200. |
| cursor互斥 | query | cursor/newerCursor/anchorMessageId不可组合 | - | 至多1个 | 业务:400 cursor, newerCursor and anchorMessageId cannot be combined. |
| 额外字段 | query | 不允许 | additionalProperties:false | - | Schema:400 Field 'xxx' is not allowed. |

### 2.2 GET /api/v1/sessions/:sessionId/conversation/preview

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| sessionId | params | 必填; 1-256字符 | String(1-256) | - | Schema:400 sessionId must not be empty. / must not exceed 256 characters. |
| offset | query | 可选; 非负整数; maxLength=7 | String(pattern,maxLength:7) | >=0 | Schema:400 offset format is invalid.; 业务:400 preview offset must be non-negative. |
| limit | query | 必填; 正整数; maxLength=3 | String(pattern,maxLength:3) | 1-500 | Schema:400 limit format is invalid.; 业务:400 preview limit must be between 1 and 500. |
| 额外字段 | query | 不允许 | - | assertConversationPreviewQueryParameters | 业务:400 only supports offset and limit. |

---

## 3. Request 模块

### 3.1 POST /api/v1/sessions/:sessionId/requests

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| sessionId | params | 必填; 1-256字符 | String(1-256) | - | Schema:400 sessionId must not be empty. / must not exceed 256 characters. |
| inputText | body | 必填; 1-32768字符 | via requireJsonBody | - | 400 inputText is required. / must not be empty. / must not exceed 32768 characters. |
| idempotencyKey | body | 必填; 1-256字符 | via requireJsonBody | - | 400 idempotencyKey is required. / must not be empty. / must not exceed 256 characters. |
| locale | body | 可选; 枚举 zh-CN/en-US | via requireJsonBody | - | 400 locale value is not allowed. |
| routingConstraints | body | 可选; 由contracts定义 | via requireJsonBody | - | 400 routingConstraints format is invalid. / validation failed. |
| modelOptions | body | 可选; 由contracts定义 | via requireJsonBody | - | 400 modelOptions format is invalid. / validation failed. |
| attachments | body | 可选; 数组<=10项 | via requireJsonBody | - | 400 attachments must contain at least 1 item(s). / must not exceed 10 items. |
| attachments[].tempRunId | body | 必填; 1-256字符 | via requireJsonBody | - | 400 attachments.0.tempRunId is required. / must not exceed 256 characters. |
| attachments[].fileName | body | 必填; 1-255字符 | via requireJsonBody | - | 400 attachments.0.fileName is required. / must not exceed 255 characters. |
| Content-Type | header | 必须为JSON | - | 非multipart报错 | 业务:400 accepts JSON with staged attachment references. |
| 额外字段 | body | 不允许 | additionalProperties:false | - | 400 Field 'xxx' is not allowed. |

### 3.2 POST /api/v1/requests (便捷提交)

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| inputText | body | 必填; 1-32768字符 | via requireJsonBody | - | 400 inputText is required. / must not be empty. / must not exceed 32768 characters. |
| idempotencyKey | body | 必填; 1-256字符 | via requireJsonBody | - | 400 idempotencyKey is required. / must not exceed 256 characters. |
| locale | body | 可选; 枚举 zh-CN/en-US | via requireJsonBody | - | 400 locale value is not allowed. |
| sessionId | body | 可选; 1-256字符 | via requireJsonBody | - | 400 sessionId must not exceed 256 characters. |
| 其他字段 | body | 同3.1 | via requireJsonBody | - | 同3.1 |
| Content-Type | header | 必须为JSON | - | 非multipart报错 | 业务:400 accepts JSON with staged attachment references. |
| 额外字段 | body | 不允许 | additionalProperties:false | - | 400 Field 'xxx' is not allowed. |

### 3.3 POST /api/v1/sessions/:sessionId/cancel

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| sessionId | params | 必填; 1-256字符 | String(1-256) | - | Schema:400 sessionId must not be empty. / must not exceed 256 characters. |
| expectedLatestRequestId | body | 必填; 1-256字符 | String(1-256) | - | Schema:400 expectedLatestRequestId is required. / must not exceed 256 characters. |
| action | body | 可选; 枚举 CANCEL/CANCEL_LATEST | Union(Literals) | - | Schema:400 action value is not allowed. |
| idempotencyKey | body | 必填; 1-256字符 | String(1-256) | - | Schema:400 idempotencyKey is required. / must not exceed 256 characters. |
| 额外字段 | body | 不允许 | additionalProperties:false | - | Schema:400 Field 'xxx' is not allowed. |

### 3.4 POST /api/v1/sessions/:sessionId/retry

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| sessionId | params | 必填; 1-256字符 | String(1-256) | - | Schema:400 sessionId must not be empty. / must not exceed 256 characters. |
| expectedLatestRequestId | body | 必填; 1-256字符 | String(1-256) | - | Schema:400 expectedLatestRequestId is required. |
| idempotencyKey | body | 必填; 1-256字符 | String(1-256) | - | Schema:400 idempotencyKey is required. |
| 额外字段 | body | 不允许 | additionalProperties:false | - | Schema:400 Field 'xxx' is not allowed. |

### 3.5 POST /api/v1/sessions/:sessionId/requests/latest/edit

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| sessionId | params | 必填; 1-256字符 | String(1-256) | - | Schema:400 sessionId must not be empty. |
| expectedLatestRequestId | body | 必填; 1-256字符 | via requireJsonBody | - | 400 expectedLatestRequestId is required. / must not exceed 256 characters. |
| editedInputText | body | 必填; 1-32768字符 | via requireJsonBody | - | 400 editedInputText is required. / must not exceed 32768 characters. |
| idempotencyKey | body | 必填; 1-256字符 | via requireJsonBody | - | 400 idempotencyKey is required. |
| locale | body | 可选; 枚举 zh-CN/en-US | via requireJsonBody | - | 400 locale value is not allowed. |
| attachments | body | 可选; 必须为空数组 | Array(Never(),maxItems:0) | - | 400 attachments must not exceed 0 items. |
| 额外字段 | body | 不允许 | additionalProperties:false | - | 400 Field 'xxx' is not allowed. |

---

## 4. Fork 模块

### 4.1 POST /api/v1/sessions/:sessionId/messages/:messageId/fork

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| sessionId | params | 必填; 1-256字符 | String(1-256) | - | Schema:400 sessionId must not be empty. / must not exceed 256 characters. |
| messageId | params | 必填; 1-256字符 | String(1-256) | - | Schema:400 messageId must not be empty. / must not exceed 256 characters. |
| idempotencyKey | body | 必填; 1-128字符 | String(1-256) | 业务层trim后检查1-128 | Schema:400 idempotencyKey is required.; 业务:400 fork idempotencyKey must be 1-128 characters. |
| 额外字段 | body | 不允许 | additionalProperties:false | - | Schema:400 Field 'xxx' is not allowed. |

### 4.2 POST /api/v1/sessions/:sessionId/requests/:requestId/fork

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| sessionId | params | 必填; 1-256字符 | String(1-256) | - | Schema:400 sessionId must not be empty. / must not exceed 256 characters. |
| requestId | params | 必填; 1-256字符 | String(1-256) | - | Schema:400 requestId must not be empty. / must not exceed 256 characters. |
| idempotencyKey | body | 必填; 1-128字符 | String(1-256) | 业务层trim后检查1-128 | Schema:400 idempotencyKey is required.; 业务:400 fork idempotencyKey must be 1-128 characters. |
| 额外字段 | body | 不允许 | additionalProperties:false | - | Schema:400 Field 'xxx' is not allowed. |

---

## 5. Stream 模块

### 5.1 GET /api/v1/sessions/:sessionId/stream

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| sessionId | params | 必填; 1-256字符 | String(1-256) | - | Schema:400 sessionId must not be empty. / must not exceed 256 characters. |
| lastSeenSequence | query | 可选; 非负整数; maxLength=7 | String(pattern,maxLength:7) | - | Schema:400 lastSeenSequence format is invalid. / lastSeenSequence must not exceed 7 characters. |
| requestId | query | 可选; 1-256字符 | String(1-256) | - | Schema:400 requestId must not be empty. / must not exceed 256 characters. |
| runId | query | 可选; 1-256字符 | String(1-256) | - | Schema:400 runId must not be empty. / must not exceed 256 characters. |
| 额外字段 | query | 不允许 | additionalProperties:false | - | Schema:400 Field 'xxx' is not allowed. |

---

## 6. Event History 模块

### 6.1 GET /api/v1/sessions/:sessionId/runs/:runId/events

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| sessionId | params | 必填; 1-256字符 | String(1-256) | - | Schema:400 sessionId must not be empty. / must not exceed 256 characters. |
| runId | params | 必填; 1-256字符 | String(1-256) | - | Schema:400 runId must not be empty. / must not exceed 256 characters. |
| afterSequence | query | 可选; Integer>=0 | Integer(minimum:0) | - | Schema:400 afterSequence must be at least 0. |
| limit | query | 可选; Integer 1-1000 | Integer(minimum:1,maximum:1000) | - | Schema:400 limit must be at least 1. / limit must not exceed 1000. |
| 额外字段 | query | 不允许 | additionalProperties:false | - | Schema:400 Field 'xxx' is not allowed. |

---

## 7. Pending Input 模块

### 7.1 POST /api/v1/sessions/:sessionId/pending-inputs/:pendingInputId/answer

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| sessionId | params | 必填; 1-256字符 | String(1-256) | - | Schema:400 sessionId must not be empty. / must not exceed 256 characters. |
| pendingInputId | params | 必填; 1-256字符 | String(1-256) | - | Schema:400 pendingInputId must not be empty. / must not exceed 256 characters. |
| answers | body | 必填; 嵌套数组; 1-100项 | Array(Array(String),minItems:1,maxItems:100) | - | Schema:400 answers is required. / answers must contain at least 1 item(s). / answers must not exceed 100 items. |
| answers[] | body | 内层数组; 1-100项 | Array(String,minItems:1,maxItems:100) | - | Schema:400 answers.0 must contain at least 1 item(s). / answers.0 must not exceed 100 items. |
| answers[][].字符串 | body | 1-4096字符 | String(1-4096) | - | Schema:400 answers.0.0 must not be empty. / answers.0.0 must not exceed 4096 characters. |
| 额外字段 | body | 不允许 | additionalProperties:false | - | Schema:400 Field 'xxx' is not allowed. |

---

## 8. Annotation 模块

### 8.1 POST /api/v1/sessions/:sessionId/runs/:runId/annotations

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| sessionId | params | 必填; 1-256字符 | String(1-256) | - | Schema:400 sessionId must not be empty. / must not exceed 256 characters. |
| runId | params | 必填; 1-256字符 | String(1-256) | - | Schema:400 runId must not be empty. / must not exceed 256 characters. |
| sentiment | body | 可选; 枚举 UP/DOWN/null | Union(Literal("UP"),Literal("DOWN"),Null()) | - | Schema:400 sentiment value is not allowed. |
| isFavorited | body | 可选; Boolean | Boolean() | - | Schema:400 isFavorited format is invalid. |
| isQuestionFavorited | body | 可选; Boolean | Boolean() | - | Schema:400 isQuestionFavorited format is invalid. |
| comment | body | 可选; String<=1000或null | Union(String(maxLength:1000),Null()) | - | Schema:400 comment must not exceed 1000 characters. / comment value is not allowed. |
| 额外字段 | body | 不允许 | additionalProperties:false | - | Schema:400 Field 'xxx' is not allowed. |

### 8.2 GET /api/v1/sessions/:sessionId/annotations

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| sessionId | params | 必填; 1-256字符 | String(1-256) | - | Schema:400 sessionId must not be empty. / must not exceed 256 characters. |

### 8.3 GET /api/v1/favorites

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| offset | query | 可选; 非负整数; maxLength=7 | String(pattern,maxLength:7) | WARNING:无业务上限 | Schema:400 offset format is invalid. / offset must not exceed 7 characters. |
| limit | query | 可选; 正整数; maxLength=3 | String(pattern,maxLength:3) | WARNING:无业务上限 | Schema:400 limit format is invalid. / limit must not exceed 3 characters. |
| 额外字段 | query | 不允许 | additionalProperties:false | - | Schema:400 Field 'xxx' is not allowed. |

---

## 9. Share 模块

### 9.1 POST /api/v1/sessions/:sessionId/shares

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| sessionId | params | 必填; 1-256字符 | String(1-256) | - | Schema:400 sessionId must not be empty. / must not exceed 256 characters. |
| runIds | body | 必填; 数组1-100项 | Array(String(1-256),minItems:1,maxItems:100) | - | Schema:400 runIds is required. / runIds must contain at least 1 item(s). / runIds must not exceed 100 items. |
| runIds[] | body | 1-256字符 | String(1-256) | - | Schema:400 runIds must not be empty. / runIds must not exceed 256 characters. |
| originUrl | body | 必填; 1-2048字符 | String(1-2048) | - | Schema:400 originUrl is required. / originUrl must not exceed 2048 characters. |
| expiresIn | body | 必填; 枚举 24h/7d/30d/permanent | Union(Literals) | - | Schema:400 expiresIn is required. / expiresIn value is not allowed. |
| allowedOps | body | 可选; null或数组<=100项 | Union(Null(),Array(String(1-256),maxItems:100)) | - | Schema:400 allowedOps value is not allowed. / allowedOps must not exceed 100 items. |
| 额外字段 | body | 不允许 | additionalProperties:false | - | Schema:400 Field 'xxx' is not allowed. |

### 9.2 GET /api/v1/shares/:shareId/conversation

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| shareId | params | 必填; 1-256字符 | String(1-256) | - | Schema:400 shareId must not be empty. / shareId must not exceed 256 characters. |

---

## 10. Background Task 模块

### 10.1 GET /api/v1/sessions/:sessionId/background-tasks

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| sessionId | params | 必填; 1-256字符 | String(1-256) | - | Schema:400 sessionId must not be empty. / must not exceed 256 characters. |

### 10.2 GET /api/v1/sessions/:sessionId/background-tasks/:taskId/output

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| sessionId | params | 必填; 1-256字符 | String(1-256) | - | Schema:400 sessionId must not be empty. / must not exceed 256 characters. |
| taskId | params | 必填; 1-256字符 | String(1-256) | - | Schema:400 taskId must not be empty. / must not exceed 256 characters. |
| stream | query | 可选; 枚举 stdout/stderr | Union(Literal("stdout"),Literal("stderr")) | - | Schema:400 stream value is not allowed. |
| limitBytes | query | 可选; 非负整数; maxLength=6 | String(pattern,maxLength:6) | 业务层clamp到1-262144 | Schema:400 limitBytes format is invalid. / limitBytes must not exceed 6 characters. |
| 额外字段 | query | 不允许 | additionalProperties:false | - | Schema:400 Field 'xxx' is not allowed. |

### 10.3 POST /api/v1/sessions/:sessionId/background-tasks/:taskId/kill

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| sessionId | params | 必填; 1-256字符 | String(1-256) | - | Schema:400 sessionId must not be empty. / must not exceed 256 characters. |
| taskId | params | 必填; 1-256字符 | String(1-256) | - | Schema:400 taskId must not be empty. / must not exceed 256 characters. |

---

## 11. File 模块

### 11.1 POST /api/v1/sessions/:sessionId/files/upload

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| sessionId | params | 必填; 1-256字符 | String(1-256) | multipart文件校验 | Schema:400 sessionId must not be empty. / must not exceed 256 characters. |
| file | formData | 必填; multipart文件 | - | 类型/大小/数量校验 | 业务:400/413 文件类型/大小/数量超限 |

### 11.2 DELETE /api/v1/sessions/:sessionId/files/tmp/:tempRunId

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| sessionId | params | 必填; 1-256字符 | String(1-256) | - | Schema:400 sessionId must not be empty. / must not exceed 256 characters. |
| tempRunId | params | 必填; 1-256字符 | String(1-256) | - | Schema:400 tempRunId must not be empty. / must not exceed 256 characters. |
| fileName | query | 必填; 1-255字符 | String(1-255) | - | Schema:400 fileName is required. / fileName must not exceed 255 characters. |
| 额外字段 | query | 不允许 | additionalProperties:false | - | Schema:400 Field 'xxx' is not allowed. |

---

### 11.3 GET /api/v1/sessions/:sessionId/files/download

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| sessionId | params | 必填; 1-256字符 | String(1-256) | - | Schema:400 sessionId must not be empty. / must not exceed 256 characters. |
| path | query | 必填; min 1字符; 业务层 validateDownloadObjectName | String(minLength:1) | validateDownloadObjectName: 禁止 \0、/开头、\\开头、盘符(C:)、.. 路径穿越 | 400 REQUEST_VALIDATION_FAILED path query parameter is required. / Invalid file path. |

---

## 12. Skill 模块

### 12.1 GET /api/v1/skills

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| pageNum | query | 可选; 正整数; maxLength=3 | String(pattern,maxLength:3) | WARNING:无业务上限 | Schema:400 pageNum format is invalid. / pageNum must not exceed 3 characters. |
| pageSize | query | 可选; 正整数; maxLength=3 | String(pattern,maxLength:3) | WARNING:无业务上限 | Schema:400 pageSize format is invalid. / pageSize must not exceed 3 characters. |
| keyword | query | 可选; maxLength=512 | String(maxLength:512) | - | Schema:400 keyword must not exceed 512 characters. |
| 额外字段 | query | 不允许 | additionalProperties:false | - | Schema:400 Field 'xxx' is not allowed. |

---

## 13. Question 模块

### 13.1 GET /api/v1/category-questions

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| locale | query | 可选; 枚举 zh-CN/en-US | Union(Literals) | - | Schema:400 locale value is not allowed. |
| 额外字段 | query | 不允许 | additionalProperties:false | - | Schema:400 Field 'xxx' is not allowed. |

### 13.2 GET /api/v1/frequent-questions

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| locale | query | 可选; 枚举 zh-CN/en-US | Union(Literals) | - | Schema:400 locale value is not allowed. |
| 额外字段 | query | 不允许 | additionalProperties:false | - | Schema:400 Field 'xxx' is not allowed. |

### 13.3 GET /api/v1/question-association

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| keyword | query | 必填; 1-512字符 | String(1-512) | - | Schema:400 keyword is required. / keyword must not exceed 512 characters. |
| locale | query | 可选; 枚举 zh-CN/en-US | Union(Literals) | - | Schema:400 locale value is not allowed. |
| 额外字段 | query | 不允许 | additionalProperties:false | - | Schema:400 Field 'xxx' is not allowed. |

### 13.4 POST /api/v1/user-questions/pin

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| sessionId | body | 必填; 1-256字符 | String(1-256) | - | Schema:400 sessionId is required. / sessionId must not exceed 256 characters. |
| runId | body | 必填; 1-256字符 | String(1-256) | - | Schema:400 runId is required. / runId must not exceed 256 characters. |
| 额外字段 | body | 不允许 | additionalProperties:false | - | Schema:400 Field 'xxx' is not allowed. |

WARNING: Schema定义为sessionId+runId，但API文档描述为question:string，存在不一致(P1)

### 13.5 POST /api/v1/sessions/:sessionId/requests/:requestId/suggested-questions

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| sessionId | params | 必填; 1-256字符 | String(1-256) | - | Schema:400 sessionId must not be empty. / must not exceed 256 characters. |
| requestId | params | 必填; 1-256字符 | String(1-256) | - | Schema:400 requestId must not be empty. / must not exceed 256 characters. |

---

## 14. Bootstrap / Health 模块

### 14.1 GET /api/v1/runtime/bootstrap

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| (无入参) | - | - | - | - | - |

### 14.2 GET /health

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| (无入参) | - | - | - | - | - |

### 14.3 GET /health/deep

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| (无入参) | - | - | - | - | - |

---

## 15. Auth 模块

### 15.1 POST /api/v1/auth/local/login

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| (由认证中间件处理) | - | - | - | - | - |

### 15.2 POST /api/v1/auth/local/logout

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| (由认证中间件处理) | - | - | - | - | - |

---

## 16. WebSocket 模块

### 16.1 WS /api/v1/sessions/:sessionId/ws

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| sessionId | params | 必填; 1-256字符 | String(1-256) | - | Schema:400 sessionId must not be empty. / must not exceed 256 characters. |

---

## 17. Memory 模块

### 17.1 GET /api/v1/memory/long-term-mem

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| memoryInstance | query | 可选; 1-256字符 | String(1-256) | - | 400 memory list memoryInstance must not be empty. / must not exceed 256 characters. |
| queryText | query | 可选; 1-2048字符 | String(1-2048) | - | 400 memory list queryText must not be empty. / must not exceed 2048 characters. |
| memoryType | query | 可选; 枚举 FACTUAL/CONCEPTUAL/PROCEDURAL/USER_CHARACTERISTICS | Union(Literals) | - | 400 memory list memoryType value is not allowed. |
| knowledgeSourceType | query | 可选; 枚举 LEARNED/CONFIGURED/SYSTEM_DEFAULT | Union(Literals) | - | 400 memory list knowledgeSourceType value is not allowed. |
| state | query | 可选; 枚举 ACTIVE/ARCHIVED | Union(Literals) | - | 400 memory list state value is not allowed. |
| isPinned | query | 可选; "true"/"false" | Union(Boolean, String enum) | - | 400 memory list isPinned value is not allowed. |
| minConfidence | query | 可选; Number 0-1 | Union(Number(0-1), String(pattern)) | - | 400 memory list minConfidence must be at least 0. |
| sinceTime | query | 可选; Number>=0 | Union(Number(min:0), String(pattern)) | - | 400 memory list sinceTime must be at least 0. |
| untilTime | query | 可选; Number>=0 | Union(Number(min:0), String(pattern)) | - | 400 memory list untilTime must be at least 0. |
| maxLastAccessedAt | query | 可选; Number>=0 | Union(Number(min:0), String(pattern)) | - | 400 memory list maxLastAccessedAt must be at least 0. |
| labels | query | 可选; maxLength=256 | String(maxLength:256) | - | 400 memory list labels must not exceed 256 characters. |
| limit | query | 可选; Number 1-10000 或正整数字符串 | Union(Number(1-10000), String(pattern)) | - | 400 memory list limit must be at least 1. |
| offset | query | 可选; Number>=0 或非负整数字符串 | Union(Number(min:0), String(pattern)) | - | 400 memory list offset must be at least 0. |
| 额外字段 | query | 不允许 | additionalProperties:false | - | 400 memory list Field 'xxx' is not allowed. |

### 17.2 POST /api/v1/memory/long-term-mem

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| memoryId | body | 可选; 1-256字符 | String(1-256) | - | 400 memory save memoryId must not be empty. / must not exceed 256 characters. |
| memoryInstance | body | 可选; 1-256字符 | String(1-256) | - | 400 memory save memoryInstance must not be empty. / must not exceed 256 characters. |
| memoryType | body | 可选; 枚举 | Union(Literals) | - | 400 memory save memoryType value is not allowed. |
| knowledgeSourceType | body | 可选; 枚举 | Union(Literals) | - | 400 memory save knowledgeSourceType value is not allowed. |
| briefIndex | body | 可选; 1-2048字符 | String(1-2048) | - | 400 memory save briefIndex must not be empty. / must not exceed 2048 characters. |
| content | body | 可选; 1-4000字符 | String(1-4000) | - | 400 memory save content must not be empty. / must not exceed 4000 characters. |
| labels | body | 可选; maxItems=10; 每项1-256字符 | Array(String(1-256),maxItems:10) | - | 400 memory save labels must not have more than 10 items. |
| confidence | body | 可选; Number 0-1 | Number(0-1) | - | 400 memory save confidence must be at least 0. |
| source | body | 可选; maxLength=256 | String(maxLength:256) | - | 400 memory save source must not exceed 256 characters. |
| 额外字段 | body | 不允许 | additionalProperties:false | - | 400 memory save Field 'xxx' is not allowed. |

### 17.2.1 POST /api/v1/memory/long-term-mem/batch

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| memoryInstance | body | 可选; 1-256字符 | String(1-256) | - | 400 memory batch memoryInstance must not be empty. / must not exceed 256 characters. |
| items | body | 必填; 数组1-100项 | Array(minItems:1,maxItems:100) | - | 400 memory batch items must not have fewer than 1 items. |
| items[].memoryId | body | 可选; 1-256字符 | String(1-256) | - | 400 memory batch items[].memoryId must not be empty. |
| items[].memoryType | body | 必填; 枚举 | Union(Literals) | - | 400 memory batch items[].memoryType value is not allowed. |
| items[].knowledgeSourceType | body | 必填; 枚举 | Union(Literals) | - | 400 memory batch items[].knowledgeSourceType value is not allowed. |
| items[].briefIndex | body | 必填; 1-2048字符 | String(1-2048) | - | 400 memory batch items[].briefIndex must not be empty. |
| items[].content | body | 必填; 1-4000字符 | String(1-4000) | - | 400 memory batch items[].content must not be empty. |
| items[].labels | body | 可选; maxItems=10 | Array(maxItems:10) | - | 400 memory batch items[].labels must not have more than 10 items. |
| items[].confidence | body | 可选; Number 0-1 | Number(0-1) | - | 400 memory batch items[].confidence must be at least 0. |
| items[].source | body | 可选; maxLength=4096 | String(maxLength:4096) | - | 400 memory batch items[].source must not exceed 4096 characters. |
| items[].idempotencyKey | body | 可选; 1-128字符 | String(1-128) | - | 400 memory batch items[].idempotencyKey must not be empty. |
| items[].state | body | 可选; 枚举 ACTIVE/ARCHIVED | Union(Literals) | - | 400 memory batch items[].state value is not allowed. |
| items[].archiveReason | body | 可选; maxLength=128 | String(maxLength:128) | - | 400 memory batch items[].archiveReason must not exceed 128 characters. |
| 额外字段 | body | 不允许 | additionalProperties:false | - | 400 memory batch Field 'xxx' is not allowed. |

### 17.3 POST /api/v1/memory/long-term-mem/manual

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| memoryId | body | 可选; 1-256字符 | String(1-256) | - | 400 memory manual memoryId must not be empty. / must not exceed 256 characters. |
| memoryInstance | body | 可选; 1-256字符 | String(1-256) | - | 400 memory manual memoryInstance must not be empty. / must not exceed 256 characters. |
| memoryType | body | 必填; 枚举 | Union(Literals) | - | 400 memory manual memoryType value is not allowed. |
| knowledgeSourceType | body | 必填; 枚举 | Union(Literals) | - | 400 memory manual knowledgeSourceType value is not allowed. |
| briefIndex | body | 必填; 1-2048字符 | String(1-2048) | - | 400 memory manual briefIndex must not be empty. / must not exceed 2048 characters. |
| content | body | 必填; 1-4000字符 | String(1-4000) | - | 400 memory manual content must not be empty. / must not exceed 4000 characters. |
| labels | body | 可选; maxItems=10; 每项1-256字符 | Array(String(1-256),maxItems:10) | - | 400 memory manual labels must not have more than 10 items. |
| 额外字段 | body | 不允许 | additionalProperties:false | - | 400 memory manual Field 'xxx' is not allowed. |

### 17.4 POST /api/v1/memory/long-term-mem/search

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| memoryInstance | body | 必填; 1-256字符 | String(1-256) | - | 400 memory search memoryInstance must not be empty. |
| queryText | body | 必填; 1-2048字符 | String(1-2048) | - | 400 memory search queryText must not be empty. |
| memoryType | body | 可选; 枚举 | Union(Literals) | - | 400 memory search memoryType value is not allowed. |
| knowledgeSourceType | body | 可选; 枚举 | Union(Literals) | - | 400 memory search knowledgeSourceType value is not allowed. |
| minConfidence | body | 可选; Number 0-1 | Number(0-1) | - | 400 memory search minConfidence must be at least 0. |
| sinceTime | body | 可选; Number>=0 | Number(min:0) | - | 400 memory search sinceTime must be at least 0. |
| untilTime | body | 可选; Number>=0 | Number(min:0) | - | 400 memory search untilTime must be at least 0. |
| labels | body | 可选; maxItems=10 | Array(maxItems:10) | - | 400 memory search labels must not have more than 10 items. |
| limit | body | 可选; Number 1-10000 | Number(1-10000) | - | 400 memory search limit must be at least 1. |
| offset | body | 可选; Number>=0 | Number(min:0) | - | 400 memory search offset must be at least 0. |
| 额外字段 | body | 不允许 | additionalProperties:false | - | 400 memory search Field 'xxx' is not allowed. |

---

### 17.5 GET /api/v1/memory/long-term-mem/shared

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| memoryInstance | query | 可选; 1-256字符 | String(1-256) | - | 400 memory shared memoryInstance must not be empty. / must not exceed 256 characters. |
| queryText | query | 可选; 1-2048字符 | String(1-2048) | - | 400 memory shared queryText must not be empty. / must not exceed 2048 characters. |
| memoryType | query | 可选; 枚举 | Union(Literals) | - | 400 memory shared memoryType value is not allowed. |
| knowledgeSourceType | query | 可选; 枚举 | Union(Literals) | - | 400 memory shared knowledgeSourceType value is not allowed. |
| labels | query | 可选; maxLength=256 | String(maxLength:256) | - | 400 memory shared labels must not exceed 256 characters. |
| limit | query | 可选; Number 1-10000 或正整数字符串 | Union(Number(1-10000),String(pattern)) | - | 400 memory shared limit must be at least 1. / must not exceed 10000. |
| offset | query | 可选; Number>=0 或非负整数字符串 | Union(Number(min:0),String(pattern)) | - | 400 memory shared offset must be at least 0. |
| 额外字段 | query | 不允许 | additionalProperties:false | - | 400 memory shared Field 'xxx' is not allowed. |

### 17.6 POST /api/v1/memory/long-term-mem/shared/copy

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| memoryIds | body | 必填; 数组1-100项; 每项1-64字符 | Array(String(1-64),minItems:1,maxItems:100) | 非空数组校验 | 400 memory copy memoryIds is required. / must contain at least 1 item(s). / must not exceed 100 items.; 业务:400 memoryIds must be a non-empty array. |
| memoryInstance | body | 可选; 1-256字符 | String(1-256) | - | 400 memory copy memoryInstance must not be empty. / must not exceed 256 characters. |
| reasonCode | body | 可选; 1-256字符 | String(1-256) | - | 400 memory copy reasonCode must not be empty. / must not exceed 256 characters. |
| 额外字段 | body | 不允许 | additionalProperties:false | - | 400 memory copy Field 'xxx' is not allowed. |

### 17.7 GET /api/v1/memory/long-term-mem/:memoryId/record

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| :memoryId | path | WARNING:无Schema校验 | - | - | WARNING:路径参数无schema校验(P2) |
| memoryInstance | query | 可选; 1-256字符 | String(1-256) | - | 400 memory detail memoryInstance must not be empty. / must not exceed 256 characters. |

### 17.8 GET /api/v1/memory/long-term-mem/:memoryId

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| :memoryId | path | WARNING:无Schema校验 | - | - | WARNING:路径参数无schema校验(P2) |
| memoryInstance | query | 可选; 1-256字符 | String(1-256) | - | 400 memory detail memoryInstance must not be empty. / must not exceed 256 characters. |

### 17.9 DELETE /api/v1/memory/long-term-mem/:memoryId

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| :memoryId | path | WARNING:无Schema校验 | - | - | WARNING:路径参数无schema校验(P2) |
| memoryInstance | query | 可选; 1-256字符 | String(1-256) | - | 400 memory delete memoryInstance must not be empty. / must not exceed 256 characters. |
| reasonCode | query | 可选; 1-256字符 | String(1-256) | - | 400 memory delete reasonCode must not be empty. / must not exceed 256 characters. |

### 17.10 PATCH /api/v1/memory/long-term-mem/:memoryId

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| :memoryId | path | WARNING:无Schema校验 | - | - | WARNING:路径参数无schema校验(P2) |
| memoryInstance | body | 可选; 1-256字符 | String(1-256) | - | 400 memory mutate memoryInstance must not be empty. / must not exceed 256 characters. |
| targetState | body | 可选; 枚举 ACTIVE/ARCHIVED | Union(Literals) | - | 400 memory mutate targetState value is not allowed. |
| archiveReason | body | 可选; 1-256字符 | String(1-256) | - | 400 memory mutate archiveReason must not be empty. / must not exceed 256 characters. |
| delta | body | 可选; Number>=0 | Number(min:0) | - | 400 memory mutate delta must be at least 0. |
| lastAccessTime | body | 可选; Number>=0 | Number(min:0) | - | 400 memory mutate lastAccessTime must be at least 0. |
| isPinned | body | 可选; Boolean | Boolean() | - | 400 memory mutate isPinned format is invalid. |
| expectedVersion | body | 可选; Number>=1 | Number(min:1) | - | 400 memory mutate expectedVersion must be at least 1. |
| 额外字段 | body | 不允许 | additionalProperties:false | - | 400 memory mutate Field 'xxx' is not allowed. |

### 17.11 POST /api/v1/memory/long-term-mem/:memoryId/publish

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| :memoryId | path | WARNING:无Schema校验 | - | - | WARNING:路径参数无schema校验(P2) |
| memoryInstance | body | 可选; 1-256字符 | String(1-256) | - | 400 memory publish memoryInstance must not be empty. / must not exceed 256 characters. |
| reasonCode | body | 可选; 1-256字符 | String(1-256) | - | 400 memory publish reasonCode must not be empty. / must not exceed 256 characters. |
| 额外字段 | body | 不允许 | additionalProperties:false | - | 400 memory publish Field 'xxx' is not allowed. |

### 17.12 POST /api/v1/memory/long-term-mem/:memoryId/unpublish

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| :memoryId | path | WARNING:无Schema校验 | - | - | WARNING:路径参数无schema校验(P2) |
| memoryInstance | body | 可选; 1-256字符 | String(1-256) | - | 400 memory unpublish memoryInstance must not be empty. / must not exceed 256 characters. |
| reasonCode | body | 可选; 1-256字符 | String(1-256) | - | 400 memory unpublish reasonCode must not be empty. / must not exceed 256 characters. |
| 额外字段 | body | 不允许 | additionalProperties:false | - | 400 memory unpublish Field 'xxx' is not allowed. |

---

## 18. CronTask 模块

### 18.1 GET /api/v1/cron-tasks

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| offset | query | 可选; min 1字符 | String(minLength:1) | route parser | 400 offset must not be empty. |
| limit | query | 可选; min 1字符 | String(minLength:1) | route parser | 400 limit must not be empty. |
| 额外字段 | query | 不允许 | additionalProperties:false | - | 400 Field 'xxx' is not allowed. |

### 18.2 POST /api/v1/cron-tasks

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| cron | body | 必填; 1-256字符 | String(1-256) | - | 400 cron must not be empty. / must not exceed 256 characters. |
| prompt | body | 必填; 1-10000字符 | String(1-10000) | - | 400 prompt must not be empty. / must not exceed 10000 characters. |
| target | body | 可选; Object {kind: SKILL|WORKFLOW, name: 1-128 pattern} | Object(additionalProperties:false) | - | 400 target.kind value is not allowed. / target.name must not be empty. |
| recurring | body | 可选; Boolean | Boolean() | - | 400 recurring format is invalid. |
| 额外字段 | body | 不允许 | additionalProperties:false | - | 400 Field 'xxx' is not allowed. |

### 18.3 PUT /api/v1/cron-tasks/:taskId

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| taskId | params | 必填; min 1字符 | String(minLength:1) | - | Schema:400 taskId must not be empty. |
| cron | body | 可选; 1-256字符 | String(1-256) | - | 400 cron must not be empty. / must not exceed 256 characters. |
| prompt | body | 可选; 1-10000字符 | String(1-10000) | - | 400 prompt must not be empty. / must not exceed 10000 characters. |
| target | body | 可选; Object 或 null | Union(Object, Null) | - | 400 target format is invalid. |
| recurring | body | 可选; Boolean | Boolean() | - | 400 recurring format is invalid. |
| 额外字段 | body | 不允许; minProperties:1 | additionalProperties:false, minProperties:1 | - | 400 Field 'xxx' is not allowed. / must have at least 1 property. |

### 18.4 GET /api/v1/cron-tasks/:taskId/runs

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| taskId | params | 必填; min 1字符 | String(minLength:1) | - | Schema:400 taskId must not be empty. |
| offset | query | 可选; min 1字符 | String(minLength:1) | route parser | 400 offset must not be empty. |
| limit | query | 可选; min 1字符 | String(minLength:1) | route parser | 400 limit must not be empty. |
| 额外字段 | query | 不允许 | additionalProperties:false | - | 400 Field 'xxx' is not allowed. |

### 18.5 POST /api/v1/cron-tasks/:taskId/runs

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| taskId | params | 必填; min 1字符 | String(minLength:1) | - | Schema:400 taskId must not be empty. |
| 额外字段 | body | 不允许 | additionalProperties:false | - | 400 Field 'xxx' is not allowed. |

### 18.6 DELETE /api/v1/cron-tasks/:taskId

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| taskId | params | 必填; min 1字符 | String(minLength:1) | - | Schema:400 taskId must not be empty. |

---

## 19. SessionActivity 模块

### 19.1 GET /api/v1/session-activities/stream

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| (无入参) | - | - | - | - | - |

### 19.2 POST /api/v1/sessions/:sessionId/activity/consume

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| sessionId | params | 必填; 1-256字符 | String(1-256) | - | Schema:400 sessionId must not be empty. / must not exceed 256 characters. |
| activityId | body | 必填; 1-256字符 | String(1-256) | - | 400 activityId must not be empty. / must not exceed 256 characters. |
| observedRunId | body | 必填; 1-256字符 | String(1-256) | - | 400 observedRunId must not be empty. / must not exceed 256 characters. |
| 额外字段 | body | 不允许 | additionalProperties:false | - | 400 Field 'xxx' is not allowed. |

---
## 20. Task Channel 模块

> 源码参考: packages/agent-channel-task/src/routes.ts、task-message.ts、task-status.ts

### 20.1 POST /api/v1/stream-task

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| taskMessages | body | 必填; array 1-1 items | Array(minItems:1,maxItems:1) | - | Schema:400 taskMessages must contain at least 1 item. / must not exceed 1 item. |
| taskMessages[].text | body | 可选; 1-32768字符 | String(1-32768) | - | Schema:400 text must not be empty. / must not exceed 32768 characters. |
| taskMessages[].data | body | 可选; JSON对象 | Record(String,Unknown) | - | Schema:400 data format is invalid. |
| taskMessages[].fileContent | body | 可选; raw(1-16777216) 或 url(1-2048) + filename(1-255) + mediaType(1-255) | Union(Object,Object) | - | Schema:400 fileContent format is invalid. |
| locale | body | 可选; 2-35字符; pattern ^[a-zA-Z][a-zA-Z-]*[a-zA-Z]$|^[a-zA-Z]$ | String(2-35,pattern) | - | Schema:400 locale format is invalid. / must not exceed 35 characters. |
| idempotencyKey | body | 可选; 1-256字符 | String(1-256) | - | Schema:400 idempotencyKey must not be empty. / must not exceed 256 characters. |
| reportEvents | body | 可选; 枚举 ALL/TERMINAL | Union(Literal(ALL),Literal(TERMINAL),Array(String)) | - | Schema:400 reportEvents value is not allowed. |
| 额外字段 | body | 不允许 | additionalProperties:false | - | Schema:400 Field 'xxx' is not allowed. |

### 20.2 POST /api/v1/stream-task/:taskId/edit

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| taskId | params | 必填; 1-256字符 | String(1-256) | - | Schema:400 taskId must not be empty. / must not exceed 256 characters. |
| sessionId | body | 必填; 1-256字符 | String(1-256) | - | Schema:400 sessionId must not be empty. / must not exceed 256 characters. |
| taskMessages | body | 必填; array 1-1 items | Array(minItems:1,maxItems:1) | - | Schema:400 taskMessages must contain at least 1 item. / must not exceed 1 item. |
| idempotencyKey | body | 必填; 1-256字符 | String(1-256) | - | Schema:400 idempotencyKey must not be empty. / must not exceed 256 characters. |
| locale | body | 可选; 2-35字符; pattern | String(2-35,pattern) | - | Schema:400 locale format is invalid. |
| reportEvents | body | 可选; 枚举 ALL/TERMINAL | Union | - | Schema:400 reportEvents value is not allowed. |
| 额外字段 | body | 不允许 | additionalProperties:false | - | Schema:400 Field 'xxx' is not allowed. |

### 20.3 POST /api/v1/stream-task/:taskId/retry

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| taskId | params | 必填; 1-256字符 | String(1-256) | - | Schema:400 taskId must not be empty. / must not exceed 256 characters. |
| sessionId | body | 必填; 1-256字符 | String(1-256) | - | Schema:400 sessionId must not be empty. / must not exceed 256 characters. |
| 额外字段 | body | 不允许 | additionalProperties:false | - | Schema:400 Field 'xxx' is not allowed. |

### 20.4 POST /api/v1/async-tasks

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| tasks | body | 必填; array 1-20 items | Array(minItems:1,maxItems:20) | - | Schema:400 tasks must contain at least 1 item. / must not exceed 20 items. |
| tasks[].taskMessages | body | 必填; array 1-1 items | Array(minItems:1,maxItems:1) | - | Schema:400 taskMessages must contain at least 1 item. |
| tasks[].callbackTarget.url | body | 必填; 1-2048字符 | String(1-2048) | - | Schema:400 callbackTarget.url must not be empty. / must not exceed 2048 characters. |
| tasks[].locale | body | 可选; 2-35字符; pattern | String(2-35,pattern) | - | Schema:400 locale format is invalid. |
| tasks[].reportEvents | body | 可选; 枚举 ALL/TERMINAL | Union | - | Schema:400 reportEvents value is not allowed. |
| 额外字段 | body | 不允许 | additionalProperties:false | - | Schema:400 Field 'xxx' is not allowed. |

### 20.5 POST /api/v1/async-tasks/edit

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| tasks | body | 必填; array 1-20 items | Array(minItems:1,maxItems:20) | - | Schema:400 tasks must contain at least 1 item. / must not exceed 20 items. |
| tasks[].taskId | body | 必填; 1-256字符 | String(1-256) | - | Schema:400 taskId must not be empty. / must not exceed 256 characters. |
| tasks[].sessionId | body | 必填; 1-256字符 | String(1-256) | - | Schema:400 sessionId must not be empty. / must not exceed 256 characters. |
| tasks[].taskMessages | body | 必填; array 1-1 items | Array(minItems:1,maxItems:1) | - | Schema:400 taskMessages must contain at least 1 item. |
| tasks[].idempotencyKey | body | 必填; 1-256字符 | String(1-256) | - | Schema:400 idempotencyKey must not be empty. / must not exceed 256 characters. |
| tasks[].locale | body | 可选; 2-35字符; pattern | String(2-35,pattern) | - | Schema:400 locale format is invalid. |
| 额外字段 | body | 不允许 | additionalProperties:false | - | Schema:400 Field 'xxx' is not allowed. |

### 20.6 POST /api/v1/async-tasks/retry

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| tasks | body | 必填; array 1-20 items | Array(minItems:1,maxItems:20) | - | Schema:400 tasks must contain at least 1 item. / must not exceed 20 items. |
| tasks[].taskId | body | 必填; 1-256字符 | String(1-256) | - | Schema:400 taskId must not be empty. / must not exceed 256 characters. |
| tasks[].sessionId | body | 必填; 1-256字符 | String(1-256) | - | Schema:400 sessionId must not be empty. / must not exceed 256 characters. |
| 额外字段 | body | 不允许 | additionalProperties:false | - | Schema:400 Field 'xxx' is not allowed. |

### 20.7 POST /api/v1/tasks/cancel

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| tasks | body | 必填; array 1-20 items | Array(minItems:1,maxItems:20) | - | Schema:400 tasks must contain at least 1 item. / must not exceed 20 items. |
| tasks[].taskId | body | 必填; 1-256字符 | String(1-256) | - | Schema:400 taskId must not be empty. / must not exceed 256 characters. |
| tasks[].sessionId | body | 必填; 1-256字符 | String(1-256) | - | Schema:400 sessionId must not be empty. / must not exceed 256 characters. |
| 额外字段 | body | 不允许 | additionalProperties:false | - | Schema:400 Field 'xxx' is not allowed. |

### 20.8 POST /api/v1/tasks/query

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| tasks | body | 必填; array 1-20 items | Array(minItems:1,maxItems:20) | - | Schema:400 tasks must contain at least 1 item. / must not exceed 20 items. |
| tasks[].sessionId | body | 必填; 1-256字符 | String(1-256) | - | Schema:400 sessionId must not be empty. / must not exceed 256 characters. |
| tasks[].taskId | body | 必填; 1-256字符 | String(1-256) | - | Schema:400 taskId must not be empty. / must not exceed 256 characters. |
| 额外字段 | body | 不允许 | additionalProperties:false | - | Schema:400 Field 'xxx' is not allowed. |

### 20.9 POST /api/v1/tasks/pending-inputs/answer

| 参数 | 位置 | 校验规则 | Schema层 | 业务层 | 校验失败结果(示例) |
|------|------|----------|----------|--------|-------------------|
| tasks | body | 必填; array 1-20 items | Array(minItems:1,maxItems:20) | - | Schema:400 tasks must contain at least 1 item. / must not exceed 20 items. |
| tasks[].taskId | body | 必填; 1-256字符 | String(1-256) | - | Schema:400 taskId must not be empty. / must not exceed 256 characters. |
| tasks[].pendingInputId | body | 必填; 1-256字符 | String(1-256) | - | Schema:400 pendingInputId must not be empty. / must not exceed 256 characters. |
| tasks[].sessionId | body | 必填; 1-256字符 | String(1-256) | - | Schema:400 sessionId must not be empty. / must not exceed 256 characters. |
| tasks[].answers | body | 必填; array 1-100 of array 1-100 of string 1-4096 | Array(minItems:1,maxItems:100,items:Array(minItems:1,maxItems:100,items:String(1-4096))) | - | Schema:400 answers must contain at least 1 item. / must not exceed 100 items. |
| 额外字段 | body | 不允许 | additionalProperties:false | - | Schema:400 Field 'xxx' is not allowed. |


## 已知缺陷汇总

| # | 接口 | 参数 | 缺陷描述 | 优先级 |
|---|------|------|----------|--------|
| 1 | GET /conversation | includeCapabilityResults | 任意字符串可通过Schema校验(String(1-32))，应限定为boolean语义 | P2 |
| 2 | Memory :memoryId路径参数 | :memoryId | 路径参数无Schema校验 | P2 |
| 3 | POST /user-questions/pin | sessionId+runId | Schema定义与API文档描述不一致(Schema:sessionId+runId vs API:question:string) | P1 |
| 4 | GET /favorites | offset/limit | 无业务上限校验 | P2 |
| 5 | GET /skills | pageNum/pageSize | 无业务上限校验 | P2 |
| 6 | POST /memory/long-term-mem/manual | validation message | manualSaveValidationMessage()部分场景消息可靠性待改进 | P3 |
