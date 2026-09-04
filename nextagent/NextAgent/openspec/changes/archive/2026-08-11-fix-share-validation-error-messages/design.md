# Design: Fix Share Validation Error Messages and Global Fastify Formatter

## 设计范围

| Function | Canonical spec | 目标变化 | Delta Requirement |
| --- | --- | --- | --- |
| `FN-1.14 创建分享链接` | `conversation-share` | share body 校验返回确定字段级消息 | `分享创建校验返回确定字段级结果` |

## FN-1.14 创建分享链接

### 目标与规范依据

本 change 的目标是让 `POST /api/v1/sessions/{sessionId}/shares` 的 body 校验失败消息与权威 API 文档严格一致，并修复全局 `formatFastifyValidationError`（被所有走 Fastify `schema.body` 自动校验的路由共用）的三处缺陷。

`conversation-share` stable spec 的 "Share creation Web API contract" Requirement 已要求：请求体和响应体 MUST 经过 runtime schema validation，`runIds` 为空数组时返回 `400`，`originUrl` 不是合法 URL 时返回 `400`（spec line 47）。spec 只要求 HTTP 400，从不断言 message 字符串。本 change 不改变这些契约（HTTP 400 不变），只让错误消息体对齐文档。

权威文档 `docs/apis/agent-web-api-list.md:3153` 的 400 行明列 `runIds is required.`；Body 表（line 3115）约束 `runIds` 为 `minItems: 1, maxItems: 100`、每项 `minLength: 1, maxLength: 256`。`docs/apis/validation-checklist.md:276` 列出 `runIds is required.` / `runIds must contain at least 1 item(s).` / `runIds must not exceed 100 items.`。

**本 Function 的目标 Requirements**：canonical spec 为 `conversation-share`。

- `ADDED`：`分享创建校验返回确定字段级结果`

### 当前实现

share 路由（`packages/agent-channel-web/src/routes/requests.ts` 约 1763 行）注册 `sessions/:sessionId/shares`，仅声明 `schema: { params, body: createShareBody, response }`，无 `preValidation` 钩子、handler 内无 `Value.Check`/手动 parser。body 校验完全依赖 Fastify 的 `schema.body` AJV 校验，失败经全局 `formatFastifyValidationError`（`requests.ts:1959`）格式化。

`createShareBody`（`packages/agent-channel-web/src/schemas/share-dto.ts`）声明 `runIds: Type.Array(Type.String({ minLength: 1, maxLength: WEB_ID_MAX_LENGTH }), { minItems: 1, maxItems: WEB_SHARE_RUN_IDS_MAX_ITEMS })`，`WEB_ID_MAX_LENGTH=256`、`WEB_SHARE_RUN_IDS_MAX_ITEMS=100`，对象 `additionalProperties: false`。约束本身正确。

全局 `formatFastifyValidationError` 以 AJV error 的 `instancePath` 取字段名（`replace(/^\//, '').replace(/\//g, '.')`），按 `keyword` 分支拼消息：`required` → `${field} is required.`；`maxLength` → `${field} must not exceed ${params.limit} characters.`；`minItems` → `${field} must contain at least ${params.minItems} item(s).`；`maxItems` → `${field} must not exceed ${params.maxItems} items.`。

### GAP 分析

| 场景 | 权威文档要求 | 当前实现返回 | 差距根因 |
| --- | --- | --- | --- |
| body 缺 `runIds` 字段 | `runIds is required.` | `body is required.` | `required` 分支只用 `instancePath`，AJV 对缺失顶层属性给 `instancePath: ''`，回退 `body`；未读 `params.missingProperty` |
| `runIds` 空/超 100 项 | `runIds must contain at least 1 item(s).` / `runIds must not exceed 100 items.` | `... undefined item(s).` / `... undefined items.` | `minItems`/`maxItems` 分支读 `params.minItems`/`params.maxItems`，AJV 实际给 `params.limit` |
| 单个 runId >256 字符 | `runIds must not exceed 256 characters.`（文档未显式列，句式沿用 `sessionId must not exceed 256 characters.`） | `runIds.0 must not exceed 256 characters.` | `field` 取完整 `instancePath=/runIds/0` 并全替换 `/`→`.`，泄露数组下标 |

### 修改方案

采用"修复全局 `formatFastifyValidationError` 三处缺陷"方案。share 路由无独立 parser，全局函数是唯一格式化入口，修复它即让 share（及所有同类路由）消息对齐文档。此方案正是 `fix-conversation-preview-validation/design.md:47` 明确推迟到后续 change 的 defer 项。

1. **`field` 取首段**：`first.instancePath?.replace(/^\//, '').replace(/\//g, '.')` → `first.instancePath?.split('/')[1]`。`/runIds/0` → `runIds`；`/sessionId` → `sessionId`；`''`（缺失顶层属性）→ `body`（由下条 `required` 分支的 `missingProperty` 覆盖）。`additionalProperties` 分支用 `params.additionalProperty`，不依赖 `field`，不受影响。
2. **`required` 读 `missingProperty`**：`${field} is required.` → `${first.params?.missingProperty ?? field} is required.`。AJV 对缺失顶层 body 属性给 `params.missingProperty = '<name>'`，产出 `runIds is required.`；缺省回退 `field`（防御）。
3. **`minItems`/`maxItems` 读 `limit`**：`params?.minItems`/`params?.maxItems` → `params?.limit`。AJV 标准这两个关键字 `params` 均为 `{ limit: N }`（与 `maxLength` 同键），产出 `runIds must not exceed 100 items.` 与 `runIds must contain at least 1 item(s).`。
4. **`maxLength` 分支无需改**：已正确读 `params.limit`，配合步骤 1 的去下标，数组项超长自动变为 `runIds must not exceed 256 characters.`，顶层标量 `sessionId must not exceed 256 characters.` 不变。

**必须保留的现有路径**：`createShareBody` 的 schema 约束、share 路由 handler 与成功响应 schema、HTTP 400 与 `REQUEST_VALIDATION_FAILED` code、`additionalProperties` 分支消息、`formatMemoryErrors`（memory 路由专用）、conversation-preview 手动 parser。

**明确不修改的边界**：`share-dto.ts` schema、share 路由 handler、`formatMemoryErrors`、`parseStrictInteger` 及其他路由的 parser。`docs/apis/validation-error-message-analysis.md` 中 `share ` 前缀的 aspirational 消息与 `params.minItems`/`params.maxItems` 伪代码是既有问题，本 change 不扩范围处理。

### 质量属性影响

可维护性：share 校验消息与权威文档一致，减少调用方与文档对照成本；全局格式化函数不再产出 `undefined` 这类无效值。可测试性：share 路由测试可断言精确消息文案。无新增黑盒质量目标。

## 与 fix-conversation-preview-validation 的关系

`fix-conversation-preview-validation/design.md:47` 的 defer note 明确将"修复全局 `formatFastifyValidationError` 的 `required` 分支（用 AJV `params.missingProperty` 取字段名）"推迟到后续 change，理由是"影响所有接口，超出本 change 只修 preview 的范围"。本 change 落地该 defer 项（步骤 2），并顺带修复同函数的 `field` 取首段（步骤 1）与 `params.limit` 键名（步骤 3），二者同属全局格式化函数修复，自然归入本 change。该 defer note 因此闭合。

## 长期基线刷新计划

- stable spec：归档时把 `分享创建校验返回确定字段级结果` 合并到 `conversation-share`。
- Function 文档：归档时同步 FN-1.14 的处理过程与结果，记录确定字段级校验消息。
- Feature 文档：无。
- overview：无。
- architecture：无。
- modules：无。
- ADR：无。
- spec-to-design-map：无。

## 验证策略

- spec 行为（`runIds` 空数组、缺失、超 100 项、单项超 256 字符返回 validation error）：由 share 路由单元测试覆盖，断言 HTTP 400 与精确消息文案。
- 全局回归：跑 channel-web 全量测试，确认 `conversation-preview-route.test.ts`（`limit is required.`，手动 parser 产出）、`memory-routes.test.ts`（`queryText must not exceed 128 characters.`，`formatMemoryErrors` 产出）等既有消息断言不回归——它们不走 `formatFastifyValidationError`。
- negative case（缺失、空数组、超 100、单项超 256）：share 路由测试逐项断言 400 与文档消息。
- 精确测试文件与命令见 tasks。

## 风险与取舍

- 修复点位于共享 Fastify 校验格式化边界，可能影响使用同类 schema keyword 的其他路由；全量 channel-web 和 contract 测试用于确认公共消息投影没有回归。

## 待确认问题

无。
