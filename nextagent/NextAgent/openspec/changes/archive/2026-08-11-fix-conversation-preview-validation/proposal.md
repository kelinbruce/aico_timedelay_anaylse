# Align Conversation Preview Validation Errors With API Documentation

## Background

`GET /api/v1/sessions/{sessionId}/conversation/preview` 的权威接口契约由 `docs/apis/agent-web-api-list.md` 维护，该文档是 agent-web channel 对外接口的权威文档。该文档对 preview 接口的分页校验失败消息有明确约定：

- `limit` 缺失或不在 1 到 500 范围内 → `limit is required.` / `limit must be an integer.` / `limit must be a finite safe integer.` / `limit must be between 1 and 500.`
- `offset` 不是合法非负整数 → `offset must be an integer.` / `offset must be a finite safe integer.` / `offset must be a non-negative integer.`
- query 包含 `offset`、`limit` 之外的字段 → `Conversation preview only supports offset and limit query parameters.`

当前实现返回的消息与上述权威文档不一致，API 调用方无法据消息定位失败参数：

1. **`limit` 缺失时返回 `body is required.`**：querystring 必填字段缺失经 schema 校验失败后，错误格式化以 querystring 根级为空回退成笼统的 `body is required.`，无法指明缺失字段是 `limit`。
2. **`offset` 或 `limit` 非法时返回 `offset format is invalid.` / `limit format is invalid.`**：schema 在 querystring 层用 pattern 拦截了负数、非数字等值，直接产出文档未定义的 `format is invalid.` 消息，绕过了路由 parser 中能产出文档约定字段级消息的逻辑。
3. **额外 query 参数返回 `Field 'q' is not allowed.`**：额外参数校验在路由 handler 内部执行，但 schema 的 `additionalProperties: false` 已先于 handler 拦截，handler 内的额外参数校验成为死代码，调用方看到的不是文档约定的 `Conversation preview only supports offset and limit query parameters.`。

`session-conversation-preview` stable spec 已要求上述场景"SHALL return a validation error"（即 HTTP 400），HTTP 状态码现状已满足；本 change 不改变状态码契约，只让错误消息体对齐权威文档。

## Goals / Non-Goals

**目标：**

- 让 preview 接口所有校验失败场景返回的错误消息严格匹配 `docs/apis/agent-web-api-list.md` 的约定消息，使 API 调用方能据消息定位失败参数。
- `limit` 缺失返回 `limit is required.`；`offset`/`limit` 非数字返回 `{field} must be an integer.`；`offset` 负数返回 `offset must be a non-negative integer.`；`limit` 不在 1 到 500 返回 `limit must be between 1 and 500.`；额外参数返回 `Conversation preview only supports offset and limit query parameters.`。
- 保持 `limit` 必填语义：缺失仍返回 HTTP 400。

**非目标：**

- 不改写既有 `session-conversation-preview` Requirement；本 change 以新增 delta Requirement 固化精确校验消息与前导零整数语义。
- 不修复其他接口的同类消息问题（如 session list、favorites、conversation 等接口的必填 query 字段缺失或 pattern 拦截消息），这些接口的报错对齐留待后续 change。
- 不修改全局错误格式化函数对其他路由的影响；本 change 只通过把 preview 的数字校验下沉到路由 parser、把额外参数校验前置为 preValidation 钩子来规避全局格式化对 preview 的不良回退。
- 不改变 preview 接口的成功响应 schema、字段、分页语义、owner/agent scope 边界或 `MAX_CONVERSATION_PREVIEW_LIMIT`（500）上限。
- 不引入新的 SafeError code、不改变 HTTP 状态码映射、不改变 stream/timeline/runtime 行为。

## What Changes

- preview 路由的 querystring schema 把 `offset` 与 `limit` 的 `pattern`/`minLength`/`maxLength` 约束移除，并将 `limit` 由 schema 必填改为 schema 可选；所有数字与必填校验下沉到路由 parser，使缺失、非数字、负数、越界值都到达 parser 并产出文档约定的字段级消息。
- 路由 parser 的两条 preview 消息去掉 `conversation preview ` 前缀，与文档列出的无前缀消息一致（`offset must be a non-negative integer.`、`limit must be between 1 and 500.`）。
- 额外 query 参数校验从路由 handler 内部移到 `preValidation` 钩子，使其在 schema 校验之前执行并返回文档约定的 `Conversation preview only supports offset and limit query parameters.`；消息首字母改为大写以匹配文档。
- `limit` 的 pattern 移除带来一个行为变更：前导零的 `limit` 串（如 `limit=01`）此前被 schema pattern 拒绝为 HTTP 400，此后被 parser 解析为整数 `1`（落在 1 到 500 内）返回 HTTP 200。该值是合法正整数，符合文档"1 到 500 的 integer string"语义；spec 只要求"zero or negative limit"返回校验错误，前导零正整数不在拒绝范围内。

本 change 不包含破坏性公共契约变更。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-1.8 查看会话消息` → `specs/session-conversation-preview/spec.md`
  - 功能边界：preview 路由的 query 参数校验失败消息对齐权威 API 文档；`limit=01` 前导零正整数从拒绝改为按整数 `1` 接受。
  - 系统质量属性：可维护性、可测试性。
  - 映射说明：`session-conversation-preview` 是 canonical spec；delta Requirement 固化调用方可观察的精确消息与 `limit=01` 接受语义。

## 影响范围（Impact）

- API 调用方：preview 接口校验失败时收到与 `docs/apis/agent-web-api-list.md` 一致的字段级消息，可直接定位缺失或非法的 `offset`/`limit` 参数；`limit=01` 等前导零正整数请求返回 200 而非 400。
- Agent 开发者与平台集成方：无需修改公共 API 调用代码；HTTP 状态码与成功响应 schema 不变。
- 运维人员：校验失败仍为 HTTP 400 + `REQUEST_VALIDATION_FAILED`，不暴露内部 stack 或额外诊断字段。
- 主要受影响范围为 `agent-channel-web` 的 preview 路由、其 querystring schema、preview 路由测试与 preview 路径的 OpenAPI yaml；不触及 runtime、session、gateway、stream、context 或前端。
