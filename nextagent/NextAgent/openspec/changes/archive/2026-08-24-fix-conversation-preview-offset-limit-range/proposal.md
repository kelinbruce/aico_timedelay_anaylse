# Tighten Conversation Preview Offset/Limit Range And Error Messages

## Why

`GET /api/v1/sessions/{sessionId}/conversation/preview` 的分页参数范围与错误消息存在三处问题，已由线上请求 `?offset=1000000000000000000000000000&limit=20` 暴露：

1. **超大 offset 消息不准确**：`offset=1e27`（28 位数字）经 `parseStrictInteger` 的 `Number()` 解析后超出 `Number.MAX_SAFE_INTEGER`，命中 `Number.isSafeInteger` 检查，抛 `offset must be a finite safe integer.`。该值**是有限的**（`1e27` 非 `Infinity`），"finite" 一词误导调用方，且未给出可接受的边界。

2. **offset 无上界**：preview 的 `offset` 此前只校验非负，无上限。超大 offset（即使 ≤ `MAX_SAFE_INTEGER`）会原样透传到 gateway 的 `LIMIT ? OFFSET ?`，对 preview 这种 marker 分页无意义，且与 limit 的上界约束不对称。

3. **limit 上限过宽**：preview `limit` 上限为 `500`，与实际 marker 分页需求（前端 preview rail 固定窗口 `limit=100`）不符；stable spec `session-conversation-preview` 的 scenario 标题为 "without imposing a total cap"，但 limit=500 已是隐式 cap，且 stable spec 与实现的错误文案不一致（spec 写 `limit must be between 1 and 500.`，实现抛 `limit must not exceed 500.`）。

### 关键约束

- preview 在 web 边界 `parseConversationPreviewQuery` 解析，**早于任何 store 调用**；错误消息不依赖后端是 SQLite 还是 memory，纯解析层问题。
- stable spec `session-conversation-preview` 的 Requirement `会话预览查询校验返回确定字段级结果` 已固化 `limit must be between 1 and 500.` 与 `offset must be a finite safe integer.` 文案，本次为**收紧既有契约**（修改可观察的边界与消息），须写 MODIFIED delta。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- `offset` 范围收紧为 `0` 到 `10000`（含），默认 `0`；超过 `10000` 返回字段级 `offset must not exceed 10000.`。
- 超大 digit string（如 `1e27`，长度 > 5）在 `Number()` 解析前被长度守卫拦截，返回 `offset must not exceed 10000.`，不再返回误导的 `offset must be a finite safe integer.`。
- `limit` 上限由 `500` 收紧为 `100`；超过返回 `limit must not exceed 100.`（与实现现有 `must not exceed` 文案风格一致）。
- 错误消息文案与 stable spec 对齐：spec 与实现统一用 `must not exceed`，消除 `between 1 and 500.` 的文案漂移。
- SQLite gateway 的 backstop 校验同步收紧（`CONVERSATION_PREVIEW_MAX_PAGE_LIMIT` 500→100，新增 offset ≤10000），保持 web 边界与 gateway 双重一致。

**非目标：**

- 不改 `/conversation`（非 preview）路由的 `limit`（仍为 `MAX_CONVERSATION_LIMIT=200`）、cursor、anchor 校验。
- 不改 `parseStrictInteger` / `parsePositiveInteger` 共享函数本身（不影响 createdFrom/createdTo 等其他端点）；offset 长度守卫写在 preview 专属 parser 内。
- 不改成功响应 schema、默认 offset 语义（省略时取最新窗口）、preview rail 前端行为。
- 不引入新 SafeError code（复用 `REQUEST_VALIDATION_FAILED`）。
- 不改 `WEB_QUERY_OFFSET_MAX_LENGTH=7`（被 annotation/memory 的 offset 共用，仅 preview 引入独立 5 位上限）。

## What Changes

- `parseConversationPreviewQuery`（`requests.ts`）在 `parseStrictInteger` 之前加 offset 长度守卫：`query.offset.length > WEB_CONVERSATION_PREVIEW_OFFSET_MAX_LENGTH`（5）→ `throwValidation('offset must not exceed 10000.')`；解析后加数值上界 `offset > 10000` → 同消息。
- `MAX_CONVERSATION_PREVIEW_LIMIT` 由 `500` 改 `100`；新增 `MAX_CONVERSATION_PREVIEW_OFFSET = 10000`；`WEB_CONVERSATION_PREVIEW_OFFSET_MAX_LENGTH = 5`。
- `sqlite-gateway-core.ts` `listConversationPreview` backstop：`CONVERSATION_PREVIEW_MAX_PAGE_LIMIT` 500→100，校验加 `offset > CONVERSATION_PREVIEW_MAX_OFFSET`（10000）。
- stable spec `session-conversation-preview` 的 `会话预览查询校验返回确定字段级结果` Requirement：MODIFIED scenario——`limit must be between 1 and 500.` → `limit must not exceed 100.`；移除 `offset must be a finite safe integer.`，新增 `offset must not exceed 10000.`；"without imposing a total cap" scenario 的 `limit greater than 500` → `limit greater than 100`，并补 offset ≤10000 约束。

本 change 包含可观察契约变更（limit 上限 500→100、offset 新增上界 10000、错误消息文案变更），属破坏性收紧，写 MODIFIED delta spec。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-1.8 查看会话消息` → `specs/session-conversation-preview/spec.md`
  - 功能边界：preview 分页参数范围收紧（offset 0–10000、limit 1–100），错误消息对齐实现与文档。
  - 系统质量属性：可靠性、一致性、可测试性。
  - 映射说明：`session-conversation-preview` 为 canonical spec，本 change 固化 MODIFIED delta。

## 影响范围（Impact）

- API 调用方：`limit` 取 101–500 的请求由 `200` 改为 `400 limit must not exceed 100.`；`offset` 取 >10000 由透传改 `400 offset must not exceed 10000.`；超大 offset（如 `1e27`）由 `offset must be a finite safe integer.` 改为 `offset must not exceed 10000.`。`limit` 1–100、`offset` 0–10000 行为不变。
- 前端 preview rail：固定 `limit=100` 窗口不受影响；预加载相邻窗口逻辑（80 marker 阈值）不依赖 >100 的 limit。
- Agent 开发者与平台集成方：无需修改成功响应 schema；仅校验边界收紧。
- 运维人员：失败路径产生字段级 `REQUEST_VALIDATION_FAILED`，不暴露 `finite safe integer` 这类实现术语。
- 主要受影响范围为 `agent-channel-web` 的 `parseConversationPreviewQuery` 与 `agent-platform-gateway-local` 的 `listConversationPreview` backstop。
