# Fix Share Validation Error Messages and Global Fastify Formatter

## Background

`POST /api/v1/sessions/{sessionId}/shares` 的权威接口契约由 `docs/apis/agent-web-api-list.md` 维护。该文档对 share 接口的 400 校验消息有明确约定（line 3153）：`runIds is required.` / `originUrl is required.` / `expiresIn value is not allowed.` / `Field '{name}' is not allowed.`。Body 字段表（line 3115）约束 `runIds` 为 `minItems: 1, maxItems: 100`，每个 run ID `minLength: 1, maxLength: 256`。

share 路由（`packages/agent-channel-web/src/routes/requests.ts` 约 1763 行）无 `preValidation` 钩子、无手动 parser，body 校验完全依赖 Fastify 的 `schema.body` AJV 校验，失败经全局 `formatFastifyValidationError`（`requests.ts:1959`）格式化。该全局函数有三处缺陷，导致 share 接口（及所有走全局格式化的路由）返回的错误消息与文档不符或为无效值：

1. **`runIds` 缺失返回 `body is required.`**：`required` 分支只用 AJV error 的 `instancePath`，而 AJV 对缺失顶层 body 属性给 `instancePath: ''`，函数回退成笼统的 `body is required.`，无法指明缺失字段是 `runIds`。文档要求 `runIds is required.`。
2. **`runIds` 数组 >100 项返回 `runIds must not exceed undefined items.`**：`maxItems` 分支读 `first.params?.maxItems`，但 AJV 标准 `maxItems` 关键字的 `params` 为 `{ limit: N }`（与 `maxLength` 同键），`params.maxItems` 恒为 `undefined`。`minItems` 分支同病，空数组返回 `runIds must contain at least undefined item(s).`。
3. **单个 runId >256 字符返回 `runIds.0 must not exceed 256 characters.`**：`field` 取自 `instancePath=/runIds/0` 并把 `/` 全替换为 `.`，导致数组项错误泄露下标 `runIds.0`。

`conversation-share` stable spec 对这些场景只要求 HTTP 400（`runIds` 为空数组时返回 `400`），从不断言 message 字符串。本 change 不改变状态码契约，只让错误消息体对齐权威文档，并修复全局格式化函数的三处缺陷。

本 change 同时闭合 `fix-conversation-preview-validation/design.md:47` 的遗留 defer note：该 note 明确将"修复全局 `formatFastifyValidationError` 的 `required` 分支（用 AJV `params.missingProperty` 取字段名）"推迟到后续 change。本 change 即落地该 defer 项，并一并修复同函数的 `params.limit` 键名与数组下标泄露问题。

## Goals / Non-Goals

**目标：**

- 修复全局 `formatFastifyValidationError` 三处缺陷：
  - `required` 分支读 `params.missingProperty`，缺失顶层 body 属性返回 `<field> is required.` 而非 `body is required.`。
  - `minItems`/`maxItems` 分支改读 `params.limit`，消除 `undefined items`。
  - `field` 取 `instancePath` 首段（`split('/')[1]`），数组项错误不再泄露下标（`runIds.0` → `runIds`）。
- 让 share 接口校验失败消息对齐 `docs/apis/agent-web-api-list.md` 与 `docs/apis/validation-checklist.md`：`runIds is required.` / `runIds must contain at least 1 item(s).` / `runIds must not exceed 100 items.` / `runIds must not exceed 256 characters.`。
- 保持所有校验失败的 HTTP 400 与 `REQUEST_VALIDATION_FAILED` code 不变。

**非目标：**

- 不改写既有 `conversation-share` Requirement；本 change 以新增 delta Requirement 固化精确字段级校验消息。
- 不引入新的 SafeError code、不改变 HTTP 状态码映射、不改变 schema 约束（`minItems`/`maxItems`/`minLength`/`maxLength` 本身正确，仅消息格式化错）。
- 不改变 share 路由 handler、不动 `share-dto.ts` schema、不动 `formatMemoryErrors`（memory 路由专用，本身正确）、不动 conversation-preview 手动 parser。
- 不对齐 `docs/apis/validation-error-message-analysis.md` 中 `share ` 前缀的"应返回"消息——那是既有 aspirational 目标，全局格式化不带 feature 前缀，与权威 `agent-web-api-list.md` 一致，不在本 change 范围。
- 不修复其他接口可能存在的同类消息问题（本 change 修全局函数后，所有路由的 `required`/`minItems`/`maxItems`/数组项 `maxLength` 消息会一并变正确，这是全局修复的预期收益，非额外范围）。

## What Changes

- `formatFastifyValidationError`（`packages/agent-channel-web/src/routes/requests.ts:1959`）三处定点修改：
  - `field` 计算：`first.instancePath?.replace(/^\//, '').replace(/\//g, '.')` → `first.instancePath?.split('/')[1]`，取首段去数组下标；空 `instancePath` 仍回退 `'body'`。
  - `required` 分支：`${field} is required.` → `${first.params?.missingProperty ?? field} is required.`，优先用 AJV 的 `missingProperty`，缺省回退 `field`。
  - `minItems`/`maxItems` 分支：`params?.minItems`/`params?.maxItems` → `params?.limit`。
- `maxLength` 分支（读 `params.limit`，本身正确）无需改——配合 `field` 取首段，数组项超长自动从 `runIds.0 must not exceed 256 characters.` 变为 `runIds must not exceed 256 characters.`，顶层标量（如 `sessionId must not exceed 256 characters.`）不变。
- `additionalProperties` 分支用 `params.additionalProperty`，不依赖 `field`，不受影响。
- share 路由测试补充 message 断言：缺失 `runIds`、空数组、>100 项、单项 >256 字符四个 case 断言 `error.code` 与 `error.message`。
- `docs/apis/validation-checklist.md:277` 的 `runIds[]` 行去掉 `.0` 下标，与修复后消息一致。

本 change 不包含破坏性公共契约变更。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-1.14 创建分享链接` → `specs/conversation-share/spec.md`
  - 功能边界：share 接口校验失败消息对齐权威 API 文档；全局 Fastify 错误格式化函数三处缺陷修复。
  - 系统质量属性：可维护性、可测试性。
  - 映射说明：`conversation-share` 是 canonical spec；delta Requirement 固化调用方可观察的精确消息结果。

## 影响范围（Impact）

- API 调用方：share 接口校验失败时收到与 `docs/apis/agent-web-api-list.md` 一致的字段级消息，可直接定位缺失或非法的 `runIds`；不再收到 `undefined items` 这类无效值。
- 所有走全局 `formatFastifyValidationError` 的路由：缺失顶层 body 字段返回 `<field> is required.` 而非 `body is required.`；`minItems`/`maxItems` 消息数值正确；数组项校验消息不再泄露下标。HTTP 状态码与 `REQUEST_VALIDATION_FAILED` code 不变。
- Agent 开发者与平台集成方：无需修改公共 API 调用代码；HTTP 状态码与成功响应 schema 不变。
- 运维人员：校验失败仍为 HTTP 400 + `REQUEST_VALIDATION_FAILED`，不暴露内部 stack 或额外诊断字段。
- 主要受影响范围为 `agent-channel-web` 的全局错误格式化函数与 share 路由测试；不触及 runtime、session、gateway、stream、context 或前端。
